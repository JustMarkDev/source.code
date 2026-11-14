import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const C = '/repos/dana/gitfs/changes/216/comments'
const hollis = { token: sampleTokens.hollis }

describe('line comments', () => {
  test('on a line, answered in its thread, then settled', async () => {
    const h = harness()
    const start = await h.call('POST', C, {
      ...hollis,
      body: { body: 'Is this checked?', file: 'src/refs.rs', line: 3 },
    })
    expect(start.status).toBe(201)
    expect(start.json).toMatchObject({
      object: 'change_comment',
      file: 'src/refs.rs',
      line: 3,
      patch_set: 3,
      reply_to: null,
      resolved: false,
    })
    const reply = await h.call('POST', C, {
      body: { body: 'Yes, below.', reply_to: start.json.id },
    })
    // A reply sits where the thread does.
    expect(reply.json).toMatchObject({
      file: 'src/refs.rs',
      line: 3,
      reply_to: start.json.id,
    })
    // Settling goes on the comment that starts it.
    expect(
      (
        await h.call('PATCH', `${C}/${reply.json.id}`, {
          body: { resolved: true },
        })
      ).status,
    ).toBe(400)
    const settled = await h.call('PATCH', `${C}/${start.json.id}`, {
      body: { resolved: true },
    })
    expect(settled.json.resolved).toBe(true)
    expect(
      (await h.call('GET', `${C}?unresolved=true`)).json.data,
    ).toHaveLength(0)
    // A new reply reopens it.
    await h.call('POST', C, {
      ...hollis,
      body: { body: 'One more thing.', reply_to: start.json.id },
    })
    expect(
      (await h.call('GET', `${C}?unresolved=true`)).json.data,
    ).toHaveLength(3)
  })

  test('the change author hears about it', async () => {
    const h = harness()
    const author = (await h.call('GET', '/repos/dana/gitfs/changes/216')).json
      .author.handle
    await h.call('POST', C, {
      ...hollis,
      body: { body: 'A question on the whole change.' },
    })
    if (author === 'dana') {
      const inbox = (await h.call('GET', '/notifications')).json.data
      expect(inbox[0].title).toContain('hollis commented on #216')
    }
  })

  test('refuses a file the change does not touch, or a line past the end', async () => {
    const h = harness()
    expect(
      (
        await h.call('POST', C, {
          body: { body: 'x', file: 'nope.rs', line: 1 },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await h.call('POST', C, {
          body: { body: 'x', file: 'src/refs.rs', line: 999 },
        })
      ).status,
    ).toBe(400)
    expect(
      (await h.call('POST', C, { body: { body: 'x', line: 2 } })).status,
    ).toBe(400)
  })

  test('only its author edits it; deleting the start deletes the thread', async () => {
    const h = harness()
    const start = (
      await h.call('POST', C, { body: { body: 'Mine', file: 'src/refs.rs' } })
    ).json
    await h.call('POST', C, {
      ...hollis,
      body: { body: 'Reply', reply_to: start.id },
    })
    expect(
      (
        await h.call('PATCH', `${C}/${start.id}`, {
          ...hollis,
          body: { body: 'Edited by someone else' },
        })
      ).status,
    ).toBe(403)
    expect((await h.call('DELETE', `${C}/${start.id}`)).status).toBe(204)
    expect((await h.call('GET', C)).json.data).toHaveLength(0)
  })
})
