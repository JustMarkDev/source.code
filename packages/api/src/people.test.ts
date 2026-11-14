import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const hollis = { token: sampleTokens.hollis }

describe('follows', () => {
  test('follow, see it counted, unfollow', async () => {
    const h = harness()
    const before = (await h.call('GET', '/accounts/hollis/profile')).json
    expect(before.viewer_follows).toBe(false)
    expect((await h.call('PUT', '/user/following/hollis')).status).toBe(204)
    const after = (await h.call('GET', '/accounts/hollis/profile')).json
    expect(after.followers).toBe(before.followers + 1)
    expect(after.viewer_follows).toBe(true)
    const followers = (await h.call('GET', '/accounts/hollis/followers')).json
      .data
    expect(followers.map((f: { handle: string }) => f.handle)).toContain('dana')
    await h.call('DELETE', '/user/following/hollis')
    expect(
      (await h.call('GET', '/accounts/hollis/profile')).json.followers,
    ).toBe(before.followers)
  })

  test('not yourself, and not as a bot', async () => {
    const h = harness()
    expect((await h.call('PUT', '/user/following/dana')).status).toBe(400)
    expect(
      (
        await h.call('PUT', '/user/following/dana', {
          token: sampleTokens.triage,
        })
      ).status,
    ).toBe(403)
  })
})

describe('profiles', () => {
  test('counted from what the person did', async () => {
    const h = harness()
    const made = await h.call('POST', '/repos/dana/gitfs/issues', {
      body: { title: 'Counted' },
    })
    expect(made.status).toBe(201)
    const p = (await h.call('GET', '/accounts/dana/profile')).json
    expect(p.object).toBe('profile')
    expect(p.contributions.total).toBeGreaterThan(0)
    expect(
      p.activity.find((a: { title: string }) => a.title.endsWith('Counted')),
    ).toMatchObject({ kind: 'issue', repo: 'dana/gitfs' })
    expect(p.contributions.by_day).toHaveLength(26 * 7)
    expect(p.contributions.by_month).toHaveLength(12)
  })

  test('what a person hides stays hidden from others', async () => {
    const h = harness()
    await h.call('PATCH', '/user/preferences', {
      ...hollis,
      body: { show_activity: false, show_agents: false },
    })
    const seen = (await h.call('GET', '/accounts/hollis/profile')).json
    expect(seen.activity).toEqual([])
    expect(seen.contributions.by_day).toEqual([])
    expect(seen.activity_hidden).toBe(true)
    expect(seen.agent_share).toBeNull()
    // They still see their own.
    const own = (await h.call('GET', '/accounts/hollis/profile', hollis)).json
    expect(own.activity_hidden).toBe(false)
  })
})

describe('the people directory', () => {
  test('lists people who allow it, and finds them by name', async () => {
    const h = harness()
    const all = (await h.call('GET', '/people', { token: null })).json.data
    expect(all.map((p: { handle: string }) => p.handle)).toContain('hollis')
    expect(all[0].handle).toBe('dana')
    const found = (await h.call('GET', '/people?q=reyes', { token: null })).json
      .data
    expect(found.map((p: { handle: string }) => p.handle)).toEqual(['hollis'])
    await h.call('PATCH', '/user/preferences', {
      ...hollis,
      body: { searchable: false },
    })
    const after = (await h.call('GET', '/people', { token: null })).json.data
    expect(after.map((p: { handle: string }) => p.handle)).not.toContain(
      'hollis',
    )
  })

  test('preferences are yours and need you signed in', async () => {
    const h = harness()
    const p = (
      await h.call('PATCH', '/user/preferences', {
        body: { download_target: { os: 'linux', arch: 'arm64' } },
      })
    ).json
    expect(p).toMatchObject({
      object: 'account_preferences',
      download_target: { os: 'linux', arch: 'arm64' },
      searchable: true,
    })
    expect(
      (await h.call('GET', '/user/preferences', hollis)).json.download_target,
    ).toBeNull()
    expect(
      (await h.call('GET', '/user/preferences', { token: null })).status,
    ).toBe(401)
  })
})
