import { createReadCache } from './cached'
import { fakeRepo } from './fake'
import type { Repo } from '@pierre/storage'

// The slice of code.storage the app depends on. Typed against the real SDK so the swap is one line.
export type GitRepo = Pick<
  Repo,
  'listFiles' | 'getFileStream' | 'listCommits' | 'getCommit' | 'getCommitDiff'
>

/**
 * Reads go through a cache: anything addressed by a full SHA is kept for good,
 * moving refs for a few seconds. Call `readCache.invalidate(storeId)` when a
 * push lands. See `cached.ts` for why.
 */
export const readCache = createReadCache()

// shortcut: in-memory fixtures; replace `fakeRepo(id)` with `new GitStorage({ name, key }).findOne({ id })` once code.storage is provisioned.
export function getGitRepo(id: string): GitRepo {
  return readCache.wrap(id, fakeRepo(id))
}
