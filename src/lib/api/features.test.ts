import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { HttpTransport, MAX_ATTEMPTS, RETRY_DELAYS_MS, endpointProblem, isBlockedAddress } from './webhooks'
import { seedBulk } from './sample'
import { clock, harness } from './testing'
import type { Scheduler, SendResult, Transport } from './webhooks'

const REPO = '/repos/dana/gitfs'

// ---------------------------------------------------------------------------
// Webhooks

class ManualScheduler implements Scheduler {
  private jobs: Array<{ at: number; fn: () => void; live: boolean }> = []
  constructor(private readonly now: ReturnType<typeof clock>) {}
  after(ms: number, fn: () => void) {
    const job = { at: this.now() + ms, fn, live: true }
    this.jobs.push(job)
    return () => (job.live = false)
  }
  get pending() {
    return this.jobs.filter((j) => j.live).length
  }
  async advance(ms: number) {
    this.now.advance(ms)
    const due = this.jobs.filter((j) => j.live && j.at <= this.now())
    for (const j of due) {
      j.live = false
      j.fn()
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

type Sent = { url: string; headers: Record<string, string>; body: string }
class FakeTransport implements Transport {
  sent: Array<Sent> = []
  respond: (s: Sent, n: number) => SendResult = () => ({ status: 200, error: null, ms: 3 })
  inFlight = 0
  peak = 0
  delay = 0
  async send(req: Sent & { timeoutMs: number }) {
    this.inFlight++
    this.peak = Math.max(this.peak, this.inFlight)
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay))
    this.sent.push(req)
    this.inFlight--
    return this.respond(req, this.sent.length)
  }
}

function hooksHarness() {
  const now = clock()
  const transport = new FakeTransport()
  const scheduler = new ManualScheduler(now)
  const h = harness({ now, transport, scheduler })
  const create = async (events = ['*'], endpoint = 'https://hooks.example.com/sx') => {
    const r = await h.call('POST', `${REPO}/webhooks`, { body: { endpoint, events } })
    expect(r.status, r.text).toBe(201)
    return r.json
  }
  const settle = () => new Promise((r) => setTimeout(r, 10))
  return { ...h, now, transport, scheduler, create, settle }
}

function verify(secret: string, sent: Sent) {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64')
  const expected = `v1,${createHmac('sha256', key).update(`${sent.headers['webhook-id']}.${sent.headers['webhook-timestamp']}.${sent.body}`).digest('base64')}`
  return sent.headers['webhook-signature'].split(' ').includes(expected)
}

describe('webhooks: endpoints', () => {
  test('create shows the secret once; list and get never do', async () => {
    const h = hooksHarness()
    const made = await h.create(['change.*', 'issue.created'])
    expect(made.secret).toMatch(/^whsec_/)
    expect(made).toMatchObject({ object: 'webhook', endpoint: 'https://hooks.example.com/sx', active: true, events: ['change.*', 'issue.created'] })
    const list = await h.call('GET', `${REPO}/webhooks`)
    expect(list.text).not.toContain(made.secret)
    expect((await h.call('GET', `${REPO}/webhooks/${made.id}`)).json.secret).toBeNull()
  })

  test('addresses that reach inside our network are refused', async () => {
    const h = hooksHarness()
    for (const endpoint of [
      'http://hooks.example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'https://metadata.google.internal/x',
      'https://db.internal/x', 'https://2130706433/x', 'https://user:pw@hooks.example.com/x', 'https://192.168.1.1/x', 'https://[fd00::1]/x',
    ]) {
      const r = await h.call('POST', `${REPO}/webhooks`, { body: { endpoint, events: ['*'] } })
      expect(r.status, endpoint).toBe(400)
      expect(r.json.errors[0].pointer).toBe('/body/endpoint')
    }
  })

  test('only people who can write the repository, with the scope, manage webhooks', async () => {
    const h = hooksHarness()
    const body = { endpoint: 'https://hooks.example.com/sx', events: ['*'] }
    expect((await h.call('POST', `${REPO}/webhooks`, { token: h.tokens.hollis, body })).json.code).toBe('insufficient_scope')
    expect((await h.call('POST', `${REPO}/webhooks`, { token: h.tokens.stranger, body })).status).toBe(403)
    expect((await h.call('POST', '/repos/dana/notes/webhooks', { token: h.tokens.stranger, body })).status).toBe(404)
    expect((await h.call('GET', `${REPO}/webhooks`, { token: null })).status).toBe(401)
  })

  test('ten per repository', async () => {
    const h = hooksHarness()
    for (let i = 0; i < 10; i++) await h.create(['*'], `https://hooks.example.com/${i}`)
    expect((await h.call('POST', `${REPO}/webhooks`, { body: { endpoint: 'https://hooks.example.com/11', events: ['*'] } })).json.code).toBe('limit_reached')
  })

  test('update, dry run and delete', async () => {
    const h = hooksHarness()
    const made = await h.create()
    const dry = await h.call('PATCH', `${REPO}/webhooks/${made.id}?dry_run=true`, { body: { active: false } })
    expect(dry.json.active).toBe(true)
    const up = await h.call('PATCH', `${REPO}/webhooks/${made.id}`, { body: { events: ['issue.*'], description: 'issues only' } })
    expect(up.json).toMatchObject({ events: ['issue.*'], description: 'issues only', version: 2 })
    expect((await h.call('PATCH', `${REPO}/webhooks/${made.id}`, { body: { endpoint: 'https://10.0.0.1/x' } })).status).toBe(400)
    expect((await h.call('DELETE', `${REPO}/webhooks/${made.id}`)).status).toBe(204)
    expect((await h.call('GET', `${REPO}/webhooks/${made.id}`)).status).toBe(404)
  })
})

describe('webhooks: deliveries', () => {
  test('an event is delivered signed, with the object it produced, and the signature verifies', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.*'])
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Hooked' } })
    await h.settle()
    expect(h.transport.sent.length).toBe(1)
    const sent = h.transport.sent[0]
    expect(sent.headers['webhook-id']).toMatch(/^evt_/)
    expect(Number(sent.headers['webhook-timestamp'])).toBe(Math.floor(h.now() / 1000))
    expect(sent.headers['sx-event']).toBe('issue.created')
    expect(verify(made.secret, sent)).toBe(true)
    // Not a valid signature for another secret or a tampered body.
    expect(verify(made.secret, { ...sent, body: sent.body.replace('Hooked', 'Hacked') })).toBe(false)
    expect(verify('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', sent)).toBe(false)
    const payload = JSON.parse(sent.body)
    const event = (await h.call('GET', '/events?type=issue.created')).json.data.at(-1)
    expect(payload).toEqual(event)
    expect(payload.id).toBe(sent.headers['webhook-id'])
  })

  test('only subscribed events, only this repository', async () => {
    const h = hooksHarness()
    await h.create(['change.landed'])
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Not wanted' } })
    await h.call('POST', '/repos/dana/tinyqueue/issues', { body: { title: 'Elsewhere' } })
    await h.settle()
    expect(h.transport.sent.length).toBe(0)
  })

  test('a failing endpoint is retried on the schedule, then succeeds', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.created'])
    h.transport.respond = (_s, n) => (n < 3 ? { status: 503, error: null, ms: 4 } : { status: 200, error: null, ms: 4 })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Retry me' } })
    await h.settle()
    expect(h.transport.sent.length).toBe(1)
    await h.scheduler.advance(RETRY_DELAYS_MS[0] - 1)
    expect(h.transport.sent.length).toBe(1)
    await h.scheduler.advance(1)
    expect(h.transport.sent.length).toBe(2)
    await h.scheduler.advance(RETRY_DELAYS_MS[1])
    expect(h.transport.sent.length).toBe(3)
    const d = (await h.call('GET', `${REPO}/webhooks/${made.id}/deliveries`)).json.data[0]
    const full = (await h.call('GET', `${REPO}/webhooks/${made.id}/deliveries/${d.id}`)).json
    expect(full.state).toBe('succeeded')
    expect(full.attempts.map((a: { status: number }) => a.status)).toEqual([503, 503, 200])
    // Every attempt carries the same webhook-id: the receiver can deduplicate.
    expect(new Set(h.transport.sent.map((s) => s.headers['webhook-id'])).size).toBe(1)
    expect(full.payload.type).toBe('issue.created')
  })

  test('after the last attempt it is failed, and five failures in a row disable the endpoint', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.created'])
    h.transport.respond = () => ({ status: null, error: 'connection refused', ms: 1 })
    for (let i = 0; i < 5; i++) {
      await h.call('POST', `${REPO}/issues`, { body: { title: `Doomed ${i}` } })
      await h.settle()
    }
    for (let i = 0; i < MAX_ATTEMPTS; i++) await h.scheduler.advance(RETRY_DELAYS_MS.at(Math.min(i, RETRY_DELAYS_MS.length - 1))!)
    const hook = (await h.call('GET', `${REPO}/webhooks/${made.id}`)).json
    expect(hook.active).toBe(false)
    expect(hook.disabled_reason).toContain('5 deliveries in a row failed')
    const failed = (await h.call('GET', `${REPO}/webhooks/${made.id}/deliveries?state=failed`)).json.data
    expect(failed.length).toBe(5)
    expect(failed[0].attempt_count).toBe(MAX_ATTEMPTS)
    expect((await h.call('GET', '/events?type=webhook.disabled')).json.data.length).toBe(1)
    // Turning it back on clears the reason.
    const on = await h.call('PATCH', `${REPO}/webhooks/${made.id}`, { body: { active: true } })
    expect(on.json).toMatchObject({ active: true, disabled_reason: null })
  })

  test('410 Gone disables the endpoint at once', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.created'])
    h.transport.respond = () => ({ status: 410, error: null, ms: 1 })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Gone' } })
    await h.settle()
    const hook = (await h.call('GET', `${REPO}/webhooks/${made.id}`)).json
    expect(hook.active).toBe(false)
    expect(hook.disabled_reason).toContain('410')
  })

  test('ping, redelivery and replay', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.*'])
    const ping = await h.call('POST', `${REPO}/webhooks/${made.id}/ping`)
    expect(ping.status).toBe(202)
    await h.settle()
    expect(h.transport.sent[0].headers['sx-event']).toBe('webhook.ping')
    expect(verify(made.secret, h.transport.sent[0])).toBe(true)

    const head = (await h.call('GET', '/events?limit=1')).json
    const before = h.api.events.head
    await h.call('POST', `${REPO}/issues`, { body: { title: 'A' } })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'B' } })
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: h.tokens.hollis, body: { state: 'commented' } })
    await h.settle()
    const sentBefore = h.transport.sent.length
    // Redeliver one: same webhook-id, a new delivery pointing at the old.
    const list = (await h.call('GET', `${REPO}/webhooks/${made.id}/deliveries`)).json.data
    const target = list.find((d: { event: { type: string } }) => d.event.type === 'issue.created')
    const re = await h.call('POST', `${REPO}/webhooks/${made.id}/deliveries/${target.id}/redeliver`)
    expect(re.json.redelivery_of).toBe(target.id)
    await h.settle()
    expect(h.transport.sent.at(-1)!.headers['webhook-id']).toBe(target.event.id)
    // Replay everything this endpoint subscribes to since before the issues.
    const replay = await h.call('POST', `${REPO}/webhooks/${made.id}/replay`, { body: { after_sequence: before } })
    expect(replay.json).toMatchObject({ object: 'replay', queued: 2 })
    await h.settle()
    expect(h.transport.sent.length).toBe(sentBefore + 1 + 2)
    void head
  })

  test('rotating signs with both secrets for a day, then only the new one', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.created'])
    const rotated = (await h.call('POST', `${REPO}/webhooks/${made.id}/rotate-secret`)).json
    expect(rotated.secret).not.toBe(made.secret)
    await h.call('POST', `${REPO}/issues`, { body: { title: 'During overlap' } })
    await h.settle()
    const during = h.transport.sent.at(-1)!
    expect(during.headers['webhook-signature'].split(' ').length).toBe(2)
    expect(verify(made.secret, during)).toBe(true)
    expect(verify(rotated.secret, during)).toBe(true)
    await h.scheduler.advance(25 * 3_600_000)
    await h.call('POST', `${REPO}/issues`, { body: { title: 'After overlap' } })
    await h.settle()
    const after = h.transport.sent.at(-1)!
    expect(after.headers['webhook-signature'].split(' ').length).toBe(1)
    expect(verify(made.secret, after)).toBe(false)
    expect(verify(rotated.secret, after)).toBe(true)
  })

  test('deleting an endpoint cancels its pending retries', async () => {
    const h = hooksHarness()
    const made = await h.create(['issue.created'])
    h.transport.respond = () => ({ status: 500, error: null, ms: 1 })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Pending' } })
    await h.settle()
    expect(h.scheduler.pending).toBe(1)
    await h.call('DELETE', `${REPO}/webhooks/${made.id}`)
    expect(h.scheduler.pending).toBe(0)
  })

  test('a burst never has more than 64 sends in flight', async () => {
    const h = hooksHarness()
    await h.create(['issue.created'])
    h.transport.delay = 5
    const repoId = h.api.domain.repos.get('dana/gitfs')!.id
    for (let i = 0; i < 150; i++) h.api.domain.events.append({ type: 'issue.created', repo: 'dana/gitfs', repo_id: repoId, actor: { object: 'actor', id: 'acc_x', handle: 'dana', class: 'human' }, subject: { object: 'issue', id: `iss_${i}`, number: i }, changes: [], data: null })
    for (let i = 0; i < 60 && h.transport.sent.length < 150; i++) await new Promise((r) => setTimeout(r, 10))
    expect(h.transport.sent.length).toBe(150)
    expect(h.transport.peak).toBeLessThanOrEqual(64)
  })
})

describe('webhooks: where a delivery may go', () => {
  test.each([
    ['127.0.0.1', true], ['10.1.2.3', true], ['172.16.0.1', true], ['172.32.0.1', false], ['192.168.0.1', true],
    ['169.254.169.254', true], ['100.64.0.1', true], ['0.0.0.0', true], ['224.0.0.1', true], ['8.8.8.8', false], ['93.184.216.34', false],
    ['::1', true], ['::', true], ['fe80::1', true], ['fd12:3456::1', true], ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['2606:4700::1111', false],
    ['2002:7f00:1::', true], ['2002:808:808::', false], ['2001:0:4136:e378::', true],
  ])('%s blocked: %s', (ip, blocked) => {
    expect(isBlockedAddress(ip)).toBe(blocked)
  })

  test('endpointProblem', () => {
    expect(endpointProblem('https://hooks.example.com/x', false)).toBeNull()
    expect(endpointProblem('http://hooks.example.com/x', false)).toContain('https')
    expect(endpointProblem('http://localhost:8080/x', true)).toBeNull()
    expect(endpointProblem('https://' + 'a'.repeat(2100), false)).toContain('long')
  })

  test('the real transport delivers to a server, refuses private addresses, and times out', async () => {
    const seen: Array<{ headers: Headers; body: string }> = []
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      seen.push({ headers: req.headers, body: await req.text() })
      return new Response(req.url.includes('slow') ? await new Promise<string>((r) => setTimeout(() => r('late'), 300)) : 'ok')
    } })
    try {
      const url = `http://127.0.0.1:${server.port}/hook`
      const ok = await new HttpTransport(true).send({ url, headers: { 'webhook-id': 'evt_1', 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 2000 })
      expect(ok.status).toBe(200)
      expect(seen[0].headers.get('webhook-id')).toBe('evt_1')
      expect(seen[0].body).toBe('{"a":1}')
      const refused = await new HttpTransport(false).send({ url, headers: {}, body: '{}', timeoutMs: 2000 })
      expect(refused.status).toBeNull()
      expect(refused.error).toContain('private')
      expect(seen.length).toBe(1)
      const slow = await new HttpTransport(true).send({ url: `http://127.0.0.1:${server.port}/slow`, headers: {}, body: '{}', timeoutMs: 50 })
      expect(slow.error).toContain('too long')
    } finally {
      void server.stop(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Search

describe('search', () => {
  const titles = (r: { json: { data: Array<{ title: string }> } }) => r.json.data.map((x) => x.title)

  test('words, prefixes and numbers', async () => {
    const h = harness()
    expect(titles(await h.call('GET', '/search?q=negative'))).toContain('Cache negative ref lookups')
    expect(titles(await h.call('GET', '/search?q=negative%20cac'))).toContain('Bound the negative cache and evict LRU')
    const byNumber = await h.call('GET', '/search?q=%23216')
    expect(byNumber.json.data[0]).toMatchObject({ type: 'change', number: 216, repo: 'dana/gitfs' })
    expect((await h.call('GET', '/search?q=zzzznothing')).json.data).toEqual([])
  })

  test('phrases, qualifiers and types', async () => {
    const h = harness()
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('"negative cache"')}`))).toEqual(['Bound the negative cache and evict LRU'])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('type:issue state:open')}`)).sort()).toEqual(['Document the cache flags', 'Panic on trailing-dot ref names'])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('author:ines')}`))).toEqual(['Normalize Windows path separators'])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('label:bug type:issue')}`))).toEqual(['Panic on trailing-dot ref names'])
    // `is:` is a state shorthand where the value is a state, and a type
    // shorthand otherwise.
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('type:issue is:open')}`)).sort()).toEqual(['Document the cache flags', 'Panic on trailing-dot ref names'])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('is:draft cache')}`)).sort()).toEqual(['Bound the negative cache and evict LRU', 'Show cache stats in `gitfs doctor`'])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('is:issue is:closed')}`))).toEqual(['Support read-only mounts'])
    const repos = await h.call('GET', `/search?q=${encodeURIComponent('type:repo queue')}`)
    expect(repos.json.data.map((r: { repo: string }) => r.repo)).toEqual(['dana/tinyqueue'])
  })

  test('a title match ranks above a body match', async () => {
    const h = harness()
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Unrelated', body: 'mentions the zebra deep in the text' } })
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Zebra stripes' } })
    const r = await h.call('GET', '/search?q=zebra')
    expect(titles(r)).toEqual(['Zebra stripes', 'Unrelated'])
    expect(r.json.data.map((x: { score: number }) => x.score)).toEqual([3, 1])
    expect(r.json.data[1].snippet).toContain('zebra')
  })

  test('it follows writes: new, renamed and closed', async () => {
    const h = harness()
    await h.call('GET', '/search?q=anything')
    const made = await h.call('POST', `${REPO}/issues`, { body: { title: 'Quokka crash' } })
    expect(titles(await h.call('GET', '/search?q=quokka'))).toEqual(['Quokka crash'])
    await h.call('PATCH', `${REPO}/issues/${made.json.number}`, { body: { title: 'Wombat crash' } })
    expect(titles(await h.call('GET', '/search?q=quokka'))).toEqual([])
    expect(titles(await h.call('GET', '/search?q=wombat'))).toEqual(['Wombat crash'])
    await h.call('PATCH', `${REPO}/issues/${made.json.number}`, { body: { state: 'closed' } })
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('wombat state:open')}`))).toEqual([])
    expect(titles(await h.call('GET', `/search?q=${encodeURIComponent('wombat state:closed')}`))).toEqual(['Wombat crash'])
  })

  test('a repository description change reaches the index', async () => {
    const h = harness()
    await h.call('PATCH', REPO, { body: { description: 'zebra words here' } })
    const r = await h.call('GET', '/search?q=zebra')
    expect(r.json.data.some((x: { repo: string }) => x.repo === 'dana/gitfs')).toBe(true)
  })

  test('private repositories never leak into results', async () => {
    const h = harness()
    await h.call('POST', '/repos/dana/notes/issues', { body: { title: 'Secret xylophone plan' } })
    expect(titles(await h.call('GET', '/search?q=xylophone'))).toEqual(['Secret xylophone plan'])
    expect(titles(await h.call('GET', '/search?q=xylophone', { token: h.tokens.stranger }))).toEqual([])
    expect(titles(await h.call('GET', '/search?q=xylophone', { token: null }))).toEqual([])
    // A token limited to another repository has the same view as a stranger to private things.
    expect(titles(await h.call('GET', '/search?q=xylophone', { token: h.tokens.limited }))).toEqual([])
  })

  test('a cursor walks tied results without losing any', async () => {
    const h = harness()
    for (let i = 0; i < 8; i++) await h.call('POST', `${REPO}/issues`, { body: { title: `tiebreak ${i}` } })
    const seen: Array<string> = []
    let cursor: string | null = null
    do {
      const r = await h.call('GET', `/search?q=tiebreak&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      for (const x of r.json.data) seen.push(x.id)
      cursor = r.json.next_cursor
    } while (cursor)
    expect(new Set(seen).size).toBe(8)
  })

  test('there is no cap: a cursor walks every match once', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 3000, 1000) })
    const seen: Array<string> = []
    let cursor: string | null = null
    do {
      const r = await h.call('GET', `/search?q=${encodeURIComponent('change repo:dana/big')}&limit=200${cursor ? `&cursor=${cursor}` : ''}`)
      expect(r.status, r.text.slice(0, 200)).toBe(200)
      for (const x of r.json.data) seen.push(x.id)
      cursor = r.json.next_cursor
    } while (cursor)
    expect(seen.length).toBe(3000)
    expect(new Set(seen).size).toBe(3000)
  })

  test('errors: empty query, wrong cursor', async () => {
    const h = harness()
    expect((await h.call('GET', '/search?q=%20')).status).toBe(400)
    expect((await h.call('GET', `/search?q=${encodeURIComponent('!!')}`)).json.errors[0].code).toBe('empty_query')
    const a = await h.call('GET', `/search?q=cache&limit=1`)
    const b = await h.call('GET', `/search?q=queue&cursor=${a.json.next_cursor}`)
    expect(b.json.code).toBe('cursor_mismatch')
  })
})

// ---------------------------------------------------------------------------
// Uploads and evidence

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('uploads', () => {
  const start = async (h: ReturnType<typeof harness>, body: Record<string, unknown> = {}) => {
    const r = await h.call('POST', '/uploads', { body: { filename: 'after.png', content_type: 'image/png', size: PNG.length, ...body } })
    return r
  }
  const put = (h: ReturnType<typeof harness>, url: string, bytes: Uint8Array, type = 'image/png') =>
    h.api.fetch(new Request(url.replace('https://api.source.code/v1', 'https://api.test/v1'), { method: 'PUT', headers: { 'content-type': type }, body: bytes as unknown as BodyInit }))

  test('announce, send to the signed address, read it back', async () => {
    const h = harness()
    const made = await start(h)
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ state: 'pending', content_url: null })
    expect(made.json.upload_url).toContain('/data?exp=')
    // No token on the PUT: the address is the credential.
    const sent = await put(h, made.json.upload_url, PNG)
    expect(sent.status).toBe(200)
    const done = (await sent.json())
    expect(done.state).toBe('uploaded')
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(done.upload_url).toBeNull()
    const got = await h.api.fetch(new Request(done.content_url.replace('https://api.source.code/v1', 'https://api.test/v1'), { headers: { authorization: `Bearer ${h.tokens.dana}` } }))
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    expect(got.headers.get('content-disposition')).toContain('inline')
    expect(got.headers.get('etag')).toBe(`"${done.sha256}"`)
  })

  test('a signed address works once, and only for exactly what was declared', async () => {
    const h = harness()
    const made = (await start(h)).json
    expect((await put(h, made.upload_url, new Uint8Array([...PNG, 9]))).status).toBe(400)
    expect((await put(h, made.upload_url, PNG, 'image/jpeg')).status).toBe(415)
    expect((await put(h, made.upload_url.replace(/sig=.{4}/, 'sig=AAAA'), PNG)).status).toBe(403)
    expect((await put(h, made.upload_url.replace(made.id, 'upl_0000000000nonexistent'), PNG)).status).toBe(403)
    expect((await put(h, made.upload_url, PNG)).status).toBe(200)
    expect((await put(h, made.upload_url, PNG)).status).toBe(400)
  })

  test('an idempotency key covers the bytes, so different bytes are refused', async () => {
    const h = harness()
    const made = (await start(h)).json
    const sendBytes = (bytes: Uint8Array) => h.api.fetch(new Request(made.upload_url.replace('https://api.source.code/v1', 'https://api.test/v1'), {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'bytes-key', 'x-forwarded-for': '1.1.1.1' },
      body: bytes as unknown as BodyInit,
    }))
    expect((await sendBytes(PNG)).status).toBe(200)
    const changed = new Uint8Array(PNG)
    changed[changed.length - 1] = 7
    expect((await sendBytes(changed)).status).toBe(422)
  })

  test('an anonymous idempotency key belongs to one caller, not everyone', async () => {
    const h = harness()
    const a = (await start(h)).json
    const b = (await start(h)).json
    const send = (u: { upload_url: string }, ip: string) =>
      h.api.fetch(new Request(u.upload_url.replace('https://api.source.code/v1', 'https://api.test/v1'), {
        method: 'PUT',
        headers: { 'content-type': 'image/png', 'idempotency-key': 'same-key', 'x-forwarded-for': ip },
        body: PNG as unknown as BodyInit,
      }))
    expect((await send(a, '1.1.1.1')).status).toBe(200)
    const second = await send(b, '2.2.2.2')
    expect(second.status).toBe(200)
    expect(second.headers.get('sx-replayed')).toBeNull()
  })

  test('an upload that is never attached is swept after its grace period', async () => {
    const now = clock()
    const h = harness({ now })
    const made = (await start(h)).json
    await put(h, made.upload_url, PNG)
    now.advance(25 * 3_600_000)
    await start(h) // creating the next upload runs the sweep
    expect((await h.call('GET', `/uploads/${made.id}/content`)).status).toBe(404)
  })

  test('the address expires after an hour', async () => {
    const now = clock()
    const h = harness({ now })
    const made = (await start(h)).json
    now.advance(3_600_001)
    const r = await put(h, made.upload_url, PNG)
    expect(r.status).toBe(403)
    expect(((await r.json())).code).toBe('signature_invalid')
  })

  test('a file is checked against what it claims to be', async () => {
    const h = harness()
    const made = (await start(h)).json
    const script = new TextEncoder().encode('<script>alert(1)</script>')
    const m2 = (await start(h, { size: script.length })).json
    const r = await put(h, m2.upload_url, script)
    expect(r.status).toBe(400)
    expect(((await r.json())).errors[0].message).toContain('not a valid image/png')
    expect(made.id).toBeTruthy()
    const bad = await h.call('POST', '/uploads', { body: { filename: 'x.svg', content_type: 'image/svg+xml', size: 10 } })
    expect(bad.status).toBe(400)
    expect((await h.call('POST', '/uploads', { body: { filename: 'x.png', content_type: 'image/png', size: 11 << 20 } })).status).toBe(413)
  })

  test('a check details URL cannot be a script or data URL', async () => {
    const h = harness()
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])
      expect((await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/x', state: 'pass', tree: '9c4d7e1', details_url: url } })).status).toBe(400)
    expect((await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/x', state: 'pass', tree: '9c4d7e1', details_url: 'https://ci.example.com/1' } })).status).toBe(201)
  })

  test('the body is capped before it is read', async () => {
    const h = harness()
    const made = (await start(h)).json
    const res = await h.api.fetch(new Request(made.upload_url.replace('https://api.source.code/v1', 'https://api.test/v1'), { method: 'PUT', headers: { 'content-type': 'image/png', 'content-length': String(60 << 20) }, body: PNG as unknown as BodyInit }))
    expect(res.status).toBe(413)
  })

  test('evidence: attach to a change, count it, and who may read it follows the repository', async () => {
    const h = harness()
    const made = (await start(h)).json
    await put(h, made.upload_url, PNG)
    const ev = await h.call('POST', `${REPO}/changes/216/evidence`, { body: { upload: made.id, kind: 'image', caption: 'After' } })
    expect(ev.status, ev.text).toBe(201)
    expect(ev.json).toMatchObject({ object: 'evidence', change: 216, kind: 'image', caption: 'After', created_by: { handle: 'dana' } })
    expect((await h.call('GET', `${REPO}/changes/216`)).json.evidence_count).toBe(1)
    expect((await h.call('GET', `${REPO}/changes/216/evidence`, { token: null })).json.data.length).toBe(1)
    // Public repository: anyone can read the attached file. Before attaching, nobody else could.
    const url = ev.json.upload.content_url.replace('https://api.source.code/v1', 'https://api.test/v1')
    expect((await h.api.fetch(new Request(url))).status).toBe(200)
    const unattached = (await start(h)).json
    await put(h, unattached.upload_url, PNG)
    expect((await h.call('GET', `/uploads/${unattached.id}/content`, { token: null })).status).toBe(404)
    expect((await h.call('GET', `/uploads/${unattached.id}/content`, { token: h.tokens.stranger })).status).toBe(404)
    expect((await h.call('GET', `/uploads/${unattached.id}`, { token: h.tokens.stranger })).status).toBe(404)
  })

  test('evidence needs a finished upload of the right kind, once', async () => {
    const h = harness()
    const pending = (await start(h)).json
    expect((await h.call('POST', `${REPO}/changes/216/evidence`, { body: { upload: pending.id, kind: 'image' } })).json.code).toBe('upload_incomplete')
    await put(h, pending.upload_url, PNG)
    expect((await h.call('POST', `${REPO}/changes/216/evidence`, { body: { upload: pending.id, kind: 'recording' } })).json.errors[0].code).toBe('type_mismatch')
    expect((await h.call('POST', `${REPO}/changes/216/evidence?dry_run=true`, { body: { upload: pending.id, kind: 'image' } })).status).toBe(200)
    expect((await h.call('GET', `${REPO}/changes/216`)).json.evidence_count).toBe(0)
    expect((await h.call('POST', `${REPO}/changes/216/evidence`, { body: { upload: pending.id, kind: 'image' } })).status).toBe(201)
    expect((await h.call('POST', `${REPO}/changes/217/evidence`, { body: { upload: pending.id, kind: 'image' } })).json.code).toBe('invalid_state')
    expect((await h.call('POST', `${REPO}/changes/216/evidence`, { token: h.tokens.stranger, body: { upload: pending.id, kind: 'image' } })).status).toBe(404)
  })

  test('html previews and json are downloads, sandboxed; the ETag gives a 304', async () => {
    const h = harness()
    const html = new TextEncoder().encode('<h1>preview</h1>')
    const made = (await start(h, { filename: 'p.html', content_type: 'text/html', size: html.length })).json
    await put(h, made.upload_url, html, 'text/html')
    const got = await h.call('GET', `/uploads/${made.id}/content`)
    expect(got.headers.get('content-disposition')).toStartWith('attachment')
    expect(got.headers.get('content-security-policy')).toContain('sandbox')
    const again = await h.call('GET', `/uploads/${made.id}/content`, { headers: { 'if-none-match': got.headers.get('etag')! } })
    expect(again.status).toBe(304)
    // A list and `*` are the same question, and both get the same answer.
    expect((await h.call('GET', `/uploads/${made.id}/content`, { headers: { 'if-none-match': `"other", ${got.headers.get('etag')!}` } })).status).toBe(304)
    expect((await h.call('GET', `/uploads/${made.id}/content`, { headers: { 'if-none-match': '*' } })).status).toBe(304)
  })
})

// ---------------------------------------------------------------------------
// Repositories, mirrors, environment and grants

describe('creating repositories', () => {
  test('a bare name goes in the account you act as, and creating twice returns the first', async () => {
    const h = harness()
    const a = await h.call('POST', '/repos', { body: { name: 'notes2', description: 'Scratch' } })
    expect(a.status).toBe(201)
    expect(a.json).toMatchObject({ full_name: 'dana/notes2', visibility: 'public', description: 'Scratch' })
    expect(a.headers.get('sx-outcome')).toBe('created')
    const b = await h.call('POST', '/repos', { body: { name: 'notes2' } })
    expect([b.status, b.headers.get('sx-outcome'), b.json.id]).toEqual([200, 'unchanged', a.json.id])
    expect((await h.call('GET', '/repos/dana/notes2')).status).toBe(200)
    expect((await h.call('GET', '/search?q=notes2')).json.data[0]?.repo).toBe('dana/notes2')
  })

  test('private, in an organization, as a member, and with a bad name', async () => {
    const h = harness()
    const priv = await h.call('POST', '/repos', { body: { name: 'secret', visibility: 'private' } })
    expect((await h.call('GET', '/repos/dana/secret', { token: h.tokens.stranger })).status).toBe(404)
    expect(priv.json.visibility).toBe('private')
    const org = await h.call('POST', '/repos', { body: { name: 'tools', owner: 'northwind' } })
    expect(org.json.full_name).toBe('northwind/tools')
    // hollis is a member of northwind: not allowed to create there.
    const denied = await h.call('POST', '/repos', { token: h.tokens.hollis, body: { name: 'x', owner: 'northwind' } })
    expect([denied.status, denied.json.code]).toEqual([403, 'insufficient_scope'])
    expect((await h.call('POST', '/repos', { body: { name: '../evil' } })).status).toBe(400)
    expect((await h.call('POST', '/repos', { body: { name: 'x', owner: 'nobody' } })).status).toBe(404)
    expect((await h.call('POST', '/repos?dry_run=true', { body: { name: 'dryrun' } })).status).toBe(200)
    expect((await h.call('GET', '/repos/dana/dryrun')).status).toBe(404)
    expect((await h.call('POST', '/repos', { token: h.tokens.limited, body: { name: 'x' } })).json.code).toBe('forbidden')
  })
})

describe('mirrors', () => {
  const R = '/repos/dana/gitfs/mirrors'
  test('list, add (repeat-safe), sync, remove', async () => {
    const h = harness()
    const list = (await h.call('GET', R)).json.data
    expect(list.map((m: { host: string; state: string }) => [m.host, m.state])).toEqual([['github', 'in-sync'], ['gitlab', 'failing']])
    const add = await h.call('POST', R, { body: { host: 'codeberg', slug: 'dana/gitfs', direction: 'push' } })
    expect([add.status, add.headers.get('sx-outcome')]).toEqual([201, 'created'])
    const again = await h.call('POST', R, { body: { host: 'codeberg', slug: 'dana/gitfs' } })
    expect([again.status, again.json.id]).toEqual([200, add.json.id])
    const failing = list[1]
    const synced = await h.call('POST', `${R}/${failing.id}/sync`)
    expect(synced.json).toMatchObject({ state: 'in-sync', detail: null })
    expect((await h.call('DELETE', `${R}/${add.json.id}`)).status).toBe(204)
    expect((await h.call('POST', `${R}/mir_nope/sync`)).status).toBe(404)
    expect((await h.call('POST', R, { body: { host: 'nowhere', slug: 'a/b' } })).status).toBe(400)
    expect((await h.call('POST', `${R}/${failing.id}/sync`, { token: h.tokens.hollis })).json.code).toBe('insufficient_scope')
  })
})

describe('environment variables and grants', () => {
  const R = '/repos/dana/gitfs/env'
  const agent = (h: ReturnType<typeof harness>) => h.tokens.fixAgent

  test('names and kinds, never values', async () => {
    const h = harness()
    const r = await h.call('GET', `${R}?environment=production`)
    expect(r.json.data.map((v: { name: string; set: boolean }) => [v.name, v.set])).toEqual([['DATABASE_URL', true], ['STRIPE_KEY', true], ['API_PORT', true]])
    expect(r.text).not.toContain('hunter2')
    expect((await h.call('GET', R, { token: h.tokens.triage })).json.code).toBe('insufficient_scope')
  })

  test('set takes ciphertext, only for a name in the schema, and never echoes it', async () => {
    const h = harness()
    const ok = await h.call('PUT', `${R}/STRIPE_KEY/development`, { body: { ciphertext: 'age1ciphertext…' } })
    expect(ok.json).toMatchObject({ name: 'STRIPE_KEY', set: true, environments: ['production', 'development'] })
    expect(ok.text).not.toContain('age1')
    const unknown = await h.call('PUT', `${R}/NOT_A_VAR/development`, { body: { ciphertext: 'x' } })
    expect(unknown.status).toBe(400)
    expect(unknown.json.errors[0].code).toBe('not_in_schema')
  })

  test('a token with secrets:decrypt still needs a repository relationship', async () => {
    const h = harness()
    expect((await h.call('GET', `${REPO}/env/production/values`, { token: h.tokens.stranger })).status).toBe(404)
  })

  test('a person reads values; the read is audited', async () => {    const h = harness()
    const r = await h.call('GET', `${R}/development/values`)
    expect(r.json.values.DATABASE_URL).toContain('postgres://')
    expect(r.json.secrets).toEqual(['DATABASE_URL'])
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect((await h.call('GET', `${R}/audit`)).json.data[0].action).toContain('read 2 variables (development)')
  })

  test('an agent has no access without a grant, and never to production', async () => {
    const h = harness()
    const none = await h.call('GET', `${R}/development/values`, { token: agent(h) })
    expect([none.status, none.json.code, none.json.exit_code]).toEqual([403, 'grant_required', 6])
    const prod = await h.call('GET', `${R}/production/values`, { token: agent(h) })
    expect(prod.json.code).toBe('human_required')
    expect((await h.call('POST', `${R}/grants`, { token: agent(h), body: { environment: 'production' } })).json.code).toBe('human_required')
  })

  test('request, approve by a person, use within limits, expire', async () => {
    const now = clock()
    const h = harness({ now })
    const req = await h.call('POST', `${R}/grants`, { token: agent(h), body: { environment: 'development', reason: 'Run the tests', max_runs: 2 } })
    expect([req.status, req.json.state, req.json.expires_at]).toEqual([201, 'pending', null])
    expect(req.json.variables).toEqual(['DATABASE_URL', 'API_PORT'])
    const again = await h.call('POST', `${R}/grants`, { token: agent(h), body: { environment: 'development' } })
    expect([again.status, again.json.id]).toEqual([200, req.json.id])
    // Still no access: a request is not access.
    expect((await h.call('GET', `${R}/development/values`, { token: agent(h) })).json.code).toBe('grant_required')
    // An agent cannot approve; a person can.
    expect((await h.call('POST', `${R}/grants/${req.json.id}/approve`, { token: agent(h), body: {} })).json.code).toBe('insufficient_scope')
    expect((await h.call('POST', `${R}/grants/${req.json.id}/approve`, { body: { ttl_minutes: 9999 } })).status).toBe(400)
    const ok = await h.call('POST', `${R}/grants/${req.json.id}/approve`, { body: { ttl_minutes: 30 } })
    expect(ok.json.state).toBe('active')
    const read = await h.call('GET', `${R}/development/values`, { token: agent(h) })
    expect(read.status).toBe(200)
    expect(read.json.grant).toBe(req.json.id)
    expect(Object.keys(read.json.values)).toEqual(['DATABASE_URL', 'API_PORT'])
    expect((await h.call('GET', `${R}/development/values?names=API_PORT`, { token: agent(h) })).json.values).toEqual({ API_PORT: '8080' })
    // Two runs used: the grant is spent.
    expect((await h.call('GET', `${R}/development/values`, { token: agent(h) })).json.code).toBe('grant_required')
    expect((await h.call('GET', `${R}/grants`)).json.data[0].state).toBe('expired')
    // And a fresh one expires with time.
    const second = await h.call('POST', `${R}/grants`, { token: agent(h), body: { environment: 'development' } })
    await h.call('POST', `${R}/grants/${second.json.id}/approve`, { body: { ttl_minutes: 10 } })
    now.advance(11 * 60_000)
    expect((await h.call('GET', `${R}/development/values`, { token: agent(h) })).json.code).toBe('grant_required')
  })

  test('a revoked grant stops working at once, and the audit log tells the story', async () => {
    const h = harness()
    const req = await h.call('POST', `${R}/grants`, { token: agent(h), body: { environment: 'development', reason: 'Debug' } })
    await h.call('POST', `${R}/grants/${req.json.id}/approve`, { body: {} })
    expect((await h.call('GET', `${R}/development/values`, { token: agent(h) })).status).toBe(200)
    await h.call('POST', `${R}/grants/${req.json.id}/revoke`)
    expect((await h.call('GET', `${R}/development/values`, { token: agent(h) })).json.code).toBe('grant_required')
    expect((await h.call('POST', `${R}/grants/${req.json.id}/approve`, { body: {} })).json.code).toBe('invalid_state')
    const log = (await h.call('GET', `${R}/audit`)).json.data.map((a: { action: string }) => a.action)
    expect(log).toEqual(expect.arrayContaining(['revoked ' + req.json.id, expect.stringContaining('requested development access: Debug'), expect.stringContaining(`under ${req.json.id}`)]))
  })
})

describe('router', () => {
  test('two operations may name the same position differently', async () => {
    const h = harness()
    // env/{name}/{environment} and env/{environment}/values share the second segment.
    expect((await h.call('PUT', '/repos/dana/gitfs/env/API_PORT/development', { body: { ciphertext: 'x' } })).json.name).toBe('API_PORT')
    expect((await h.call('GET', '/repos/dana/gitfs/env/development/values')).json.environment).toBe('development')
  })

  test('values and tokens are never cached by anyone', async () => {
    const h = harness()
    expect((await h.call('GET', '/repos/dana/gitfs/env/development/values')).headers.get('cache-control')).toBe('no-store')
    const t = await h.call('POST', '/tokens', { body: { name: 'x', scopes: ['repo:read'] } })
    expect(t.headers.get('cache-control')).toBe('no-store')
  })
})
