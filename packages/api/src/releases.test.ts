import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/hollis/lumen'
const G = '/repos/dana/gitfs'
const hollis = { token: sampleTokens.hollis }
const asset = {
  name: 'lumen-v2.5.0-x86_64-unknown-linux-gnu.tar.gz',
  platform: 'linux',
  arch: 'x64',
  size: 12_000_000,
  sha256: 'b'.repeat(64),
}

describe('releases', () => {
  test('newest first, withdrawn ones kept with the reason', async () => {
    const h = harness()
    const list = (await h.call('GET', `${R}/releases?limit=20`)).json.data
    expect(list[0].tag).toBe('v2.5.0-nightly.20261104')
    const pulled = list.find((r: { tag: string }) => r.tag === 'v2.3.1')
    expect(pulled.withdrawn.reason).toContain('overwrite')
    const stable = (await h.call('GET', `${R}/releases?channel=stable`)).json
      .data
    expect(
      stable.every((r: { channel: string }) => r.channel === 'stable'),
    ).toBe(true)
    const one = (await h.call('GET', `${R}/releases/v2.4.1`)).json
    expect(one).toMatchObject({
      object: 'release',
      tag: 'v2.4.1',
      signed: true,
    })
    expect(one.downloads).toBe(
      one.assets.reduce(
        (n: number, a: { downloads: number }) => n + a.downloads,
        0,
      ),
    )
  })

  test('publishing is idempotent by tag, and tells who starred it', async () => {
    const h = harness()
    await h.call('PUT', `${G}/star`, hollis)
    const made = await h.call('POST', `${G}/releases`, {
      body: { tag: 'v2.5.0', title: 'Plan mode', assets: [asset] },
    })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ channel: 'stable', downloads: 0 })
    const again = await h.call('POST', `${G}/releases`, {
      body: { tag: 'v2.5.0', title: 'Something else' },
    })
    expect(again.status).toBe(200)
    expect(again.json.title).toBe('Plan mode')
    const inbox = (await h.call('GET', '/notifications?kind=release', hollis))
      .json.data
    expect(inbox[0].title).toBe('gitfs v2.5.0 is out: Plan mode')
  })

  test('a beta tells no one', async () => {
    const h = harness()
    await h.call('PUT', `${G}/star`, hollis)
    await h.call('POST', `${G}/releases`, {
      body: { tag: 'v2.6.0-beta.1', channel: 'beta', title: 'Try it' },
    })
    expect(
      (await h.call('GET', '/notifications?kind=release', hollis)).json.data,
    ).toHaveLength(0)
  })

  test('a download is counted; a withdrawn release refuses', async () => {
    const h = harness()
    const tag = 'v0.9.0'
    const r = (await h.call('GET', `${G}/releases/${tag}`)).json
    const a = r.assets[0]
    const got = await h.call(
      'POST',
      `${G}/releases/${tag}/assets/${a.name}/download`,
      { token: null },
    )
    expect(got.status).toBe(200)
    expect(got.json).toMatchObject({ object: 'download', sha256: a.sha256 })
    expect(got.json.downloads).toBe(a.downloads + 1)
    const pulled = await h.call('PATCH', `${G}/releases/${tag}`, {
      body: { withdrawn: 'Bad build' },
    })
    expect(pulled.json.withdrawn.reason).toBe('Bad build')
    const refused = await h.call(
      'POST',
      `${G}/releases/${tag}/assets/${a.name}/download`,
    )
    expect(refused.status).toBe(409)
    const back = await h.call('PATCH', `${G}/releases/${tag}`, {
      body: { withdrawn: null },
    })
    expect(back.json.withdrawn).toBe(null)
  })

  test('only people who can change the repository publish', async () => {
    const h = harness()
    const r = await h.call('POST', `${R}/releases`, {
      token: sampleTokens.stranger,
      body: { tag: 'v9', title: 'Mine' },
    })
    expect(r.status).toBe(403)
    expect((await h.call('GET', `${R}/releases/v9`)).status).toBe(404)
  })
})

describe('release files', () => {
  test('uploaded with the release, then served from it', async () => {
    const h = harness()
    const bytes = new TextEncoder().encode('#!/bin/sh\necho gitfs\n')
    const up = (
      await h.call('POST', '/uploads', {
        body: {
          filename: 'gitfs-install.sh',
          content_type: 'application/octet-stream',
          size: bytes.length,
          purpose: 'release',
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
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes as unknown as BodyInit,
        },
      ),
    )
    const made = await h.call('POST', `${G}/releases`, {
      body: {
        tag: 'v9.9.9',
        channel: 'stable',
        title: 'With a real file',
        assets: [
          {
            name: 'gitfs-install.sh',
            platform: 'linux',
            arch: 'x64',
            upload: up.id,
          },
        ],
      },
    })
    expect(made.status).toBe(201)
    expect(made.json.assets[0].size).toBe(bytes.length)
    expect(made.json.assets[0].content_url).toContain(
      `/uploads/${up.id}/content`,
    )
    const dl = (
      await h.call(
        'POST',
        `${G}/releases/v9.9.9/assets/gitfs-install.sh/download`,
        { token: null },
      )
    ).json
    expect(dl.content_url).toContain(up.id)
    // Anyone who can read the repository can fetch it.
    const file = await h.call('GET', `/uploads/${up.id}/content`, {
      token: null,
    })
    expect(file.status).toBe(200)
    expect(file.text).toContain('echo gitfs')
  })

  test('a binary is only for a release, and an asset needs a file or its facts', async () => {
    const h = harness()
    expect(
      (
        await h.call('POST', '/uploads', {
          body: {
            filename: 'x.bin',
            content_type: 'application/octet-stream',
            size: 10,
          },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await h.call('POST', `${G}/releases`, {
          body: {
            tag: 'v9.9.8',
            channel: 'beta',
            title: 'No facts',
            assets: [{ name: 'a', platform: 'linux', arch: 'x64' }],
          },
        })
      ).status,
    ).toBe(400)
  })
})
