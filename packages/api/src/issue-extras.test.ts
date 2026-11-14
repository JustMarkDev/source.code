import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'
const stranger = { token: sampleTokens.stranger }

describe('labels', () => {
  test('a repository starts with six, each counting its open issues', async () => {
    const h = harness()
    const list = (await h.call('GET', `${R}/labels`)).json
    expect(list.data.map((l: { name: string }) => l.name)).toEqual([
      'bug',
      'docs',
      'enhancement',
      'good first issue',
      'help wanted',
      'perf',
    ])
    const bug = list.data.find((l: { name: string }) => l.name === 'bug')
    expect(bug).toMatchObject({ object: 'label', color: 'red', issues: 1 })
    expect(bug.id).toStartWith('lbl_')
  })

  test('adding one is naturally idempotent, in any case', async () => {
    const h = harness()
    const made = await h.call('POST', `${R}/labels`, {
      body: { name: 'windows', color: 'blue' },
    })
    expect(made.status).toBe(201)
    expect(made.headers.get('sx-outcome')).toBe('created')
    const again = await h.call('POST', `${R}/labels`, {
      body: { name: 'Windows' },
    })
    expect(again.status).toBe(200)
    expect(again.headers.get('sx-outcome')).toBe('unchanged')
    expect(again.json.id).toBe(made.json.id)
  })

  test('a rename follows the label onto its issues; a delete takes it off', async () => {
    const h = harness()
    const before = (await h.call('GET', `${R}/issues/4`)).json
    const renamed = await h.call('PATCH', `${R}/labels/bug`, {
      body: { name: 'defect', color: 'orange' },
    })
    expect(renamed.status).toBe(200)
    expect(renamed.json).toMatchObject({ name: 'defect', color: 'orange' })
    const after = (await h.call('GET', `${R}/issues/4`)).json
    expect(after.labels).toEqual(['defect'])
    expect(after.version).toBe(before.version + 1)

    expect((await h.call('DELETE', `${R}/labels/defect`)).status).toBe(204)
    expect((await h.call('GET', `${R}/issues/4`)).json.labels).toEqual([])
    expect(
      (await h.call('PATCH', `${R}/labels/defect`, { body: {} })).status,
    ).toBe(404)
  })

  test('a rename onto another label is refused', async () => {
    const h = harness()
    const r = await h.call('PATCH', `${R}/labels/bug`, {
      body: { name: 'Docs' },
    })
    expect(r.status).toBe(400)
    expect(r.json.errors[0].code).toBe('taken')
  })

  test('only people who can change the repository edit its labels', async () => {
    const h = harness()
    const r = await h.call('POST', `${R}/labels`, {
      ...stranger,
      body: { name: 'mine' },
    })
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('forbidden')
    // Reading is open to anyone who can read the repository.
    expect((await h.call('GET', `${R}/labels`, stranger)).status).toBe(200)
  })
})

describe('issue comments', () => {
  test('an issue counts its comments and lists them oldest first', async () => {
    const h = harness()
    const issue = (await h.call('GET', `${R}/issues/4`)).json
    expect(issue.comments).toBe(2)
    const list = (await h.call('GET', `${R}/issues/4/comments`)).json
    expect(
      list.data.map((c: { author: { handle: string } }) => c.author.handle),
    ).toEqual(['dana', 'ines'])
    expect(list.data[0]).toMatchObject({ object: 'issue_comment', issue: 4 })
  })

  test('anyone who can read may comment; it bumps the issue and is an event', async () => {
    const h = harness()
    const before = (await h.call('GET', `${R}/issues/4`)).json
    const made = await h.call('POST', `${R}/issues/4/comments`, {
      ...stranger,
      body: { body: 'Still happens on 2.4.' },
    })
    expect(made.status).toBe(201)
    expect(made.json.author.handle).toBe('stranger')
    const after = (await h.call('GET', `${R}/issues/4`)).json
    expect(after.comments).toBe(3)
    expect(after.version).toBe(before.version + 1)
    const events = (await h.call('GET', '/events?type=issue.commented')).json
    expect(events.data[0].data.body).toBe('Still happens on 2.4.')
  })

  test('a dry run adds nothing', async () => {
    const h = harness()
    const r = await h.call('POST', `${R}/issues/4/comments?dry_run=true`, {
      body: { body: 'Just looking' },
    })
    expect(r.status).toBe(200)
    expect((await h.call('GET', `${R}/issues/4`)).json.comments).toBe(2)
  })

  test('only the author edits; the author or a maintainer deletes', async () => {
    const h = harness()
    const [first] = (await h.call('GET', `${R}/issues/4/comments`)).json.data
    const byOther = await h.call('PATCH', `${R}/issues/comments/${first.id}`, {
      token: sampleTokens.hollis,
      body: { body: 'Not mine' },
    })
    expect(byOther.status).toBe(403)
    const edited = await h.call('PATCH', `${R}/issues/comments/${first.id}`, {
      body: { body: 'Reproduced on main and on 2.3.' },
    })
    expect(edited.status).toBe(200)
    expect(edited.json.version).toBe(2)

    const mine = await h.call('POST', `${R}/issues/4/comments`, {
      ...stranger,
      body: { body: 'Me too' },
    })
    // dana can change the repository, so she can delete someone else's.
    expect(
      (await h.call('DELETE', `${R}/issues/comments/${mine.json.id}`)).status,
    ).toBe(204)
    expect(
      (await h.call('DELETE', `${R}/issues/comments/${first.id}`, stranger))
        .status,
    ).toBe(403)
    expect((await h.call('GET', `${R}/issues/4`)).json.comments).toBe(2)
  })

  test('comments page with a cursor', async () => {
    const h = harness()
    for (let i = 0; i < 3; i++)
      await h.call('POST', `${R}/issues/4/comments`, {
        body: { body: `note ${i}` },
      })
    const one = (await h.call('GET', `${R}/issues/4/comments?limit=2`)).json
    expect(one.has_more).toBe(true)
    const two = (
      await h.call(
        'GET',
        `${R}/issues/4/comments?limit=2&cursor=${one.next_cursor}`,
      )
    ).json
    const three = (
      await h.call(
        'GET',
        `${R}/issues/4/comments?limit=2&cursor=${two.next_cursor}`,
      )
    ).json
    expect(
      [...one.data, ...two.data, ...three.data]
        .map((c: { body: string }) => c.body)
        .slice(2),
    ).toEqual(['note 0', 'note 1', 'note 2'])
    expect(three.has_more).toBe(false)
  })

  test('a comment on a missing issue is a 404', async () => {
    const h = harness()
    const r = await h.call('POST', `${R}/issues/9999/comments`, {
      body: { body: 'Hello' },
    })
    expect(r.status).toBe(404)
  })
})

describe('assignees', () => {
  test('set by handle, replaced as a whole, cleared with []', async () => {
    const h = harness()
    const issue = (await h.call('GET', `${R}/issues/209`)).json
    expect(issue.assignees).toEqual([])
    const set = await h.call('PATCH', `${R}/issues/209`, {
      body: { assignees: ['hollis', 'fix-agent'] },
    })
    expect(set.status).toBe(200)
    expect(set.json.assignees.map((a: { handle: string }) => a.handle)).toEqual(
      ['hollis', 'fix-agent'],
    )
    const cleared = await h.call('PATCH', `${R}/issues/209`, {
      body: { assignees: [] },
    })
    expect(cleared.json.assignees).toEqual([])
  })

  test('someone unknown cannot be assigned', async () => {
    const h = harness()
    const r = await h.call('PATCH', `${R}/issues/209`, {
      body: { assignees: ['nobody-here'] },
    })
    expect(r.status).toBe(400)
    expect(r.json.errors[0]).toMatchObject({
      pointer: '/body/assignees/0',
      code: 'not_assignable',
    })
  })

  test('on a private repository, only people with access', async () => {
    const h = harness()
    const r = await h.call('POST', '/repos/dana/notes/issues', {
      body: { title: 'Private', assignees: ['stranger'] },
    })
    expect(r.status).toBe(400)
  })
})
