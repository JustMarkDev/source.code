import { getGitRepo } from '../../git'
import { apiError } from './problem'
import type { GitRepo } from '../../git'

/**
 * What the API reads from git. It is the slice of the git store the app already
 * uses (`src/git`), so the fake store in the preview and code.storage later sit
 * behind the same four calls.
 */
export type GitCommit = {
  sha: string
  parents: Array<string>
  message: string
  author: { name: string; email: string }
  committer: { name: string; email: string }
  date: string
}

export type GitDiffFile = { path: string; state: 'added' | 'modified' | 'deleted'; additions: number; deletions: number; patch: string }

export interface GitData {
  /** Every file path at `ref`, with the commit it was resolved to. */
  files: (repo: string, ref?: string) => Promise<{ ref: string; paths: Array<string> }>
  blob: (repo: string, path: string, ref?: string) => Promise<Uint8Array | null>
  /** Newest first. */
  commits: (repo: string, limit: number) => Promise<Array<GitCommit>>
  commit: (repo: string, sha: string) => Promise<GitCommit>
  diff: (repo: string, sha: string) => Promise<{ sha: string; base: string | null; files: Array<GitDiffFile> }>
  /** Point an address at an immutable git store id, when the implementation has one. */
  setRepo?: (repo: string, storeId: string) => void
  /** Forget an address whose repository is gone. */
  dropRepo?: (repo: string) => void
}

const commitOf = (c: {
  sha: string
  parentShas: Array<string>
  message: string
  authorName: string
  authorEmail: string
  committerName: string
  committerEmail: string
  date: Date
}): GitCommit => ({
  sha: c.sha,
  parents: c.parentShas,
  message: c.message,
  author: { name: c.authorName, email: c.authorEmail },
  committer: { name: c.committerName, email: c.committerEmail },
  date: c.date.toISOString(),
})

/** A missing ref, file or commit in the store is a 404; anything else is ours to report. */
async function guarded<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 404) throw apiError('not_found', `${what} was not found.`)
    throw e
  }
}

/** The store behind `src/git`. A repository's store id is its name until the directory says otherwise. */
export class StoreGit implements GitData {
  private readonly stores = new Map<string, string>()
  constructor(private readonly open: (storeId: string) => GitRepo = getGitRepo) {}

  setRepo(repo: string, storeId: string) {
    this.stores.set(repo.toLowerCase(), storeId)
  }

  dropRepo(repo: string) {
    this.stores.delete(repo.toLowerCase())
  }

  private repo(full: string) {
    return this.open(this.stores.get(full.toLowerCase()) ?? full.split('/')[1])
  }

  files(repo: string, ref?: string) {
    return guarded(`The ref ${ref ?? 'main'}`, async () => {
      const r = await this.repo(repo).listFiles({ ref })
      return { ref: r.ref, paths: r.paths }
    })
  }

  blob(repo: string, path: string, ref?: string) {
    return guarded(`${path} at ${ref ?? 'main'}`, async () => {
      const res = await this.repo(repo).getFileStream({ path, ref })
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    })
  }

  commits(repo: string, limit: number) {
    return guarded('The history', async () => (await this.repo(repo).listCommits({ limit })).commits.map(commitOf))
  }

  commit(repo: string, sha: string) {
    return guarded(`Commit ${sha}`, async () => commitOf((await this.repo(repo).getCommit({ sha })).commit))
  }

  diff(repo: string, sha: string) {
    return guarded(`Commit ${sha}`, async () => {
      const d = await this.repo(repo).getCommitDiff({ sha })
      return {
        sha: d.sha,
        base: d.baseSha ?? null,
        files: d.files.map((f) => ({
          path: f.path,
          state: f.state as GitDiffFile['state'],
          additions: f.additions,
          deletions: f.deletions,
          patch: f.raw,
        })),
      }
    })
  }
}
