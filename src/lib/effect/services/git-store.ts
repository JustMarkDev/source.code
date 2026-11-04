import { ApiError } from '@pierre/storage'
import { Context, Effect, Layer } from 'effect'
import { BackendUnavailable, NotFound } from '../errors'
import { RepoDirectory, RepoDirectoryLive } from './repo-directory'
import type { GitRepo } from '~/git'
import { getGitRepo } from '~/git'

/**
 * Access to a repository's git data. Swapping the fake store for code.storage
 * changes `getGitRepo` and nothing above this file.
 */
export class GitStore extends Context.Service<
  GitStore,
  {
    /** The git repo behind `handle/name`. */
    readonly open: (
      handle: string,
      name: string,
    ) => Effect.Effect<GitRepo, NotFound | BackendUnavailable>
  }
>()('app/GitStore') {}

export const GitStoreLive = Layer.effect(GitStore)(
  Effect.gen(function* () {
    const directory = yield* RepoDirectory
    return GitStore.of({
      open: Effect.fn('GitStore.open')(function* (handle, name) {
        const { storeId } = yield* directory.find(handle, name)
        return getGitRepo(storeId)
      }),
    })
  }),
).pipe(Layer.provide(RepoDirectoryLive))

/**
 * Run one call against the git store. A 404 from the store is `NotFound`,
 * anything else is `BackendUnavailable`.
 */
export const git = <TValue>(what: string, call: () => Promise<TValue>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof ApiError && cause.status === 404
        ? new NotFound({ what })
        : new BackendUnavailable({ service: 'git-store', cause }),
  })
