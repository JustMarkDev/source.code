import { describe, expect, test } from 'bun:test'
import { harness } from './testing'

const REPO = '/repos/dana/gitfs'

type Entry = {
  id: string
  kind: string
  created_at: string
  run: string | null
  summary: string
  item: { object: string; [k: string]: unknown }
}

async function all(h: ReturnType<typeof harness>, path: string) {
  const out: Array<Entry> = []
  let cursor: string | undefined
  for (;;) {
    const r = await h.call(
      'GET',
      `${path}?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
    )
    expect(r.status).toBe(200)
    out.push(...r.json.data)
    cursor = r.json.next_cursor ?? undefined
    if (!cursor) return out
  }
}

describe('one timeline per change and per issue', () => {
  test("a change's story, in time order, with the run that made each part", async () => {
    const h = harness()
    const run = await h.call('POST', `${REPO}/runs`, {
      body: {
        task: 'Answer review',
        change: 216,
        scopes: ['repo:read', 'pulls:read', 'pulls:comment', 'pulls:write'],
      },
    })
    await h.call('POST', `${REPO}/runs/${run.json.id}/notes`, {
      token: run.json.token,
      body: { text: 'Reading the review.' },
    })
    await h.call('POST', `${REPO}/changes/216/patch-sets`, {
      token: run.json.token,
      body: { sha: '9'.repeat(40), kind: 'update', note: 'Bounded the cache' },
    })
    const entries = await all(h, `${REPO}/changes/216/timeline`)
    const kinds = new Set(entries.map((e) => e.kind))
    for (const k of ['patch_set', 'run_note', 'state_change'])
      expect(kinds.has(k)).toBe(true)
    const times = entries.map((e) => Date.parse(e.created_at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    // Paging gave each entry once.
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length)
    const pushed = entries.find(
      (e) => e.kind === 'patch_set' && e.item.number === 4,
    )!
    expect(pushed.run).toBe(run.json.id)
    expect(pushed.item.object).toBe('patch_set')
    const note = entries.find((e) => e.summary === 'Reading the review.')!
    expect(note).toMatchObject({ kind: 'run_note', run: run.json.id })
  })

  test("an issue's story: its runs, the changes that fix it, and closing it", async () => {
    const h = harness()
    const issue = (
      await h.call('POST', `${REPO}/issues`, {
        body: { title: 'Lookups of missing refs hit the disk' },
      })
    ).json.number as number
    const run = await h.call('POST', `${REPO}/runs`, {
      body: { task: 'Look into it' },
    })
    await h.call('PATCH', `${REPO}/runs/${run.json.id}`, {
      token: run.json.token,
      body: { issue },
    })
    await h.call('POST', `${REPO}/runs/${run.json.id}/notes`, {
      token: run.json.token,
      body: { text: 'Found it: no negative cache.' },
    })
    const change = await h.call('POST', `${REPO}/changes`, {
      body: {
        branch: 'missing-refs-hit-disk',
        title: 'Cache missing refs',
        description: `Fixes #${issue}`,
      },
    })
    await h.call('PATCH', `${REPO}/issues/${issue}`, {
      body: { state: 'closed' },
    })
    expect(change.status).toBe(201)
    const entries = await all(h, `${REPO}/issues/${issue}/timeline`)
    expect(entries.find((e) => e.kind === 'reference')!.item).toMatchObject({
      object: 'reference',
      change: change.json.number,
      closes: true,
    })
    expect(
      entries.find((e) => e.summary === 'Found it: no negative cache.'),
    ).toMatchObject({ kind: 'run_note', run: run.json.id })
    const moves = entries
      .filter((e) => e.kind === 'state_change')
      .map((e) => e.item.to)
    expect(moves.at(-1)).toBe('closed')
    expect((await h.call('GET', `${REPO}/issues/99999/timeline`)).status).toBe(
      404,
    )
  })
})
