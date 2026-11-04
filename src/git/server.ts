import { createServerFn } from '@tanstack/react-start'
import { Effect } from 'effect'
import { InvalidInput } from '~/lib/effect'
import { runServer } from '~/lib/effect/runtime'
import { GitStore, git } from '~/lib/effect/services/git-store'

const field = (d: unknown, key: string) =>
  (d as Record<string, unknown> | null)?.[key]

/** A required, non-empty string field from untrusted input. */
const required = (d: unknown, key: string) => {
  const value = field(d, key)
  return typeof value === 'string' && value
    ? Effect.succeed(value)
    : Effect.fail(new InvalidInput({ field: key }))
}

/** A string field that may be absent. */
const optional = (d: unknown, key: string) => {
  const value = field(d, key)
  return value === undefined
    ? Effect.succeed(undefined)
    : typeof value === 'string' && value
      ? Effect.succeed(value)
      : Effect.fail(new InvalidInput({ field: key }))
}

export const getRepoTree = createServerFn({ method: 'GET' })
  .validator((d: { handle: string; repo: string; path?: string }) => d)
  .handler(({ data }) =>
    runServer(
      Effect.gen(function* () {
        const handle = yield* required(data, 'handle')
        const name = yield* required(data, 'repo')
        const requested = yield* optional(data, 'path')

        const store = yield* GitStore
        const repo = yield* store.open(handle, name)

        const [files, history] = yield* Effect.all(
          [
            git('files', () => repo.listFiles()),
            git('history', () => repo.listCommits({ limit: 10 })),
          ],
          { concurrency: 'unbounded' },
        )
        const path =
          requested ??
          (files.paths.includes('README.md') ? 'README.md' : files.paths[0])
        const file = path
          ? yield* git(path, async () => {
              const res = await repo.getFileStream({ path })
              return res.ok ? { name: path, contents: await res.text() } : null
            })
          : null
        return { paths: files.paths, commits: history.commits, file }
      }),
    ),
  )

export const getCommitView = createServerFn({ method: 'GET' })
  .validator((d: { handle: string; repo: string; sha: string }) => d)
  .handler(({ data }) =>
    runServer(
      Effect.gen(function* () {
        const handle = yield* required(data, 'handle')
        const name = yield* required(data, 'repo')
        const sha = yield* required(data, 'sha')

        const store = yield* GitStore
        const repo = yield* store.open(handle, name)

        const [{ commit }, diff] = yield* Effect.all(
          [
            git(sha, () => repo.getCommit({ sha })),
            git(sha, () => repo.getCommitDiff({ sha })),
          ],
          { concurrency: 'unbounded' },
        )
        return { commit, diff }
      }),
    ),
  )
