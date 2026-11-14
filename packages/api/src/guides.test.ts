import { describe, expect, test } from 'bun:test'
import { harness } from './testing'

const REPO = '/repos/dana/gitfs'
const C = `${REPO}/changes/216`

describe('change guides', () => {
  test('an agent writes the guide, and a newer patch set leaves it behind', async () => {
    const h = harness()
    expect((await h.call('GET', `${C}/guide`)).status).toBe(404)
    const run = await h.call('POST', `${REPO}/runs`, {
      body: {
        task: 'Guide the reviewers',
        change: 216,
        scopes: ['repo:read', 'pulls:read', 'pulls:write'],
      },
    })
    const put = await h.call('PUT', `${C}/guide`, {
      token: run.json.token,
      body: {
        summary: 'Caches missing refs so a lookup reads the disk once.',
        order: [
          {
            path: 'src/refs.rs',
            why: 'The cache and where it is filled.',
            risk: 'medium',
          },
          { path: 'tests/refs_test.rs', why: 'Proves one read.' },
        ],
      },
    })
    expect(put.status).toBe(200)
    expect(put.json).toMatchObject({
      object: 'change_guide',
      patch_set: 3,
      current: true,
      run: run.json.id,
      order: [
        { path: 'src/refs.rs', risk: 'medium' },
        { path: 'tests/refs_test.rs', risk: 'low' },
      ],
    })
    await h.call('POST', `${C}/patch-sets`, {
      body: { sha: '8'.repeat(40), kind: 'update' },
    })
    const got = await h.call('GET', `${C}/guide`)
    expect(got.json).toMatchObject({ patch_set: 3, current: false })
    const timeline = (await h.call('GET', `${C}/timeline?limit=200`)).json.data
    expect(
      timeline.some(
        (e: { kind: string; run: string }) =>
          e.kind === 'guide' && e.run === run.json.id,
      ),
    ).toBe(true)
  })

  test('a guide names files of the change, each once', async () => {
    const h = harness()
    const unknown = await h.call('PUT', `${C}/guide`, {
      body: { summary: 'x', order: [{ path: 'nope.rs' }] },
    })
    expect(unknown.status).toBe(400)
    const twice = await h.call('PUT', `${C}/guide`, {
      body: {
        summary: 'x',
        order: [{ path: 'src/refs.rs' }, { path: 'src/refs.rs' }],
      },
    })
    expect(twice.status).toBe(400)
  })
})
