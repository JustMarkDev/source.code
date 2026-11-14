import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

describe('repository insights', () => {
  test('history by week and by who wrote it, downloads, counts', async () => {
    const h = harness()
    const r = (await h.call('GET', '/repos/dana/gitfs/insights')).json
    expect(r.object).toBe('repo_insights')
    expect(r.commits.total).toBeGreaterThan(0)
    expect(r.commits.by_week).toHaveLength(26)
    const { human, agent, bot } = r.commits.by_class
    expect(human + agent + bot).toBe(r.commits.total)
    expect(bot).toBeGreaterThan(0)
    expect(r.contributors).toBeGreaterThan(1)
    expect(r.downloads.daily).toHaveLength(30)
    expect(r.issues.open).toBe(2)
  })

  test('a download shows up in today', async () => {
    const h = harness()
    const before = (await h.call('GET', '/repos/dana/notes/insights')).json
    expect(before.downloads.total).toBe(0)
    const g = (await h.call('GET', '/repos/dana/gitfs/insights')).json
    const tag = 'v0.9.0'
    const rel = (await h.call('GET', `/repos/dana/gitfs/releases/${tag}`)).json
    await h.call(
      'POST',
      `/repos/dana/gitfs/releases/${tag}/assets/${rel.assets[0].name}/download`,
    )
    const after = (await h.call('GET', '/repos/dana/gitfs/insights')).json
    expect(after.downloads.daily.at(-1)).toBe(g.downloads.daily.at(-1) + 1)
  })
})

describe('the dashboard', () => {
  test('what needs you, what is moving, your repositories', async () => {
    const h = harness()
    const d = (await h.call('GET', '/dashboard')).json
    expect(d).toMatchObject({
      object: 'dashboard',
      account: 'dana',
      empty: false,
    })
    expect(d.repos.map((r: { repo: string }) => r.repo)).toContain('dana/gitfs')
    const kinds = new Set(
      d.needs_you.map((n: { severity: string }) => n.severity),
    )
    expect(kinds.has('review')).toBe(true)
    expect(d.in_progress.length).toBeGreaterThan(0)
    expect(d.storage.used_bytes).toBeGreaterThan(0)
    expect(d.contributions.daily).toHaveLength(28)
  })

  test('an assigned issue needs you', async () => {
    const h = harness()
    await h.call('PATCH', '/repos/dana/gitfs/issues/209', {
      body: { assignees: ['hollis'] },
    })
    const d = (
      await h.call('GET', '/dashboard', { token: sampleTokens.hollis })
    ).json
    expect(
      d.needs_you.some(
        (n: { severity: string; title: string }) =>
          n.severity === 'assigned' && n.title.startsWith('#209'),
      ),
    ).toBe(true)
  })

  test('for an organization you belong to, not one you do not', async () => {
    const h = harness()
    const org = (await h.call('GET', '/dashboard?account=northwind')).json
    expect(org.account).toBe('northwind')
    expect(org.repos.map((r: { repo: string }) => r.repo)).toEqual([
      'northwind/relay',
    ])
    expect(
      (
        await h.call('GET', '/dashboard?account=northwind', {
          token: sampleTokens.stranger,
        })
      ).status,
    ).toBe(404)
  })

  test('needs you to be signed in', async () => {
    const h = harness()
    expect((await h.call('GET', '/dashboard', { token: null })).status).toBe(
      401,
    )
  })
})
