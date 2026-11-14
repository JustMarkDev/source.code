import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const C = '/repos/dana/gitfs/changes/216'

/** src/refs.rs in patch set 3 of #216. */
const REFS = [
  'pub struct Refs {',
  '    disk: Disk,',
  '    neg: NegCache,',
  '}',
  '',
  'impl Refs {',
  '    pub fn lookup(&self, name: &str) -> Option<Oid> {',
  '        if self.neg.contains(name) {',
  '            return None;',
  '        }',
  '        self.disk',
  '            .read_ref(name)',
  '            .or_else(|| self.neg.put(name))',
  '    }',
  '}',
]
const text = (lines: Array<string>) => `${lines.join('\n')}\n`

async function commentThenPush(line: number, next: Array<string>) {
  const h = harness()
  const made = await h.call('POST', `${C}/comments`, {
    body: { body: 'Is this right?', file: 'src/refs.rs', line, patch_set: 3 },
  })
  expect(made.status).toBe(201)
  expect(made.json.anchor.quote).toBe(REFS[line - 1])
  const reply = await h.call('POST', `${C}/comments`, {
    body: { body: 'Yes.', reply_to: made.json.id },
  })
  const ps = await h.call('POST', `${C}/patch-sets`, {
    body: { kind: 'update', files: { 'src/refs.rs': text(next) } },
  })
  expect(ps.status).toBe(201)
  const list = (await h.call('GET', `${C}/comments`)).json.data
  return {
    h,
    start: list.find((x: { id: string }) => x.id === made.json.id),
    reply: list.find((x: { id: string }) => x.id === reply.json.id),
  }
}

describe('comments follow the code', () => {
  test('when lines are inserted above it', async () => {
    const { start, reply } = await commentThenPush(8, [
      '// Refs, with a cache of misses.',
      'use crate::cache::NegCache;',
      ...REFS,
    ])
    expect(start).toMatchObject({ current_line: 10, outdated: false })
    // A reply is wherever its thread is.
    expect(reply).toMatchObject({ current_line: 10, outdated: false })
  })

  test('when its code is moved', async () => {
    // The struct moves below the impl; the comment is on a field in it.
    const { start } = await commentThenPush(2, [
      ...REFS.slice(5),
      '',
      ...REFS.slice(0, 4),
    ])
    expect(start).toMatchObject({ current_line: 13, outdated: false })
  })

  test('it goes outdated when its code is deleted', async () => {
    const { start } = await commentThenPush(8, [
      ...REFS.slice(0, 7),
      ...REFS.slice(10),
    ])
    expect(start).toMatchObject({ current_line: null, outdated: true })
  })

  test('it stays right on the patch set it was written on', async () => {
    const { start } = await commentThenPush(8, ['// new', ...REFS])
    expect(start).toMatchObject({ line: 8, patch_set: 3, current_line: 9 })
    expect(start.anchor).toEqual({
      quote: REFS[7],
      before: REFS.slice(4, 7),
      after: REFS.slice(8, 11),
      side: 'head',
    })
  })

  test('a quote names more than the line, and is followed as a whole', async () => {
    const h = harness()
    const made = await h.call('POST', `${C}/comments`, {
      body: {
        body: 'This whole check.',
        file: 'src/refs.rs',
        line: 8,
        patch_set: 3,
        quote: REFS.slice(7, 10).join('\n'),
      },
    })
    expect(made.json.anchor.quote).toBe(REFS.slice(7, 10).join('\n'))
    // The check's body changes: the quote no longer matches, so it is outdated.
    await h.call('POST', `${C}/patch-sets`, {
      body: {
        kind: 'update',
        files: {
          'src/refs.rs': text([
            ...REFS.slice(0, 8),
            '            return self.miss();',
            ...REFS.slice(9),
          ]),
        },
      },
    })
    const got = (await h.call('GET', `${C}/comments`)).json.data.find(
      (x: { id: string }) => x.id === made.json.id,
    )
    expect(got.outdated).toBe(true)
  })
})

describe('fixes linked to the comments they answer', () => {
  const hollis = { token: sampleTokens.hollis }

  async function thread(h: ReturnType<typeof harness>) {
    const made = await h.call('POST', `${C}/comments`, {
      ...hollis,
      body: { body: 'Bound this cache.', file: 'src/refs.rs', line: 3 },
    })
    expect(made.status).toBe(201)
    return made.json.id as string
  }

  test('a patch set marks the threads it answers, in one write, and tells their authors', async () => {
    const h = harness()
    const id = await thread(h)
    const ps = await h.call('POST', `${C}/patch-sets`, {
      body: {
        sha: 'f'.repeat(40),
        kind: 'update',
        addresses: [{ comment: id, note: 'Capped at 1,024 entries.' }],
      },
    })
    expect(ps.status).toBe(201)
    const got = (await h.call('GET', `${C}/comments`)).json.data.find(
      (x: { id: string }) => x.id === id,
    )
    expect(got.addressed).toMatchObject({
      patch_set: ps.json.number,
      by: { handle: 'dana' },
      note: 'Capped at 1,024 entries.',
    })
    // Addressed is not resolved.
    expect(got.resolved).toBe(false)
    const inbox = (await h.call('GET', '/notifications', hollis)).json.data
    expect(
      inbox.some((x: { title: string }) =>
        x.title.includes(
          `addressed your comment on #216 in patch set ${ps.json.number}`,
        ),
      ),
    ).toBe(true)
  })

  test('an address naming a comment that is not there writes nothing', async () => {
    const h = harness()
    const before = (await h.call('GET', `${C}/patch-sets`)).json.data.length
    const ps = await h.call('POST', `${C}/patch-sets`, {
      body: {
        sha: 'f'.repeat(40),
        kind: 'update',
        addresses: [{ comment: 'cmt_nope' }],
      },
    })
    expect(ps.status).toBe(400)
    expect((await h.call('GET', `${C}/patch-sets`)).json.data.length).toBe(
      before,
    )
  })

  test('a thread can be marked afterwards, by a later patch set only', async () => {
    const h = harness()
    const id = await thread(h)
    const same = await h.call('POST', `${C}/comments/${id}/address`, {
      body: { patch_set: 3 },
    })
    expect(same.status).toBe(400)
    await h.call('POST', `${C}/patch-sets`, {
      body: { sha: 'f'.repeat(40), kind: 'update' },
    })
    const ok = await h.call('POST', `${C}/comments/${id}/address`, {
      body: { note: 'Done in the newest one.' },
    })
    expect(ok.status).toBe(200)
    expect(ok.json.addressed.patch_set).toBe(4)
    const reply = await h.call('POST', `${C}/comments`, {
      ...hollis,
      body: { body: 'Thanks.', reply_to: id },
    })
    const onReply = await h.call(
      'POST',
      `${C}/comments/${reply.json.id}/address`,
      { body: {} },
    )
    expect(onReply.status).toBe(400)
    expect(
      (await h.call('POST', `${C}/comments/cmt_nope/address`, { body: {} }))
        .status,
    ).toBe(404)
  })
})
