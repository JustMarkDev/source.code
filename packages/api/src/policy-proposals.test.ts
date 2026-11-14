import { describe, expect, test } from 'bun:test'
import { harness } from './testing'

const R = '/repos/dana/gitfs'
type H = ReturnType<typeof harness>

const modeOf = async (h: H, rule: string) =>
  (await h.call('GET', `${R}/policy`)).json.rules.find(
    (r: { id: string }) => r.id === rule,
  ).mode

/** Approve as a maintainer, pass CI on the tree, land. */
async function landIt(h: H, n: number) {
  await h.call('POST', `${R}/changes/${n}/reviews`, {
    token: h.tokens.hollis,
    body: { state: 'approved' },
  })
  const before = (await h.call('GET', `${R}/changes/${n}/landability`)).json
  await h.call('POST', `${R}/changes/${n}/checks`, {
    body: { key: 'ci/test', state: 'pass', tree: before.tree },
  })
  const ready = (await h.call('GET', `${R}/changes/${n}/landability`)).json
  expect(ready.blockers).toEqual([])
  expect(ready.landable).toBe(true)
  const landed = await h.call('POST', `${R}/changes/${n}/land`, {
    body: { expected_tree: ready.tree },
  })
  expect(landed.status).toBe(200)
}

describe('the rules live in the repository', () => {
  test('before the move, policy writes apply at once', async () => {
    const h = harness()
    const set = (await h.call('GET', `${R}/policy`)).json
    expect(set.source).toEqual({
      state: 'settings',
      sha: null,
      errors: [],
      pending: [],
    })
    expect(set.landing).toMatchObject({
      strategy: 'squash',
      fresh_approvals: false,
    })
    const r = await h.call('PATCH', `${R}/policy/rules/big-change`, {
      body: { mode: 'off' },
    })
    expect(r.status).toBe(200)
    expect(await modeOf(h, 'big-change')).toBe('off')
  })

  test('a proposal is a change to the file; it applies when it lands', async () => {
    const h = harness()
    const dry = await h.call('POST', `${R}/policy/proposals?dry_run=true`, {
      body: {
        edits: [{ op: 'set_mode', rule: 'big-change', mode: 'enforce' }],
      },
    })
    // A dry run answers 200, as every dry run does, with the diff and no change.
    expect(dry.status).toBe(200)
    expect(dry.json).toMatchObject({ object: 'policy_proposal', change: null })
    expect(dry.json.diff).toContain('+    mode: enforce')
    expect((await h.call('GET', `${R}/policy`)).json.source.pending).toEqual([])

    const first = await h.call('POST', `${R}/policy/proposals`, {
      body: {
        edits: [
          { op: 'set_mode', rule: 'big-change', mode: 'enforce' },
          { op: 'set_landing', fresh_approvals: true },
        ],
      },
    })
    expect(first.status).toBe(202)
    expect(first.json).toMatchObject({ created: true, patch_set: 1 })
    expect(first.headers.get('location')).toBe(first.json.url)
    const n = first.json.change as number
    const change = (await h.call('GET', `${R}/changes/${n}`)).json
    expect(change.title).toContain('Move the rules into the policy file')
    // Nothing applies yet.
    expect(await modeOf(h, 'big-change')).toBe('dry-run')
    const pending = (await h.call('GET', `${R}/policy`)).json.source.pending
    expect(pending.map((x: { change: number }) => x.change)).toEqual([n])

    // A second edit goes on the same change.
    const second = await h.call('POST', `${R}/policy/proposals`, {
      body: {
        edits: [
          {
            op: 'add_exception',
            rule: 'core-paths',
            who: 'hollis',
            reason: 'On call this week',
            expires_at: new Date(h.now() + 7 * 86_400_000).toISOString(),
          },
        ],
      },
    })
    expect(second.json).toMatchObject({
      change: n,
      created: false,
      patch_set: 2,
    })

    // The policy folder protects itself: a maintainer has to approve.
    const blocked = (await h.call('GET', `${R}/changes/${n}/landability`)).json
    expect(blocked.landable).toBe(false)
    expect(blocked.blockers.map((b: { id: string }) => b.id)).toContain(
      'policy-file',
    )
    await landIt(h, n)

    const after = (await h.call('GET', `${R}/policy`)).json
    expect(after.source.state).toBe('file')
    expect(after.source.pending).toEqual([])
    expect(after.yaml).toContain('fresh_approvals: true')
    expect(await modeOf(h, 'big-change')).toBe('enforce')
    // The exceptions there were moved with the rules, and the new one added.
    expect(after.exceptions.map((e: { who: string }) => e.who)).toEqual([
      'ines',
      'hollis',
    ])
    expect(after.landing.fresh_approvals).toBe(true)
  })

  test('once moved, the policy endpoints propose instead of apply', async () => {
    const h = harness()
    const moved = await h.call('POST', `${R}/policy/proposals`, {
      body: {
        edits: [{ op: 'set_mode', rule: 'big-change', mode: 'dry-run' }],
      },
    })
    await landIt(h, moved.json.change)

    const patch = await h.call('PATCH', `${R}/policy/rules/big-change`, {
      body: { mode: 'off' },
    })
    expect(patch.status).toBe(202)
    expect(patch.json).toMatchObject({
      object: 'policy_proposal',
      created: true,
    })
    expect(await modeOf(h, 'big-change')).toBe('dry-run')
    const created = await h.call('POST', `${R}/policy/rules`, {
      body: {
        id: 'docs-review',
        name: 'Docs',
        kind: 'path_approval',
        paths: ['docs/**'],
      },
    })
    expect(created.status).toBe(202)
    expect(created.json).toMatchObject({
      change: patch.json.change,
      patch_set: 2,
    })
    const dry = await h.call(
      'DELETE',
      `${R}/policy/rules/docs-review?dry_run=true`,
    )
    expect(dry.status).toBe(200)
    expect(dry.json).toMatchObject({ object: 'policy_proposal', change: null })
    expect(
      (await h.call('GET', `${R}/policy`)).json.rules.some(
        (r: { id: string }) => r.id === 'docs-review',
      ),
    ).toBe(false)
    // A built-in rule still cannot be deleted.
    expect(
      (await h.call('DELETE', `${R}/policy/rules/core-paths`)).status,
    ).toBe(409)
  })

  test('a policy file that does not read cannot land', async () => {
    const h = harness()
    const made = await h.call('POST', `${R}/policy/proposals`, {
      body: { edits: [{ op: 'set_mode', rule: 'findings', mode: 'enforce' }] },
    })
    const n = made.json.change
    await h.call('POST', `${R}/changes/${n}/patch-sets`, {
      body: {
        kind: 'update',
        files: {
          '.source/policy/main.yml':
            'rules:\n  - id: core-paths\n    mode: sometimes\n',
        },
      },
    })
    const l = (await h.call('GET', `${R}/changes/${n}/landability`)).json
    const rule = l.blockers.find((b: { id: string }) => b.id === 'policy-file')
    expect(rule.state).toBe('fail')
    expect(rule.detail).toContain('rules[0].mode (line 3)')
  })

  test('landing settings: fresh approvals and who settles a thread', async () => {
    const h = harness()
    const made = await h.call('POST', `${R}/policy/proposals`, {
      body: {
        edits: [
          {
            op: 'set_landing',
            fresh_approvals: true,
            resolve: 'author',
            steps: [{ wait_checks: ['ci/build'] }],
          },
        ],
      },
    })
    await h.call('POST', `${R}/changes/${made.json.change}/reviews`, {
      token: h.tokens.hollis,
      body: { state: 'approved' },
    })
    const before = (
      await h.call('GET', `${R}/changes/${made.json.change}/landability`)
    ).json
    await h.call('POST', `${R}/changes/${made.json.change}/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: before.tree },
    })
    await h.call('POST', `${R}/changes/${made.json.change}/land`, {
      body: { expected_tree: before.tree },
    })
    const set = (await h.call('GET', `${R}/policy`)).json
    expect(set.landing).toMatchObject({
      resolve: 'author',
      fresh_approvals: true,
    })
    // Landing now waits for ci/build.
    const l = (await h.call('GET', `${R}/changes/216/landability`)).json
    expect(l.blockers.map((b: { id: string }) => b.id)).toContain(
      'landing:wait_checks:ci/build',
    )
    // Only the person who started a thread settles it.
    const c = await h.call('POST', `${R}/changes/216/comments`, {
      token: h.tokens.hollis,
      body: { body: 'Is this bounded?', file: 'src/refs.rs', line: 1 },
    })
    const settle = await h.call(
      'PATCH',
      `${R}/changes/216/comments/${c.json.id}`,
      { body: { resolved: true } },
    )
    expect(settle.status).toBe(403)
  })
})

describe('the landing engine', () => {
  /** Polls an operation until it ends. */
  async function ended(h: H, id: string) {
    let op = (await h.call('GET', `/operations/${id}`)).json
    for (
      let i = 0;
      i < 40 && (op.state === 'queued' || op.state === 'running');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20))
      op = (await h.call('GET', `/operations/${id}`)).json
    }
    return op
  }

  /** Lands a proposal that sets the landing steps. */
  async function withSteps(h: H, steps: Array<Record<string, unknown>>) {
    const made = await h.call('POST', `${R}/policy/proposals`, {
      body: { edits: [{ op: 'set_landing', steps }] },
    })
    await landIt(h, made.json.change)
  }

  /** Change 216 made ready to land: findings resolved, CI passed. */
  async function ready216(h: H) {
    await h.call('POST', `${R}/changes/216/findings/F-2/resolve`)
    const l = (await h.call('GET', `${R}/changes/216/landability`)).json
    await h.call('POST', `${R}/changes/216/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: l.tree },
    })
    return (await h.call('GET', `${R}/changes/216/landability`)).json
  }

  test('a single change is a stack of one: it lands, then each step runs', async () => {
    const sent: Array<{ url: string; body: string }> = []
    const h = harness({
      transport: {
        send: (req: { url: string; body: string }) => {
          sent.push(req)
          return Promise.resolve({ status: 200, error: null, ms: 1 })
        },
      },
    })
    await h.call('POST', `${R}/webhooks`, {
      body: {
        endpoint: 'https://hooks.example.com/landed',
        events: ['issue.opened'],
      },
    })
    await withSteps(h, [
      { run_pipeline: 'build' },
      { webhook: 'https://hooks.example.com/landed' },
    ])
    const l = await ready216(h)
    const r = await h.call('POST', `${R}/changes/216/land`, {
      body: { expected_tree: l.tree },
    })
    expect(r.status).toBe(202)
    expect(r.json).toMatchObject({ object: 'operation', kind: 'change.land' })
    expect(r.headers.get('location')).toBe(r.json.url)
    const op = await ended(h, r.json.id)
    expect(op.state).toBe('succeeded')
    expect(op.result).toMatchObject({ object: 'change' })
    expect(
      op.steps.map((s: { name: string; state: string }) => [s.name, s.state]),
    ).toEqual([
      ['Land #216', 'succeeded'],
      ['Run the build pipeline', 'succeeded'],
      ['Call https://hooks.example.com/landed', 'succeeded'],
    ])
    expect(op.steps[1].detail).toMatch(/^Started build run #\d+\.$/)
    expect((await h.call('GET', `${R}/changes/216`)).json.state).toBe('landed')
    expect(sent.some((x) => x.url === 'https://hooks.example.com/landed')).toBe(
      true,
    )
  })

  test('a step that fails stops the rest; what landed stays landed', async () => {
    const h = harness()
    await withSteps(h, [
      { webhook: 'https://hooks.example.com/nobody' },
      { run_pipeline: 'build' },
    ])
    const l = await ready216(h)
    const dry = await h.call('POST', `${R}/changes/216/land?dry_run=true`, {
      body: { expected_tree: l.tree },
    })
    expect(dry.json.steps.map((s: { state: string }) => s.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
    const r = await h.call('POST', `${R}/changes/216/land`, {
      body: { expected_tree: l.tree },
    })
    const op = await ended(h, r.json.id)
    expect(op.state).toBe('failed')
    expect(op.error.code).toBe('invalid_state')
    expect(op.steps.map((s: { state: string }) => s.state)).toEqual([
      'succeeded',
      'failed',
      'skipped',
    ])
    expect(op.steps[1].detail).toContain('No webhook for')
    expect((await h.call('GET', `${R}/changes/216`)).json.state).toBe('landed')
  })
})
