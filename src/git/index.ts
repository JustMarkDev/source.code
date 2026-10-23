import { fakeRepo } from './fake'
import type { Repo } from '@pierre/storage'

// The slice of code.storage the app depends on. Typed against the real SDK so the swap is one line.
export type GitRepo = Pick<
  Repo,
  'listFiles' | 'getFileStream' | 'listCommits' | 'getCommit' | 'getCommitDiff'
>

// shortcut: in-memory fixtures; replace with `new GitStorage({ name, key }).findOne({ id })` once code.storage is provisioned.
export function getGitRepo(id: string): GitRepo {
  return fakeRepo(id)
}
