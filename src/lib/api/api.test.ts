import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { z } from 'zod'
import { buildOpenApi } from './openapi'
import { findBreaking } from './openapi-diff'
import { errorCatalog } from './problem'
import { defineOp } from './registry'
import { STACK_ID, seedBulk, seedStack } from './sample'
import { EventLog } from './events'
import { clock, harness } from './testing'
import * as S from './schemas'
import { allOperations } from './index'

const REPO = '/repos/dana/gitfs'

const SHAPE_PATHS: Record<string, string> = {
  'accounts.list': '/accounts',
  'accounts.get': '/accounts/dana',
  'repos.list': '/repos',
  'repos.get': REPO,
  'repos.context': `${REPO}/context`,
  'repos.number': `${REPO}/numbers/216`,
  'runs.list': `${REPO}/runs`,
  'teams.list': '/accounts/northwind/teams',
  'git.tree': `${REPO}/git/tree`,
  'git.blob': `${REPO}/git/blob?path=README.md`,
  'git.commits': `${REPO}/git/commits`,
  'changes.list': `${REPO}/changes?state=all`,
  'changes.get': `${REPO}/changes/216?expand=repo,findings,check_runs`,
  'patch_sets.list': `${REPO}/changes/216/patch-sets`,
  'patch_sets.get': `${REPO}/changes/216/patch-sets/2`,
  'patch_sets.compare': `${REPO}/changes/216/compare?from=2&to=3`,
  'findings.list': `${REPO}/changes/216/findings`,
  'checks.list': `${REPO}/changes/216/checks`,
  'policy.get': `${REPO}/changes/216/policy`,
  'issues.list': `${REPO}/issues?state=all`,
  'issues.get': `${REPO}/issues/4`,
  'events.list': '/events',
  'sync.get': `/sync?repo=dana/gitfs`,
  'tokens.list': '/tokens',
  'authorizations.list': '/authorizations',
  'webhooks.list': `${REPO}/webhooks`,
  'search.query': '/search?q=cache',
  'evidence.list': `${REPO}/changes/216/evidence`,
  'mirrors.list': `${REPO}/mirrors`,
  'env.list': `${REPO}/env?environment=development`,
  'env.recipients': `${REPO}/env/recipients`,
  'env.audit': `${REPO}/env/audit`,
  'env.values': `${REPO}/env/development/values`,
  'grants.list': `${REPO}/env/grants`,
  'api.root': '/',
  'api.errors': '/errors',
  'api.limits': '/limits',
  'auth.principal': '/auth/principal',
}
// Checked in the shape test too, with an address that only exists once they are made.
const SHAPE_DYNAMIC = ['webhooks.get', 'webhooks.deliveries.list', 'webhooks.deliveries.get', 'tokens.get', 'uploads.get', 'git.commit', 'git.diff', 'teams.get', 'runs.get']
const SHAPE_CHECKED = new Set([...Object.keys(SHAPE_PATHS), ...SHAPE_DYNAMIC])
const T = (h: ReturnType<typeof harness>) => h.tokens

describe('shape', () => {
  test('every response carries a request id, a version and timing', async () => {
    const h = harness()
    const r = await h.call('GET', '/', { token: null })
    expect(r.status).toBe(200)
    expect(r.headers.get('sx-request-id')).toMatch(/^req_/)
    expect(r.headers.get('sx-version')).toBe('2026-11-07')
    expect(r.headers.get('server-timing')).toContain('total;dur=')
    expect(S.Root.safeParse(r.json).success).toBe(true)
  })

  test('every GET operation answers with exactly the shape it publishes', async () => {
    const h = harness()
    const paths: Record<string, string> = { ...SHAPE_PATHS }
    // Make some events and an operation so those schemas are exercised too.
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Shape check' } })
    // Things whose address is only known once they exist.
    const hook = (await h.call('POST', `${REPO}/webhooks`, { body: { endpoint: 'https://hooks.example.com/x', events: ['*'] } })).json
    const tok = (await h.call('POST', '/tokens', { body: { name: 'shape', scopes: ['repo:read'] } })).json
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const up = (await h.call('POST', '/uploads', { body: { filename: 'a.png', content_type: 'image/png', size: png.length } })).json
    await h.api.fetch(new Request(up.upload_url.replace('https://api.source.code/v1', 'https://api.test/v1'), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png as unknown as BodyInit }))
    await h.call('POST', `${REPO}/changes/216/evidence`, { body: { upload: up.id, kind: 'image' } })
    const dynamic: Record<string, string> = {
      'webhooks.get': `${REPO}/webhooks/${hook.id}`,
      'webhooks.deliveries.list': `${REPO}/webhooks/${hook.id}/deliveries`,
      'tokens.get': `/tokens/${tok.id}`,
      'uploads.get': `/uploads/${up.id}`,
    }
    await h.call('POST', `${REPO}/webhooks/${hook.id}/ping`)
    const dlv = (await h.call('GET', `${REPO}/webhooks/${hook.id}/deliveries`)).json.data[0]
    dynamic['webhooks.deliveries.get'] = `${REPO}/webhooks/${hook.id}/deliveries/${dlv.id}`
    const started = await h.call('POST', `${REPO}/runs`, { body: { task: 'shape' } })
    dynamic['runs.get'] = `${REPO}/runs/${started.json.id}`
    await h.call('POST', '/accounts/northwind/teams', { body: { slug: 'shape' } })
    dynamic['teams.get'] = '/accounts/northwind/teams/shape'
    const sha = (await h.call('GET', `${REPO}/git/commits`)).json.data[0].sha
    dynamic['git.commit'] = `${REPO}/git/commits/${sha}`
    dynamic['git.diff'] = `${REPO}/git/commits/${sha}/diff`
    Object.assign(paths, dynamic)
    for (const op of h.api.ops.filter((o) => o.method === 'GET' && o.id in paths)) {
      const r = await h.call('GET', paths[op.id])
      expect(r.status, `${op.id}: ${r.text.slice(0, 200)}`).toBe(200)
      const parsed = op.response.safeParse(r.json)
      expect(
        parsed.success ? 'ok' : JSON.stringify(parsed.error.issues.slice(0, 3)),
        op.id,
      ).toBe('ok')
    }
  })

  test('no GET operation is left out of the shape check', () => {
    const h = harness()
    const unchecked = h.api.ops
      .filter((o) => o.method === 'GET')
      .map((o) => o.id)
      .filter((id) => !SHAPE_CHECKED.has(id))
    // These need state the test builds itself, and have their own tests below.
    expect(unchecked.sort()).toEqual(['api.openapi', 'events.stream', 'git.raw', 'operations.get', 'uploads.content'])
  })

  test('every error code used in the source is in the catalog', () => {
    const dir = new URL('.', import.meta.url).pathname
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => dir + f),
      ...readdirSync(dir + 'ops').map((f) => dir + 'ops/' + f),
    ]
    const used = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/apiError\(\s*(?:[^'"\n]*\?\s*)?'([a-z_]+)'/g)) used.add(m[1])
      for (const m of src.matchAll(/errors: \[((?:\s*'[a-z_]+',?)+)\s*\]/g))
        for (const c of m[1].matchAll(/'([a-z_]+)'/g)) used.add(c[1])
    }
    expect(used.size).toBeGreaterThan(10)
    for (const code of used) expect(errorCatalog, code).toHaveProperty(code)
  })
})

describe('errors', () => {
  test('an unknown path is a problem with a hint', async () => {
    const h = harness()
    const r = await h.call('GET', '/nope', { token: null })
    expect(r.status).toBe(404)
    expect(r.headers.get('content-type')).toContain('application/problem+json')
    expect(S.Problem.safeParse(r.json).success).toBe(true)
    expect(r.json.code).toBe('not_found')
    expect(r.json.hint).toContain('openapi.json')
    expect(r.json.request_id).toBe(r.headers.get('sx-request-id'))
  })

  test('a malformed escape is a miss, not a crash', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes/%E0%A4%A`, { token: null })
    expect(r.status).toBe(404)
    expect(r.json.code).toBe('not_found')
  })

  test('a wrong method names the allowed ones', async () => {
    const h = harness()
    const r = await h.call('DELETE', '/limits', { token: null })
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toBe('GET')
  })

  test('401s say what is wrong with the token', async () => {
    const h = harness()
    expect((await h.call('GET', '/auth/principal', { token: null })).json.code).toBe('unauthenticated')
    expect((await h.call('GET', '/auth/principal', { token: 'sxp_unknown_token_value' })).json.code).toBe('token_invalid')
    expect((await h.call('GET', '/auth/principal', { token: 'garbage' })).json.code).toBe('token_invalid')
    const expired = await h.call('GET', '/auth/principal', { token: T(h).expired })
    expect(expired.json.code).toBe('token_expired')
    expect(expired.headers.get('www-authenticate')).toContain('invalid_token')
  })

  test('a missing scope lists what is needed and what the token has', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes`, { token: T(h).triage, body: { branch: 'x' } })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('insufficient_scope')
    expect(r.json.required_scopes).toEqual(['pulls:write'])
    expect(r.json.token_scopes).toContain('issues:write')
  })

  test('validation names each field by JSON pointer and never echoes values', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/issues`, { body: { title: '', labels: 'bug', extra: 'secret-value' } })
    expect(r.status).toBe(400)
    const pointers = r.json.errors.map((e: { pointer: string }) => e.pointer)
    expect(pointers).toContain('/body/title')
    expect(pointers).toContain('/body/labels')
    expect(r.text).not.toContain('secret-value')
  })

  test('an unknown query parameter is refused, not ignored', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes?stat=open`)
    expect(r.status).toBe(400)
    expect(r.json.errors[0].message).toContain('stat')
  })

  test('bad JSON, wrong content type and oversized bodies', async () => {
    const h = harness()
    expect((await h.call('POST', `${REPO}/issues`, { raw: '{nope' })).json.errors[0].code).toBe('invalid_json')
    const wrong = await h.call('POST', `${REPO}/issues`, { raw: '{}', headers: { 'content-type': 'text/plain' } })
    expect(wrong.status).toBe(415)
    const big = await h.call('POST', `${REPO}/issues`, { raw: JSON.stringify({ title: 'x', body: 'y'.repeat(1_100_000) }) })
    expect(big.status).toBe(413)
  })

  test('an unsupported version is refused', async () => {
    const h = harness()
    const r = await h.call('GET', '/', { headers: { 'sx-version': '2020-01-01' } })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('unsupported_version')
  })

  test('CORS preflight allows the headers clients send', async () => {
    const h = harness()
    const res = await h.api.fetch(new Request('https://api.test/v1/repos', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('idempotency-key')
  })
})

describe('who can see what', () => {
  test('a private repository answers 404 to everyone who cannot see it', async () => {
    const h = harness()
    for (const token of [null, T(h).stranger, T(h).hollis]) {
      const r = await h.call('GET', '/repos/dana/notes', { token })
      expect(r.status).toBe(404)
    }
    expect((await h.call('GET', '/repos/dana/notes')).status).toBe(200)
    const list = await h.call('GET', '/repos', { token: T(h).stranger })
    expect(list.json.data.map((r: { name: string }) => r.name)).not.toContain('notes')
  })

  test('a token limited to one repository cannot change another', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/issues`, { token: T(h).limited, body: { title: 'nope' } })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('forbidden')
    expect((await h.call('GET', `${REPO}/issues`, { token: T(h).limited })).status).toBe(200)
  })

  test('acting as an organization needs to be a member of it', async () => {
    const h = harness()
    const ok = await h.call('GET', '/auth/principal', { headers: { 'sx-account': 'northwind' } })
    expect(ok.json.acting_as).toBe('northwind')
    const no = await h.call('GET', '/auth/principal', { token: T(h).stranger, headers: { 'sx-account': 'northwind' } })
    expect(no.status).toBe(403)
  })

  test('a renamed repository answers 308 with the new address, for any method', async () => {
    const h = harness()
    const r = await h.call('POST', '/repos/dana/git-fs/issues?dry_run=true', { body: { title: 't' } })
    expect(r.status).toBe(308)
    expect(r.headers.get('location')).toBe('https://api.test/v1/repos/dana/gitfs/issues?dry_run=true')
    expect(r.headers.get('sx-renamed-from')).toBe('dana/git-fs')
  })

  test('a repository answers at its id as well as its name', async () => {
    const h = harness()
    const repo = (await h.call('GET', REPO)).json
    const byId = await h.call('GET', `/repos/${repo.id}/changes/216`)
    expect(byId.status).toBe(200)
    expect(byId.json.number).toBe(216)
    const byIdOfChange = await h.call('GET', `${REPO}/changes/${byId.json.id}`)
    expect(byIdOfChange.json.number).toBe(216)
  })

  test('#n resolves to a change or an issue', async () => {
    const h = harness()
    expect((await h.call('GET', `${REPO}/numbers/216`)).json.type).toBe('change')
    expect((await h.call('GET', `${REPO}/numbers/4`)).json.type).toBe('issue')
    expect((await h.call('GET', `${REPO}/numbers/9999`)).status).toBe(404)
  })
})

describe('lists', () => {
  test('a walk with a small limit returns every item once, in order, at any depth', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 1000, 300) })
    const seen: Array<number> = []
    let cursor: string | null = null
    let pages = 0
    do {
      const r = await h.call('GET', `/repos/dana/big/changes?state=all&limit=90${cursor ? `&cursor=${cursor}` : ''}&sort=-number`)
      expect(r.status).toBe(200)
      for (const c of r.json.data) seen.push(c.number)
      cursor = r.json.next_cursor
      pages++
    } while (cursor)
    expect(seen.length).toBe(1000)
    expect(new Set(seen).size).toBe(1000)
    expect(seen).toEqual([...seen].sort((a, b) => b - a))
    expect(pages).toBe(12)
  })

  test('items changed during a walk never appear twice', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 200, 0) })
    const first = await h.call('GET', '/repos/dana/big/changes?limit=50')
    const seen = first.json.data.map((c: { number: number }) => c.number)
    // Touch one change that was already sent and one that has not been.
    await h.call('PATCH', `/repos/dana/big/changes/${seen[0]}`, { body: { title: 'edited' } })
    const later = first.json.next_cursor
    const second = await h.call('GET', `/repos/dana/big/changes?limit=500&cursor=${later}`)
    for (const c of second.json.data) expect(seen).not.toContain(c.number)
  })

  test('a cursor from another filter is refused', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 100, 0) })
    const a = await h.call('GET', '/repos/dana/big/changes?limit=10&author=dana')
    const b = await h.call('GET', `/repos/dana/big/changes?limit=10&author=ines&cursor=${a.json.next_cursor}`)
    expect(b.status).toBe(400)
    expect(b.json.code).toBe('cursor_mismatch')
    const junk = await h.call('GET', `/repos/dana/big/changes?cursor=junk`)
    expect(junk.json.errors[0].pointer).toBe('/query/cursor')
  })

  test('a limit over the maximum is clamped and says so', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 400, 0) })
    const r = await h.call('GET', '/repos/dana/big/changes?limit=5000')
    expect(r.json.data.length).toBe(200)
    expect(r.headers.get('sx-limit-applied')).toBe('200')
  })

  test('filters and sorting', async () => {
    const h = harness()
    const landed = await h.call('GET', `${REPO}/changes?state=landed`)
    expect(landed.json.data.map((c: { number: number }) => c.number)).toEqual([210])
    const mine = await h.call('GET', `${REPO}/changes?author=ines`)
    expect(mine.json.data.map((c: { number: number }) => c.number)).toEqual([212])
    const asc = await h.call('GET', `${REPO}/changes?sort=number&state=all`)
    expect(asc.json.data.map((c: { number: number }) => c.number)).toEqual([210, 212, 215, 216, 217, 218])
    expect((await h.call('GET', `${REPO}/changes?state=bogus`)).status).toBe(400)
    const labelled = await h.call('GET', `${REPO}/issues?label=bug`)
    expect(labelled.json.data.map((i: { number: number }) => i.number)).toEqual([4])
  })

  test('each change carries checks and policy, so a list needs one request', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes`)
    const c212 = r.json.data.find((c: { number: number }) => c.number === 212)
    expect(c212.checks.state).toBe('fail')
    expect(c212.policy.state).toBe('blocked')
    const c215 = r.json.data.find((c: { number: number }) => c.number === 215)
    expect(c215.checks.state).toBe('pass')
  })

  test('fields keeps only what was asked, on an object and on each list item', async () => {
    const h = harness()
    const one = await h.call('GET', `${REPO}/changes/216?fields=title,head.tree,policy`)
    expect(Object.keys(one.json).sort()).toEqual(['head', 'id', 'object', 'policy', 'title'])
    expect(one.json.head).toEqual({ tree: '9c4d7e1' })
    const list = await h.call('GET', `${REPO}/changes?fields=number`)
    expect(list.json.object).toBe('list')
    expect(Object.keys(list.json.data[0]).sort()).toEqual(['id', 'number', 'object'])
    const bad = await h.call('GET', `${REPO}/changes/216?fields=titel`)
    expect(bad.status).toBe(400)
    expect(bad.json.errors[0].message).toContain('titel')
  })

  test('expand inlines relations, and heavy fields are null until asked for', async () => {
    const h = harness()
    const plain = (await h.call('GET', `${REPO}/changes/216`)).json
    expect(plain.findings).toBeNull()
    expect(plain.repo.object).toBe('repo')
    expect(plain.repo.stars).toBeUndefined()
    const full = (await h.call('GET', `${REPO}/changes/216?expand=findings,repo`)).json
    expect(full.findings.length).toBe(3)
    expect(full.repo.stars).toBe(2140)
    expect((await h.call('GET', `${REPO}/changes/216?expand=nope`)).status).toBe(400)
  })

  test('a list can be streamed as ndjson', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes?state=all`, { headers: { accept: 'application/x-ndjson' } })
    expect(r.headers.get('content-type')).toContain('x-ndjson')
    const lines = r.text.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.length).toBe(7)
    expect(lines.at(-1)).toEqual({ object: 'page', has_more: false, next_cursor: null })
    // The same address answers JSON and markdown too, so caches must vary on
    // what was asked for, not only on the identity in the URL.
    expect(r.headers.get('vary')).toContain('accept')
    expect(r.headers.get('vary')).toContain('authorization')
  })
})

describe('conditional requests', () => {
  test('304 when nothing changed, and a new ETag after a change', async () => {
    const h = harness()
    const a = await h.call('GET', `${REPO}/changes/216`)
    const etag = a.headers.get('etag')!
    expect(etag).toMatch(/^W\/"/)
    const same = await h.call('GET', `${REPO}/changes/216`, { headers: { 'if-none-match': etag } })
    expect(same.status).toBe(304)
    expect(same.text).toBe('')
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: T(h).hollis, body: { state: 'commented', body: 'nit' } })
    const changed = await h.call('GET', `${REPO}/changes/216`, { headers: { 'if-none-match': etag } })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
  })

  test('the second identical read is served from the body cache', async () => {
    const h = harness()
    const a = await h.call('GET', `${REPO}/changes/216`)
    expect(a.headers.get('server-timing')).not.toContain('cache')
    const b = await h.call('GET', `${REPO}/changes/216`)
    expect(b.headers.get('server-timing')).toContain('cache;desc="hit"')
    expect(b.text).toBe(a.text)
  })

  test('a cached body is never served to someone with different abilities', async () => {
    const h = harness()
    const dana = (await h.call('GET', `${REPO}/changes/216`)).json
    const anon = (await h.call('GET', `${REPO}/changes/216`, { token: null })).json
    const triage = (await h.call('GET', `${REPO}/changes/216`, { token: T(h).triage })).json
    expect(anon.actions.land.reasons).toEqual(['sign_in'])
    expect(triage.actions.abandon.reasons).toEqual(['scope:pulls:write'])
    expect(dana.actions.abandon.allowed).toBe(true)
  })

  test('If-Match refuses an edit made on top of a stale read, and returns the current object', async () => {
    const h = harness()
    const got = await h.call('GET', `${REPO}/issues/4`)
    const etag = got.headers.get('etag')!
    const ok = await h.call('PATCH', `${REPO}/issues/4`, { body: { title: 'Panic on trailing-dot refs' }, headers: { 'if-match': etag } })
    expect(ok.status).toBe(200)
    const stale = await h.call('PATCH', `${REPO}/issues/4`, { body: { title: 'Again' }, headers: { 'if-match': etag } })
    expect(stale.status).toBe(412)
    expect(stale.json.code).toBe('version_mismatch')
    expect(stale.json.current.title).toBe('Panic on trailing-dot refs')
  })

  test('?wait holds a read until the thing changes', async () => {
    const h = harness()
    const a = await h.call('GET', `${REPO}/changes/216`)
    const etag = a.headers.get('etag')!
    const started = performance.now()
    const waiting = h.call('GET', `${REPO}/changes/216?wait=10`, { headers: { 'if-none-match': etag } })
    setTimeout(() => void h.call('POST', `${REPO}/changes/216/reviews`, { token: T(h).hollis, body: { state: 'commented' } }), 50)
    const r = await waiting
    expect(r.status).toBe(200)
    expect(r.headers.get('etag')).not.toBe(etag)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('?wait answers 304 when time runs out', async () => {
    const h = harness()
    const etag = (await h.call('GET', `${REPO}/changes/216`)).headers.get('etag')!
    const started = performance.now()
    const r = await h.call('GET', `${REPO}/changes/216?wait=1`, { headers: { 'if-none-match': etag } })
    expect(r.status).toBe(304)
    expect(performance.now() - started).toBeGreaterThan(900)
    expect(h.api.events.waiting).toBe(0)
  })

  test('wait is refused where it makes no sense', async () => {
    const h = harness()
    expect((await h.call('GET', '/limits?wait=5')).status).toBe(400)
    expect((await h.call('GET', `${REPO}/changes/216?wait=99`)).status).toBe(400)
    const noTag = await h.call('GET', `${REPO}/changes/216?wait=5`)
    expect(noTag.status).toBe(400)
    expect(noTag.json.errors[0].code).toBe('needs_if_none_match')
  })
})

describe('writes', () => {
  test('an Idempotency-Key makes a create happen once', async () => {
    const h = harness()
    const body = { title: 'Crash on empty repo' }
    const headers = { 'idempotency-key': 'k-1' }
    const a = await h.call('POST', `${REPO}/issues`, { body, headers })
    expect(a.status).toBe(201)
    const b = await h.call('POST', `${REPO}/issues`, { body, headers })
    expect(b.status).toBe(201)
    expect(b.headers.get('sx-replayed')).toBe('true')
    expect(b.json.id).toBe(a.json.id)
    const list = await h.call('GET', `${REPO}/issues?limit=200`)
    expect(list.json.data.filter((i: { title: string }) => i.title === body.title).length).toBe(1)
  })

  test('the same key with a different request is refused', async () => {
    const h = harness()
    const headers = { 'idempotency-key': 'k-2' }
    await h.call('POST', `${REPO}/issues`, { body: { title: 'One' }, headers })
    const r = await h.call('POST', `${REPO}/issues`, { body: { title: 'Two' }, headers })
    expect(r.status).toBe(422)
    expect(r.json.code).toBe('idempotency_key_reused')
  })

  test('a failed request frees its key, so a corrected retry works', async () => {
    const h = harness()
    const headers = { 'idempotency-key': 'k-3' }
    const bad = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '9c4d7e1' }, headers })
    expect(bad.status).toBe(409)
    const again = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '9c4d7e1' }, headers })
    expect(again.headers.get('sx-replayed')).toBeNull()
    expect(again.status).toBe(409)
  })

  test('a second request with the key while the first runs is told to wait', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow = defineOp({
      id: 'test.slow', summary: 'slow', tags: ['test'], method: 'POST', path: '/slow', auth: 'required', pool: 'write',
      safety: 'write', idempotent: true, body: z.strictObject({}), response: z.strictObject({ ok: z.boolean() }),
      handler: () => Effect.promise(async () => { await gate; return { ok: true } }),
    })
    const h = harness({ ops: [...allOperations(), slow] })
    const headers = { 'idempotency-key': 'slow-1' }
    const first = h.call('POST', '/slow', { body: {}, headers })
    await new Promise((r) => setTimeout(r, 20))
    const second = await h.call('POST', '/slow', { body: {}, headers })
    expect(second.status).toBe(409)
    expect(second.json.code).toBe('request_in_progress')
    expect(second.headers.get('retry-after')).toBe('1')
    release()
    expect((await first).status).toBe(200)
    const third = await h.call('POST', '/slow', { body: {}, headers })
    expect(third.headers.get('sx-replayed')).toBe('true')
  })

  test('creating the same thing twice is harmless by nature', async () => {
    const h = harness()
    const a = await h.call('POST', `${REPO}/issues`, { body: { title: 'Natural' } })
    const b = await h.call('POST', `${REPO}/issues`, { body: { title: 'Natural' } })
    expect([a.status, b.status]).toEqual([201, 200])
    expect(b.headers.get('sx-outcome')).toBe('unchanged')
    expect(b.json.id).toBe(a.json.id)

    const c1 = await h.call('POST', `${REPO}/changes`, { body: { branch: 'feature-x' } })
    expect(c1.status).toBe(201)
    expect(c1.headers.get('sx-outcome')).toBe('created')
    const sha = c1.json.head.sha
    const c2 = await h.call('POST', `${REPO}/changes`, { body: { branch: 'feature-x', sha } })
    expect(c2.status).toBe(200)
    expect(c2.headers.get('sx-outcome')).toBe('unchanged')
    const c3 = await h.call('POST', `${REPO}/changes`, { body: { branch: 'feature-x', sha: 'abcdef1234' } })
    expect(c3.headers.get('sx-outcome')).toBe('patch_set_added')
    expect(c3.json.number).toBe(c1.json.number)
    expect(c3.json.patch_set_count).toBe(2)
  })

  test('dry run changes nothing and returns what would have happened', async () => {
    const h = harness()
    const before = (await h.call('GET', `${REPO}/issues?limit=200&state=all`)).json.data.length
    const r = await h.call('POST', `${REPO}/issues?dry_run=true`, { body: { title: 'Dry' } })
    expect(r.status).toBe(200)
    expect(r.headers.get('sx-dry-run')).toBe('true')
    expect(r.json.title).toBe('Dry')
    expect((await h.call('GET', `${REPO}/issues?limit=200&state=all`)).json.data.length).toBe(before)
    expect((await h.call('POST', `${REPO}/changes/216/land?dry_run=true`, { body: { expected_tree: '9c4d7e1' } })).json.code).toBe('policy_blocked')
    expect((await h.call('GET', `${REPO}/changes?dry_run=true`)).status).toBe(400)
  })
})

describe('review, policy and landing', () => {
  test('policy explains every requirement and what would satisfy it', async () => {
    const h = harness()
    const p = (await h.call('GET', `${REPO}/changes/216/policy`)).json
    expect(p.state).toBe('blocked')
    const byId = Object.fromEntries(p.requirements.map((r: { id: string }) => [r.id, r]))
    expect(byId['core-paths'].state).toBe('pass')
    expect(byId['agent-authored'].state).toBe('na')
    expect(byId['ci-evidence'].state).toBe('pending')
    expect(byId['ci-evidence'].needs).toMatchObject({ check: 'ci/test', bound_to: 'tree', tree: '9c4d7e1' })
    expect(byId.findings.state).toBe('fail')
    expect(byId.findings.needs.resolve).toEqual(['F-2'])
  })

  test('simulate answers “what if” without writing anything', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes/216/policy/simulate`, { body: { checks: { 'ci/test': 'pass' }, resolve: ['F-2'] } })
    expect(r.json.state).toBe('met')
    expect(r.json.assumed).toEqual(['check:ci/test=pass', 'resolve:F-2'])
    expect((await h.call('GET', `${REPO}/changes/216/policy`)).json.state).toBe('blocked')
    const noApproval = await h.call('POST', `${REPO}/changes/216/policy/simulate`, { body: { approve: ['greptile'] } })
    expect(noApproval.json.requirements.find((q: { id: string }) => q.id === 'core-paths').state).toBe('pass')
  })

  test('landing is blocked with every requirement, and only waiting is retryable', async () => {
    const h = harness()
    const blocked = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '9c4d7e1' } })
    expect(blocked.status).toBe(409)
    expect(blocked.json.code).toBe('policy_blocked')
    expect(blocked.json.exit_code).toBe(5)
    expect(blocked.json.retryable).toBe(false)
    expect(blocked.json.requirements.length).toBe(4)
    // Resolve the finding: only the pending CI result is left.
    await h.call('POST', `${REPO}/changes/216/findings/F-2/resolve`)
    const waiting = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '9c4d7e1' } })
    expect(waiting.json.retryable).toBe(true)
    expect(waiting.json.hint).toContain('Wait')
  })

  test('landing needs the exact tree that was checked', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '5d02b8f' } })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('stale_head')
    expect(r.json.current.tree).toBe('9c4d7e1')
  })

  test('the full path: resolve, report CI on the tree, land, see the event', async () => {
    const h = harness()
    await h.call('POST', `${REPO}/changes/216/findings/F-2/resolve`)
    const check = await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/test', state: 'pass', tree: '9c4d7e1' } })
    expect(check.headers.get('sx-outcome')).toBe('updated')
    const agent = await h.call('POST', `${REPO}/changes/216/land`, { token: T(h).fixAgent, body: { expected_tree: '9c4d7e1' } })
    expect(agent.status).toBe(403)
    expect(agent.json.code).toBe('insufficient_scope')
    const parent = await h.call('POST', `${REPO}/changes/217/land`, { body: { expected_tree: 'a71e0c3' } })
    expect(parent.json.code).toBe('invalid_state')
    const landed = await h.call('POST', `${REPO}/changes/216/land`, { body: { expected_tree: '9c4d7e1' } })
    expect(landed.status).toBe(200)
    expect(landed.json.state).toBe('landed')
    expect(landed.json.landed_at).not.toBeNull()
    const events = await h.call('GET', '/events?type=change.landed')
    expect(events.json.data.map((e: { subject: { number: number } }) => e.subject.number)).toEqual([216])
    // The change above it was rebased onto the result and kept its tree.
    const above = (await h.call('GET', `${REPO}/changes/217`)).json
    expect(above.patch_set_count).toBe(2)
    expect(above.head.tree).toBe('a71e0c3')
    expect(above.stack.parent).toBe(216)
  })

  test('a check for an older tree is stored but does not count', async () => {
    const h = harness()
    await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/test', state: 'pass', tree: '5d02b8f' } })
    const c = (await h.call('GET', `${REPO}/changes/216?expand=check_runs`)).json
    expect(c.check_runs.length).toBe(2)
    expect(c.checks).toMatchObject({ state: 'pending', pending: 1, passed: 0 })
    const same = await h.call('POST', `${REPO}/changes/216/checks`, { body: { key: 'ci/test', state: 'pass', tree: '5d02b8f' } })
    expect(same.headers.get('sx-outcome')).toBe('unchanged')
  })

  test('nobody approves their own work', async () => {
    const h = harness()
    const agent = await h.call('POST', `${REPO}/changes`, { token: T(h).fixAgent, body: { branch: 'agent-fix' } })
    const own = await h.call('POST', `${REPO}/changes/${agent.json.number}/reviews`, { token: T(h).fixAgent, body: { state: 'approved' } })
    expect(own.status).toBe(403)
    expect(own.json.code).toBe('human_required')
    expect(own.json.exit_code).toBe(6)
    const person = await h.call('POST', `${REPO}/changes/216/reviews`, { body: { state: 'approved' } })
    expect(person.json.code).toBe('forbidden')
  })

  test('agent-authored work needs a person to approve it', async () => {
    const h = harness()
    const agent = await h.call('POST', `${REPO}/changes`, { token: T(h).fixAgent, body: { branch: 'agent-fix' } })
    const n = agent.json.number
    const before = (await h.call('GET', `${REPO}/changes/${n}/policy`)).json.requirements.find((r: { id: string }) => r.id === 'agent-authored')
    expect(before.state).toBe('pending')
    await h.call('POST', `${REPO}/changes/${n}/reviews`, { token: T(h).hollis, body: { state: 'approved' } })
    const after = (await h.call('GET', `${REPO}/changes/${n}/policy`)).json.requirements.find((r: { id: string }) => r.id === 'agent-authored')
    expect(after.state).toBe('pass')
  })

  test('an approval follows a rebase but not a rewrite', async () => {
    const h = harness()
    const reviewers = async () => (await h.call('GET', `${REPO}/changes/216`)).json.reviewers.find((r: { actor: { handle: string } }) => r.actor.handle === 'hollis')
    expect((await reviewers()).carries_to_head).toBe(true)
    await h.call('POST', `${REPO}/changes/216/patch-sets`, { body: { sha: 'aaaaaaa1', kind: 'rebase' } })
    expect((await reviewers()).carries_to_head).toBe(true)
    await h.call('POST', `${REPO}/changes/216/patch-sets`, { body: { sha: 'bbbbbbb2', kind: 'update' } })
    expect((await reviewers()).carries_to_head).toBe(false)
    const core = (await h.call('GET', `${REPO}/changes/216/policy`)).json.requirements.find((r: { id: string }) => r.id === 'core-paths')
    expect(core.state).toBe('pending')
  })

  test('comparing patch sets shows only what is new', async () => {
    const h = harness()
    const r = (await h.call('GET', `${REPO}/changes/216/compare?from=2&to=3`)).json
    expect(r.files.map((f: { path: string }) => f.path)).toEqual(['src/refs.rs'])
    expect(r.unchanged_files).toBe(1)
    expect((await h.call('GET', `${REPO}/changes/216/compare?from=1&to=9`)).status).toBe(404)
  })

  test('dismissing a finding needs a reason', async () => {
    const h = harness()
    const no = await h.call('POST', `${REPO}/changes/216/findings/F-3/dismiss`, { body: {} })
    expect(no.status).toBe(400)
    const ok = await h.call('POST', `${REPO}/changes/216/findings/F-3/dismiss`, { body: { reason: 'Not worth it' } })
    expect(ok.json).toMatchObject({ state: 'dismissed', reason: 'Not worth it' })
  })

  test('draft, ready, abandon and restore follow the state machine', async () => {
    const h = harness()
    expect((await h.call('POST', `${REPO}/changes/216/ready`)).json.code).toBe('invalid_state')
    expect((await h.call('POST', `${REPO}/changes/218/ready`)).json.state).toBe('open')
    expect((await h.call('POST', `${REPO}/changes/218/abandon`)).json.state).toBe('abandoned')
    expect((await h.call('POST', `${REPO}/changes/218/restore`)).json.state).toBe('open')
  })

  test('a stack lands bottom first as one operation', async () => {
    const h = harness({
      seed: (d) => {
        seedStack(d)
        d.stepDelayMs = 2
      },
    })
    const child = await h.call('POST', '/repos/dana/stacky/changes/2/land', { body: { expected_tree: '2222222' } })
    expect(child.json.code).toBe('parent_not_landed')
    const dry = await h.call('POST', `/repos/dana/stacky/stacks/${STACK_ID}/land?dry_run=true`, { body: { expected_trees: { 1: '1111111' } } })
    expect(dry.status).toBe(200)
    const started = await h.call('POST', `/repos/dana/stacky/stacks/${STACK_ID}/land`, { body: { expected_trees: { 1: '1111111' } } })
    expect(started.status).toBe(202)
    expect(started.headers.get('location')).toBe(started.json.url)
    expect(started.json.progress.total).toBe(3)
    // Long-poll the operation until it ends.
    let op = started.json
    for (let i = 0; i < 20 && op.state !== 'succeeded' && op.state !== 'failed'; i++) {
      const etag = (await h.call('GET', `/operations/${op.id}`)).headers.get('etag')!
      const r = await h.call('GET', `/operations/${op.id}?wait=2`, { headers: { 'if-none-match': etag } })
      op = r.status === 304 ? op : r.json
      if (r.status === 304) op = (await h.call('GET', `/operations/${op.id}`)).json
    }
    expect(op.state).toBe('succeeded')
    const list = (await h.call('GET', '/repos/dana/stacky/changes?state=landed&sort=number')).json.data
    expect(list.map((c: { number: number }) => c.number)).toEqual([1, 2, 3])
    const landedAt = list.map((c: { landed_at: string }) => c.landed_at)
    expect([...landedAt].sort()).toEqual(landedAt)
    const middle = (await h.call('GET', '/repos/dana/stacky/changes/2')).json
    expect(middle.head.tree).toBe('2222222')
    expect(middle.reviewers[0].carries_to_head).toBe(true)
  })
})

describe('events and sync', () => {
  test('every write leaves an event, in order, carrying the object it produced', async () => {
    const h = harness()
    const created = await h.call('POST', `${REPO}/issues`, { body: { title: 'Evented' } })
    await h.call('PATCH', `${REPO}/issues/${created.json.number}`, { body: { state: 'closed' } })
    const list = (await h.call('GET', '/events?repo=dana/gitfs&type=issue.*')).json.data
    expect(list.map((e: { type: string }) => e.type)).toEqual(['issue.created', 'issue.closed'])
    const seq = list.map((e: { sequence: number }) => e.sequence)
    expect(seq[1]).toBe(seq[0] + 1)
    const now = (await h.call('GET', `${REPO}/issues/${created.json.number}`)).json
    expect(list[1].data).toEqual(now)
    expect(S.Event.safeParse(list[0]).success).toBe(true)
  })

  test('events of private repositories are not shown to others', async () => {
    const h = harness()
    await h.call('POST', '/repos/dana/notes/issues', { body: { title: 'secret plan' } })
    const stranger = await h.call('GET', '/events', { token: T(h).stranger })
    expect(stranger.text).not.toContain('secret plan')
    expect((await h.call('GET', '/events')).text).toContain('secret plan')
  })

  test('sync gives a snapshot, then only what changed', async () => {
    const h = harness()
    const snap = (await h.call('GET', '/sync?repo=dana/gitfs', { token: null })).json
    expect(snap.reset).toBe(true)
    expect(snap.objects.length).toBe(1 + 6 + 3)
    expect(snap.has_more).toBe(false)
    expect(snap.objects.every((o: { actions?: unknown }) => !('actions' in o) || o.actions === null)).toBe(true)
    const none = (await h.call('GET', `/sync?repo=dana/gitfs&cursor=${snap.cursor}`)).json
    expect(none.objects).toEqual([])
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: T(h).hollis, body: { state: 'commented' } })
    await h.call('POST', `${REPO}/changes/216/reviews`, { token: T(h).hollis, body: { state: 'commented' } })
    const delta = (await h.call('GET', `/sync?repo=dana/gitfs&cursor=${none.cursor}`)).json
    expect(delta.reset).toBe(false)
    expect(delta.objects.length).toBe(1)
    expect(delta.objects[0].number).toBe(216)
    expect((await h.call('GET', `/sync?repo=dana/gitfs&cursor=${delta.cursor}`)).json.objects).toEqual([])
  })

  test('sync pages a snapshot and resets a cursor that is too old', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 120, 30) })
    let cursor: string | undefined
    let total = 0
    do {
      const r = (await h.call('GET', `/sync?repo=dana/big&limit=40${cursor ? `&cursor=${cursor}` : ''}`)).json
      total += r.objects.length
      cursor = r.has_more ? r.cursor : undefined
    } while (cursor)
    expect(total).toBe(151)
  })

  test('a cursor older than the retained log is reset, not silently wrong', async () => {
    const h = harness({ events: new EventLog(clock(), 5) })
    const first = (await h.call('GET', '/sync?repo=dana/gitfs')).json
    for (let i = 0; i < 12; i++) await h.call('POST', `${REPO}/issues`, { body: { title: `Spam ${i}` } })
    const old = (await h.call('GET', `/sync?repo=dana/gitfs&cursor=${first.cursor}`)).json
    expect(old.reset).toBe(true)
    expect(old.objects.length).toBeGreaterThan(10)
  })

  test('the stream sends events as they happen and resumes from Last-Event-ID', async () => {
    const h = harness()
    const res = await h.api.fetch(new Request('https://api.test/v1/events/stream?repo=dana/gitfs', { headers: { authorization: `Bearer ${T(h).dana}` } }))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain(': connected')
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Streamed' } })
    const chunk = decoder.decode((await reader.read()).value)
    expect(chunk).toContain('event: issue.created')
    expect(chunk).toMatch(/^id: \d+/m)
    await reader.cancel()

    const head = h.api.events.head
    await h.call('POST', `${REPO}/issues`, { body: { title: 'Missed one' } })
    const resumed = await h.api.fetch(new Request('https://api.test/v1/events/stream', { headers: { authorization: `Bearer ${T(h).dana}`, 'last-event-id': String(head) } }))
    const r2 = resumed.body!.getReader()
    await r2.read()
    expect(decoder.decode((await r2.read()).value)).toContain('Missed one')
    await r2.cancel()
  })
})

describe('batch', () => {
  test('several reads in one round trip, in order, each with its own status', async () => {
    const h = harness()
    const r = await h.call('POST', '/batch', {
      body: {
        requests: [
          { id: 'change', method: 'GET', path: '/repos/dana/gitfs/changes/216' },
          { id: 'policy', method: 'GET', path: '/repos/dana/gitfs/changes/216/policy' },
          { id: 'missing', method: 'GET', path: '/repos/dana/gitfs/changes/999' },
        ],
      },
    })
    expect(r.status).toBe(200)
    expect(r.json.results.map((x: { id: string; status: number }) => [x.id, x.status])).toEqual([['change', 200], ['policy', 200], ['missing', 404]])
    expect(r.json.results[2].body.code).toBe('not_found')
    expect(S.BatchResult.safeParse(r.json).success).toBe(true)
  })

  test('batches do not nest, and are limited in size', async () => {
    const h = harness()
    const nested = await h.call('POST', '/batch', { body: { requests: [{ id: 'a', method: 'POST', path: '/batch', body: { requests: [{ id: 'b', method: 'GET', path: '/limits' }] } }] } })
    expect(nested.json.results[0].status).toBe(400)
    const tooMany = await h.call('POST', '/batch', { body: { requests: Array.from({ length: 26 }, (_, i) => ({ id: String(i), method: 'GET', path: '/limits' })) } })
    expect(tooMany.status).toBe(400)
  })

  test('a sub-request keeps the account the caller acts as', async () => {
    const h = harness()
    const r = await h.call('POST', '/batch', {
      headers: { 'sx-account': 'northwind' },
      body: { requests: [{ id: 'who', method: 'GET', path: '/auth/principal' }] },
    })
    expect(r.status).toBe(200)
    expect(r.json.results[0].body.acting_as).toBe('northwind')
  })
})

describe('OpenAPI', () => {
  const h = harness()
  const doc = buildOpenApi(h.api.ops) as any

  test('is served, cacheable and describes every operation', async () => {
    const r = await h.call('GET', '/openapi.json', { token: null })
    expect(r.json.openapi).toBe('3.1.0')
    const etag = r.headers.get('etag')!
    expect((await h.call('GET', '/openapi.json', { token: null, headers: { 'if-none-match': etag } })).status).toBe(304)
    const ids = Object.values<any>(r.json.paths).flatMap((p) => Object.values<any>(p).map((o) => o.operationId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(h.api.ops.length)
  })

  test('every operation says what an agent needs to know before calling it', () => {
    for (const [path, item] of Object.entries<any>(doc.paths))
      for (const [method, op] of Object.entries<any>(item)) {
        const where = `${method} ${path}`
        expect(['read', 'write', 'destructive'], where).toContain(op['x-sx-safety'])
        expect(typeof op['x-sx-idempotent'], where).toBe('boolean')
        expect(op['x-sx-pool'], where).toBeDefined()
        expect(op['x-sx-errors'], where).toContain('rate_limited')
        for (const code of op['x-sx-errors']) expect(errorCatalog, `${where} ${code}`).toHaveProperty(code)
        expect(op.responses.default.content['application/problem+json']).toBeDefined()
        // Every {param} in the path is declared.
        for (const m of path.matchAll(/\{(\w+)\}/g))
          expect(op.parameters.some((p: any) => p.in === 'path' && p.name === m[1]), `${where} ${m[1]}`).toBe(true)
      }
  })

  test('destructive operations are marked, and reads never are', () => {
    expect(doc.paths['/repos/{owner}/{repo}/changes/{number}/land'].post['x-sx-safety']).toBe('destructive')
    expect(doc.paths['/repos/{owner}/{repo}/stacks/{stack}/land'].post['x-async'] ?? doc.paths['/repos/{owner}/{repo}/stacks/{stack}/land'].post['x-sx-async']).toBe(true)
    for (const item of Object.values<any>(doc.paths))
      if (item.get) expect(item.get['x-sx-safety']).toBe('read')
  })

  test('responses do not forbid members clients do not know yet', () => {
    for (const item of Object.values<any>(doc.paths))
      for (const op of Object.values<any>(item))
        for (const response of Object.values<any>(op.responses ?? {}))
          expect(JSON.stringify(response)).not.toContain('"additionalProperties":false')
    // Requests are strict, and the document says so: the server rejects
    // unknown members, so a generated client must not be told they are fine.
    expect(JSON.stringify(doc.paths['/repos'].post.requestBody)).toContain('"additionalProperties":false')
  })

  test('v1 only adds: the committed snapshot is still satisfied', () => {
    const snapshot = JSON.parse(readFileSync(new URL('./openapi.snapshot.json', import.meta.url), 'utf8'))
    expect(findBreaking(snapshot, doc)).toEqual([])
    // And the snapshot is current, so the contract change is in the diff.
    expect(JSON.stringify(doc, null, 2) + '\n').toBe(JSON.stringify(snapshot, null, 2) + '\n')
  })

  test('the check itself catches the breaking changes it is meant to', () => {
    const copy = () => JSON.parse(JSON.stringify(doc))
    const removedOp = copy()
    delete removedOp.paths['/limits']
    expect(findBreaking(doc, removedOp).join()).toContain('operation removed')

    const removedField = copy()
    delete removedField.paths['/repos/{owner}/{repo}/issues/{number}'].get.responses['200'].content['application/json'].schema.properties?.title
    const issue = removedField.components.schemas.Issue
    if (issue) delete issue.properties.title
    expect(findBreaking(doc, removedField).join()).toContain('title')

    const required = copy()
    required.paths['/repos/{owner}/{repo}/issues'].post.requestBody.content['application/json'].schema.required.push('milestone')
    expect(findBreaking(doc, required).join()).toContain('milestone')

    const added = copy()
    added.paths['/new'] = { get: { operationId: 'new.thing', responses: { 200: {} } } }
    expect(findBreaking(doc, added)).toEqual([])
  })
})
