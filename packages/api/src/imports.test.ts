import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

describe('imports', () => {
  test('a repository that remembers where it came from and pulls from it', async () => {
    const h = harness()
    const made = await h.call('POST', '/imports', {
      body: { host: 'github', slug: 'dana-okafor/dotfiles' },
    })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({
      owner: 'dana',
      name: 'dotfiles',
      upstream: { host: 'github', slug: 'dana-okafor/dotfiles' },
    })
    const mirrors = (await h.call('GET', '/repos/dana/dotfiles/mirrors')).json
      .data
    expect(mirrors[0]).toMatchObject({ host: 'github', direction: 'pull' })
    const again = await h.call('POST', '/imports', {
      body: { host: 'github', slug: 'dana-okafor/dotfiles' },
    })
    expect(again.status).toBe(200)
    const mine = (await h.call('GET', '/imports')).json.data
    expect(mine.map((i: { repo: string }) => i.repo)).toContain('dana/dotfiles')
  })

  test('a dry run makes nothing', async () => {
    const h = harness()
    await h.call('POST', '/imports?dry_run=true', {
      body: { host: 'gitlab', slug: 'x/zine' },
    })
    expect((await h.call('GET', '/repos/dana/zine')).status).toBe(404)
  })
})

describe('linked accounts', () => {
  test('recorded as given, unverified, one per host', async () => {
    const h = harness()
    const list = (await h.call('GET', '/accounts/dana/links')).json.data
    expect(list[0]).toMatchObject({
      host: 'github',
      login: 'dana-okafor',
      verified: false,
    })
    await h.call('PUT', '/accounts/dana/links/github', {
      body: { login: 'dana-o' },
    })
    const after = (await h.call('GET', '/accounts/dana/links')).json.data
    expect(after).toHaveLength(1)
    expect(after[0].login).toBe('dana-o')
    const gitea = await h.call('PUT', '/accounts/dana/links/gitea', {
      body: { login: 'dana' },
    })
    expect(gitea.status).toBe(400)
    expect((await h.call('DELETE', '/accounts/dana/links/github')).status).toBe(
      204,
    )
  })

  test('only your own', async () => {
    const h = harness()
    expect(
      (
        await h.call('GET', '/accounts/dana/links', {
          token: sampleTokens.hollis,
        })
      ).status,
    ).toBe(404)
  })
})
