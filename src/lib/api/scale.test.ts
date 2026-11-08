import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { z } from 'zod'
import { Limiter, MemoryLimitStore } from './limiter'
import { ConvexLimitStore } from './stores/convex'
import { MemoryIdempotencyStore } from './idempotency'
import { defineOp } from './registry'
import { seedBulk } from './sample'
import { EventLog } from './events'
import { SearchIndex, parseQuery } from './search'
import { clock, harness } from './testing'
import { allOperations } from './index'
import type { SearchDoc } from './search'
import type { Reply } from './testing'

const REPO = '/repos/dana/gitfs'
const p99 = (xs: Array<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.99)]
const p50 = (xs: Array<number>) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.5)]

describe('rate limits across many nodes', () => {
  test('an unreachable shared store admits one small block, not one unit per request', async () => {
    const store = new ConvexLimitStore(() => Promise.reject(new Error('down')), 'secret')
    const policy = { limit: 100, windowMs: 60_000 }
    const error = console.error
    console.error = () => {}
    try {
      const a = await store.take('key', 10, policy, 1_000)
      const b = await store.take('key', 10, policy, 1_001)
      expect(a.granted).toBe(1)
      expect(b.granted).toBe(0)
    } finally {
      console.error = error
    }
  })

  test('nodes sharing a store never admit more than the limit, and rarely ask the store', async () => {
    const store = new MemoryLimitStore()
    const now = clock()
    const nodes = Array.from({ length: 4 }, () => new Limiter(store, { now }))
    const policy = { limit: 1000, windowMs: 60_000 }
    let admitted = 0
    for (let i = 0; i < 3000; i++) {
      const d = await nodes[i % 4].check('read:tok_a', policy, 1)
      if (d.allowed) admitted++
    }
    expect(admitted).toBeLessThanOrEqual(1000)
    // Units leased and not spent are lost until the window ends: at most nodes * lease.
    expect(admitted).toBeGreaterThanOrEqual(1000 - 4 * 50)
    // 3000 requests, but the shared store saw a small fraction of them.
    expect(store.calls).toBeLessThan(60)
  })

  test('a flood of denied requests does not become a flood of store writes', async () => {
    const store = new MemoryLimitStore()
    const node = new Limiter(store, { now: clock() })
    const policy = { limit: 100, windowMs: 60_000 }
    for (let i = 0; i < 20_000; i++) await node.check('k', policy, 1)
    expect(store.calls).toBeLessThan(40)
  })

  test('a new window starts fresh', async () => {
    const store = new MemoryLimitStore()
    const now = clock()
    const node = new Limiter(store, { now })
    const policy = { limit: 10, windowMs: 60_000 }
    for (let i = 0; i < 10; i++) await node.check('k', policy, 1)
    expect((await node.check('k', policy, 1)).allowed).toBe(false)
    now.advance(60_000)
    expect((await node.check('k', policy, 1)).allowed).toBe(true)
  })

  test('on the wire: headers say what is left, 429 says when to come back', async () => {
    const h = harness({ pools: { read: { limit: 5, windowMs: 60_000 }, write: { limit: 5, windowMs: 60_000 }, heavy: { limit: 5, windowMs: 60_000 }, search: { limit: 5, windowMs: 60_000 }, anonymous: { limit: 3, windowMs: 60_000 } } })
    const first = await h.call('GET', '/repos')
    expect(first.headers.get('ratelimit-policy')).toBe('"read";q=5;w=60')
    expect(first.headers.get('ratelimit')).toMatch(/^"read";r=4;t=\d+$/)
    for (let i = 0; i < 4; i++) expect((await h.call('GET', '/repos')).status).toBe(200)
    const denied = await h.call('GET', '/repos')
    expect(denied.status).toBe(429)
    expect(denied.json.code).toBe('rate_limited')
    expect(denied.json.retryable).toBe(true)
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(denied.json).toMatchObject({ pool: 'read', limit: 5, window_seconds: 60 })
    // Another token has its own budget; so does an anonymous caller.
    expect((await h.call('GET', '/repos', { token: h.tokens.hollis })).status).toBe(200)
    expect((await h.call('GET', '/repos', { token: null, headers: { 'x-forwarded-for': '1.2.3.4' } })).status).toBe(200)
  })

  test('an anonymous caller cannot get a fresh budget by lying about their address', async () => {
    const pool = { limit: 2, windowMs: 60_000 }
    const h = harness({ pools: { read: pool, write: pool, heavy: pool, search: pool, anonymous: pool } })
    // Our proxy appends the real address last. Whatever comes before it is the caller's claim.
    const as = (claimed: string) => ({ 'x-forwarded-for': `${claimed}, 9.9.9.9` })
    expect((await h.call('GET', '/repos', { token: null, headers: as('1.1.1.1') })).status).toBe(200)
    expect((await h.call('GET', '/repos', { token: null, headers: as('2.2.2.2') })).status).toBe(200)
    expect((await h.call('GET', '/repos', { token: null, headers: as('3.3.3.3') })).status).toBe(429)
  })

  test('a 304 costs nothing', async () => {
    const h = harness({ pools: { read: { limit: 6, windowMs: 60_000 }, write: { limit: 6, windowMs: 60_000 }, heavy: { limit: 6, windowMs: 60_000 }, search: { limit: 6, windowMs: 60_000 }, anonymous: { limit: 6, windowMs: 60_000 } } })
    const etag = (await h.call('GET', `${REPO}/changes/216`)).headers.get('etag')!
    for (let i = 0; i < 40; i++) {
      const r = await h.call('GET', `${REPO}/changes/216`, { headers: { 'if-none-match': etag } })
      expect(r.status).toBe(304)
    }
    expect((await h.call('GET', `${REPO}/changes/216`)).status).toBe(200)
  })

  test('discovery and identity are never limited', async () => {
    const h = harness({ pools: { read: { limit: 1, windowMs: 60_000 }, write: { limit: 1, windowMs: 60_000 }, heavy: { limit: 1, windowMs: 60_000 }, search: { limit: 1, windowMs: 60_000 }, anonymous: { limit: 1, windowMs: 60_000 } } })
    for (let i = 0; i < 20; i++) {
      expect((await h.call('GET', '/auth/principal')).status).toBe(200)
      expect((await h.call('GET', '/limits', { token: null })).status).toBe(200)
    }
  })

  test('too many requests in flight for one token are turned away', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow = defineOp({
      id: 'test.slow', summary: 'slow', tags: ['test'], method: 'GET', path: '/slow', auth: 'required', pool: 'none',
      safety: 'read', idempotent: true, response: z.strictObject({ ok: z.boolean() }),
      handler: () => Effect.promise(async () => { await gate; return { ok: true } }),
    })
    const h = harness({ ops: [...allOperations(), slow], concurrencyPerToken: 3 })
    const calls = Array.from({ length: 5 }, () => h.call('GET', '/slow'))
    await new Promise((r) => setTimeout(r, 30))
    release()
    const results = await Promise.all(calls)
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 200, 200, 429, 429])
    expect(results.find((r) => r.status === 429)!.json.code).toBe('concurrency_limited')
    // And the slots are free again.
    expect((await h.call('GET', '/slow')).status).toBe(200)
  })

  test('two nodes share idempotency keys and rate budgets', async () => {
    const limitStore = new MemoryLimitStore()
    const idempotency = new MemoryIdempotencyStore()
    const now = clock()
    const a = harness({ now, limitStore, idempotency })
    const b = harness({ now, limitStore, idempotency })
    const headers = { 'idempotency-key': 'across-nodes' }
    const first = await a.call('POST', `${REPO}/issues`, { body: { title: 'Once' }, headers })
    const second = await b.call('POST', `${REPO}/issues`, { body: { title: 'Once' }, headers })
    expect(second.headers.get('sx-replayed')).toBe('true')
    expect(second.json.id).toBe(first.json.id)
    expect(limitStore.calls).toBeGreaterThan(0)
  })
})

describe('speed (generous bounds; scripts/api-bench.ts prints the real numbers)', () => {
  async function timeMany(n: number, f: () => Promise<unknown>) {
    for (let i = 0; i < 200; i++) await f()
    const out: Array<number> = []
    for (let i = 0; i < n; i++) {
      const t = performance.now()
      await f()
      out.push(performance.now() - t)
    }
    return out
  }

  test('reads of one object, cached and conditional', async () => {
    const h = harness()
    const url = `${REPO}/changes/216`
    const etag = (await h.call('GET', url)).headers.get('etag')!
    const plain = await timeMany(1500, () => h.call('GET', url))
    const cond = await timeMany(1500, () => h.call('GET', url, { headers: { 'if-none-match': etag } }))
    console.log(`  one change: p50 ${p50(plain).toFixed(3)}ms p99 ${p99(plain).toFixed(3)}ms; 304: p50 ${p50(cond).toFixed(3)}ms p99 ${p99(cond).toFixed(3)}ms`)
    expect(p99(plain)).toBeLessThan(5)
    expect(p99(cond)).toBeLessThan(5)
  })

  test('a page of 50 from 10,000 changes costs the same at any depth', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'huge', 10_000, 2_000), pools: { read: { limit: 1e9, windowMs: 60_000 }, write: { limit: 1e9, windowMs: 60_000 }, heavy: { limit: 1e9, windowMs: 60_000 }, search: { limit: 1e9, windowMs: 60_000 }, anonymous: { limit: 1e9, windowMs: 60_000 } } })
    const base = '/repos/dana/huge/changes?state=all&limit=50'
    const firstPage = await h.call('GET', base)
    // Walk to the last page, remembering a deep cursor.
    let cursor: string | null = firstPage.json.next_cursor
    let deep = cursor
    for (let i = 0; i < 150 && cursor; i++) {
      const r = await h.call('GET', `${base}&cursor=${cursor}`)
      cursor = r.json.next_cursor
      if (i === 150 - 2) deep = cursor
    }
    const shallow = await timeMany(300, () => h.call('GET', base))
    const deepT = await timeMany(300, () => h.call('GET', `${base}&cursor=${deep}`))
    console.log(`  50 of 10,000: first page p50 ${p50(shallow).toFixed(3)}ms p99 ${p99(shallow).toFixed(3)}ms; deep page p50 ${p50(deepT).toFixed(3)}ms p99 ${p99(deepT).toFixed(3)}ms`)
    expect(p99(shallow)).toBeLessThan(10)
    expect(p50(deepT)).toBeLessThan(p50(shallow) * 3 + 0.3)
  })

  test('a filter that matches rarely still stays bounded', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'huge', 10_000, 0), pools: { read: { limit: 1e9, windowMs: 60_000 }, write: { limit: 1e9, windowMs: 60_000 }, heavy: { limit: 1e9, windowMs: 60_000 }, search: { limit: 1e9, windowMs: 60_000 }, anonymous: { limit: 1e9, windowMs: 60_000 } } })
    const t = await timeMany(100, () => h.call('GET', '/repos/dana/huge/changes?author=ines&limit=50'))
    console.log(`  filtered scan of 10,000: p50 ${p50(t).toFixed(3)}ms p99 ${p99(t).toFixed(3)}ms`)
    expect(p99(t)).toBeLessThan(40)
  })

  test('hundreds of concurrent readers', async () => {
    const h = harness({ pools: { read: { limit: 1e9, windowMs: 60_000 }, write: { limit: 1e9, windowMs: 60_000 }, heavy: { limit: 1e9, windowMs: 60_000 }, search: { limit: 1e9, windowMs: 60_000 }, anonymous: { limit: 1e9, windowMs: 60_000 } }, concurrencyPerToken: 1000 })
    const started = performance.now()
    const n = 10_000
    const lat: Array<number> = []
    await Promise.all(
      Array.from({ length: 500 }, async (_, w) => {
        for (let i = w; i < n; i += 500) {
          const t = performance.now()
          const r = await h.call('GET', `${REPO}/changes/216`)
          lat.push(performance.now() - t)
          if (r.status !== 200) throw new Error(`status ${r.status}`)
        }
      }),
    )
    const rps = n / ((performance.now() - started) / 1000)
    console.log(`  500 concurrent readers: ${rps.toFixed(0)} req/s in-process`)
    expect(rps).toBeGreaterThan(1500)
  })

  test('two thousand long-polling clients wake on one event and leave nothing behind', async () => {
    const h = harness({ pools: { read: { limit: 1e9, windowMs: 60_000 }, write: { limit: 1e9, windowMs: 60_000 }, heavy: { limit: 1e9, windowMs: 60_000 }, search: { limit: 1e9, windowMs: 60_000 }, anonymous: { limit: 1e9, windowMs: 60_000 } }, concurrencyPerToken: 5000 })
    const etag = (await h.call('GET', `${REPO}/changes/216`)).headers.get('etag')!
    const waiters = Array.from({ length: 2000 }, () => h.call('GET', `${REPO}/changes/216?wait=20`, { headers: { 'if-none-match': etag } }))
    await new Promise((r) => setTimeout(r, 100))
    expect(h.api.events.waiting).toBe(2000)
    const t = performance.now()
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: h.tokens.hollis, body: { state: 'commented' } })
    const results = await Promise.all(waiters)
    const took = performance.now() - t
    console.log(`  2000 waiters woken and answered in ${took.toFixed(0)}ms`)
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(took).toBeLessThan(2000)
    expect(h.api.events.waiting).toBe(0)
  })

  test('an event on one repository does not wake waiters on another', async () => {
    const h = harness()
    const etag = (await h.call('GET', '/repos/dana/tinyqueue')).headers.get('etag')!
    const waiting = h.call('GET', '/repos/dana/tinyqueue?wait=1', { headers: { 'if-none-match': etag } })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Elsewhere' } })
    expect((await waiting).status).toBe(304)
  })

  test('hundreds of event streams each get the event', async () => {
    const h = harness({ concurrencyPerToken: 5000, pools: { read: { limit: 1e9, windowMs: 60_000 }, write: { limit: 1e9, windowMs: 60_000 }, heavy: { limit: 1e9, windowMs: 60_000 }, search: { limit: 1e9, windowMs: 60_000 }, anonymous: { limit: 1e9, windowMs: 60_000 } } })
    const readers = await Promise.all(
      Array.from({ length: 300 }, async () => {
        const res = await h.api.fetch(new Request('https://api.test/v1/events/stream', { headers: { authorization: `Bearer ${h.tokens.dana}` } }))
        const r = res.body!.getReader()
        await r.read()
        return r
      }),
    )
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Broadcast' } })
    const decoder = new TextDecoder()
    const chunks = await Promise.all(readers.map(async (r) => decoder.decode((await r.read()).value)))
    expect(chunks.every((c) => c.includes('Broadcast'))).toBe(true)
    await Promise.all(readers.map((r) => r.cancel()))
  })

  test('a hundred thousand idempotency keys are swept', () => {
    const now = clock()
    const store = new MemoryIdempotencyStore(1000, now)
    for (let i = 0; i < 100_000; i++) void store.begin('acc', `k${i}`, 'x')
    expect(store.size).toBe(100_000)
    now.advance(2000)
    store.sweep()
    expect(store.size).toBe(0)
  })
})

describe('what keeps it fast must not make it wrong', () => {
  test('a cached list shows a change the moment it changes, and to each viewer what they may do', async () => {
    const h = harness()
    const url = `${REPO}/changes?limit=50`
    const before = (await h.call('GET', url)).json.data.find((c: { number: number }) => c.number === 212)
    expect(before.title).toBe('Normalize Windows path separators')
    await h.call('PATCH', `${REPO}/changes/212`, { body: { title: 'Normalize Windows and UNC paths' } })
    const after = await h.call('GET', url)
    expect(after.json.data.find((c: { number: number }) => c.number === 212).title).toBe('Normalize Windows and UNC paths')
    expect(after.headers.get('etag')).not.toBe((await h.call('GET', `${REPO}/changes?limit=50&state=open`)).headers.get('etag'))
    // The same list for someone who cannot do anything must not carry dana's abilities.
    const anon = (await h.call('GET', url, { token: null })).json.data.find((c: { number: number }) => c.number === 212)
    const mine = (await h.call('GET', url)).json.data.find((c: { number: number }) => c.number === 212)
    expect(anon.actions.abandon.allowed).toBe(false)
    expect(mine.actions.abandon.allowed).toBe(true)
    // And a conditional request on the list answers 304 until something in it moves.
    const etag = (await h.call('GET', url)).headers.get('etag')!
    expect((await h.call('GET', url, { headers: { 'if-none-match': etag } })).status).toBe(304)
    await h.call('POST', `${REPO}/changes/212/reviews`, { token: h.tokens.hollis, body: { state: 'commented' } })
    expect((await h.call('GET', url, { headers: { 'if-none-match': etag } })).status).toBe(200)
  })

  test('policy is worked out once per version and never served stale', async () => {
    const h = harness()
    const state = async () => (await h.call('GET', `${REPO}/changes/216/policy`)).json
    expect((await state()).state).toBe('blocked')
    await h.call('POST', `${REPO}/changes/216/findings/F-2/resolve`)
    await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/test', state: 'pass', tree: '9c4d7e1' } })
    expect((await state()).state).toBe('met')
    // A new patch set that rewrites the code takes the approval and the evidence with it.
    await h.call('POST', `${REPO}/changes/216/patch-sets`, { body: { sha: 'ccccccc3', kind: 'update' } })
    expect((await state()).state).toBe('pending')
  })

  test('the newest review per person is tracked as reviews arrive', async () => {
    const h = harness()
    const hollis = async () => (await h.call('GET', `${REPO}/changes/216`)).json.reviewers.find((r: { actor: { handle: string } }) => r.actor.handle === 'hollis')
    expect((await hollis()).state).toBe('approved')
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: h.tokens.hollis, body: { state: 'changes' } })
    expect((await hollis()).state).toBe('changes')
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: h.tokens.hollis, body: { state: 'approved' } })
    expect((await hollis()).state).toBe('approved')
  })

  test('opening an issue and finding a change by branch do not scan everything', async () => {
    const unlimited = { limit: 1e9, windowMs: 60_000 }
    const h = harness({
      seed: (d) => seedBulk(d, 'dana', 'big', 20_000, 20_000),
      pools: { read: unlimited, write: unlimited, heavy: unlimited, search: unlimited, anonymous: unlimited },
    })
    const t = performance.now()
    for (let i = 0; i < 500; i++) {
      const r = await h.call('POST', '/repos/dana/big/issues', { body: { title: `Fresh ${i}` } })
      expect(r.status).toBe(201)
    }
    const issues = performance.now() - t
    const t2 = performance.now()
    for (let i = 0; i < 300; i++) await h.call('POST', '/repos/dana/big/changes', { body: { branch: `new-${i % 20}` } })
    const changes = performance.now() - t2
    console.log(`  500 issues into 20,000: ${issues.toFixed(0)} ms; 300 pushes by branch into 20,000 changes: ${changes.toFixed(0)} ms`)
    // A scan of 20,000 per write would take seconds. Generous: well under a second each.
    expect(issues).toBeLessThan(1500)
    expect(changes).toBeLessThan(1500)
    // Duplicates are still found: that is what the index is for.
    expect((await h.call('POST', '/repos/dana/big/issues', { body: { title: 'Fresh 7' } })).headers.get('sx-outcome')).toBe('unchanged')
    // Closing frees the title; renaming moves it.
    expect((await h.call('POST', '/repos/dana/big/issues', { body: { title: 'Issue 1' } })).headers.get('sx-outcome')).toBe('unchanged')
    await h.call('PATCH', '/repos/dana/big/issues/20002', { body: { state: 'closed' } })
    const again = await h.call('POST', '/repos/dana/big/issues', { body: { title: 'Issue 1' } })
    expect([again.status, again.headers.get('sx-outcome')]).toEqual([201, 'created'])
    await h.call('PATCH', `/repos/dana/big/issues/${again.json.number}`, { body: { title: 'Renamed' } })
    expect((await h.call('POST', '/repos/dana/big/issues', { body: { title: 'Issue 1' } })).headers.get('sx-outcome')).toBe('created')
    expect((await h.call('POST', '/repos/dana/big/issues', { body: { title: 'Renamed' } })).headers.get('sx-outcome')).toBe('unchanged')
  })

  test('memory is bounded: old idempotency keys and old events are dropped', async () => {
    const store = new MemoryIdempotencyStore(86_400_000, clock(), 1000)
    for (let i = 0; i < 5000; i++) void store.begin('a', `k${i}`, 'x')
    expect(store.size).toBe(1000)
    const h = harness({ events: new EventLog(clock(), 100) })
    for (let i = 0; i < 400; i++) await h.call('POST', `${REPO}/issues`, { body: { title: `E${i}` } })
    expect(h.api.events.all().length).toBeLessThanOrEqual(110)
    expect((await h.call('GET', '/events?limit=200')).json.data.length).toBeLessThanOrEqual(110)
  })

  test('a list read backwards is the same list read forwards', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 300, 0) })
    const walk = async (sort: string) => {
      const out: Array<number> = []
      let cursor: string | null = null
      do {
        const r: Reply = await h.call('GET', `/repos/dana/big/changes?state=all&limit=70&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`)
        for (const c of r.json.data) out.push(c.number)
        cursor = r.json.next_cursor
      } while (cursor)
      return out
    }
    const desc = await walk('-number')
    const asc = await walk('number')
    expect(asc).toEqual([...desc].reverse())
    expect(asc.length).toBe(300)
  })

  test('a search kept across writes gives the answer a fresh search would', () => {
    // A small vocabulary, so that documents and queries collide a lot.
    const vocab = ['cache', 'cachet', 'ref', 'refs', 'panic', 'path', 'bound', 'evict', 'lru', 'docs', 'flag', 'queue']
    let seed = 7
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const pick = () => vocab[Math.floor(rnd() * vocab.length)]
    const docs = new Map<string, SearchDoc>()
    const make = (i: number, t: number): SearchDoc => ({
      key: `issue:${i}`,
      type: 'issue',
      id: `iss_${i}`,
      repo: rnd() < 0.5 ? 'a/x' : 'a/y',
      number: i,
      title: `${pick()} ${pick()} ${pick()}`,
      text: `${pick()} ${pick()}`,
      state: rnd() < 0.5 ? 'open' : 'closed',
      author: 'dana',
      labels: [],
      updated: t,
      url: `u/${i}`,
    })
    const kept = new SearchIndex(() => docs.values(), new EventLog())
    const queries = ['cache', 'cach', 'ref panic', 'state:open lru', 'repo:a/x bound', '"cache ref"', 'docs fl', 'type:issue evict queue'].map(parseQuery)
    const all = () => true
    for (let step = 0; step < 600; step++) {
      // Mostly new documents, some rewrites of old ones.
      const i = rnd() < 0.7 ? step : Math.floor(rnd() * (step + 1))
      const doc = make(i, step)
      docs.set(doc.key, doc)
      kept.upsert(doc)
      if (step % 7 === 0) {
        const fresh = new SearchIndex(() => docs.values(), new EventLog())
        for (const q of queries) {
          const keyOf = (idx: SearchIndex) => idx.search(q, all, 'v').map((h) => `${h.doc.key}:${h.score}:${h.snippet}`)
          expect(keyOf(kept)).toEqual(keyOf(fresh))
        }
      }
    }
  })
})
