import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const C = '/repos/dana/gitfs/changes/216'

describe('each reviewer has their own seen state per file', () => {
  test('a mark holds until a newer patch set changes the file', async () => {
    const h = harness()
    const before = await h.call('GET', `${C}/seen`)
    expect(before.json).toMatchObject({ object: 'change_seen', seen: 0 })
    const total = before.json.total as number
    const marked = await h.call('PUT', `${C}/seen`, {
      body: { paths: ['src/refs.rs', 'tests/refs_test.rs'] },
    })
    expect(marked.json.seen).toBe(2)
    // Someone else's marks are theirs.
    const theirs = await h.call('GET', `${C}/seen`, {
      token: sampleTokens.hollis,
    })
    expect(theirs.json.seen).toBe(0)
    const files = (await h.call('GET', `${C}/patch-sets/3/files`)).json.files
    const refs = files.find((f: { path: string }) => f.path === 'src/refs.rs')
    await h.call('POST', `${C}/patch-sets`, {
      body: {
        kind: 'update',
        files: { 'src/refs.rs': `// Bounded.\n${refs.content}` },
      },
    })
    const after = (await h.call('GET', `${C}/seen`)).json
    expect(after.total).toBe(total)
    const byPath = Object.fromEntries(
      after.files.map((f: { path: string }) => [f.path, f]),
    )
    expect(byPath['src/refs.rs']).toMatchObject({
      seen: false,
      patch_set: 3,
      changed_since: true,
    })
    expect(byPath['tests/refs_test.rs']).toMatchObject({
      seen: true,
      changed_since: false,
    })
    const off = await h.call('PUT', `${C}/seen`, {
      body: { paths: ['tests/refs_test.rs'], seen: false },
    })
    expect(off.json.seen).toBe(0)
    const bad = await h.call('PUT', `${C}/seen`, {
      body: { paths: ['nope.rs'] },
    })
    expect(bad.status).toBe(400)
  })
})
