import { describe, expect, test } from 'bun:test'
import { clock, harness } from './testing'
import type { Transport } from './webhooks'

/** A receiver that accepts everything, so creating a webhook never reaches the network. */
class OkTransport implements Transport {
  send() {
    return Promise.resolve({ status: 200, error: null, ms: 1 })
  }
}

const REPO = '/repos/dana/gitfs'

describe('renaming, editing and deleting a repository', () => {
  test('a rename moves the repository, keeps the old address working and writes an event', async () => {
    const h = harness()
    const before = (await h.call('GET', REPO)).json
    const r = await h.call('PATCH', REPO, { body: { name: 'gitfs-core', description: 'Renamed' } })
    expect(r.status).toBe(200)
    expect(r.json.full_name).toBe('dana/gitfs-core')
    expect(r.json.description).toBe('Renamed')
    expect(r.json.id).toBe(before.id)
    expect((await h.call('GET', '/repos/dana/gitfs-core')).status).toBe(200)
    // The old address redirects, with the new one in Location.
    const old = await h.call('GET', REPO)
    expect(old.status).toBe(308)
    expect(old.headers.get('location')).toContain('/repos/dana/gitfs-core')
    // What belonged to the repository went with it.
    expect((await h.call('GET', '/repos/dana/gitfs-core/changes/216')).status).toBe(200)
    const events = (await h.call('GET', '/events?type=repo.*')).json.data
    expect(events.map((e: { type: string }) => e.type)).toEqual(['repo.updated'])
    expect(events[0].changes.sort()).toEqual(['description', 'name'])
  })

  test('webhooks follow a rename', async () => {
    const h = harness({ transport: new OkTransport() })
    const hook = await h.call('POST', `${REPO}/webhooks`, { body: { endpoint: 'https://hooks.example.com/sx', events: ['*'] } })
    expect(hook.status).toBe(201)
    await h.call('PATCH', REPO, { body: { name: 'gitfs2' } })
    const list = await h.call('GET', '/repos/dana/gitfs2/webhooks')
    expect(list.json.data.map((x: { id: string }) => x.id)).toEqual([hook.json.id])
  })

  test('a name that is taken is refused, and so is a bad one', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { name: 'other' } })
    const taken = await h.call('PATCH', REPO, { body: { name: 'other' } })
    expect(taken.status).toBe(409)
    expect(taken.json.code).toBe('invalid_state')
    expect((await h.call('PATCH', REPO, { body: { name: 'no spaces' } })).status).toBe(400)
  })

  test('only an admin of the account may do it, and a stale If-Match is refused', async () => {
    const h = harness()
    // hollis can write to dana/gitfs but does not administer dana's account.
    const denied = await h.call('PATCH', REPO, { token: h.tokens.hollis, body: { description: 'x' } })
    expect(denied.status).toBe(403)
    expect((await h.call('DELETE', `${REPO}?confirm=dana/gitfs`, { token: h.tokens.hollis })).status).toBe(403)
    const stale = await h.call('PATCH', REPO, { body: { description: 'x' }, headers: { 'if-match': '"0"' } })
    expect(stale.status).toBe(412)
  })

  test('a token limited to repositories cannot rename or delete', async () => {
    const h = harness()
    expect((await h.call('PATCH', REPO, { token: h.tokens.limited, body: { name: 'z' } })).status).toBe(403)
    expect((await h.call('DELETE', `${REPO}?confirm=dana/gitfs`, { token: h.tokens.limited })).status).toBe(403)
  })

  test('a dry run changes nothing', async () => {
    const h = harness()
    const r = await h.call('PATCH', `${REPO}?dry_run=true`, { body: { name: 'gone' } })
    expect(r.status).toBe(200)
    expect((await h.call('GET', REPO)).status).toBe(200)
    expect((await h.call('GET', '/repos/dana/gone')).status).toBe(404)
    expect((await h.call('DELETE', `${REPO}?dry_run=true&confirm=dana/gitfs`)).status).toBe(204)
    expect((await h.call('GET', REPO)).status).toBe(200)
  })

  test('visibility changes who can see it', async () => {
    const h = harness()
    expect((await h.call('GET', REPO, { token: h.tokens.stranger })).status).toBe(200)
    await h.call('PATCH', REPO, { body: { visibility: 'private' } })
    expect((await h.call('GET', REPO, { token: h.tokens.stranger })).status).toBe(404)
    // And search no longer finds it for them.
    const found = await h.call('GET', '/search?q=negative', { token: h.tokens.stranger })
    expect(found.json.data).toEqual([])
  })

  test('deleting needs the full name, then removes the repository and what hangs on it', async () => {
    const h = harness({ transport: new OkTransport() })
    await h.call('POST', `${REPO}/webhooks`, { body: { endpoint: 'https://hooks.example.com/sx', events: ['*'] } })
    const noConfirm = await h.call('DELETE', REPO)
    expect(noConfirm.status).toBe(400)
    expect(noConfirm.json.code).toBe('invalid_request')
    expect((await h.call('DELETE', `${REPO}?confirm=dana/other`)).status).toBe(400)
    expect((await h.call('GET', REPO)).status).toBe(200)

    const ok = await h.call('DELETE', `${REPO}?confirm=dana/gitfs`)
    expect(ok.status).toBe(204)
    expect((await h.call('GET', REPO)).status).toBe(404)
    expect((await h.call('GET', `${REPO}/changes/216`)).status).toBe(404)
    expect((await h.call('GET', '/events?type=repo.deleted')).json.data).toHaveLength(1)
    // The name is free again.
    const again = await h.call('POST', '/repos', { body: { name: 'gitfs' } })
    expect(again.status).toBe(201)
    expect((await h.call('GET', `${REPO}/webhooks`)).json.data).toEqual([])
    const results = (await h.call('GET', '/search?q=negative')).json.data as Array<{ repo: string }>
    expect(results.every((x) => x.repo !== 'dana/gitfs')).toBe(true)
  })
})

describe('asking for markdown', () => {
  const md = { accept: 'text/markdown' }

  test('a change, an issue and the start-up bundle come back as readable text', async () => {
    const h = harness()
    const change = await h.call('GET', `${REPO}/changes/216`, { headers: md })
    expect(change.status).toBe(200)
    expect(change.headers.get('content-type')).toContain('text/markdown')
    expect(change.text).toMatch(/^# #216 /)
    expect(change.text).toContain('## Policy:')
    expect(change.text).toContain('## You can')
    const json = (await h.call('GET', `${REPO}/changes/216`)).json
    // Every fact in the text is in the object it was made from.
    expect(change.text).toContain(json.title)
    expect(change.text).toContain(json.head.tree)
    expect(change.text.length).toBeLessThan(JSON.stringify(json).length)

    const issues = (await h.call('GET', `${REPO}/issues`)).json.data
    const issue = await h.call('GET', `${REPO}/issues/${issues[0].number}`, { headers: md })
    expect(issue.text).toContain(issues[0].title)

    const ctx = await h.call('GET', `${REPO}/context`, { headers: md })
    expect(ctx.text).toMatch(/^# dana\/gitfs/)
    expect(ctx.text).toContain('## Changes')
    expect(ctx.text).toContain('/sync?repo=dana/gitfs')
  })

  test('the two forms have their own ETags and neither is served for the other', async () => {
    const h = harness()
    const j = await h.call('GET', `${REPO}/changes/216`)
    const m = await h.call('GET', `${REPO}/changes/216`, { headers: md })
    expect(j.headers.get('etag')).not.toBe(m.headers.get('etag'))
    expect(j.headers.get('vary')).toContain('accept')
    // Conditional reads work in each form, and again after the body cache is warm.
    expect((await h.call('GET', `${REPO}/changes/216`, { headers: { ...md, 'if-none-match': m.headers.get('etag')! } })).status).toBe(304)
    const again = await h.call('GET', `${REPO}/changes/216`, { headers: md })
    expect(again.text).toBe(m.text)
    expect((await h.call('GET', `${REPO}/changes/216`)).json.object).toBe('change')
    // An operation without a readable form answers JSON as usual.
    expect((await h.call('GET', `${REPO}/changes`, { headers: md })).json.object).toBe('list')
  })

  test('errors stay problem+json whatever was asked for', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/changes/99999`, { headers: md })
    expect(r.status).toBe(404)
    expect(r.headers.get('content-type')).toContain('application/problem+json')
  })
})

describe('git data', () => {
  const G = `${REPO}/git`

  test('lists a directory, directories first, and reads a file', async () => {
    const h = harness()
    const root = await h.call('GET', `${G}/tree`)
    expect(root.status).toBe(200)
    expect(root.json.object).toBe('tree')
    expect(root.json.ref).toMatch(/^[0-9a-f]{40}$/)
    const names = root.json.entries.map((e: { name: string }) => e.name)
    expect(names).toContain('README.md')
    const kinds = root.json.entries.map((e: { type: string }) => e.type)
    // Directories come before files.
    expect(kinds.indexOf('blob')).toBeGreaterThanOrEqual(kinds.lastIndexOf('tree'))
    const dir = root.json.entries.find((e: { type: string }) => e.type === 'tree')
    if (dir) {
      const inner = await h.call('GET', `${G}/tree?path=${encodeURIComponent(dir.path)}`)
      expect(inner.json.entries.every((e: { path: string }) => e.path.startsWith(`${dir.path}/`))).toBe(true)
    }
    const blob = await h.call('GET', `${G}/blob?path=README.md`)
    expect(blob.json).toMatchObject({ object: 'blob', path: 'README.md', encoding: 'utf-8' })
    expect(blob.json.content.length).toBe(blob.json.size)
    expect((await h.call('GET', `${G}/blob?path=nope.txt`)).status).toBe(404)
    expect((await h.call('GET', `${G}/tree?path=nope`)).status).toBe(404)
  })

  test('history pages by the last commit sent, and a commit and its diff agree', async () => {
    const h = harness()
    const first = await h.call('GET', `${G}/commits?limit=1`)
    expect(first.json.data).toHaveLength(1)
    expect(first.json.has_more).toBe(true)
    const second = await h.call('GET', `${G}/commits?limit=1&cursor=${first.json.next_cursor}`)
    const seen = new Set(first.json.data.map((c: { sha: string }) => c.sha))
    expect(second.json.data.every((c: { sha: string }) => !seen.has(c.sha))).toBe(true)
    // The history is newest first: each commit's parent is the next one down.
    const all = [...first.json.data, ...second.json.data]
    expect(all[0].parents[0]).toBe(all[1].sha)

    const sha = all[0].sha
    const one = await h.call('GET', `${G}/commits/${sha}`)
    expect(one.json.message).toBe(all[0].message)
    expect(one.headers.get('cache-control')).toContain('immutable')
    const diff = await h.call('GET', `${G}/commits/${sha}/diff`)
    expect(diff.json.base_sha).toBe(all[0].parents[0])
    expect(diff.json.stats.files).toBe(diff.json.files.length)
    expect(diff.json.files[0].patch).toContain('@@')
    expect((await h.call('GET', `${G}/commits/${'0'.repeat(40)}`)).status).toBe(404)
  })

  test('a file downloads as an attachment that cannot run in the page', async () => {
    const h = harness()
    const raw = await h.call('GET', `${G}/raw?path=README.md`)
    expect(raw.status).toBe(200)
    expect(raw.headers.get('content-disposition')).toContain('attachment')
    expect(raw.headers.get('x-content-type-options')).toBe('nosniff')
    expect(raw.headers.get('content-security-policy')).toContain('sandbox')
    expect(raw.text.length).toBeGreaterThan(0)
  })

  test('a private repository answers 404 to people who cannot read it', async () => {
    const h = harness()
    expect((await h.call('GET', '/repos/dana/notes/git/tree', { token: h.tokens.stranger })).status).toBe(404)
    expect((await h.call('GET', '/repos/dana/notes/git/commits', { token: null })).status).toBe(404)
  })

  test('a repository with no history answers 404, not an error', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { name: 'empty' } })
    expect((await h.call('GET', '/repos/dana/empty/git/tree')).status).toBe(404)
  })

  test('a case-only rename keeps git data', async () => {
    const h = harness()
    expect((await h.call('PATCH', '/repos/dana/gitfs', { body: { name: 'GitFS' } })).status).toBe(200)
    expect((await h.call('GET', '/repos/dana/GitFS/git/tree')).status).toBe(200)
  })

  test('two seeds with the same name get separate git stores', async () => {    const h = harness({
      seed: (d) => {
        d.seedRepo('alice', 'same', { storeId: 'gitfs' })
        d.seedRepo('bob', 'same')
      },
    })
    expect((await h.call('GET', '/repos/alice/same/git/tree')).status).toBe(200)
    expect((await h.call('GET', '/repos/bob/same/git/tree')).status).toBe(404)
  })

  test('git follows a rename and cannot be inherited by a reused name', async () => {    const h = harness()
    await h.call('PATCH', REPO, { body: { name: 'gitfs2' } })
    expect((await h.call('GET', '/repos/dana/gitfs/git/tree')).status).toBe(308)
    expect((await h.call('GET', '/repos/dana/gitfs2/git/tree')).status).toBe(200)
    await h.call('DELETE', '/repos/dana/gitfs2?confirm=dana/gitfs2')
    await h.call('POST', '/repos', { body: { owner: 'dana', name: 'gitfs2', visibility: 'private' } })
    expect((await h.call('GET', '/repos/dana/gitfs2/git/tree')).status).toBe(404)
    await h.call('POST', '/repos', { body: { owner: 'northwind', name: 'tinyqueue' } })
    expect((await h.call('GET', '/repos/northwind/tinyqueue/git/tree')).status).toBe(404)
  })
})

describe('teams', () => {
  const ORG = '/accounts/northwind/teams'

  async function withVault() {
    const h = harness()
    const made = await h.call('POST', '/repos', { body: { owner: 'northwind', name: 'vault', visibility: 'private' } })
    expect(made.status).toBe(201)
    return h
  }

  test('only owners and admins make teams; outsiders cannot even see that the organization has any', async () => {
    const h = await withVault()
    expect((await h.call('POST', ORG, { token: h.tokens.hollis, body: { slug: 'readers' } })).status).toBe(403)
    expect((await h.call('GET', ORG, { token: h.tokens.stranger })).status).toBe(404)
    expect((await h.call('GET', '/accounts/dana/teams')).status).toBe(404)
    const made = await h.call('POST', ORG, { body: { slug: 'readers', name: 'Readers' } })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ object: 'team', slug: 'readers', members: [], repos: [] })
    const again = await h.call('POST', ORG, { body: { slug: 'readers' } })
    expect(again.status).toBe(200)
    expect(again.headers.get('sx-outcome')).toBe('unchanged')
    expect((await h.call('GET', ORG, { token: h.tokens.hollis })).json.data).toHaveLength(1)
    expect((await h.call('POST', ORG, { body: { slug: 'Bad Slug' } })).status).toBe(400)
  })

  test('a team gives people outside the organization read or write access to the repositories it is given', async () => {
    const h = await withVault()
    await h.call('POST', ORG, { body: { slug: 'readers' } })
    const vault = '/repos/northwind/vault'
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(404)

    await h.call('PUT', `${ORG}/readers/members/stranger`)
    // A member of a team with no repositories still sees nothing.
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(404)
    const given = await h.call('PUT', `${ORG}/readers/repos/northwind/vault`, { body: { permission: 'read' } })
    expect(given.json.repos).toEqual([{ full_name: 'northwind/vault', permission: 'read' }])
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(200)
    expect((await h.call('POST', `${vault}/issues`, { token: h.tokens.stranger, body: { title: 'x' } })).status).toBe(403)

    await h.call('PUT', `${ORG}/readers/repos/northwind/vault`, { body: { permission: 'write' } })
    expect((await h.call('POST', `${vault}/issues`, { token: h.tokens.stranger, body: { title: 'x' } })).status).toBe(201)

    // Taking the person out, or the team away, takes the access with it.
    await h.call('DELETE', `${ORG}/readers/members/stranger`)
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(404)
    await h.call('PUT', `${ORG}/readers/members/stranger`)
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(200)
    expect((await h.call('DELETE', `${ORG}/readers`)).status).toBe(204)
    expect((await h.call('GET', vault, { token: h.tokens.stranger })).status).toBe(404)
  })

  test('a team reaches only its own organization, and the grant follows a rename', async () => {
    const h = await withVault()
    await h.call('POST', ORG, { body: { slug: 'readers' } })
    const other = await h.call('PUT', `${ORG}/readers/repos/dana/gitfs`, { body: { permission: 'read' } })
    expect(other.status).toBe(400)
    await h.call('PUT', `${ORG}/readers/members/stranger`)
    await h.call('PUT', `${ORG}/readers/repos/northwind/vault`, { body: { permission: 'read' } })
    await h.call('PATCH', '/repos/northwind/vault', { body: { name: 'safe' } })
    expect((await h.call('GET', `${ORG}/readers`)).json.repos[0].full_name).toBe('northwind/safe')
    expect((await h.call('GET', '/repos/northwind/safe', { token: h.tokens.stranger })).status).toBe(200)
    await h.call('DELETE', '/repos/northwind/safe?confirm=northwind/safe')
    expect((await h.call('GET', `${ORG}/readers`)).json.repos).toEqual([])
  })

  test('edits need the current version, and unknown people and teams are 404', async () => {
    const h = await withVault()
    await h.call('POST', ORG, { body: { slug: 'readers' } })
    expect((await h.call('PATCH', `${ORG}/readers`, { body: { name: 'R' }, headers: { 'if-match': '"99"' } })).status).toBe(412)
    const t = await h.call('GET', `${ORG}/readers`)
    const etag = t.headers.get('etag')!
    const ok = await h.call('PATCH', `${ORG}/readers`, { body: { name: 'R' }, headers: { 'if-match': etag } })
    expect(ok.json.name).toBe('R')
    expect((await h.call('PUT', `${ORG}/readers/members/nobody`)).status).toBe(404)
    expect((await h.call('GET', `${ORG}/missing`)).status).toBe(404)
    expect((await h.call('DELETE', `${ORG}/readers/members/stranger`)).status).toBe(404)
  })
})

describe('runs', () => {
  test('what an agent does is recorded as an agent, even when it acts for a person', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/runs`, { body: { task: 'Review', scopes: ['repo:read', 'pulls:read', 'pulls:comment'] } })
    const token = r.json.token as string
    const review = await h.call('POST', `${REPO}/changes/217/reviews`, { token, body: { state: 'approved' } })
    expect(review.status).toBe(201)
    expect(review.json.actor).toMatchObject({ handle: 'dana', class: 'agent' })
    // The person is still the person.
    const mine = await h.call('POST', `${REPO}/changes/217/reviews`, { body: { state: 'commented' } })
    expect(mine.json.actor.class).toBe('human')
    expect(review.json.actor.id).not.toBe(mine.json.actor.id)
  })

  const start = (h: ReturnType<typeof harness>, body: Record<string, unknown> = {}) =>
    h.call('POST', `${REPO}/runs`, { body: { task: 'Fix the flaky cache test', ...body } })

  test('a run mints a token that is limited to the repository and to what was asked for', async () => {
    const h = harness()
    const r = await start(h, { change: 216 })
    expect(r.status).toBe(201)
    expect(r.json.token).toMatch(/^sxr_/)
    expect(r.json.state).toBe('running')
    expect(r.json.actor.class).toBe('agent')
    expect(r.json.scopes).toContain('issues:comment')
    expect(r.json.scopes).not.toContain('repo:write')
    expect(r.headers.get('cache-control')).toBe('no-store')

    const token = r.json.token as string
    const who = (await h.call('GET', '/auth/principal', { token })).json
    expect(who).toMatchObject({ login: 'dana', class: 'agent', repos: ['dana/gitfs'] })
    expect((await h.call('GET', `${REPO}/changes/216`, { token })).status).toBe(200)
    // It reads and comments; it does not write, and it cannot leave the repository.
    const denied = await h.call('POST', `${REPO}/issues`, { token, body: { title: 'x' } })
    expect(denied.status).toBe(403)
    expect(denied.json.code).toBe('insufficient_scope')
    expect((await h.call('GET', '/repos/dana/tinyqueue/issues', { token })).status).toBe(200) // public: anyone can read
    expect((await h.call('GET', '/repos/dana/notes/issues', { token })).status).toBe(404) // private, outside the token
    // The secret is shown once.
    expect((await h.call('GET', `${REPO}/runs/${r.json.id}`)).json.token).toBeNull()
  })

  test('a run cannot be given more than its starter has, or the power to make tokens', async () => {
    const h = harness()
    const noManage = await h.call('POST', `${REPO}/runs`, { token: h.tokens.fixAgent, body: { task: 't' } })
    expect(noManage.status).toBe(403)
    expect(noManage.json.code).toBe('insufficient_scope')
    const tooMuch = await start(h, { scopes: ['tokens:manage'] })
    expect(tooMuch.status).toBe(403)
    expect(tooMuch.json.code).toBe('forbidden')
    expect((await start(h, { change: 99999 })).status).toBe(404)
    expect((await h.call('POST', `${REPO}/runs`, { body: { task: 't', ttl_minutes: 999 } })).status).toBe(400)
    // A dry run mints nothing.
    const dry = await h.call('POST', `${REPO}/runs?dry_run=true`, { body: { task: 't' } })
    expect(dry.status).toBe(200)
    expect((await h.call('GET', `${REPO}/runs`)).json.data).toEqual([])
  })

  test('the run reports on itself, finishes, and its token stops working', async () => {
    const h = harness()
    const r = await start(h)
    const token = r.json.token as string
    const id = r.json.id as string
    const note = await h.call('POST', `${REPO}/runs/${id}/notes`, { token, body: { text: 'Reproduced the failure' } })
    expect(note.json.notes.map((n: { text: string }) => n.text)).toEqual(['Reproduced the failure'])
    const done = await h.call('POST', `${REPO}/runs/${id}/finish`, { token, body: { state: 'succeeded', summary: 'Fixed in #217' } })
    expect(done.json).toMatchObject({ state: 'succeeded', summary: 'Fixed in #217' })
    expect(done.json.finished_at).not.toBeNull()
    // The same outcome again is a no-op; a different one is refused.
    expect((await h.call('POST', `${REPO}/runs/${id}/finish`, { body: { state: 'succeeded' } })).status).toBe(200)
    const other = await h.call('POST', `${REPO}/runs/${id}/finish`, { body: { state: 'failed' } })
    expect(other.status).toBe(409)
    expect(other.json.code).toBe('invalid_state')
    const dead = await h.call('GET', `${REPO}/changes/216`, { token })
    expect(dead.status).toBe(401)
    expect(dead.json.code).toBe('token_revoked')
    expect((await h.call('POST', `${REPO}/runs/${id}/notes`, { body: { text: 'late' } })).status).toBe(409)
    const types = (await h.call('GET', '/events?type=run.*')).json.data.map((e: { type: string }) => e.type)
    expect(types).toEqual(['run.started', 'run.finished'])
  })

  test('a run token cannot control another run of the same person', async () => {
    const h = harness()
    const a = await h.call('POST', `${REPO}/runs`, { body: { task: 'a' } })
    const b = await h.call('POST', `${REPO}/runs`, { body: { task: 'b' } })
    const denied = await h.call('POST', `${REPO}/runs/${a.json.id}/cancel`, { token: b.json.token })
    expect(denied.status).toBe(403)
  })

  test('a run cannot be given secrets:write', async () => {
    const h = harness()
    const r = await h.call('POST', `${REPO}/runs`, { body: { task: 'secret', scopes: ['secrets:write'] } })
    expect(r.status).toBe(403)
  })

  test('a repository-limited token cannot note a run outside its grant', async () => {    const h = harness()
    const a = await h.call('POST', `${REPO}/runs`, { body: { task: 'a' } })
    expect((await h.call('POST', `${REPO}/runs/${a.json.id}/notes`, { token: h.tokens.limited, body: { text: 'nope' } })).status).toBe(403)
  })

  test('cancelling stops the token at once; only the starter or an admin may', async () => {    const h = harness()
    const r = await start(h)
    const id = r.json.id as string
    // hollis can write to the repository but did not start the run and does not administer it.
    expect((await h.call('POST', `${REPO}/runs/${id}/cancel`, { token: h.tokens.hollis })).status).toBe(403)
    expect((await h.call('POST', `${REPO}/runs/${id}/cancel`, { token: h.tokens.stranger })).status).toBe(403)
    const c = await h.call('POST', `${REPO}/runs/${id}/cancel`)
    expect(c.json.state).toBe('cancelled')
    expect((await h.call('GET', '/auth/principal', { token: r.json.token })).status).toBe(401)
    expect((await h.call('GET', `${REPO}/runs?state=cancelled`)).json.data).toHaveLength(1)
    expect((await h.call('GET', `${REPO}/runs?state=running`)).json.data).toHaveLength(0)
  })

  test('a run that runs out of time is expired, and only twenty can be going at once', async () => {
    const now = clock()
    const h = harness({ now })
    const r = await start(h, { ttl_minutes: 5 })
    now.advance(6 * 60_000)
    expect((await h.call('GET', `${REPO}/runs/${r.json.id}`)).json.state).toBe('expired')
    expect((await h.call('GET', '/auth/principal', { token: r.json.token })).json.code).toBe('token_expired')
    for (let i = 0; i < 20; i++) expect((await start(h)).status).toBe(201)
    const over = await start(h)
    expect(over.status).toBe(409)
    expect(over.json.code).toBe('limit_reached')
  })

  test('runs follow a rename and end with a deletion', async () => {
    const h = harness()
    const r = await start(h)
    await h.call('PATCH', REPO, { body: { name: 'gitfs2' } })
    expect((await h.call('GET', `/repos/dana/gitfs2/runs/${r.json.id}`)).json.repo.full_name).toBe('dana/gitfs2')
    await h.call('DELETE', '/repos/dana/gitfs2?confirm=dana/gitfs2')
    expect((await h.call('GET', '/auth/principal', { token: r.json.token })).status).toBe(401)
  })
})
