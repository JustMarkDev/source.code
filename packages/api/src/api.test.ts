import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { z } from 'zod'
import { buildOpenApi } from './openapi'
import { findBreaking } from './openapi-diff'
import { errorCatalog } from './problem'
import { defineOp } from './registry'
import { MemoryIdempotencyStore } from './idempotency'
import { STACK_ID, seedBulk, seedStack } from './sample'
import { EventLog } from './events'
import { clock, harness } from './testing'
import * as S from './schemas'
import { allOperations } from './index'

const REPO = '/repos/dana/gitfs'

const SHAPE_PATHS: Record<string, string> = {
  'accounts.list': '/accounts',
  'accounts.get': '/accounts/dana',
  'accounts.profile': '/accounts/dana/profile',
  'follows.followers': '/accounts/dana/followers',
  'follows.following': '/accounts/dana/following',
  'preferences.get': '/user/preferences',
  'people.list': '/people',
  'status.get': '/status',
  'issue_evidence.list': `${REPO}/issues/4/evidence`,
  'change_comments.list': `${REPO}/changes/216/comments`,
  'members.list': '/accounts/northwind/members',
  'invitations.list': '/accounts/northwind/invitations',
  'repos.contributors': `${REPO}/contributors`,
  'stars.get': `${REPO}/star`,
  'repos.list': '/repos',
  'repos.get': REPO,
  'repos.context': `${REPO}/context`,
  'repos.number': `${REPO}/numbers/216`,
  'runs.list': `${REPO}/runs`,
  'teams.list': '/accounts/northwind/teams',
  'git.tree': `${REPO}/git/tree`,
  'git.blob': `${REPO}/git/blob?path=README.md`,
  'git.commits': `${REPO}/git/commits`,
  'repos.provenance': `${REPO}/provenance?path=src/refs.rs&line=1`,
  'changes.timeline': `${REPO}/changes/216/timeline`,
  'changes.seen.get': `${REPO}/changes/216/seen`,
  'changes.presence.get': `${REPO}/changes/216/presence`,
  'changes.landability': `${REPO}/changes/216/landability`,
  'issues.presence.get': `${REPO}/issues/4/presence`,
  'issues.timeline': `${REPO}/issues/4/timeline`,
  'changes.list': `${REPO}/changes?state=all`,
  'changes.get': `${REPO}/changes/216?expand=repo,findings,check_runs`,
  'patch_sets.list': `${REPO}/changes/216/patch-sets`,
  'patch_sets.get': `${REPO}/changes/216/patch-sets/2`,
  'patch_sets.compare': `${REPO}/changes/216/compare?from=2&to=3`,
  'patch_sets.files': `${REPO}/changes/216/patch-sets/3/files`,
  'findings.list': `${REPO}/changes/216/findings`,
  'checks.list': `${REPO}/changes/216/checks`,
  'policy.get': `${REPO}/changes/216/policy`,
  'issues.list': `${REPO}/issues?state=all`,
  'issues.get': `${REPO}/issues/4`,
  'labels.list': `${REPO}/labels`,
  'comments.list': `${REPO}/issues/4/comments`,
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
  'notifications.list': '/notifications',
  'releases.list': `${REPO}/releases`,
  'releases.get': `${REPO}/releases/v0.9.0`,
  'pipelines.list': `${REPO}/pipelines`,
  'policy.rules': `${REPO}/policy`,
  'integrations.list': '/accounts/dana/integrations',
  'bots.list': '/accounts/dana/bots',
  'links.list': '/accounts/dana/links',
  'imports.list': '/imports',
  'repos.insights': `${REPO}/insights`,
  'dashboard.get': '/dashboard',
  'automations.list': `${REPO}/automations`,
  'integrations.repo': `${REPO}/integrations`,
  'pipelines.get': `${REPO}/pipelines/1839`,
  'pipelines.log': `${REPO}/pipelines/1839/jobs/1/steps/2/log`,
  'notifications.count': '/notifications/count',
  'notifications.preferences': '/notifications/preferences',
}
// Checked in the shape test too, with an address that only exists once they are made.
const SHAPE_DYNAMIC = [
  'webhooks.get',
  'webhooks.deliveries.list',
  'webhooks.deliveries.get',
  'tokens.get',
  'uploads.get',
  'git.commit',
  'git.diff',
  'teams.get',
  'runs.get',
]
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
    const hook = (
      await h.call('POST', `${REPO}/webhooks`, {
        body: { endpoint: 'https://hooks.example.com/x', events: ['*'] },
      })
    ).json
    const tok = (
      await h.call('POST', '/tokens', {
        body: { name: 'shape', scopes: ['repo:read'] },
      })
    ).json
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'a.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    await h.api.fetch(
      new Request(
        up.upload_url.replace(
          'https://api.source.code/v1',
          'https://api.test/v1',
        ),
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: png as unknown as BodyInit,
        },
      ),
    )
    await h.call('POST', `${REPO}/changes/216/evidence`, {
      body: { upload: up.id, kind: 'image' },
    })
    const dynamic: Record<string, string> = {
      'webhooks.get': `${REPO}/webhooks/${hook.id}`,
      'webhooks.deliveries.list': `${REPO}/webhooks/${hook.id}/deliveries`,
      'tokens.get': `/tokens/${tok.id}`,
      'uploads.get': `/uploads/${up.id}`,
    }
    await h.call('POST', `${REPO}/webhooks/${hook.id}/ping`)
    const dlv = (await h.call('GET', `${REPO}/webhooks/${hook.id}/deliveries`))
      .json.data[0]
    dynamic['webhooks.deliveries.get'] =
      `${REPO}/webhooks/${hook.id}/deliveries/${dlv.id}`
    const started = await h.call('POST', `${REPO}/runs`, {
      body: { task: 'shape' },
    })
    dynamic['runs.get'] = `${REPO}/runs/${started.json.id}`
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'shape' },
    })
    dynamic['teams.get'] = '/accounts/northwind/teams/shape'
    const sha = (await h.call('GET', `${REPO}/git/commits`)).json.data[0].sha
    dynamic['git.commit'] = `${REPO}/git/commits/${sha}`
    dynamic['git.diff'] = `${REPO}/git/commits/${sha}/diff`
    Object.assign(paths, dynamic)
    for (const op of h.api.ops.filter(
      (o) => o.method === 'GET' && o.id in paths,
    )) {
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
    expect(unchecked.sort()).toEqual([
      'api.openapi',
      'changes.guide.get',
      'events.stream',
      'git.raw',
      'operations.get',
      'runs.transcript.get',
      'uploads.content',
    ])
  })

  test('every error code used in the source is in the catalog', () => {
    const dir = new URL('.', import.meta.url).pathname
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => dir + f),
      ...readdirSync(dir + 'ops').map((f) => dir + 'ops/' + f),
    ]
    const used = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(
        /apiError\(\s*(?:[^'"\n]*\?\s*)?'([a-z_]+)'/g,
      ))
        used.add(m[1])
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
    expect(
      (await h.call('GET', '/auth/principal', { token: null })).json.code,
    ).toBe('unauthenticated')
    expect(
      (
        await h.call('GET', '/auth/principal', {
          token: 'sxp_unknown_token_value',
        })
      ).json.code,
    ).toBe('token_invalid')
    expect(
      (await h.call('GET', '/auth/principal', { token: 'garbage' })).json.code,
    ).toBe('token_invalid')
    const expired = await h.call('GET', '/auth/principal', {
      token: T(h).expired,
    })
    expect(expired.json.code).toBe('token_expired')
    expect(expired.headers.get('www-authenticate')).toContain('invalid_token')
  })

  test('a missing scope lists what is needed and what the token has', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes`, {
      token: T(h).triage,
      body: { branch: 'x' },
    })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('insufficient_scope')
    expect(r.json.required_scopes).toEqual(['pulls:write'])
    expect(r.json.token_scopes).toContain('issues:write')
  })

  test('validation names each field by JSON pointer and never echoes values', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/issues`, {
      body: { title: '', labels: 'bug', extra: 'secret-value' },
    })
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
    expect(
      (await h.call('POST', `${REPO}/issues`, { raw: '{nope' })).json.errors[0]
        .code,
    ).toBe('invalid_json')
    const wrong = await h.call('POST', `${REPO}/issues`, {
      raw: '{}',
      headers: { 'content-type': 'text/plain' },
    })
    expect(wrong.status).toBe(415)
    const big = await h.call('POST', `${REPO}/issues`, {
      raw: JSON.stringify({ title: 'x', body: 'y'.repeat(1_100_000) }),
    })
    expect(big.status).toBe(413)
  })

  test('a body is stopped while it is read, even without a Content-Length', async () => {
    const h = harness()
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.close()
          return
        }
        sent = true
        controller.enqueue(new Uint8Array(1_100_000))
      },
    })
    const res = await h.api.fetch(
      new Request('https://api.test/v1/repos/dana/gitfs/issues', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${h.tokens.dana}`,
          'content-type': 'application/json',
        },
        body,
      }),
    )
    expect(res.status).toBe(413)
  })

  test('an unsupported version is refused', async () => {
    const h = harness()
    const r = await h.call('GET', '/', {
      headers: { 'sx-version': '2020-01-01' },
    })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('unsupported_version')
  })

  test('CORS preflight allows the headers clients send', async () => {
    const h = harness()
    const res = await h.api.fetch(
      new Request('https://api.test/v1/repos', { method: 'OPTIONS' }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain(
      'idempotency-key',
    )
    expect(res.headers.get('access-control-expose-headers')).toContain(
      'sx-renamed-from',
    )
    expect(res.headers.get('access-control-expose-headers')).toContain('allow')
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
    expect(list.json.data.map((r: { name: string }) => r.name)).not.toContain(
      'notes',
    )
  })

  test('a token limited to one repository cannot change another', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/issues`, {
      token: T(h).limited,
      body: { title: 'nope' },
    })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('forbidden')
    expect(
      (await h.call('GET', `${REPO}/issues`, { token: T(h).limited })).status,
    ).toBe(200)
  })

  test('a token without read scopes cannot read private repository data', async () => {
    const h = harness()
    const token = (
      await h.call('POST', '/tokens', {
        body: { name: 'hooks', scopes: ['webhooks:write'] },
      })
    ).json.secret as string
    for (const path of [
      `${REPO}/changes/216`,
      `${REPO}/issues`,
      '/repos/dana/notes',
      '/events',
      '/search?q=cache',
      `${REPO}/context`,
    ])
      expect((await h.call('GET', path, { token })).status, path).toBe(403)
  })

  test('acting as an organization needs to be a member of it', async () => {
    const h = harness()
    const ok = await h.call('GET', '/auth/principal', {
      headers: { 'sx-account': 'northwind' },
    })
    expect(ok.json.acting_as).toBe('northwind')
    const no = await h.call('GET', '/auth/principal', {
      token: T(h).stranger,
      headers: { 'sx-account': 'northwind' },
    })
    expect(no.status).toBe(403)
  })

  test('a renamed repository answers 308 with the new address, for any method', async () => {
    const h = harness()
    const r = await h.call('POST', '/repos/dana/git-fs/issues?dry_run=true', {
      body: { title: 't' },
    })
    expect(r.status).toBe(308)
    expect(r.headers.get('location')).toBe(
      'https://api.test/v1/repos/dana/gitfs/issues?dry_run=true',
    )
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
    expect((await h.call('GET', `${REPO}/numbers/216`)).json.type).toBe(
      'change',
    )
    expect((await h.call('GET', `${REPO}/numbers/4`)).json.type).toBe('issue')
    expect((await h.call('GET', `${REPO}/numbers/9999`)).status).toBe(404)
  })

  test('context shows environment names only to a token that may see the schema', async () => {
    const h = harness()
    expect(
      (await h.call('GET', `${REPO}/context`, { token: null })).json.env,
    ).toEqual([])
    expect(
      (await h.call('GET', `${REPO}/context`, { token: h.tokens.triage })).json
        .env,
    ).toEqual([])
    expect(
      (await h.call('GET', `${REPO}/context`)).json.env.length,
    ).toBeGreaterThan(0)
  })

  test('a repository id works in the explicit owner/repo form', async () => {
    const h = harness()
    const id = (await h.call('GET', REPO)).json.id as string
    expect((await h.call('GET', `/repos/${id}/~`)).status).toBe(200)
    expect((await h.call('GET', `/repos/${id}/~/issues`)).status).toBe(200)
  })

  test('a conditional env values read is still 200 and no-store', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/env/development/values`, {
      headers: { 'if-none-match': '*' },
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  test('maintainer changes are ACL changes: limited tokens cannot grant and removal revokes write', async () => {
    const h = harness()
    expect(
      (
        await h.call('PATCH', '/repos/dana/tinyqueue', {
          token: h.tokens.limited,
          body: { maintainers: ['stranger'] },
        })
      ).status,
    ).toBe(403)
    // Echoing the current list back is not a change, so a limited token may send it.
    expect(
      (
        await h.call('PATCH', '/repos/dana/tinyqueue', {
          token: h.tokens.limited,
          body: { maintainers: ['dana'] },
        })
      ).status,
    ).toBe(200)
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'aclrepo', maintainers: ['hollis'] },
    })
    const change = await h.call('POST', '/repos/dana/aclrepo/changes', {
      body: { branch: 'a' },
    })
    await h.call('PATCH', '/repos/dana/aclrepo', {
      body: { maintainers: ['dana'] },
    })
    expect(
      (
        await h.call(
          'POST',
          `/repos/dana/aclrepo/changes/${change.json.number}/reviews`,
          { token: h.tokens.hollis, body: { state: 'approved' } },
        )
      ).status,
    ).toBe(403)
  })

  test('an agent review does not replace the human review from the same handle', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'actors' } })
    const made = await h.call('POST', '/repos/dana/actors/changes', {
      body: { branch: 'a' },
    })
    const n = made.json.number
    await h.call('POST', `/repos/dana/actors/changes/${n}/reviews`, {
      token: h.tokens.hollis,
      body: { state: 'approved' },
    })
    expect(
      (
        await h.call('POST', `/repos/dana/actors/changes/${n}/reviews`, {
          body: { state: 'changes' },
        })
      ).status,
    ).toBe(201)
    const policy = async () =>
      (
        await h.call('GET', `/repos/dana/actors/changes/${n}/policy`)
      ).json.requirements.find((r: { id: string }) => r.id === 'core-paths')
        .state
    expect(await policy()).toBe('fail')

    // A run started by dana acts as an agent with dana's handle.
    const run = await h.call('POST', '/repos/dana/actors/runs', {
      body: { task: 'comment on this' },
    })
    expect(
      (
        await h.call('POST', `/repos/dana/actors/changes/${n}/reviews`, {
          token: run.json.token,
          body: { state: 'commented' },
        })
      ).status,
    ).toBe(201)
    expect(await policy()).toBe('fail')
    const reviewers = (
      await h.call('GET', `/repos/dana/actors/changes/${n}`)
    ).json.reviewers.filter(
      (r: { actor: { handle: string } }) => r.actor.handle === 'dana',
    )
    expect(
      reviewers.map((r: { actor: { class: string } }) => r.actor.class).sort(),
    ).toEqual(['agent', 'human'])
    expect(
      reviewers.find(
        (r: { actor: { class: string } }) => r.actor.class === 'human',
      ).state,
    ).toBe('changes')
  })

  test('a repository-limited token cannot read team metadata', async () => {
    const h = harness()
    expect(
      (
        await h.call('GET', '/accounts/northwind/teams', {
          token: h.tokens.limited,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await h.call('GET', '/accounts/northwind/teams', {
          token: h.tokens.hollis,
        })
      ).status,
    ).toBe(200)
  })

  test('upload content needs a read scope too', async () => {
    const h = harness()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'a.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    await h.api.fetch(
      new Request(
        up.upload_url.replace(
          'https://api.source.code/v1',
          'https://api.test/v1',
        ),
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: png as unknown as BodyInit,
        },
      ),
    )
    await h.call('POST', `${REPO}/changes/216/evidence`, {
      body: { upload: up.id, kind: 'image' },
    })
    const token = (
      await h.call('POST', '/tokens', {
        body: { name: 'hooks', scopes: ['webhooks:write'] },
      })
    ).json.secret as string
    expect(
      (await h.call('GET', `/uploads/${up.id}/content`, { token })).status,
    ).toBe(403)
  })

  test('removing an approving maintainer clears policy before landing', async () => {
    const h = harness({ seed: (d) => seedStack(d) })
    const policy = await h.call('GET', '/repos/dana/stacky/changes/1/policy')
    expect(
      policy.json.requirements.find(
        (r: { id: string }) => r.id === 'core-paths',
      ).state,
    ).toBe('pass')
    await h.call('PATCH', '/repos/dana/stacky', {
      body: { maintainers: ['dana'] },
    })
    expect(
      (
        await h.call('POST', '/repos/dana/stacky/changes/1/reviews', {
          token: h.tokens.hollis,
          body: { state: 'approved' },
        })
      ).status,
    ).toBe(403)
    const after = await h.call('GET', '/repos/dana/stacky/changes/1/policy')
    expect(
      after.json.requirements.find((r: { id: string }) => r.id === 'core-paths')
        .state,
    ).toBe('pending')
    const land = await h.call('POST', '/repos/dana/stacky/changes/1/land', {
      body: { expected_tree: '1111111' },
    })
    expect(land.status).toBe(409)
  })

  test('maintainers are people who can review, and the list cannot be empty', async () => {
    const h = harness()
    const made = await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'maint', maintainers: ['hollis'] },
    })
    expect(made.json.maintainers).toEqual(['hollis'])
    const change = await h.call('POST', '/repos/dana/maint/changes', {
      body: { branch: 'b' },
    })
    expect(
      (
        await h.call(
          'POST',
          `/repos/dana/maint/changes/${change.json.number}/reviews`,
          { token: h.tokens.hollis, body: { state: 'approved' } },
        )
      ).status,
    ).toBe(201)
    expect(
      (
        await h.call('POST', '/repos', {
          body: { name: 'empty-maint', maintainers: [] },
        })
      ).status,
    ).toBe(400)
  })

  test('a webhook GET reflects a new delivery and cannot answer a stale 304', async () => {
    const h = harness()
    const made = (
      await h.call('POST', `${REPO}/webhooks`, {
        body: { endpoint: 'https://hooks.example.com/x', events: ['*'] },
      })
    ).json
    const first = await h.call('GET', `${REPO}/webhooks/${made.id}`)
    expect(first.json.last_delivery).toBeNull()
    await h.call('POST', `${REPO}/webhooks/${made.id}/ping`)
    const second = await h.call('GET', `${REPO}/webhooks/${made.id}`)
    expect(second.json.last_delivery).not.toBeNull()
    expect(
      (
        await h.call('GET', `${REPO}/webhooks/${made.id}`, {
          headers: { 'if-none-match': first.headers.get('etag')! },
        })
      ).status,
    ).toBe(200)
  })

  test('the mount is a path segment, not a prefix', async () => {
    const h = harness()
    const at = (method: string, pathname: string) =>
      h.api.fetch(
        new Request(`https://api.test${pathname}`, {
          method,
          headers: { authorization: `Bearer ${h.tokens.dana}` },
        }),
      )
    expect((await at('POST', '/v1batch')).status).toBe(404)
    expect((await at('GET', '/v1repos')).status).toBe(404)
    expect((await at('GET', '/v1')).status).toBe(200)
    expect((await at('GET', '/v1/repos')).status).toBe(200)
  })

  test('a stack dry run checks every expected tree before landing anything', async () => {
    const h = harness({ seed: (d) => seedStack(d) })
    const r = await h.call(
      'POST',
      `/repos/dana/stacky/stacks/${STACK_ID}/land?dry_run=true`,
      {
        body: { expected_trees: { 1: '1111111', 2: '9999999', 3: '3333333' } },
      },
    )
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('stale_head')
    expect(
      (await h.call('GET', '/repos/dana/stacky/changes/1')).json.state,
    ).toBe('open')
  })

  test('an in-progress idempotency key is not evicted', async () => {
    const store = new MemoryIdempotencyStore(
      24 * 3_600_000,
      Date.now,
      2,
      1_000_000,
    )
    await store.begin('s', 'running', 'f')
    await store.begin('s', 'done-1', 'f')
    await store.begin('s', 'done-2', 'f')
    expect((await store.begin('s', 'running', 'f')).state).toBe('in_progress')
  })

  test('a completed idempotency key cannot evict itself', async () => {
    const store = new MemoryIdempotencyStore(24 * 3_600_000, Date.now, 3, 300)
    await store.begin('s', 'big', 'f')
    await store.begin('s', 'other', 'f')
    await store.complete('s', 'other', { status: 200, headers: {}, body: '' })
    await store.complete('s', 'big', {
      status: 200,
      headers: {},
      body: 'x'.repeat(500),
    })
    expect((await store.begin('s', 'big', 'f')).state).toBe('replay')
  })

  test('finished runs are swept after their retention window', async () => {
    const now = clock()
    const h = harness({ now })
    const made = await h.call('POST', `${REPO}/runs`, {
      body: { task: 'sweep' },
    })
    await h.call('POST', `${REPO}/runs/${made.json.id}/finish`, {
      token: made.json.token,
      body: { state: 'succeeded' },
    })
    now.advance(8 * 86_400_000)
    await h.api.port.sweepRunsOperations()
    expect((await h.call('GET', `${REPO}/runs/${made.json.id}`)).status).toBe(
      404,
    )
  })

  test('sync accepts an old repository name without a self-redirect', async () => {
    const h = harness()
    const r = await h.call('GET', '/sync?repo=dana/git-fs')
    expect(r.status).toBe(200)
    expect(r.json.object).toBe('sync')
    const id = (await h.call('GET', REPO)).json.id as string
    expect((await h.call('GET', `/sync?repo=${id}`)).status).toBe(200)
  })

  test('the context cursor can continue with sync', async () => {
    const h = harness()
    const context = await h.call('GET', `${REPO}/context`)
    const next = await h.call(
      'GET',
      `/sync?repo=dana/gitfs&cursor=${context.json.cursor}`,
    )
    expect(next.status, next.text.slice(0, 200)).toBe(200)
    expect(next.json.object).toBe('sync')
  })
})

describe('generations and reuse', () => {
  test('a recreated repository never serves the deleted one from cache', async () => {
    const h = harness()
    const made = await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'phoenix', visibility: 'private' },
    })
    expect(made.status).toBe(201)
    expect((await h.call('GET', '/repos/dana/phoenix')).status).toBe(200)
    expect(
      (await h.call('DELETE', '/repos/dana/phoenix?confirm=dana/phoenix'))
        .status,
    ).toBe(204)
    const again = await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'phoenix', visibility: 'public' },
    })
    expect(again.status).toBe(201)
    const anon = await h.call('GET', '/repos/dana/phoenix', { token: null })
    expect(anon.status).toBe(200)
    expect(anon.json.visibility).toBe('public')
    expect(anon.json.id).toBe(again.json.id)
  })

  test('events do not cross a reused repository name', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'echo', visibility: 'private' },
    })
    await h.call('POST', '/repos/dana/echo/issues', {
      body: { title: 'Secret echo' },
    })
    await h.call('DELETE', '/repos/dana/echo?confirm=dana/echo')
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'echo', visibility: 'public' },
    })
    const events = await h.call('GET', '/events', { token: h.tokens.stranger })
    expect(
      events.json.data.some(
        (e: { data?: { title?: string } }) => e.data?.title === 'Secret echo',
      ),
    ).toBe(false)
  })

  test('a recreated repository cannot inherit attached evidence', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'media', visibility: 'private' },
    })
    const change = await h.call('POST', '/repos/dana/media/changes', {
      body: { branch: 'show' },
    })
    expect(change.status, change.text).toBe(201)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'a.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    await h.api.fetch(
      new Request(
        up.upload_url.replace(
          'https://api.source.code/v1',
          'https://api.test/v1',
        ),
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: png as unknown as BodyInit,
        },
      ),
    )
    await h.call(
      'POST',
      `/repos/dana/media/changes/${change.json.number}/evidence`,
      { body: { upload: up.id, kind: 'image' } },
    )
    const url = `https://api.test/v1/uploads/${up.id}/content`
    await h.call('DELETE', '/repos/dana/media?confirm=dana/media')
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'media', visibility: 'public' },
    })
    expect((await h.api.fetch(new Request(url))).status).toBe(404)
  })

  test('deleting a repository frees its attached upload bytes', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'mem', visibility: 'private' },
    })
    const change = await h.call('POST', '/repos/dana/mem/changes', {
      body: { branch: 'b' },
    })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'm.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    await h.api.fetch(
      new Request(
        up.upload_url.replace(
          'https://api.source.code/v1',
          'https://api.test/v1',
        ),
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: png as unknown as BodyInit,
        },
      ),
    )
    await h.call(
      'POST',
      `/repos/dana/mem/changes/${change.json.number}/evidence`,
      { body: { upload: up.id, kind: 'image' } },
    )
    const before = h.api.port.svc.uploads.blobs.bytes
    await h.call('DELETE', '/repos/dana/mem?confirm=dana/mem')
    expect(h.api.port.svc.uploads.blobs.bytes).toBe(before - png.length)
  })

  test('upload errors say what to do next', async () => {
    const h = harness()
    const big = await h.call('POST', '/uploads', {
      body: { filename: 'big.png', content_type: 'image/png', size: 11 << 20 },
    })
    expect(big.status).toBe(413)
    expect(big.json.code).toBe('payload_too_large')
    expect(big.json.hint).toContain('smaller file')

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'ok.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    const url = up.upload_url.replace(
      'https://api.source.code/v1',
      'https://api.test/v1',
    )
    const wrong = await h.api.fetch(
      new Request(url, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'x',
      }),
    )
    const problem = (await wrong.json()) as { title: string; hint: string }
    expect(wrong.status).toBe(415)
    expect(problem.title).toBe('Unsupported media type')
    expect(problem.hint).toBe('Send Content-Type: image/png.')

    expect(
      (
        await h.api.fetch(
          new Request(url, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: png as unknown as BodyInit,
          }),
        )
      ).status,
    ).toBe(200)
    const again = await h.api.fetch(
      new Request(url, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: png as unknown as BodyInit,
      }),
    )
    expect(again.status).toBe(400)
    expect(((await again.json()) as { hint: string }).hint).toContain(
      'Start a new upload',
    )
  })

  test('a repository-limited token cannot read an attached upload elsewhere', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'secretrepo', visibility: 'private' },
    })
    const change = await h.call('POST', '/repos/dana/secretrepo/changes', {
      body: { branch: 'x' },
    })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6])
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 's.png',
          content_type: 'image/png',
          size: png.length,
        },
      })
    ).json
    await h.api.fetch(
      new Request(
        up.upload_url.replace(
          'https://api.source.code/v1',
          'https://api.test/v1',
        ),
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: png as unknown as BodyInit,
        },
      ),
    )
    await h.call(
      'POST',
      `/repos/dana/secretrepo/changes/${change.json.number}/evidence`,
      { body: { upload: up.id, kind: 'image' } },
    )
    expect(
      (await h.call('GET', `/uploads/${up.id}`, { token: h.tokens.limited }))
        .status,
    ).toBe(404)
    expect(
      (
        await h.call('GET', `/uploads/${up.id}/content`, {
          token: h.tokens.limited,
        })
      ).status,
    ).toBe(404)
    expect((await h.call('GET', `/uploads/${up.id}`)).status).toBe(200)
  })

  test('a cursor ahead of the log resets sync and the stream', async () => {
    const h = harness()
    const repo = (await h.call('GET', REPO)).json.id as string
    const future = (
      await h.call('GET', `/sync?repo=dana/gitfs&cursor=e_${repo}_999999`)
    ).json
    expect(future.reset).toBe(true)
    const futureSnap = (
      await h.call(
        'GET',
        `/sync?repo=dana/gitfs&cursor=s_${repo}_999999_0&limit=1`,
      )
    ).json
    expect(futureSnap.reset).toBe(true)
    await h.call('POST', `${REPO}/issues`, {
      body: { title: 'After the future' },
    })
    const delta = (
      await h.call('GET', `/sync?repo=dana/gitfs&cursor=${future.cursor}`)
    ).json
    expect(
      delta.objects.some(
        (o: { title?: string }) => o.title === 'After the future',
      ),
    ).toBe(true)

    const res = await h.api.fetch(
      new Request('https://api.test/v1/events/stream?repo=dana/gitfs', {
        headers: {
          authorization: `Bearer ${T(h).dana}`,
          'last-event-id': '999999',
        },
      }),
    )
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain(': connected')
    await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Stream after the future' },
    })
    expect(decoder.decode((await reader.read()).value)).toContain(
      'Stream after the future',
    )
    await reader.cancel()
  })

  test('event history follows a rename', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'history', visibility: 'public' },
    })
    await h.call('POST', '/repos/dana/history/issues', {
      body: { title: 'Before the rename' },
    })
    await h.call('PATCH', '/repos/dana/history', { body: { name: 'history2' } })
    const current = await h.call('GET', '/events?repo=dana/history2')
    expect(
      current.json.data.some(
        (e: { data?: { title?: string } }) =>
          e.data?.title === 'Before the rename',
      ),
    ).toBe(true)
    const old = await h.call('GET', '/events?repo=dana/history')
    expect(
      old.json.data.some(
        (e: { data?: { title?: string } }) =>
          e.data?.title === 'Before the rename',
      ),
    ).toBe(true)
  })

  test('a reused name resolves to the new repository, not an old alias', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'rr' } })
    await h.call('POST', '/repos/dana/rr/issues', { body: { title: 'OLD rr' } })
    await h.call('PATCH', '/repos/dana/rr', { body: { name: 'rr2' } })
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'rr' } })
    await h.call('POST', '/repos/dana/rr/issues', { body: { title: 'NEW rr' } })
    const events = await h.call('GET', '/events?repo=dana/rr')
    expect(
      events.json.data.some(
        (e: { data?: { title?: string } }) => e.data?.title === 'NEW rr',
      ),
    ).toBe(true)
    expect(
      events.json.data.some(
        (e: { data?: { title?: string } }) => e.data?.title === 'OLD rr',
      ),
    ).toBe(false)
    expect((await h.call('GET', '/repos/dana/rr')).status).toBe(200)
  })

  test('losing team access invalidates cached events and sync bodies', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'vault', visibility: 'private' },
    })
    await h.call('POST', '/repos/northwind/vault/issues', {
      body: { title: 'Private vault event' },
    })
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'readers' },
    })
    await h.call('PUT', '/accounts/northwind/teams/readers/members/stranger')
    await h.call(
      'PUT',
      '/accounts/northwind/teams/readers/repos/northwind/vault',
      { body: { permission: 'read' } },
    )
    const before = await h.call('GET', '/events', { token: h.tokens.stranger })
    expect(
      before.json.data.some(
        (e: { data?: { title?: string } }) =>
          e.data?.title === 'Private vault event',
      ),
    ).toBe(true)
    const sync = await h.call('GET', '/sync?repo=northwind/vault', {
      token: h.tokens.stranger,
    })
    expect(sync.status).toBe(200)
    await h.call('DELETE', '/accounts/northwind/teams/readers/members/stranger')
    const after = await h.call('GET', '/events', { token: h.tokens.stranger })
    expect(
      after.json.data.some(
        (e: { data?: { title?: string } }) =>
          e.data?.title === 'Private vault event',
      ),
    ).toBe(false)
    expect(
      (
        await h.call('GET', '/sync?repo=northwind/vault', {
          token: h.tokens.stranger,
        })
      ).status,
    ).toBe(404)
  })

  test('If-None-Match * still refuses a private team and repository to a stranger', async () => {
    const h = harness()
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'private' },
    })
    expect(
      (
        await h.call('GET', '/accounts/northwind/teams/private', {
          token: h.tokens.stranger,
          headers: { 'if-none-match': '*' },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await h.call('GET', '/sync?repo=dana/notes', {
          token: h.tokens.stranger,
          headers: { 'if-none-match': '*' },
        })
      ).status,
    ).toBe(404)
  })

  test('a repository-limited token cannot read deleted history', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'vault', visibility: 'private' },
    })
    await h.call('POST', '/repos/northwind/vault/issues', {
      body: { title: 'Deleted private event' },
    })
    const token = (
      await h.call('POST', '/tokens', {
        body: {
          name: 'scoped',
          scopes: ['repo:read', 'issues:read'],
          repos: ['northwind/vault'],
        },
      })
    ).json.secret as string
    expect(
      (await h.call('GET', '/events?repo=northwind/vault', { token })).status,
    ).toBe(200)
    await h.call('DELETE', '/repos/northwind/vault?confirm=northwind/vault')
    expect(
      (await h.call('GET', '/events?repo=northwind/vault', { token })).status,
    ).toBe(404)
  })

  test('a repository-limited token matches names without regard to case', async () => {
    const h = harness()
    const token = (
      await h.call('POST', '/tokens', {
        body: { name: 'scoped', scopes: ['repo:read'], repos: ['DANA/Notes'] },
      })
    ).json.secret as string
    expect((await h.call('GET', '/repos/dana/notes', { token })).status).toBe(
      200,
    )
  })

  test('a repository-limited token follows a rename but not a reused name', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'w-a', visibility: 'private' },
    })
    const token = (
      await h.call('POST', '/tokens', {
        body: { name: 'scoped', scopes: ['repo:read'], repos: ['dana/w-a'] },
      })
    ).json.secret as string
    await h.call('PATCH', '/repos/dana/w-a', { body: { name: 'w-b' } })
    expect((await h.call('GET', '/repos/dana/w-b', { token })).status).toBe(200)
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'w-a', visibility: 'private' },
    })
    expect((await h.call('GET', '/repos/dana/w-a', { token })).status).toBe(404)
  })

  test('a repository-limited token cannot administer teams', async () => {
    const h = harness()
    expect(
      (
        await h.call('POST', '/accounts/northwind/teams', {
          token: h.tokens.limited,
          body: { slug: 'nope' },
        })
      ).status,
    ).toBe(403)
  })

  test('a secret-bearing response refuses an Idempotency-Key', async () => {
    const h = harness()
    const r = await h.call('POST', '/tokens', {
      headers: { 'idempotency-key': 'secret-key' },
      body: { name: 'x', scopes: ['repo:read'] },
    })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('invalid_request')
  })

  test('a repeated dry run with the same key is not left in progress', async () => {
    const h = harness()
    const body = { name: 'dry-run' }
    const key = 'dry-run-key'
    expect(
      (
        await h.call('POST', '/repos?dry_run=true', {
          headers: { 'idempotency-key': key },
          body,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await h.call('POST', '/repos?dry_run=true', {
          headers: { 'idempotency-key': key },
          body,
        })
      ).status,
    ).toBe(200)
  })

  test('NDJSON is not replaced by a cached JSON body', async () => {
    const h = harness()
    const json = await h.call('GET', `${REPO}/changes?state=all`)
    expect(json.headers.get('vary')).toContain('accept')
    const nd = await h.call('GET', `${REPO}/changes?state=all`, {
      headers: { accept: 'application/x-ndjson' },
    })
    expect(nd.headers.get('content-type')).toContain('x-ndjson')
  })

  test('a HEAD on the event stream opens no waiter but answers like GET', async () => {
    const h = harness()
    const r = await h.call('HEAD', '/events/stream')
    expect(r.status).toBe(200)
    expect(h.api.events.waiting).toBe(0)
    expect((await h.call('HEAD', '/events/stream?repo=nope/nope')).status).toBe(
      404,
    )
    expect((await h.call('HEAD', '/events/stream?bad=1')).status).toBe(400)
    expect(
      (
        await h.call('HEAD', '/events/stream?repo=dana/notes', {
          token: h.tokens.stranger,
        })
      ).status,
    ).toBe(404)
  })

  test('an unrelated repository event does not change a scoped events ETag', async () => {
    const h = harness()
    const etag = (await h.call('GET', '/events?repo=dana/gitfs')).headers.get(
      'etag',
    )!
    await h.call('POST', '/repos/northwind/relay/issues', {
      body: { title: 'Elsewhere' },
    })
    expect(
      (
        await h.call('GET', '/events?repo=dana/gitfs', {
          headers: { 'if-none-match': etag },
        })
      ).status,
    ).toBe(304)
    const changes = (
      await h.call('GET', `${REPO}/changes?state=all`)
    ).headers.get('etag')!
    await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Not a change event' },
    })
    expect(
      (
        await h.call('GET', `${REPO}/changes?state=all`, {
          headers: { 'if-none-match': changes },
        })
      ).status,
    ).toBe(304)
  })

  test('a chain of renames keeps every old address working', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'chain', visibility: 'public' },
    })
    await h.call('PATCH', '/repos/dana/chain', { body: { name: 'chain2' } })
    await h.call('PATCH', '/repos/dana/chain2', { body: { name: 'chain3' } })
    const old = await h.call('GET', '/repos/dana/chain')
    expect(old.status).toBe(308)
    expect(old.headers.get('location')).toContain('/repos/dana/chain3')
    const mixed = await h.call('GET', '/repos/Dana/Chain')
    expect(mixed.status).toBe(308)
    expect(mixed.headers.get('location')).toContain('/repos/dana/chain3')
    const double = await h.call('GET', '/repos/dana//chain')
    expect(double.status).toBe(308)
    const doubleAt = new URL(double.headers.get('location')!).pathname.replace(
      /^\/v1/,
      '',
    )
    expect(doubleAt).toBe('/repos/dana/chain3')
    expect((await h.call('GET', doubleAt)).status).toBe(200)
    const encoded = await h.call('GET', '/repos/dana/ch%61in')
    expect(encoded.status).toBe(308)
    const encodedAt = new URL(
      encoded.headers.get('location')!,
    ).pathname.replace(/^\/v1/, '')
    expect(encodedAt).toBe('/repos/dana/chain3')
    expect((await h.call('GET', encodedAt)).status).toBe(200)
    const events = await h.call('GET', '/events?repo=dana/chain')
    expect(events.status).toBe(200)
  })

  test('a rename redirect rewrites a delete confirmation', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'confirmdemo', visibility: 'public' },
    })
    await h.call('PATCH', '/repos/dana/confirmdemo', {
      body: { name: 'confirmdemo2' },
    })
    const old = await h.call(
      'DELETE',
      '/repos/dana/confirmdemo?confirm=dana/confirmdemo',
    )
    expect(old.status).toBe(308)
    const to = new URL(old.headers.get('location')!)
    expect(to.searchParams.get('confirm')).toBe('dana/confirmdemo2')
    const at = `${to.pathname.replace(/^\/v1/, '')}${to.search}`
    expect((await h.call('DELETE', at)).status).toBe(204)
  })

  test('repository names are unique without regard to case', async () => {
    const h = harness()
    const first = await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'CaseRepo', visibility: 'private' },
    })
    expect(first.status).toBe(201)
    const second = await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'caserepo', visibility: 'public' },
    })
    expect(second.status).toBe(200)
    expect(second.json.visibility).toBe('private')
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'other' } })
    expect(
      (await h.call('PATCH', '/repos/dana/other', { body: { name: 'GITFS' } }))
        .status,
    ).toBe(409)
  })

  test('If-Match ignores unrelated repository and ACL changes', async () => {
    const h = harness()
    const etag = (await h.call('GET', `${REPO}/changes/216`)).headers.get(
      'etag',
    )!
    await h.call('PATCH', REPO, { body: { description: 'unrelated edit' } })
    expect(
      (
        await h.call('PATCH', `${REPO}/changes/216`, {
          body: { title: 'still mine' },
          headers: { 'if-match': etag },
        })
      ).status,
    ).toBe(200)
    const issue = (
      await h.call('POST', `${REPO}/issues`, { body: { title: 'issue' } })
    ).json
    const issueTag = (
      await h.call('GET', `${REPO}/issues/${issue.number}`)
    ).headers.get('etag')!
    await h.call('POST', '/accounts/northwind/teams', { body: { slug: 'acl' } })
    expect(
      (
        await h.call('PATCH', `${REPO}/issues/${issue.number}`, {
          body: { title: 'still mine' },
          headers: { 'if-match': issueTag },
        })
      ).status,
    ).toBe(200)
  })
})

describe('If-Match', () => {
  test('accepts the ETag the API returned for repositories, changes and teams', async () => {
    const h = harness()
    const repo = await h.call('GET', REPO)
    expect(
      (
        await h.call('PATCH', REPO, {
          body: { description: 'etag repo' },
          headers: { 'if-match': repo.headers.get('etag')! },
        })
      ).status,
    ).toBe(200)
    const change = await h.call('GET', `${REPO}/changes/216`)
    expect(
      (
        await h.call('PATCH', `${REPO}/changes/216`, {
          body: { title: 'etag change' },
          headers: { 'if-match': change.headers.get('etag')! },
        })
      ).status,
    ).toBe(200)
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'etag' },
    })
    const team = await h.call('GET', '/accounts/northwind/teams/etag')
    expect(
      (
        await h.call('PATCH', '/accounts/northwind/teams/etag', {
          body: { description: 'etag team' },
          headers: { 'if-match': team.headers.get('etag')! },
        })
      ).status,
    ).toBe(200)
  })

  test('an operation ETag is unique and does not answer 304 to someone who cannot read it', async () => {
    const h = harness({ seed: (d) => seedStack(d) })
    const started = await h.call(
      'POST',
      `/repos/dana/stacky/stacks/${STACK_ID}/land`,
      {
        body: { expected_trees: { 1: '1111111', 2: '2222222', 3: '3333333' } },
      },
    )
    expect(started.status, started.text).toBe(202)
    const id = started.json.id as string
    const op = await h.call('GET', `/operations/${id}`)
    expect(op.status).toBe(200)
    expect(
      (
        await h.call('GET', `/operations/${id}`, {
          headers: { 'if-none-match': op.headers.get('etag')! },
        })
      ).status,
    ).toBe(304)
    await h.call('PATCH', '/repos/dana/stacky', {
      body: { visibility: 'private' },
    })
    expect(
      (
        await h.call('GET', `/operations/${id}`, {
          token: h.tokens.stranger,
          headers: { 'if-none-match': op.headers.get('etag')! },
        })
      ).status,
    ).toBe(404)
  })
})

describe('lists', () => {
  test('a walk with a small limit returns every item once, in order, at any depth', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 1000, 300) })
    const seen: Array<number> = []
    let cursor: string | null = null
    let pages = 0
    do {
      const r = await h.call(
        'GET',
        `/repos/dana/big/changes?state=all&limit=90${cursor ? `&cursor=${cursor}` : ''}&sort=-number`,
      )
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
    await h.call('PATCH', `/repos/dana/big/changes/${seen[0]}`, {
      body: { title: 'edited' },
    })
    const later = first.json.next_cursor
    const second = await h.call(
      'GET',
      `/repos/dana/big/changes?limit=500&cursor=${later}`,
    )
    for (const c of second.json.data) expect(seen).not.toContain(c.number)
  })

  test('a cursor from another filter is refused', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 100, 0) })
    const a = await h.call(
      'GET',
      '/repos/dana/big/changes?limit=10&author=dana',
    )
    const b = await h.call(
      'GET',
      `/repos/dana/big/changes?limit=10&author=ines&cursor=${a.json.next_cursor}`,
    )
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
    expect(landed.json.data.map((c: { number: number }) => c.number)).toEqual([
      210,
    ])
    const mine = await h.call('GET', `${REPO}/changes?author=ines`)
    expect(mine.json.data.map((c: { number: number }) => c.number)).toEqual([
      212,
    ])
    const asc = await h.call('GET', `${REPO}/changes?sort=number&state=all`)
    expect(asc.json.data.map((c: { number: number }) => c.number)).toEqual([
      210, 212, 215, 216, 217, 218,
    ])
    expect((await h.call('GET', `${REPO}/changes?state=bogus`)).status).toBe(
      400,
    )
    const labelled = await h.call('GET', `${REPO}/issues?label=bug`)
    expect(labelled.json.data.map((i: { number: number }) => i.number)).toEqual(
      [4],
    )
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
    const one = await h.call(
      'GET',
      `${REPO}/changes/216?fields=title,head.tree,policy`,
    )
    expect(Object.keys(one.json).sort()).toEqual([
      'head',
      'id',
      'object',
      'policy',
      'title',
    ])
    expect(one.json.head).toEqual({ tree: '9c4d7e1' })
    const list = await h.call('GET', `${REPO}/changes?fields=number`)
    expect(list.json.object).toBe('list')
    expect(Object.keys(list.json.data[0]).sort()).toEqual([
      'id',
      'number',
      'object',
    ])
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
    const full = (
      await h.call('GET', `${REPO}/changes/216?expand=findings,repo`)
    ).json
    expect(full.findings.length).toBe(3)
    expect(full.repo.stars).toBe(2140)
    expect(
      (await h.call('GET', `${REPO}/changes/216?expand=nope`)).status,
    ).toBe(400)
  })

  test('a list can be streamed as ndjson', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes?state=all`, {
      headers: { accept: 'application/x-ndjson' },
    })
    expect(r.headers.get('content-type')).toContain('x-ndjson')
    const lines = r.text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines.length).toBe(7)
    expect(lines.at(-1)).toEqual({
      object: 'page',
      has_more: false,
      next_cursor: null,
    })
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
    const same = await h.call('GET', `${REPO}/changes/216`, {
      headers: { 'if-none-match': etag },
    })
    expect(same.status).toBe(304)
    expect(same.text).toBe('')
    await h.call('POST', `${REPO}/changes/216/reviews`, {
      token: T(h).hollis,
      body: { state: 'commented', body: 'nit' },
    })
    const changed = await h.call('GET', `${REPO}/changes/216`, {
      headers: { 'if-none-match': etag },
    })
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
    const anon = (await h.call('GET', `${REPO}/changes/216`, { token: null }))
      .json
    const reader = (
      await h.call('POST', '/tokens', {
        body: { name: 'reader', scopes: ['repo:read', 'pulls:read'] },
      })
    ).json.secret as string
    const triage = (
      await h.call('GET', `${REPO}/changes/216`, { token: reader })
    ).json
    expect(anon.actions.land.reasons).toEqual(['sign_in'])
    expect(triage.actions.abandon.reasons).toEqual(['scope:pulls:write'])
    expect(dana.actions.abandon.allowed).toBe(true)
  })

  test('If-Match refuses an edit made on top of a stale read, and returns the current object', async () => {
    const h = harness()
    const got = await h.call('GET', `${REPO}/issues/4`)
    const etag = got.headers.get('etag')!
    const ok = await h.call('PATCH', `${REPO}/issues/4`, {
      body: { title: 'Panic on trailing-dot refs' },
      headers: { 'if-match': etag },
    })
    expect(ok.status).toBe(200)
    const stale = await h.call('PATCH', `${REPO}/issues/4`, {
      body: { title: 'Again' },
      headers: { 'if-match': etag },
    })
    expect(stale.status).toBe(412)
    expect(stale.json.code).toBe('version_mismatch')
    expect(stale.json.current.title).toBe('Panic on trailing-dot refs')
  })

  test('?wait holds a read until the thing changes', async () => {
    const h = harness()
    const a = await h.call('GET', `${REPO}/changes/216`)
    const etag = a.headers.get('etag')!
    const started = performance.now()
    const waiting = h.call('GET', `${REPO}/changes/216?wait=10`, {
      headers: { 'if-none-match': etag },
    })
    setTimeout(
      () =>
        void h.call('POST', `${REPO}/changes/216/reviews`, {
          token: T(h).hollis,
          body: { state: 'commented' },
        }),
      50,
    )
    const r = await waiting
    expect(r.status).toBe(200)
    expect(r.headers.get('etag')).not.toBe(etag)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('?wait wakes for a mixed-case repository address', async () => {
    const h = harness()
    const upper = '/repos/DANA/GITFS/changes/216'
    const etag = (await h.call('GET', upper)).headers.get('etag')!
    const started = performance.now()
    const waiting = h.call('GET', `${upper}?wait=5`, {
      headers: { 'if-none-match': etag },
    })
    setTimeout(
      () =>
        void h.call('POST', `${REPO}/changes/216/reviews`, {
          token: T(h).hollis,
          body: { state: 'commented' },
        }),
      50,
    )
    const r = await waiting
    expect(r.status).toBe(200)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test('?wait answers 304 when time runs out', async () => {
    const h = harness()
    const etag = (await h.call('GET', `${REPO}/changes/216`)).headers.get(
      'etag',
    )!
    const started = performance.now()
    const r = await h.call('GET', `${REPO}/changes/216?wait=1`, {
      headers: { 'if-none-match': etag },
    })
    expect(r.status).toBe(304)
    expect(performance.now() - started).toBeGreaterThan(900)
    expect(h.api.events.waiting).toBe(0)
  })

  test('?wait holds a list until its repository changes or time runs out', async () => {
    const h = harness()
    const etag = (await h.call('GET', `${REPO}/changes?state=all`)).headers.get(
      'etag',
    )!
    const started = performance.now()
    const r = await h.call('GET', `${REPO}/changes?state=all&wait=1`, {
      headers: { 'if-none-match': etag },
    })
    expect(r.status).toBe(304)
    expect(performance.now() - started).toBeGreaterThan(900)
  })

  test('fields and markdown work together, and a nested unknown field is refused', async () => {
    const h = harness()
    const md = await h.call('GET', `${REPO}/changes/216?fields=title`, {
      headers: { accept: 'text/markdown' },
    })
    expect(md.status, md.text.slice(0, 200)).toBe(200)
    expect(md.headers.get('content-type')).toContain('text/markdown')
    expect(
      (await h.call('GET', `${REPO}/changes/216?fields=head.tree`)).status,
    ).toBe(200)
    expect(
      (await h.call('GET', `${REPO}/changes/216?fields=repo.full_name`)).status,
    ).toBe(200)
    expect(
      (await h.call('GET', `${REPO}/changes/216?fields=head.nope`)).status,
    ).toBe(400)
    expect(
      (await h.call('GET', `${REPO}/changes/216?fields=head.tree.nope`)).status,
    ).toBe(400)
  })

  test('wait is refused where it makes no sense', async () => {
    const h = harness()
    expect((await h.call('GET', '/limits?wait=5')).status).toBe(400)
    expect((await h.call('GET', `${REPO}/changes/216?wait=99`)).status).toBe(
      400,
    )
    const noTag = await h.call('GET', `${REPO}/changes/216?wait=5`)
    expect(noTag.status).toBe(400)
    expect(noTag.json.errors[0].code).toBe('needs_if_none_match')
  })
})

describe('writes', () => {
  test('a 204 replays without a body', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { name: 'gone' } })
    const key = 'delete-once'
    const first = await h.call('DELETE', '/repos/dana/gone?confirm=dana/gone', {
      headers: { 'idempotency-key': key },
    })
    expect(first.status).toBe(204)
    const again = await h.call('DELETE', '/repos/dana/gone?confirm=dana/gone', {
      headers: { 'idempotency-key': key },
    })
    expect(again.status).toBe(204)
    expect(again.text).toBe('')
    expect(again.headers.get('sx-replayed')).toBe('true')
  })

  test('a store failure after a write keeps the response and the key in progress', async () => {
    const store = new MemoryIdempotencyStore()
    store.complete = () => Promise.reject(new Error('store down'))
    const h = harness({ idempotency: store })
    const key = 'store-down'
    const error = console.error
    console.error = () => {}
    try {
      const first = await h.call('POST', '/repos', {
        headers: { 'idempotency-key': key },
        body: { name: 'store-down' },
      })
      expect(first.status).toBe(201)
      const retry = await h.call('POST', '/repos', {
        headers: { 'idempotency-key': key },
        body: { name: 'store-down' },
      })
      expect(retry.json.code).toBe('request_in_progress')
    } finally {
      console.error = error
    }
  })

  test('a dry run shows the change it would make', async () => {
    const h = harness()
    const preview = await h.call('PATCH', `${REPO}?dry_run=true`, {
      body: { description: 'Would be this' },
    })
    expect(preview.json.description).toBe('Would be this')
    expect(preview.headers.get('location')).toBeNull()
    const created = await h.call('POST', '/repos?dry_run=true', {
      body: { name: 'would-exist' },
    })
    expect(created.headers.get('location')).toBeNull()
    expect((await h.call('GET', REPO)).json.description).not.toBe(
      'Would be this',
    )
    const abandon = await h.call(
      'POST',
      `${REPO}/changes/216/abandon?dry_run=true`,
    )
    expect(abandon.json.state).toBe('abandoned')
    expect((await h.call('GET', `${REPO}/changes/216`)).json.state).toBe('open')
  })

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
    expect(
      list.json.data.filter((i: { title: string }) => i.title === body.title)
        .length,
    ).toBe(1)
  })

  test('the same key with a different request is refused', async () => {
    const h = harness()
    const headers = { 'idempotency-key': 'k-2' }
    await h.call('POST', `${REPO}/issues`, { body: { title: 'One' }, headers })
    const r = await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Two' },
      headers,
    })
    expect(r.status).toBe(422)
    expect(r.json.code).toBe('idempotency_key_reused')
  })

  test('a replay cannot outlive access or a reused repository name', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'vault', visibility: 'private' },
    })
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'vault-access' },
    })
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault-access/repos/northwind/vault',
      { body: { permission: 'write' } },
    )
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault-access/members/stranger',
    )
    const headers = { 'idempotency-key': 'acl-replay' }
    const first = await h.call('POST', '/repos/northwind/vault/issues', {
      token: h.tokens.stranger,
      body: { title: 'Private issue' },
      headers,
    })
    expect(first.status).toBe(201)
    await h.call(
      'DELETE',
      '/accounts/northwind/teams/vault-access/members/stranger',
    )
    const denied = await h.call('POST', '/repos/northwind/vault/issues', {
      token: h.tokens.stranger,
      body: { title: 'Private issue' },
      headers,
    })
    expect(denied.status).toBe(422)
    expect(denied.json.code).toBe('idempotency_key_reused')
    expect(denied.text).not.toContain('Private issue')

    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'reuse', visibility: 'private' },
    })
    const key = { 'idempotency-key': 'reuse-replay' }
    await h.call('POST', '/repos/dana/reuse/issues', {
      body: { title: 'Old repo' },
      headers: key,
    })
    await h.call('PATCH', '/repos/dana/reuse', { body: { name: 'reuse-old' } })
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'reuse', visibility: 'private' },
    })
    const fresh = await h.call('POST', '/repos/dana/reuse/issues', {
      body: { title: 'Old repo' },
      headers: key,
    })
    expect(fresh.status).toBe(422)
    expect(fresh.json.code).toBe('idempotency_key_reused')
    expect(fresh.text).not.toContain('Old repo')
  })

  test('routed path variants use the same idempotency identity', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'slash', visibility: 'public' },
    })
    const key = { 'idempotency-key': 'slash-delete' }
    expect(
      (
        await h.call('DELETE', '/repos/dana/slash/?confirm=dana/slash', {
          headers: key,
        })
      ).status,
    ).toBe(204)
    const again = await h.call(
      'DELETE',
      '/repos/dana/slash/?confirm=dana/slash',
      { headers: key },
    )
    expect(again.status).toBe(204)
    expect(again.headers.get('sx-replayed')).toBe('true')

    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'slashid', visibility: 'public' },
    })
    const repo = (await h.call('GET', '/repos/dana/slashid')).json
    const key2 = { 'idempotency-key': 'slash-id-delete' }
    expect(
      (
        await h.call('DELETE', `/repos/${repo.id}/?confirm=dana/slashid`, {
          headers: key2,
        })
      ).status,
    ).toBe(204)
    const againId = await h.call(
      'DELETE',
      `/repos/${repo.id}/?confirm=dana/slashid`,
      { headers: key2 },
    )
    expect(againId.status).toBe(204)
    expect(againId.headers.get('sx-replayed')).toBe('true')

    const alias = await h.call('POST', '/repos/dana/git-fs/issues', {
      headers: { 'idempotency-key': 'alias-write' },
      body: { title: 'Alias write' },
    })
    expect(alias.status).toBe(308)
    const canonical = new URL(alias.headers.get('location')!).pathname.replace(
      /^\/v1/,
      '',
    )
    const headers = { 'idempotency-key': 'alias-write' }
    expect(
      (
        await h.call('POST', canonical, {
          headers,
          body: { title: 'Alias write' },
        })
      ).status,
    ).toBe(201)
    const replay = await h.call('POST', canonical, {
      headers,
      body: { title: 'Alias write' },
    })
    expect(replay.status).toBe(201)
    expect(replay.headers.get('sx-replayed')).toBe('true')
  })

  test('an extra slash cannot bypass the replay access stamp', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'vault3', visibility: 'private' },
    })
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'vault3-access' },
    })
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault3-access/repos/northwind/vault3',
      { body: { permission: 'write' } },
    )
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault3-access/members/stranger',
    )
    const hook = (
      await h.call('POST', '/repos/northwind/vault3/webhooks', {
        body: { endpoint: 'https://hooks.example.com/slash', events: ['*'] },
      })
    ).json
    const key = { 'idempotency-key': 'slash-hook-delete' }
    expect(
      (
        await h.call('DELETE', `/repos/northwind//vault3/webhooks/${hook.id}`, {
          token: h.tokens.stranger,
          headers: key,
        })
      ).status,
    ).toBe(204)
    await h.call(
      'DELETE',
      '/accounts/northwind/teams/vault3-access/members/stranger',
    )
    const denied = await h.call(
      'DELETE',
      `/repos/northwind//vault3/webhooks/${hook.id}`,
      { token: h.tokens.stranger, headers: key },
    )
    expect(denied.status).toBe(422)
    expect(denied.json.code).toBe('idempotency_key_reused')
  })

  test('a wildcard If-Match replays instead of overwriting', async () => {
    const h = harness()
    for (const wildcard of ['*', '"*"', 'W/"*"', 'W/"other", W/"*"']) {
      const made = await h.call('POST', `${REPO}/issues`, {
        body: { title: `wild ${wildcard}` },
      })
      const n = made.json.number
      const headers = {
        'idempotency-key': `wild-${wildcard}`,
        'if-match': wildcard,
      }
      const body = { title: 'from retry' }
      expect(
        (await h.call('PATCH', `${REPO}/issues/${n}`, { body, headers }))
          .status,
      ).toBe(200)
      await h.call('PATCH', `${REPO}/issues/${n}`, {
        body: { title: 'concurrent' },
      })
      const again = await h.call('PATCH', `${REPO}/issues/${n}`, {
        body,
        headers,
      })
      expect(again.status).toBe(200)
      expect(again.headers.get('sx-replayed')).toBe('true')
      expect((await h.call('GET', `${REPO}/issues/${n}`)).json.title).toBe(
        'concurrent',
      )
    }
  })

  test('a repository-limited token keeps its key across a rename', async () => {
    const h = harness()
    const made = await h.call('POST', '/repos/dana/tinyqueue/changes', {
      body: { branch: 'keyed' },
    })
    const headers = { 'idempotency-key': 'limited-rename' }
    const body = { state: 'commented' }
    const first = await h.call(
      'POST',
      `/repos/dana/tinyqueue/changes/${made.json.number}/reviews`,
      { token: h.tokens.limited, headers, body },
    )
    expect(first.status).toBe(201)
    await h.call('PATCH', '/repos/dana/tinyqueue', {
      body: { name: 'tinyqueue2' },
    })
    const again = await h.call(
      'POST',
      `/repos/dana/tinyqueue2/changes/${made.json.number}/reviews`,
      { token: h.tokens.limited, headers, body },
    )
    expect(again.status).toBe(201)
    expect(again.headers.get('sx-replayed')).toBe('true')
    expect(again.json.id).toBe(first.json.id)
  })

  test('a team named repos does not confuse rename redirects', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'teamrepo', visibility: 'public' },
    })
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'repos' },
    })
    await h.call(
      'PUT',
      '/accounts/northwind/teams/repos/repos/northwind/teamrepo',
      { body: { permission: 'read' } },
    )
    await h.call('PATCH', '/repos/northwind/teamrepo', {
      body: { name: 'teamrepo2' },
    })
    const old = await h.call(
      'PUT',
      '/accounts/northwind/teams/repos/repos/northwind/teamrepo',
      { body: { permission: 'read' } },
    )
    expect(old.status).toBe(308)
    const at = new URL(old.headers.get('location')!).pathname.replace(
      /^\/v1/,
      '',
    )
    expect(at).toBe('/accounts/northwind/teams/repos/repos/northwind/teamrepo2')
    expect(
      (await h.call('PUT', at, { body: { permission: 'read' } })).status,
    ).toBe(200)
  })

  test('a conditional write is checked again instead of replayed', async () => {
    const h = harness()
    const made = await h.call('POST', `${REPO}/issues`, {
      body: { title: 'conditional' },
    })
    const issue = await h.call('GET', `${REPO}/issues/${made.json.number}`)
    const headers = {
      'idempotency-key': 'if-match-key',
      'if-match': issue.headers.get('etag')!,
    }
    const body = { title: 'first edit' }
    expect(
      (
        await h.call('PATCH', `${REPO}/issues/${made.json.number}`, {
          body,
          headers,
        })
      ).status,
    ).toBe(200)
    await h.call('PATCH', `${REPO}/issues/${made.json.number}`, {
      body: { title: 'someone else' },
    })
    const again = await h.call('PATCH', `${REPO}/issues/${made.json.number}`, {
      body,
      headers,
    })
    expect(again.status).toBe(412)
    expect(again.headers.get('sx-replayed')).toBeNull()
    const hijack = await h.call('PATCH', `${REPO}/issues/${made.json.number}`, {
      body: { title: 'hijack' },
      headers,
    })
    expect(hijack.status).toBe(422)
    expect(hijack.json.code).toBe('idempotency_key_reused')
  })

  test('If-Match does not defeat idempotency on operations that ignore it', async () => {
    const h = harness()
    const hook = (
      await h.call('POST', `${REPO}/webhooks`, {
        body: { endpoint: 'https://hooks.example.com/ping', events: ['*'] },
      })
    ).json
    const headers = { 'idempotency-key': 'ping-key', 'if-match': '"1"' }
    const first = await h.call('POST', `${REPO}/webhooks/${hook.id}/ping`, {
      headers,
    })
    expect(first.status).toBe(202)
    const again = await h.call('POST', `${REPO}/webhooks/${hook.id}/ping`, {
      headers,
    })
    expect(again.status).toBe(202)
    expect(again.headers.get('sx-replayed')).toBe('true')
    expect(
      (await h.call('GET', `${REPO}/webhooks/${hook.id}/deliveries`)).json.data
        .length,
    ).toBe(1)
  })

  test('a repository delete by id replays, but other deletes need write access', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'byid', visibility: 'public' },
    })
    const repo = (await h.call('GET', '/repos/dana/byid')).json
    const key = { 'idempotency-key': 'delete-by-id' }
    expect(
      (
        await h.call('DELETE', `/repos/${repo.id}?confirm=dana/byid`, {
          headers: key,
        })
      ).status,
    ).toBe(204)
    const again = await h.call(
      'DELETE',
      `/repos/${repo.id}?confirm=dana/byid`,
      { headers: key },
    )
    expect(again.status).toBe(204)
    expect(again.headers.get('sx-replayed')).toBe('true')

    await h.call('POST', '/repos', {
      body: { owner: 'northwind', name: 'vault2', visibility: 'private' },
    })
    await h.call('POST', '/accounts/northwind/teams', {
      body: { slug: 'vault2-access' },
    })
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault2-access/repos/northwind/vault2',
      { body: { permission: 'write' } },
    )
    await h.call(
      'PUT',
      '/accounts/northwind/teams/vault2-access/members/stranger',
    )
    const hook = (
      await h.call('POST', '/repos/northwind/vault2/webhooks', {
        body: { endpoint: 'https://hooks.example.com/delete', events: ['*'] },
      })
    ).json
    const hookKey = { 'idempotency-key': 'delete-hook' }
    expect(
      (
        await h.call('DELETE', `/repos/northwind/vault2/webhooks/${hook.id}`, {
          token: h.tokens.stranger,
          headers: hookKey,
        })
      ).status,
    ).toBe(204)
    await h.call(
      'DELETE',
      '/accounts/northwind/teams/vault2-access/members/stranger',
    )
    const denied = await h.call(
      'DELETE',
      `/repos/northwind/vault2/webhooks/${hook.id}`,
      { token: h.tokens.stranger, headers: hookKey },
    )
    expect(denied.status).toBe(422)
    expect(denied.json.code).toBe('idempotency_key_reused')
  })

  test('a renamed private repository is not disclosed through a token alias', async () => {
    const h = harness()
    await h.call('POST', '/repos', {
      body: { owner: 'dana', name: 'leak', visibility: 'private' },
    })
    await h.call('PATCH', '/repos/dana/leak', {
      body: { name: 'leak-renamed' },
    })
    const r = await h.call('POST', '/tokens', {
      token: h.tokens.stranger,
      body: { name: 'probe', scopes: ['repo:read'], repos: ['dana/leak'] },
    })
    expect(r.status).toBe(404)
    expect(r.json.detail).toContain('dana/leak')
    expect(r.text).not.toContain('leak-renamed')
  })

  test('token repositories are stored under their current name', async () => {
    const h = harness()
    const made = await h.call('POST', '/tokens', {
      body: { name: 'alias', scopes: ['repo:read'], repos: ['dana/git-fs'] },
    })
    expect(made.status).toBe(201)
    expect(made.json.repos).toEqual(['dana/gitfs'])
  })

  test('a failed request frees its key, so a corrected retry works', async () => {
    const h = harness()
    const headers = { 'idempotency-key': 'k-3' }
    const bad = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '9c4d7e1' },
      headers,
    })
    expect(bad.status).toBe(409)
    const again = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '9c4d7e1' },
      headers,
    })
    expect(again.headers.get('sx-replayed')).toBeNull()
    expect(again.status).toBe(409)
  })

  test('a second request with the key while the first runs is told to wait', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow = defineOp({
      id: 'test.slow',
      summary: 'slow',
      tags: ['test'],
      method: 'POST',
      path: '/slow',
      auth: 'required',
      pool: 'write',
      safety: 'write',
      idempotent: true,
      body: z.strictObject({}),
      response: z.strictObject({ ok: z.boolean() }),
      handler: () =>
        Effect.promise(async () => {
          await gate
          return { ok: true }
        }),
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
    const a = await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Natural' },
    })
    const b = await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Natural' },
    })
    expect([a.status, b.status]).toEqual([201, 200])
    expect(b.headers.get('sx-outcome')).toBe('unchanged')
    expect(b.json.id).toBe(a.json.id)

    const c1 = await h.call('POST', `${REPO}/changes`, {
      body: { branch: 'feature-x' },
    })
    expect(c1.status).toBe(201)
    expect(c1.headers.get('sx-outcome')).toBe('created')
    const sha = c1.json.head.sha
    const c2 = await h.call('POST', `${REPO}/changes`, {
      body: { branch: 'feature-x', sha },
    })
    expect(c2.status).toBe(200)
    expect(c2.headers.get('sx-outcome')).toBe('unchanged')
    const c3 = await h.call('POST', `${REPO}/changes`, {
      body: { branch: 'feature-x', sha: 'abcdef1234' },
    })
    expect(c3.headers.get('sx-outcome')).toBe('patch_set_added')
    expect(c3.json.number).toBe(c1.json.number)
    expect(c3.json.patch_set_count).toBe(2)
  })

  test('dry run changes nothing and returns what would have happened', async () => {
    const h = harness()
    const before = (await h.call('GET', `${REPO}/issues?limit=200&state=all`))
      .json.data.length
    const r = await h.call('POST', `${REPO}/issues?dry_run=true`, {
      body: { title: 'Dry' },
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('sx-dry-run')).toBe('true')
    expect(r.json.title).toBe('Dry')
    expect(
      (await h.call('GET', `${REPO}/issues?limit=200&state=all`)).json.data
        .length,
    ).toBe(before)
    expect(
      (
        await h.call('POST', `${REPO}/changes/216/land?dry_run=true`, {
          body: { expected_tree: '9c4d7e1' },
        })
      ).json.code,
    ).toBe('policy_blocked')
    expect((await h.call('GET', `${REPO}/changes?dry_run=true`)).status).toBe(
      400,
    )
  })
})

describe('review, policy and landing', () => {
  test('policy explains every requirement and what would satisfy it', async () => {
    const h = harness()
    const p = (await h.call('GET', `${REPO}/changes/216/policy`)).json
    expect(p.state).toBe('blocked')
    const byId = Object.fromEntries(
      p.requirements.map((r: { id: string }) => [r.id, r]),
    )
    expect(byId['core-paths'].state).toBe('pass')
    expect(byId['agent-authored'].state).toBe('na')
    expect(byId['ci-evidence'].state).toBe('pending')
    expect(byId['ci-evidence'].needs).toMatchObject({
      check: 'ci/test',
      bound_to: 'tree',
      tree: '9c4d7e1',
    })
    expect(byId.findings.state).toBe('fail')
    expect(byId.findings.needs.resolve).toEqual(['F-2'])
  })

  test('simulate answers “what if” without writing anything', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes/216/policy/simulate`, {
      body: { checks: { 'ci/test': 'pass' }, resolve: ['F-2'] },
    })
    expect(r.json.state).toBe('met')
    expect(r.json.assumed).toEqual(['check:ci/test=pass', 'resolve:F-2'])
    expect((await h.call('GET', `${REPO}/changes/216/policy`)).json.state).toBe(
      'blocked',
    )
    const noApproval = await h.call(
      'POST',
      `${REPO}/changes/216/policy/simulate`,
      { body: { approve: ['greptile'] } },
    )
    expect(
      noApproval.json.requirements.find(
        (q: { id: string }) => q.id === 'core-paths',
      ).state,
    ).toBe('pass')
  })

  test('landing is blocked with every requirement, and only waiting is retryable', async () => {
    const h = harness()
    const blocked = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '9c4d7e1' },
    })
    expect(blocked.status).toBe(409)
    expect(blocked.json.code).toBe('policy_blocked')
    expect(blocked.json.exit_code).toBe(5)
    expect(blocked.json.retryable).toBe(false)
    expect(blocked.json.requirements.length).toBe(5)
    // Resolve the finding: only the pending CI result is left.
    await h.call('POST', `${REPO}/changes/216/findings/F-2/resolve`)
    const waiting = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '9c4d7e1' },
    })
    expect(waiting.json.retryable).toBe(true)
    expect(waiting.json.hint).toContain('Wait')
  })

  test('landing needs the exact tree that was checked', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '5d02b8f' },
    })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('stale_head')
    expect(r.json.current.tree).toBe('9c4d7e1')
  })

  test('the full path: resolve, report CI on the tree, land, see the event', async () => {
    const h = harness()
    await h.call('POST', `${REPO}/changes/216/findings/F-2/resolve`)
    const check = await h.call('POST', `${REPO}/changes/216/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: '9c4d7e1' },
    })
    expect(check.headers.get('sx-outcome')).toBe('updated')
    const agent = await h.call('POST', `${REPO}/changes/216/land`, {
      token: T(h).fixAgent,
      body: { expected_tree: '9c4d7e1' },
    })
    expect(agent.status).toBe(403)
    expect(agent.json.code).toBe('insufficient_scope')
    const parent = await h.call('POST', `${REPO}/changes/217/land`, {
      body: { expected_tree: 'a71e0c3' },
    })
    expect(parent.json.code).toBe('invalid_state')
    const landed = await h.call('POST', `${REPO}/changes/216/land`, {
      body: { expected_tree: '9c4d7e1' },
    })
    expect(landed.status).toBe(200)
    expect(landed.json.state).toBe('landed')
    expect(landed.json.landed_at).not.toBeNull()
    const events = await h.call('GET', '/events?type=change.landed')
    expect(
      events.json.data.map(
        (e: { subject: { number: number } }) => e.subject.number,
      ),
    ).toEqual([216])
    // The change above it was rebased onto the result and kept its tree.
    const above = (await h.call('GET', `${REPO}/changes/217`)).json
    expect(above.patch_set_count).toBe(2)
    expect(above.head.tree).toBe('a71e0c3')
    expect(above.stack.parent).toBe(216)
  })

  test('a check for an older tree is stored but does not count', async () => {
    const h = harness()
    await h.call('POST', `${REPO}/changes/216/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: '5d02b8f' },
    })
    const c = (await h.call('GET', `${REPO}/changes/216?expand=check_runs`))
      .json
    expect(c.check_runs.length).toBe(2)
    expect(c.checks).toMatchObject({ state: 'pending', pending: 1, passed: 0 })
    const same = await h.call('POST', `${REPO}/changes/216/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: '5d02b8f' },
    })
    expect(same.headers.get('sx-outcome')).toBe('unchanged')
  })

  test('nobody approves their own work', async () => {
    const h = harness()
    const agent = await h.call('POST', `${REPO}/changes`, {
      token: T(h).fixAgent,
      body: { branch: 'agent-fix' },
    })
    const own = await h.call(
      'POST',
      `${REPO}/changes/${agent.json.number}/reviews`,
      { token: T(h).fixAgent, body: { state: 'approved' } },
    )
    expect(own.status).toBe(403)
    expect(own.json.code).toBe('human_required')
    expect(own.json.exit_code).toBe(6)
    const person = await h.call('POST', `${REPO}/changes/216/reviews`, {
      body: { state: 'approved' },
    })
    expect(person.json.code).toBe('forbidden')
  })

  test('agent-authored work needs a person to approve it', async () => {
    const h = harness()
    const agent = await h.call('POST', `${REPO}/changes`, {
      token: T(h).fixAgent,
      body: { branch: 'agent-fix' },
    })
    const n = agent.json.number
    const before = (
      await h.call('GET', `${REPO}/changes/${n}/policy`)
    ).json.requirements.find((r: { id: string }) => r.id === 'agent-authored')
    expect(before.state).toBe('pending')
    await h.call('POST', `${REPO}/changes/${n}/reviews`, {
      token: T(h).hollis,
      body: { state: 'approved' },
    })
    const after = (
      await h.call('GET', `${REPO}/changes/${n}/policy`)
    ).json.requirements.find((r: { id: string }) => r.id === 'agent-authored')
    expect(after.state).toBe('pass')
  })

  test('an approval follows a rebase but not a rewrite', async () => {
    const h = harness()
    const reviewers = async () =>
      (await h.call('GET', `${REPO}/changes/216`)).json.reviewers.find(
        (r: { actor: { handle: string } }) => r.actor.handle === 'hollis',
      )
    expect((await reviewers()).carries_to_head).toBe(true)
    await h.call('POST', `${REPO}/changes/216/patch-sets`, {
      body: { sha: 'aaaaaaa1', kind: 'rebase' },
    })
    expect((await reviewers()).carries_to_head).toBe(true)
    await h.call('POST', `${REPO}/changes/216/patch-sets`, {
      body: { sha: 'bbbbbbb2', kind: 'update' },
    })
    expect((await reviewers()).carries_to_head).toBe(false)
    const core = (
      await h.call('GET', `${REPO}/changes/216/policy`)
    ).json.requirements.find((r: { id: string }) => r.id === 'core-paths')
    expect(core.state).toBe('pending')
  })

  test('comparing patch sets shows only what is new', async () => {
    const h = harness()
    const r = (await h.call('GET', `${REPO}/changes/216/compare?from=2&to=3`))
      .json
    expect(r.files.map((f: { path: string }) => f.path)).toEqual([
      'src/refs.rs',
    ])
    expect(r.unchanged_files).toBe(1)
    expect(
      (await h.call('GET', `${REPO}/changes/216/compare?from=1&to=9`)).status,
    ).toBe(404)
  })

  test('dismissing a finding needs a reason', async () => {
    const h = harness()
    const no = await h.call(
      'POST',
      `${REPO}/changes/216/findings/F-3/dismiss`,
      { body: {} },
    )
    expect(no.status).toBe(400)
    const ok = await h.call(
      'POST',
      `${REPO}/changes/216/findings/F-3/dismiss`,
      { body: { reason: 'Not worth it' } },
    )
    expect(ok.json).toMatchObject({
      state: 'dismissed',
      reason: 'Not worth it',
    })
  })

  test('draft, ready, abandon and restore follow the state machine', async () => {
    const h = harness()
    expect((await h.call('POST', `${REPO}/changes/216/ready`)).json.code).toBe(
      'invalid_state',
    )
    expect((await h.call('POST', `${REPO}/changes/218/ready`)).json.state).toBe(
      'open',
    )
    expect(
      (await h.call('POST', `${REPO}/changes/218/abandon`)).json.state,
    ).toBe('abandoned')
    expect(
      (await h.call('POST', `${REPO}/changes/218/restore`)).json.state,
    ).toBe('open')
  })

  test('restoring a change whose branch is taken is refused', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'restore' } })
    const a = await h.call('POST', '/repos/dana/restore/changes', {
      body: { branch: 'topic' },
    })
    await h.call('POST', `/repos/dana/restore/changes/${a.json.number}/abandon`)
    const free = await h.call(
      'GET',
      `/repos/dana/restore/changes/${a.json.number}`,
    )
    expect(free.json.actions.restore).toEqual({ allowed: true, reasons: [] })
    const etag = free.headers.get('etag')!
    const b = await h.call('POST', '/repos/dana/restore/changes', {
      body: { branch: 'topic' },
    })
    expect(b.status).toBe(201)

    const taken = await h.call(
      'GET',
      `/repos/dana/restore/changes/${a.json.number}`,
      {
        headers: { 'if-none-match': etag },
      },
    )
    expect(taken.status).toBe(200)
    expect(taken.json.actions.restore).toEqual({
      allowed: false,
      reasons: [`branch:#${b.json.number}`],
    })
    const list = await h.call('GET', '/repos/dana/restore/changes?state=all')
    expect(
      list.json.data.find((c: { id: string }) => c.id === a.json.id).actions
        .restore.allowed,
    ).toBe(false)

    const again = await h.call(
      'POST',
      `/repos/dana/restore/changes/${a.json.number}/restore`,
    )
    expect(again.status).toBe(409)
    expect(again.json.code).toBe('invalid_state')
  })

  test('a stack lands bottom first as one operation', async () => {
    const h = harness({
      seed: (d) => {
        seedStack(d)
        d.stepDelayMs = 2
      },
    })
    const child = await h.call('POST', '/repos/dana/stacky/changes/2/land', {
      body: { expected_tree: '2222222' },
    })
    expect(child.json.code).toBe('parent_not_landed')
    const dry = await h.call(
      'POST',
      `/repos/dana/stacky/stacks/${STACK_ID}/land?dry_run=true`,
      {
        body: { expected_trees: { 1: '1111111', 2: '2222222', 3: '3333333' } },
      },
    )
    expect(dry.status).toBe(200)
    const short = await h.call(
      'POST',
      `/repos/dana/stacky/stacks/${STACK_ID}/land`,
      { body: { expected_trees: { 1: '1111111' } } },
    )
    expect(short.status).toBe(400)
    expect(short.json.code).toBe('invalid_request')
    const started = await h.call(
      'POST',
      `/repos/dana/stacky/stacks/${STACK_ID}/land`,
      {
        body: { expected_trees: { 1: '1111111', 2: '2222222', 3: '3333333' } },
      },
    )
    expect(started.headers.get('location')).toBe(started.json.url)
    expect(started.json.progress.total).toBe(3)
    // Long-poll the operation until it ends.
    let op = started.json
    for (
      let i = 0;
      i < 20 && op.state !== 'succeeded' && op.state !== 'failed';
      i++
    ) {
      const etag = (await h.call('GET', `/operations/${op.id}`)).headers.get(
        'etag',
      )!
      const r = await h.call('GET', `/operations/${op.id}?wait=2`, {
        headers: { 'if-none-match': etag },
      })
      op = r.status === 304 ? op : r.json
      if (r.status === 304)
        op = (await h.call('GET', `/operations/${op.id}`)).json
    }
    expect(op.state).toBe('succeeded')
    const list = (
      await h.call('GET', '/repos/dana/stacky/changes?state=landed&sort=number')
    ).json.data
    expect(list.map((c: { number: number }) => c.number)).toEqual([1, 2, 3])
    const landedAt = list.map((c: { landed_at: string }) => c.landed_at)
    expect([...landedAt].sort((a, b) => a.localeCompare(b))).toEqual(landedAt)
    const middle = (await h.call('GET', '/repos/dana/stacky/changes/2')).json
    expect(middle.head.tree).toBe('2222222')
    expect(middle.reviewers[0].carries_to_head).toBe(true)
  })
})

describe('events and sync', () => {
  test('every write leaves an event, in order, carrying the object it produced', async () => {
    const h = harness()
    const created = await h.call('POST', `${REPO}/issues`, {
      body: { title: 'Evented' },
    })
    await h.call('PATCH', `${REPO}/issues/${created.json.number}`, {
      body: { state: 'closed' },
    })
    const list = (await h.call('GET', '/events?repo=dana/gitfs&type=issue.*'))
      .json.data
    expect(list.map((e: { type: string }) => e.type)).toEqual([
      'issue.created',
      'issue.closed',
    ])
    const seq = list.map((e: { sequence: number }) => e.sequence)
    // An automation the issue woke may write its own event in between.
    expect(seq[1]).toBeGreaterThan(seq[0])
    const now = (await h.call('GET', `${REPO}/issues/${created.json.number}`))
      .json
    expect(list[1].data).toEqual(now)
    expect(S.Event.safeParse(list[0]).success).toBe(true)
  })

  test('events of private repositories are not shown to others', async () => {
    const h = harness()
    await h.call('POST', '/repos/dana/notes/issues', {
      body: { title: 'secret plan' },
    })
    const stranger = await h.call('GET', '/events', { token: T(h).stranger })
    expect(stranger.text).not.toContain('secret plan')
    expect((await h.call('GET', '/events')).text).toContain('secret plan')
  })

  test('sync gives a snapshot, then only what changed', async () => {
    const h = harness()
    const snap = (await h.call('GET', '/sync?repo=dana/gitfs', { token: null }))
      .json
    expect(snap.reset).toBe(true)
    expect(snap.objects.length).toBe(1 + 6 + 3)
    expect(snap.has_more).toBe(false)
    expect(
      snap.objects.every(
        (o: { actions?: unknown }) => !('actions' in o) || o.actions === null,
      ),
    ).toBe(true)
    const none = (
      await h.call('GET', `/sync?repo=dana/gitfs&cursor=${snap.cursor}`)
    ).json
    expect(none.objects).toEqual([])
    await h.call('POST', `${REPO}/changes/216/reviews`, {
      token: T(h).hollis,
      body: { state: 'commented' },
    })
    await h.call('POST', `${REPO}/changes/216/reviews`, {
      token: T(h).hollis,
      body: { state: 'commented' },
    })
    const delta = (
      await h.call('GET', `/sync?repo=dana/gitfs&cursor=${none.cursor}`)
    ).json
    expect(delta.reset).toBe(false)
    expect(delta.objects.length).toBe(1)
    expect(delta.objects[0].number).toBe(216)
    expect(
      (await h.call('GET', `/sync?repo=dana/gitfs&cursor=${delta.cursor}`)).json
        .objects,
    ).toEqual([])
  })

  test('sync pages a snapshot and resets a cursor that is too old', async () => {
    const h = harness({ seed: (d) => seedBulk(d, 'dana', 'big', 120, 30) })
    let cursor: string | undefined
    let total = 0
    do {
      const r = (
        await h.call(
          'GET',
          `/sync?repo=dana/big&limit=40${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json
      total += r.objects.length
      cursor = r.has_more ? r.cursor : undefined
    } while (cursor)
    expect(total).toBe(151)
  })

  test('a cursor older than the retained log is reset, not silently wrong', async () => {
    const h = harness({ events: new EventLog(clock(), 5) })
    const first = (await h.call('GET', '/sync?repo=dana/gitfs')).json
    for (let i = 0; i < 12; i++)
      await h.call('POST', `${REPO}/issues`, { body: { title: `Spam ${i}` } })
    const old = (
      await h.call('GET', `/sync?repo=dana/gitfs&cursor=${first.cursor}`)
    ).json
    expect(old.reset).toBe(true)
    expect(old.objects.length).toBeGreaterThan(10)
  })

  test('the stream sends events as they happen and resumes from Last-Event-ID', async () => {
    const h = harness()
    const res = await h.api.fetch(
      new Request('https://api.test/v1/events/stream?repo=dana/gitfs', {
        headers: { authorization: `Bearer ${T(h).dana}` },
      }),
    )
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
    const resumed = await h.api.fetch(
      new Request('https://api.test/v1/events/stream', {
        headers: {
          authorization: `Bearer ${T(h).dana}`,
          'last-event-id': String(head),
        },
      }),
    )
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
          {
            id: 'change',
            method: 'GET',
            path: '/repos/dana/gitfs/changes/216',
          },
          {
            id: 'policy',
            method: 'GET',
            path: '/repos/dana/gitfs/changes/216/policy',
          },
          {
            id: 'missing',
            method: 'GET',
            path: '/repos/dana/gitfs/changes/999',
          },
        ],
      },
    })
    expect(r.status).toBe(200)
    expect(
      r.json.results.map((x: { id: string; status: number }) => [
        x.id,
        x.status,
      ]),
    ).toEqual([
      ['change', 200],
      ['policy', 200],
      ['missing', 404],
    ])
    expect(r.json.results[2].body.code).toBe('not_found')
    expect(S.BatchResult.safeParse(r.json).success).toBe(true)
  })

  test('batches do not nest, and are limited in size', async () => {
    const h = harness()
    const nested = await h.call('POST', '/batch', {
      body: {
        requests: [
          {
            id: 'a',
            method: 'POST',
            path: '/batch',
            body: { requests: [{ id: 'b', method: 'GET', path: '/limits' }] },
          },
        ],
      },
    })
    expect(nested.json.results[0].status).toBe(400)
    const tooMany = await h.call('POST', '/batch', {
      body: {
        requests: Array.from({ length: 26 }, (_, i) => ({
          id: String(i),
          method: 'GET',
          path: '/limits',
        })),
      },
    })
    expect(tooMany.status).toBe(400)
  })

  test('a sub-request keeps the account the caller acts as', async () => {
    const h = harness()
    const r = await h.call('POST', '/batch', {
      headers: { 'sx-account': 'northwind' },
      body: {
        requests: [{ id: 'who', method: 'GET', path: '/auth/principal' }],
      },
    })
    expect(r.status).toBe(200)
    expect(r.json.results[0].body.acting_as).toBe('northwind')
  })

  test('streams and raw bodies are refused inside a batch', async () => {
    const h = harness()
    const r = await h.call('POST', '/batch', {
      body: {
        requests: [
          { id: 'stream', method: 'GET', path: '/events/stream' },
          {
            id: 'upload',
            method: 'PUT',
            path: '/uploads/upl_nope/data?exp=1&sig=aaaaaaaaaa',
          },
        ],
      },
    })
    expect(r.json.results.map((x: { status: number }) => x.status)).toEqual([
      400, 400,
    ])
    expect(r.json.results[0].body.code).toBe('invalid_request')
  })
})

describe('OpenAPI', () => {
  const h = harness()
  const doc = buildOpenApi(h.api.ops) as any

  test('is served, cacheable and describes every operation', async () => {
    const r = await h.call('GET', '/openapi.json', { token: null })
    expect(r.json.openapi).toBe('3.1.0')
    const etag = r.headers.get('etag')!
    expect(
      (
        await h.call('GET', '/openapi.json', {
          token: null,
          headers: { 'if-none-match': etag },
        })
      ).status,
    ).toBe(304)
    const ids = Object.values<any>(r.json.paths).flatMap((p) =>
      Object.values<any>(p).map((o) => o.operationId),
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(h.api.ops.length)
  })

  test('every operation says what an agent needs to know before calling it', () => {
    for (const [path, item] of Object.entries<any>(doc.paths))
      for (const [method, op] of Object.entries<any>(item)) {
        const where = `${method} ${path}`
        expect(['read', 'write', 'destructive'], where).toContain(
          op['x-sx-safety'],
        )
        expect(typeof op['x-sx-idempotent'], where).toBe('boolean')
        expect(op['x-sx-pool'], where).toBeDefined()
        if (op['x-sx-pool'] !== 'none')
          expect(op['x-sx-errors'], where).toContain('rate_limited')
        else expect(op['x-sx-errors'], where).not.toContain('rate_limited')
        for (const code of op['x-sx-errors'])
          expect(errorCatalog, `${where} ${code}`).toHaveProperty(code)
        expect(
          op.responses.default.content['application/problem+json'],
        ).toBeDefined()
        // Every {param} in the path is declared.
        for (const m of path.matchAll(/\{(\w+)\}/g))
          expect(
            op.parameters.some((p: any) => p.in === 'path' && p.name === m[1]),
            `${where} ${m[1]}`,
          ).toBe(true)
      }
  })

  test('destructive operations are marked, and reads never are', () => {
    expect(
      doc.paths['/repos/{owner}/{repo}/changes/{number}/land'].post[
        'x-sx-safety'
      ],
    ).toBe('destructive')
    expect(
      doc.paths['/repos/{owner}/{repo}/stacks/{stack}/land'].post['x-async'] ??
        doc.paths['/repos/{owner}/{repo}/stacks/{stack}/land'].post[
          'x-sx-async'
        ],
    ).toBe(true)
    for (const item of Object.values<any>(doc.paths))
      if (item.get) expect(item.get['x-sx-safety']).toBe('read')
  })

  test('responses do not forbid members clients do not know yet', () => {
    for (const item of Object.values<any>(doc.paths))
      for (const op of Object.values<any>(item))
        for (const response of Object.values<any>(op.responses ?? {}))
          expect(JSON.stringify(response)).not.toContain(
            '"additionalProperties":false',
          )
    // Requests are strict, and the document says so: the server rejects
    // unknown members, so a generated client must not be told they are fine.
    expect(JSON.stringify(doc.paths['/repos'].post.requestBody)).toContain(
      '"additionalProperties":false',
    )
  })

  test('binary responses say they are binary', () => {
    expect(
      doc.paths['/repos/{owner}/{repo}/git/raw'].get.responses['200'].content[
        'application/octet-stream'
      ].schema,
    ).toEqual({ type: 'string', format: 'binary' })
    expect(
      doc.paths['/uploads/{id}/content'].get.responses['200'].content['*/*']
        .schema,
    ).toEqual({ type: 'string', format: 'binary' })
  })

  test('v1 only adds: the committed snapshot is still satisfied', () => {
    const snapshot = JSON.parse(
      readFileSync(new URL('./openapi.snapshot.json', import.meta.url), 'utf8'),
    )
    expect(findBreaking(snapshot, doc)).toEqual([])
    // And the snapshot is current, so the contract change is in the diff.
    expect(JSON.stringify(doc, null, 2) + '\n').toBe(
      JSON.stringify(snapshot, null, 2) + '\n',
    )
  })

  test('the check itself catches the breaking changes it is meant to', () => {
    const copy = () => JSON.parse(JSON.stringify(doc))
    const removedOp = copy()
    delete removedOp.paths['/limits']
    expect(findBreaking(doc, removedOp).join()).toContain('operation removed')

    const removedField = copy()
    delete removedField.paths['/repos/{owner}/{repo}/issues/{number}'].get
      .responses['200'].content['application/json'].schema.properties?.title
    const issue = removedField.components.schemas.Issue
    if (issue) delete issue.properties.title
    expect(findBreaking(doc, removedField).join()).toContain('title')

    const required = copy()
    required.paths['/repos/{owner}/{repo}/issues'].post.requestBody.content[
      'application/json'
    ].schema.required.push('milestone')
    expect(findBreaking(doc, required).join()).toContain('milestone')

    const requestType = copy()
    requestType.paths['/repos'].post.requestBody.content[
      'application/json'
    ].schema.properties.name.type = 'object'
    expect(findBreaking(doc, requestType).join()).toContain(
      'request type changed',
    )

    const enumRemoved = copy()
    enumRemoved.components.schemas.Repo.properties.visibility.enum = ['public']
    expect(findBreaking(doc, enumRemoved).join()).toContain(
      'enum value private removed',
    )

    const bodyBecameRequired = copy()
    bodyBecameRequired.paths['/repos'].post.requestBody.required = false
    expect(findBreaking(bodyBecameRequired, doc).join()).toContain(
      'request body became required',
    )

    const added = copy()
    added.paths['/new'] = {
      get: { operationId: 'new.thing', responses: { 200: {} } },
    }
    expect(findBreaking(doc, added)).toEqual([])
  })
})
