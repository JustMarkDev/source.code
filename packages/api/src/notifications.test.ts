import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'
const hollis = { token: sampleTokens.hollis }

describe('the inbox', () => {
  test('newest first, with an unread count', async () => {
    const h = harness()
    const list = (await h.call('GET', '/notifications')).json
    expect(list.data[0]).toMatchObject({
      object: 'notification',
      kind: 'import',
      unread: true,
    })
    expect(list.data[0].id).toStartWith('ntf_')
    const count = (await h.call('GET', '/notifications/count')).json
    expect(count).toEqual({ object: 'notification_count', unread: 3 })
    const unread = (await h.call('GET', '/notifications?unread=true')).json
    expect(unread.data).toHaveLength(3)
    const releases = (await h.call('GET', '/notifications?kind=release')).json
    expect(
      releases.data.every((n: { kind: string }) => n.kind === 'release'),
    ).toBe(true)
  })

  test('marking one, then all, as read', async () => {
    const h = harness()
    const [first] = (await h.call('GET', '/notifications?unread=true')).json
      .data
    expect(
      (await h.call('POST', `/notifications/${first.id}/read`)).status,
    ).toBe(204)
    expect((await h.call('GET', '/notifications/count')).json.unread).toBe(2)
    expect((await h.call('POST', '/notifications/read')).status).toBe(204)
    expect((await h.call('GET', '/notifications/count')).json.unread).toBe(0)
    expect((await h.call('POST', '/notifications/ntf_nope/read')).status).toBe(
      404,
    )
  })

  test('a count answers 304 until something changes', async () => {
    const h = harness()
    const a = await h.call('GET', '/notifications/count')
    const etag = a.headers.get('etag')!
    const same = await h.call('GET', '/notifications/count', {
      headers: { 'if-none-match': etag },
    })
    expect(same.status).toBe(304)
    await h.call('POST', '/notifications/read')
    const changed = await h.call('GET', '/notifications/count', {
      headers: { 'if-none-match': etag },
    })
    expect(changed.status).toBe(200)
  })

  test('is yours alone, and needs you signed in', async () => {
    const h = harness()
    expect(
      (await h.call('GET', '/notifications', hollis)).json.data,
    ).toHaveLength(0)
    expect(
      (await h.call('GET', '/notifications', { token: null })).status,
    ).toBe(401)
  })
})

describe('what reaches it', () => {
  test('being assigned an issue, once', async () => {
    const h = harness()
    await h.call('PATCH', `${R}/issues/209`, {
      body: { assignees: ['hollis'] },
    })
    const got = (await h.call('GET', '/notifications', hollis)).json.data
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'issue', repo: 'dana/gitfs' })
    expect(got[0].title).toContain('dana assigned you #209')
    // A later edit does not tell them again.
    await h.call('PATCH', `${R}/issues/209`, { body: { title: 'Renamed' } })
    expect(
      (await h.call('GET', '/notifications', hollis)).json.data,
    ).toHaveLength(1)
  })

  test('being mentioned in a comment, not mentioning yourself', async () => {
    const h = harness()
    await h.call('POST', `${R}/issues/4/comments`, {
      body: { body: '@hollis can you look? cc @dana' },
    })
    const got = (await h.call('GET', '/notifications', hollis)).json.data
    expect(got[0]).toMatchObject({ kind: 'mention' })
    expect(got[0].html_url).toEndWith('/dana/gitfs/issues?n=4')
    // dana wrote it, so dana is not told.
    expect(
      (await h.call('GET', '/notifications?kind=mention')).json.data,
    ).toHaveLength(1)
  })

  test('a review on your change, and failing checks', async () => {
    const h = harness()
    await h.call('POST', `${R}/changes/216/reviews`, {
      ...hollis,
      body: { state: 'commented', body: 'Looks fine.' },
    })
    await h.call('POST', `${R}/changes/216/checks`, {
      body: { key: 'ci/lint', state: 'fail', tree: '9c4d7e1' },
      token: sampleTokens.hollis,
    })
    const kinds = (await h.call('GET', '/notifications?unread=true')).json.data
      .slice(0, 2)
      .map((n: { kind: string }) => n.kind)
    expect(kinds).toEqual(['ci', 'review'])
  })

  test('only the kinds you want', async () => {
    const h = harness()
    const prefs = await h.call('PATCH', '/notifications/preferences', {
      ...hollis,
      body: { mention: false },
    })
    expect(prefs.json).toMatchObject({
      object: 'notification_preferences',
      mention: false,
      review: true,
      digest: false,
    })
    await h.call('POST', `${R}/issues/4/comments`, {
      body: { body: '@hollis again' },
    })
    expect(
      (await h.call('GET', '/notifications', hollis)).json.data,
    ).toHaveLength(0)
    expect(
      (await h.call('GET', '/notifications/preferences', hollis)).json.mention,
    ).toBe(false)
  })

  test('nothing about a repository you cannot read', async () => {
    const h = harness()
    // dana/notes is private, and hollis is not in it.
    await h.call('POST', '/repos/dana/notes/issues', {
      body: { title: 'Private' },
    })
    await h.call('POST', '/repos/dana/notes/issues/1/comments', {
      body: { body: '@hollis see this' },
    })
    expect(
      (await h.call('GET', '/notifications', hollis)).json.data,
    ).toHaveLength(0)
    expect(
      (await h.call('GET', '/notifications/count', hollis)).json.unread,
    ).toBe(0)
  })
})
