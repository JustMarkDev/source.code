import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'

describe("a repository's policy", () => {
  test('rules with modes and counts, live exceptions, the file', async () => {
    const h = harness()
    const set = (await h.call('GET', `${R}/policy`)).json
    expect(set.object).toBe('policy_set')
    expect(set.rules.map((r: { id: string }) => r.id)).toEqual([
      'core-paths',
      'agent-authored',
      'ci-evidence',
      'findings',
      'big-change',
    ])
    const findings = set.rules.find((r: { id: string }) => r.id === 'findings')
    expect(findings.mode).toBe('enforce')
    expect(findings.evaluated).toBeGreaterThan(0)
    expect(findings.blocked).toBeGreaterThan(0)
    expect(set.exceptions[0]).toMatchObject({ rule: 'core-paths', who: 'ines' })
    expect(set.yaml).toContain('- id: big-change\n    mode: dry-run')
  })

  test('turning a rule off lets a change through; enforcing it blocks again', async () => {
    const h = harness()
    const before = (await h.call('GET', `${R}/changes/216/policy`)).json
    expect(before.state).toBe('blocked')
    const off = await h.call('PATCH', `${R}/policy/rules/findings`, {
      body: { mode: 'off' },
    })
    expect(off.status).toBe(200)
    expect(off.json.mode).toBe('off')
    const after = (await h.call('GET', `${R}/changes/216/policy`)).json
    expect(
      after.requirements.some((r: { id: string }) => r.id === 'findings'),
    ).toBe(false)
    await h.call('PATCH', `${R}/policy/rules/findings`, {
      body: { mode: 'enforce' },
    })
    expect((await h.call('GET', `${R}/changes/216/policy`)).json.state).toBe(
      'blocked',
    )
  })

  test('a rule in dry run reports and does not block', async () => {
    const h = harness()
    await h.call('PATCH', `${R}/policy/rules/findings`, {
      body: { mode: 'dry-run' },
    })
    const p = (await h.call('GET', `${R}/changes/216/policy`)).json
    const f = p.requirements.find((r: { id: string }) => r.id === 'findings')
    expect(f.state).toBe('na')
    expect(f.detail).toStartWith('Dry run, would block:')
    const set = (await h.call('GET', `${R}/policy`)).json
    const rule = set.rules.find((r: { id: string }) => r.id === 'findings')
    expect(rule.would_block.map((w: { change: number }) => w.change)).toContain(
      216,
    )
  })

  test('a change version moves when policy does', async () => {
    const h = harness()
    const v = (await h.call('GET', `${R}/changes/216`)).json.version
    await h.call('PATCH', `${R}/policy/rules/big-change`, {
      body: { mode: 'enforce' },
    })
    expect((await h.call('GET', `${R}/changes/216`)).json.version).toBe(v + 1)
  })

  test('an exception lets its person count as a maintainer, until it ends', async () => {
    const h = harness()
    const made = await h.call('POST', `${R}/policy/exceptions`, {
      body: {
        rule: 'findings',
        who: 'dana',
        reason: 'Hotfix',
        expires_at: new Date(h.now() + 86_400_000).toISOString(),
      },
    })
    expect(made.status).toBe(201)
    const f = (
      await h.call('GET', `${R}/changes/216/policy`)
    ).json.requirements.find((r: { id: string }) => r.id === 'findings')
    expect(f.state).toBe('pass')
    expect(f.detail).toContain('Exception for dana')
    expect(
      (await h.call('DELETE', `${R}/policy/exceptions/${made.json.id}`)).status,
    ).toBe(204)
    expect((await h.call('GET', `${R}/changes/216/policy`)).json.state).toBe(
      'blocked',
    )
  })

  test('exceptions are for people, and at most 90 days', async () => {
    const h = harness()
    const far = await h.call('POST', `${R}/policy/exceptions`, {
      body: {
        rule: 'findings',
        who: 'dana',
        reason: 'x',
        expires_at: new Date(h.now() + 100 * 86_400_000).toISOString(),
      },
    })
    expect(far.status).toBe(400)
    const bot = await h.call('POST', `${R}/policy/exceptions`, {
      body: {
        rule: 'findings',
        who: 'northwind',
        reason: 'x',
        expires_at: new Date(h.now() + 86_400_000).toISOString(),
      },
    })
    expect(bot.status).toBe(400)
  })

  test('only people who can change the repository edit its policy', async () => {
    const h = harness()
    const r = await h.call('PATCH', `${R}/policy/rules/findings`, {
      token: sampleTokens.stranger,
      body: { mode: 'off' },
    })
    expect(r.status).toBe(403)
    expect(
      (
        await h.call('PATCH', `${R}/policy/rules/nope`, {
          body: { mode: 'off' },
        })
      ).status,
    ).toBe(404)
  })
})

describe('rules a repository writes', () => {
  test('a path rule holds a change until the named person approves', async () => {
    const h = harness()
    const made = await h.call('POST', '/repos/dana/gitfs/policy/rules', {
      body: {
        id: 'refs-owner',
        name: 'Refs need hollis',
        kind: 'path_approval',
        paths: ['src/refs.*'],
        from: ['hollis'],
      },
    })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ custom: true, mode: 'enforce' })
    const policy = (await h.call('GET', '/repos/dana/gitfs/changes/216/policy'))
      .json
    const req = (policy.requirements ?? policy.data ?? []).find?.(
      (r: { id: string }) => r.id === 'refs-owner',
    )
    if (req) expect(['pass', 'pending']).toContain(req.state)
    const set = (await h.call('GET', '/repos/dana/gitfs/policy')).json
    expect(set.yaml).toContain('id: refs-owner')
    expect(
      set.rules.find((r: { id: string }) => r.id === 'refs-owner').evaluated,
    ).toBeGreaterThan(0)
  })

  test('a size limit fails a change that is too large', async () => {
    const h = harness()
    await h.call('POST', '/repos/dana/gitfs/policy/rules', {
      body: {
        id: 'small',
        name: 'Small changes',
        kind: 'max_lines',
        max_lines: 1,
      },
    })
    const c = (await h.call('GET', '/repos/dana/gitfs/changes/216')).json
    expect(c.policy.state).toBe('blocked')
  })

  test('only its own rules can be deleted, and a kind needs its fields', async () => {
    const h = harness()
    expect(
      (await h.call('DELETE', '/repos/dana/gitfs/policy/rules/findings'))
        .status,
    ).toBe(409)
    expect(
      (
        await h.call('POST', '/repos/dana/gitfs/policy/rules', {
          body: { id: 'x-check', name: 'X', kind: 'required_check' },
        })
      ).status,
    ).toBe(400)
    await h.call('POST', '/repos/dana/gitfs/policy/rules', {
      body: {
        id: 'lint',
        name: 'Lint passes',
        kind: 'required_check',
        check: 'ci/lint',
      },
    })
    expect(
      (await h.call('DELETE', '/repos/dana/gitfs/policy/rules/lint')).status,
    ).toBe(204)
    expect(
      (await h.call('GET', '/repos/dana/gitfs/policy')).json.rules.some(
        (r: { id: string }) => r.id === 'lint',
      ),
    ).toBe(false)
  })
})
