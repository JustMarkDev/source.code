import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { clock, harness } from './testing'

const C = '/repos/dana/gitfs/changes/216/presence'
const I = '/repos/dana/gitfs/issues/4/presence'

describe('everyone can see who else is looking', () => {
  test('people and agents in a change, with the file each has open', async () => {
    const now = clock()
    const h = harness({ now })
    const empty = await h.call('GET', C)
    expect(empty.status).toBe(200)
    expect(empty.json).toMatchObject({
      object: 'presence',
      kind: 'change',
      number: 216,
      interval: 20,
      viewers: [],
    })
    await h.call('PUT', C, {
      body: { session: 'tab-aaaa-1', path: 'src/refs.rs' },
    })
    const both = await h.call('PUT', C, {
      token: sampleTokens.fixAgent,
      body: { session: 'mcp-bbbb-1' },
    })
    expect(both.status).toBe(200)
    const byHandle = Object.fromEntries(
      both.json.viewers.map(
        (v: { actor: { handle: string }; path: string | null }) => [
          v.actor.handle,
          v,
        ],
      ),
    )
    expect(byHandle.dana).toMatchObject({
      actor: { class: 'human' },
      path: 'src/refs.rs',
    })
    expect(byHandle['fix-agent']).toMatchObject({
      actor: { class: 'agent' },
      path: null,
    })
    // Two tabs of one person count once, at the newer file.
    now.advance(1000)
    const tabs = await h.call('PUT', C, {
      body: { session: 'tab-aaaa-2', path: 'tests/refs_test.rs' },
    })
    expect(
      tabs.json.viewers.filter(
        (v: { actor: { handle: string } }) => v.actor.handle === 'dana',
      ),
    ).toEqual([expect.objectContaining({ path: 'tests/refs_test.rs' })])
    // Leaving one tab leaves the other.
    const left = await h.call('PUT', C, {
      body: { session: 'tab-aaaa-2', leave: true },
    })
    expect(
      left.json.viewers
        .map((v: { actor: { handle: string } }) => v.actor.handle)
        .sort(),
    ).toEqual(['dana', 'fix-agent'])
    // Silence for two and a half intervals and you are gone.
    now.advance(51_000)
    const later = await h.call('GET', C)
    expect(later.json.viewers).toEqual([])
  })

  test('issues have rooms too, and a room needs read access', async () => {
    const h = harness()
    const r = await h.call('PUT', I, { body: { session: 'tab-cccc-1' } })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ kind: 'issue', number: 4 })
    expect(r.json.viewers).toHaveLength(1)
    expect((await h.call('GET', I, { token: null })).status).toBe(401)
    expect(
      (await h.call('PUT', I, { body: { session: 'short' } })).status,
    ).toBe(400)
    expect(
      (await h.call('GET', '/repos/dana/gitfs/changes/99999/presence')).status,
    ).toBe(404)
  })
})
