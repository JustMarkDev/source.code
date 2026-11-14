import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const C = '/repos/dana/gitfs/changes/216'

describe('the files of a patch set', () => {
  test('whole, on the base and at the patch set', async () => {
    const h = harness()
    const r = await h.call('GET', `${C}/patch-sets/3/files`)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({
      object: 'patch_set_files',
      change: 216,
      patch_set: 3,
      available: true,
    })
    const refs = r.json.files.find(
      (f: { path: string }) => f.path === 'src/refs.rs',
    )
    expect(refs.base).toContain('self.disk.read_ref(name)')
    expect(refs.content).toContain('neg: NegCache,')
    // Patch set 1 is an earlier version of the same file.
    const first = (await h.call('GET', `${C}/patch-sets/1/files`)).json
    expect(first.files[0].content).not.toBe(refs.content)
  })

  test('a change that came without its files says so', async () => {
    const h = harness()
    const r = await h.call(
      'GET',
      '/repos/dana/gitfs/changes/210/patch-sets/1/files',
    )
    expect(r.json).toMatchObject({ available: false, files: [] })
    expect((await h.call('GET', `${C}/patch-sets/9/files`)).status).toBe(404)
  })
})

describe('a patch set made from edited files', () => {
  const edit = (contents: string) => ({
    body: {
      note: 'Applied F-2',
      files: { 'src/refs.rs': contents },
    },
  })

  test('is the head with the edit on top, counted against the base', async () => {
    const h = harness()
    const head = (await h.call('GET', `${C}/patch-sets/3/files`)).json
    const before = head.files.find(
      (f: { path: string }) => f.path === 'src/refs.rs',
    ).content as string
    const after = before.replace(
      '.or_else(|| self.neg.put(name))',
      '.or_else(|| self.neg.put_bounded(name, NEG_CACHE_MAX))',
    )
    const made = await h.call('POST', `${C}/patch-sets`, edit(after))
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ number: 4, note: 'Applied F-2' })
    expect(made.json.sha).toMatch(/^[0-9a-f]{40}$/)
    const files = (await h.call('GET', `${C}/patch-sets/4/files`)).json.files
    expect(
      files.find((f: { path: string }) => f.path === 'src/refs.rs').content,
    ).toBe(after)
    // The test file was not edited and is carried over.
    expect(
      files.find((f: { path: string }) => f.path === 'tests/refs_test.rs')
        .content,
    ).toContain('lookup_reads_disk_once')
    const change = (await h.call('GET', C)).json
    expect(change.head.patch_set).toBe(4)
    // The code changed, so earlier approvals no longer count for the head.
    expect(
      change.reviewers.every(
        (r: { carries_to_head: boolean }) => !r.carries_to_head,
      ),
    ).toBe(true)
  })

  test('the same edit names the same commit', async () => {
    const a = harness()
    const b = harness()
    const x = await a.call('POST', `${C}/patch-sets`, edit('fn main() {}\n'))
    const y = await b.call('POST', `${C}/patch-sets`, edit('fn main() {}\n'))
    expect(x.json.sha).toBe(y.json.sha)
  })

  test('only files the change touches', async () => {
    const h = harness()
    const r = await h.call('POST', `${C}/patch-sets`, {
      body: { files: { 'src/other.rs': 'x' } },
    })
    expect(r.status).toBe(400)
    expect(r.json.errors[0].code).toBe('not_in_change')
  })

  test('needs the files to edit, and a commit or files to send', async () => {
    const h = harness()
    const none = await h.call(
      'POST',
      '/repos/dana/gitfs/changes/218/patch-sets',
      { body: { files: { 'src/refs.rs': 'x' } } },
    )
    expect(none.status).toBe(409)
    expect(none.json.code).toBe('invalid_state')
    const empty = await h.call('POST', `${C}/patch-sets`, { body: {} })
    expect(empty.status).toBe(400)
  })

  test('a dry run saves nothing', async () => {
    const h = harness()
    const r = await h.call(
      'POST',
      `${C}/patch-sets?dry_run=true`,
      edit('fn main() {}\n'),
    )
    expect(r.json.number).toBe(4)
    expect((await h.call('GET', C)).json.head.patch_set).toBe(3)
  })

  test('only people who can change the repository', async () => {
    const h = harness()
    const r = await h.call('POST', `${C}/patch-sets`, {
      token: sampleTokens.stranger,
      ...edit('x'),
    })
    expect(r.status).toBe(403)
  })
})

describe('findings and checks carry what the review screen shows', () => {
  test('a finding has its suggestion and a prompt for an agent', async () => {
    const h = harness()
    const list = (await h.call('GET', `${C}/findings`)).json.data
    const f2 = list.find((f: { label: string }) => f.label === 'F-2')
    expect(f2.suggestion).toMatchObject({
      file: 'src/refs.rs',
      replace: ['            .or_else(|| self.neg.put(name))'],
      after: null,
    })
    expect(f2.prompt).toContain('NEG_CACHE_MAX')
  })

  test('a check reports its test cases', async () => {
    const h = harness()
    const runs = (await h.call('GET', `${C}/checks`)).json.data
    expect(runs[0].cases[0]).toEqual({
      suite: 'refs',
      name: 'lookup_reads_disk_once',
      ms: 12,
      base: 'fail',
      head: 'pass',
    })
    const r = await h.call('POST', `${C}/checks`, {
      body: {
        key: 'ci/test',
        state: 'fail',
        tree: '9c4d7e1',
        cases: [
          { suite: 'refs', name: 'x', ms: 3, base: 'pass', head: 'fail' },
        ],
      },
    })
    expect(r.json.cases).toHaveLength(1)
    expect(r.json.state).toBe('fail')
  })
})
