import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
])

async function uploaded(
  h: ReturnType<typeof harness>,
  type = 'image/png',
  bytes = png,
) {
  const up = (
    await h.call('POST', '/uploads', {
      body: { filename: 'shot', content_type: type, size: bytes.length },
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
        headers: { 'content-type': type },
        body: bytes as unknown as BodyInit,
      },
    ),
  )
  return up.id as string
}

describe('images and recordings on an issue', () => {
  test('attached by someone who can read it, listed with the issue', async () => {
    const h = harness()
    const id = await uploaded(h)
    const made = await h.call('POST', `${R}/issues/4/evidence`, {
      body: { upload: id, kind: 'image', caption: 'What I saw' },
    })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({
      object: 'issue_evidence',
      issue: 4,
      kind: 'image',
      caption: 'What I saw',
    })
    const list = (
      await h.call('GET', `${R}/issues/4/evidence`, { token: null })
    ).json.data
    expect(list).toHaveLength(1)
    // A visitor can read the file of a public repository's issue.
    const file = await h.call('GET', `/uploads/${id}/content`, { token: null })
    expect(file.status).toBe(200)
  })

  test('the type has to fit, a file attaches once, private stays private', async () => {
    const h = harness()
    const id = await uploaded(h)
    expect(
      (
        await h.call('POST', `${R}/issues/4/evidence`, {
          body: { upload: id, kind: 'recording' },
        })
      ).status,
    ).toBe(400)
    await h.call('POST', `${R}/issues/4/evidence`, {
      body: { upload: id, kind: 'image' },
    })
    expect(
      (
        await h.call('POST', `${R}/issues/4/evidence`, {
          body: { upload: id, kind: 'image' },
        })
      ).status,
    ).toBe(409)
    await h.call('POST', '/repos/dana/notes/issues', { body: { title: 'x' } })
    expect(
      (
        await h.call('GET', '/repos/dana/notes/issues/1/evidence', {
          token: sampleTokens.stranger,
        })
      ).status,
    ).toBe(404)
  })
})

describe('the status report', () => {
  test('counts what the server answered, and says what is wrong', async () => {
    const h = harness()
    for (let i = 0; i < 5; i++) await h.call('GET', `${R}/issues`)
    await h.call('GET', `${R}/git/tree`)
    const s = (await h.call('GET', '/status', { token: null })).json
    expect(s.object).toBe('status')
    const api = s.services.find((x: { id: string }) => x.id === 'api')
    expect(api.requests).toBeGreaterThanOrEqual(5)
    expect(api.errors).toBe(0)
    expect(api.uptime).toBe(100)
    expect(api.p50_ms).not.toBeNull()
    expect(api.days).toHaveLength(90)
    const git = s.services.find((x: { id: string }) => x.id === 'git')
    expect(git.requests).toBe(1)
    // The sample has a mirror that is failing.
    const mirrors = s.services.find((x: { id: string }) => x.id === 'mirrors')
    expect(mirrors.state).toBe('degraded')
    expect(s.state).not.toBe('up')
    expect(s.incidents[0]).toMatchObject({
      service: 'Mirror sync',
      state: 'open',
    })
    expect(s.counts.repositories).toBeGreaterThan(0)
  })

  test('a paused mirror is not an outage', async () => {
    const h = harness()
    for (const m of (await h.call('GET', `${R}/mirrors`)).json.data)
      if (m.state === 'failing')
        await h.call('PATCH', `${R}/mirrors/${m.id}`, {
          body: { paused: true },
        })
    const s = (await h.call('GET', '/status', { token: null })).json
    expect(
      s.services.find((x: { id: string }) => x.id === 'mirrors').state,
    ).toBe('up')
  })
})
