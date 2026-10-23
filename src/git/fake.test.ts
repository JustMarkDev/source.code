import { expect, test } from 'bun:test'
import { parsePatchFiles } from '@pierre/diffs'
import { ApiError } from '@pierre/storage'
import { getGitRepo } from './index'

test('fake repo walks history and produces patches Pierre can parse', async () => {
  const repo = getGitRepo('tinyqueue')
  const { commits } = await repo.listCommits()
  expect(commits.map((c) => c.message)).toEqual([
    'Document retries',
    'Retry failed jobs with backoff',
    'Initial commit',
  ])

  const diff = await repo.getCommitDiff({ sha: commits[1].sha })
  expect(diff.files.map((f) => [f.path, f.state])).toEqual([
    ['src/index.ts', 'modified'],
    ['src/retry.ts', 'added'],
  ])
  const parsed = parsePatchFiles(diff.files.map((f) => f.raw).join(''))
  expect(parsed[0].files.map((f) => f.name)).toEqual([
    'src/index.ts',
    'src/retry.ts',
  ])

  const old = await repo.listFiles({ ref: commits[2].sha.slice(0, 7) })
  expect(old.paths).not.toContain('src/retry.ts')
  expect((await repo.getFileStream({ path: 'missing' })).status).toBe(404)
})

test('unknown refs fail like the real SDK', async () => {
  const err = await getGitRepo('tinyqueue')
    .getCommit({ sha: 'deadbeef' })
    .catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).status).toBe(404)
})
