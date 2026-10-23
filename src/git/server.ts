import { createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { ApiError } from '@pierre/storage'
import { api } from '../../convex/_generated/api'
import { getGitRepo } from './index'

function str(d: unknown, key: string, optional = false): string | undefined {
  const value = (d as Record<string, unknown> | null)?.[key]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !value)
    throw new Error(`${key} must be a non-empty string`)
  return value
}

// The store id is resolved here, never taken from the client, so callers can only reach repos Convex knows about.
async function gitRepoFor(handle: string, name: string) {
  const url = import.meta.env.VITE_CONVEX_URL
  if (!url) throw new Error('VITE_CONVEX_URL is not set')
  const convex = new ConvexHttpClient(url)
  const repo = await convex.query(api.profiles.repo, { handle, name })
  if (!repo) throw notFound()
  return getGitRepo(repo.storeId)
}

export const getRepoTree = createServerFn({ method: 'GET' })
  .validator((d: { handle: string; repo: string; path?: string }) => ({
    handle: str(d, 'handle')!,
    repo: str(d, 'repo')!,
    path: str(d, 'path', true),
  }))
  .handler(async ({ data }) => {
    const git = await gitRepoFor(data.handle, data.repo)
    const [files, history] = await Promise.all([
      git.listFiles(),
      git.listCommits({ limit: 10 }),
    ])
    const path =
      data.path ??
      (files.paths.includes('README.md') ? 'README.md' : files.paths[0])
    const res = path ? await git.getFileStream({ path }) : undefined
    const file =
      path && res?.ok ? { name: path, contents: await res.text() } : null
    return { paths: files.paths, commits: history.commits, file }
  })

export const getCommitView = createServerFn({ method: 'GET' })
  .validator((d: { handle: string; repo: string; sha: string }) => ({
    handle: str(d, 'handle')!,
    repo: str(d, 'repo')!,
    sha: str(d, 'sha')!,
  }))
  .handler(async ({ data }) => {
    const git = await gitRepoFor(data.handle, data.repo)
    try {
      const [{ commit }, diff] = await Promise.all([
        git.getCommit({ sha: data.sha }),
        git.getCommitDiff({ sha: data.sha }),
      ])
      return { commit, diff }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw notFound()
      throw e
    }
  })
