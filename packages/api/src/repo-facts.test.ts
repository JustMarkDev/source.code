import { describe, expect, test } from 'bun:test'
import { harness } from './testing'

const R = '/repos/dana/gitfs'

describe('what a repository says about itself', () => {
  test('languages, licence, forks and links are on the repository', async () => {
    const h = harness()
    const repo = (await h.call('GET', R)).json
    expect(repo.language).toBe('Rust')
    expect(repo.languages[0]).toEqual({ name: 'Rust', percent: 88.4 })
    expect(repo.license).toBe('MIT')
    expect(repo.forks).toBe(118)
    expect(repo.category).toBe('Developer tools')
    expect(repo.website).toBe('https://gitfs.dev')
    expect(repo.docs_url).toBe('https://gitfs.dev/docs')
    // A repository nothing is known about says so with nulls, not guesses.
    const bare = (await h.call('GET', '/repos/dana/notes')).json
    expect(bare.language).toBe(null)
    expect(bare.languages).toEqual([])
    expect(bare.license).toBe(null)
    expect(bare.website).toBe(null)
  })

  test('owners set the category and links, and clear them with null', async () => {
    const h = harness()
    const set = await h.call('PATCH', R, {
      body: { category: 'Infrastructure', website: 'https://example.com/x' },
    })
    expect(set.status).toBe(200)
    expect(set.json.category).toBe('Infrastructure')
    expect(set.json.website).toBe('https://example.com/x')
    expect(set.json.docs_url).toBe('https://gitfs.dev/docs')
    const cleared = await h.call('PATCH', R, {
      body: { website: null, category: null },
    })
    expect(cleared.json.website).toBe(null)
    expect(cleared.json.category).toBe(null)
    expect(cleared.json.version).toBe(set.json.version + 1)
  })

  test('a link must be a web address, and a category one we know', async () => {
    const h = harness()
    for (const body of [
      { website: 'javascript:alert(1)' },
      { docs_url: 'ftp://example.com' },
      { website: 'https://exa mple.com' },
      { category: 'Games' },
      { license: 'MIT' },
    ])
      expect((await h.call('PATCH', R, { body })).status).toBe(400)
  })

  test('someone who cannot administer the repository cannot change them', async () => {
    const h = harness()
    const res = await h.call('PATCH', R, {
      token: h.tokens.stranger,
      body: { website: 'https://example.com' },
    })
    expect(res.status).toBe(403)
  })
})

describe('stars', () => {
  test('a person stars once, sees it, and takes it back', async () => {
    const h = harness()
    const before = (await h.call('GET', R)).json
    const none = await h.call('GET', `${R}/star`, { token: h.tokens.stranger })
    expect(none.json).toEqual({
      object: 'star',
      repo: 'dana/gitfs',
      starred: false,
      stars: before.stars,
    })
    const added = await h.call('PUT', `${R}/star`, {
      token: h.tokens.stranger,
    })
    expect(added.status).toBe(200)
    expect(added.headers.get('sx-outcome')).toBe('updated')
    expect(added.json.starred).toBe(true)
    expect(added.json.stars).toBe(before.stars + 1)
    const again = await h.call('PUT', `${R}/star`, {
      token: h.tokens.stranger,
    })
    expect(again.headers.get('sx-outcome')).toBe('unchanged')
    expect(again.json.stars).toBe(before.stars + 1)
    // It is the caller's star: someone else has not starred it.
    expect((await h.call('GET', `${R}/star`)).json.starred).toBe(false)
    expect((await h.call('GET', R)).json.stars).toBe(before.stars + 1)
    const removed = await h.call('DELETE', `${R}/star`, {
      token: h.tokens.stranger,
    })
    expect(removed.json).toMatchObject({ starred: false, stars: before.stars })
    const twice = await h.call('DELETE', `${R}/star`, {
      token: h.tokens.stranger,
    })
    expect(twice.headers.get('sx-outcome')).toBe('unchanged')
    expect((await h.call('GET', R)).json.stars).toBe(before.stars)
  })

  test('a star moves the ETag of the repository and not its updated time', async () => {
    const h = harness()
    const before = await h.call('GET', R)
    await h.call('PUT', `${R}/star`)
    const after = await h.call('GET', R, {
      headers: { 'if-none-match': before.headers.get('etag')! },
    })
    expect(after.status).toBe(200)
    expect(after.json.updated_at).toBe(before.json.updated_at)
  })

  test('agents and bots cannot star, and a visitor must sign in', async () => {
    const h = harness()
    for (const token of [h.tokens.fixAgent, h.tokens.triage])
      expect((await h.call('PUT', `${R}/star`, { token })).status).toBe(403)
    expect((await h.call('PUT', `${R}/star`, { token: null })).status).toBe(401)
    const visitor = await h.call('GET', `${R}/star`, { token: null })
    expect(visitor.status).toBe(200)
    expect(visitor.json.starred).toBe(false)
  })

  test('a private repository cannot be starred by someone who cannot read it', async () => {
    const h = harness()
    const res = await h.call('PUT', '/repos/dana/notes/star', {
      token: h.tokens.stranger,
    })
    expect(res.status).toBe(404)
  })

  test('a dry run reports the result and changes nothing', async () => {
    const h = harness()
    const before = (await h.call('GET', R)).json.stars
    const dry = await h.call('PUT', `${R}/star?dry_run=true`)
    expect(dry.json).toMatchObject({ starred: true, stars: before + 1 })
    expect((await h.call('GET', R)).json.stars).toBe(before)
  })
})

describe('contributors', () => {
  test('authors of the history, most commits first, one per email', async () => {
    const h = harness()
    const res = await h.call('GET', `${R}/contributors`, { token: null })
    expect(res.status).toBe(200)
    const people = res.json.data
    expect(people.length).toBeGreaterThan(0)
    const commits = (await h.call('GET', `${R}/git/commits?limit=200`)).json
      .data
    expect(people.reduce((n: number, p: any) => n + p.commits, 0)).toBe(
      commits.length,
    )
    expect(new Set(people.map((p: any) => p.email.toLowerCase())).size).toBe(
      people.length,
    )
    for (let i = 1; i < people.length; i++)
      expect(people[i - 1].commits).toBeGreaterThanOrEqual(people[i].commits)
    expect(people[0].object).toBe('contributor')
  })

  test('no history is an empty list, and a hidden repository is not found', async () => {
    const h = harness()
    await h.call('POST', '/repos', { body: { name: 'empty' } })
    const empty = await h.call('GET', '/repos/dana/empty/contributors')
    expect(empty.status).toBe(200)
    expect(empty.json.data).toEqual([])
    const hidden = await h.call('GET', '/repos/dana/notes/contributors', {
      token: h.tokens.stranger,
    })
    expect(hidden.status).toBe(404)
  })
})
