import { describe, expect, test } from 'bun:test'
import { ApiError } from '@pierre/storage'
import { createReadCache } from './cached'
import { fakeRepo } from './fake'
import type { GitRepo } from './index'

/** The fake store with a counter on every call that reaches it. */
function counted(id: string) {
  const inner = fakeRepo(id)
  const calls = { total: 0 }
  const count =
    <TArgs extends Array<unknown>, TResult>(fn: (...a: TArgs) => TResult) =>
    (...a: TArgs): TResult => {
      calls.total++
      return fn(...a)
    }
  const repo: GitRepo = {
    listFiles: count(inner.listFiles.bind(inner)),
    listCommits: count(inner.listCommits.bind(inner)),
    getCommit: count(inner.getCommit.bind(inner)),
    getCommitDiff: count(inner.getCommitDiff.bind(inner)),
    getFileStream: count(inner.getFileStream.bind(inner)),
  }
  return { repo, calls, inner }
}

function clock() {
  let t = 1_000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('reads addressed by a full SHA', () => {
  test('are fetched once, and never expire', async () => {
    const c = clock()
    const cache = createReadCache({ ttlMs: 1_000, now: c.now })
    const { repo, calls, inner } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    const { commits } = await inner.listCommits()
    const sha = commits[0].sha
    expect(sha).toHaveLength(40)

    const a = await cached.getCommit({ sha })
    c.advance(24 * 60 * 60 * 1000)
    const b = await cached.getCommit({ sha })
    await cached.getCommitDiff({ sha })
    await cached.getCommitDiff({ sha })
    expect(b).toEqual(a)
    expect(calls.total).toBe(2)
    expect(cache.stats.hits).toBe(2)
  })

  test('a file at a commit is read once and can be read as many times as asked', async () => {
    const cache = createReadCache()
    const { repo, calls, inner } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    const sha = (await inner.listCommits()).commits[0].sha

    const first = await cached.getFileStream({ path: 'README.md', ref: sha })
    const second = await cached.getFileStream({ path: 'README.md', ref: sha })
    expect(await first.text()).toBe(await second.text())
    expect(calls.total).toBe(1)
  })

  test('callers get their own copy: changing one result does not change the next', async () => {
    const cache = createReadCache()
    const { repo, inner } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    const sha = (await inner.listCommits()).commits[0].sha
    const a = await cached.getCommit({ sha })
    a.commit.message = 'tampered'
    expect((await cached.getCommit({ sha })).commit.message).not.toBe(
      'tampered',
    )
  })
})

describe('reads that depend on a moving ref', () => {
  test('are cached for the ttl, then fetched again', async () => {
    const c = clock()
    const cache = createReadCache({ ttlMs: 1_000, now: c.now })
    const { repo, calls } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)

    await cached.listCommits({ limit: 10 })
    await cached.listCommits({ limit: 10 })
    expect(calls.total).toBe(1)
    c.advance(1_001)
    await cached.listCommits({ limit: 10 })
    expect(calls.total).toBe(2)
  })

  test('a short SHA is not treated as permanent', async () => {
    const c = clock()
    const cache = createReadCache({ ttlMs: 1_000, now: c.now })
    const { repo, calls, inner } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    const short = (await inner.listCommits()).commits[2].sha.slice(0, 7)

    await cached.listFiles({ ref: short })
    c.advance(1_001)
    await cached.listFiles({ ref: short })
    expect(calls.total).toBe(2)
  })

  test('invalidate drops them for one repo and leaves pinned reads and other repos alone', async () => {
    const cache = createReadCache()
    const a = counted('tinyqueue')
    const b = counted('gitfs')
    const repoA = cache.wrap('tinyqueue', a.repo)
    const repoB = cache.wrap('gitfs', b.repo)
    const sha = (await a.inner.listCommits()).commits[0].sha

    await repoA.listCommits()
    await repoA.getCommit({ sha })
    await repoB.listCommits()
    cache.invalidate('tinyqueue')

    await repoA.listCommits()
    await repoA.getCommit({ sha })
    await repoB.listCommits()
    expect(a.calls.total).toBe(3) // listCommits twice, getCommit once
    expect(b.calls.total).toBe(1)
  })
})

describe('sharing and failure', () => {
  test('concurrent identical reads share one call', async () => {
    const cache = createReadCache()
    const { repo, calls } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    await Promise.all([
      cached.listFiles(),
      cached.listFiles(),
      cached.listFiles(),
    ])
    expect(calls.total).toBe(1)
  })

  test('a missing file is not remembered', async () => {
    const cache = createReadCache()
    const { repo, calls } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    expect((await cached.getFileStream({ path: 'nope' })).status).toBe(404)
    expect((await cached.getFileStream({ path: 'nope' })).status).toBe(404)
    expect(calls.total).toBe(2)
  })

  test('an unknown ref still fails like the real SDK, and is not remembered', async () => {
    const cache = createReadCache()
    const { repo, calls } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    for (let i = 0; i < 2; i++) {
      const err = await cached
        .getCommit({ sha: 'deadbeef' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
    }
    expect(calls.total).toBe(2)
  })

  test('the oldest entry goes first when the cache is full', async () => {
    const cache = createReadCache({ maxEntries: 2 })
    const { repo, calls } = counted('tinyqueue')
    const cached = cache.wrap('tinyqueue', repo)
    await cached.listCommits({ limit: 1 })
    await cached.listCommits({ limit: 2 })
    await cached.listCommits({ limit: 3 })
    await cached.listCommits({ limit: 1 }) // was evicted
    expect(calls.total).toBe(4)
  })
})

test('a page view that reads the same repo twice costs one set of store calls', async () => {
  // What the repo page does: files + history + a file, then the same again.
  const cache = createReadCache()
  const { repo, calls, inner } = counted('tinyqueue')
  const cached = cache.wrap('tinyqueue', repo)
  const sha = (await inner.listCommits()).commits[0].sha
  const view = () =>
    Promise.all([
      cached.listFiles({ ref: sha }),
      cached.listCommits({ limit: 10 }),
      cached.getFileStream({ path: 'README.md', ref: sha }),
    ])
  await view()
  const after = calls.total
  for (let i = 0; i < 20; i++) await view()
  expect(after).toBe(3)
  expect(calls.total).toBe(3)
})
