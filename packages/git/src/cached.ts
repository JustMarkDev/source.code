import type { GitRepo } from './index'

/**
 * A read cache in front of the git store.
 *
 * Git objects never change: a commit, its diff and a file at a commit are the
 * same forever, so anything addressed by a full SHA is cached with no expiry.
 * Only what a moving ref points at (the default branch, a branch name) can go
 * stale, so that expires after `ttlMs` and `invalidate(id)` drops it at once
 * when a push lands.
 *
 * Why it exists: Code Storage bills outbound bytes and holds a repo hot while
 * it is used; Cloudflare Artifacts bills per operation. Either way the cheapest
 * read is the one that never reaches the store. Concurrent identical reads
 * share one call.
 *
 * Not cached: ephemeral reads, conditional requests (`headers`), and failed
 * file reads, so a 404 never sticks.
 */

/** A full object id. Short SHAs are not safe: they can become ambiguous as a repo grows. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

export type ReadCacheOptions = {
  /** How long a read that depends on a moving ref stays fresh. */
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

type Snapshot = {
  status: number
  headers: Array<[string, string]>
  body: ArrayBuffer
}

type Entry = { value: Promise<unknown>; expires: number | null }

export function createReadCache(opts: ReadCacheOptions = {}) {
  const ttlMs = opts.ttlMs ?? 15_000
  const maxEntries = opts.maxEntries ?? 500
  const now = opts.now ?? Date.now
  const entries = new Map<string, Entry>()
  const stats = { hits: 0, misses: 0 }

  const keyOf = (id: string, method: string, args: object) =>
    `${id}\u0000${method}\u0000${JSON.stringify(args)}`

  /** Run `load` once per key; `pinned` entries never expire. */
  function read<T>(key: string, pinned: boolean, load: () => Promise<T>) {
    const hit = entries.get(key)
    if (hit && (hit.expires === null || hit.expires > now())) {
      entries.delete(key) // re-insert: the map's order is the recency order
      entries.set(key, hit)
      stats.hits++
      return hit.value as Promise<T>
    }
    stats.misses++
    const value = load()
    entries.set(key, { value, expires: pinned ? null : now() + ttlMs })
    // A failed read must not stick.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key)
    })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
    return value
  }

  /** Cached JSON-like result. Callers get their own copy, so one cannot corrupt another's. */
  const data = <T>(
    id: string,
    method: string,
    args: object,
    pinned: boolean,
    load: () => Promise<T>,
  ) =>
    read(keyOf(id, method, args), pinned, load).then((v) => structuredClone(v))

  return {
    stats,
    /** Drop every moving-ref read for one repo. Call it when a push lands. */
    invalidate(id: string) {
      for (const [key, entry] of entries)
        if (key.startsWith(`${id}\u0000`) && entry.expires !== null)
          entries.delete(key)
    },
    /** Drop everything for one repo, including pinned reads (the repo was deleted or rewritten). */
    purge(id: string) {
      for (const key of entries.keys())
        if (key.startsWith(`${id}\u0000`)) entries.delete(key)
    },
    wrap(id: string, repo: GitRepo): GitRepo {
      return {
        listFiles: (o) =>
          o?.ephemeral
            ? repo.listFiles(o)
            : data(
                id,
                'listFiles',
                { ref: o?.ref },
                FULL_SHA.test(o?.ref ?? ''),
                () => repo.listFiles(o),
              ),
        listCommits: (o) =>
          o?.ephemeral
            ? repo.listCommits(o)
            : data(
                id,
                'listCommits',
                {
                  branch: o?.branch,
                  cursor: o?.cursor,
                  limit: o?.limit,
                  path: o?.path,
                },
                false,
                () => repo.listCommits(o),
              ),
        getCommit: (o) =>
          data(id, 'getCommit', { sha: o.sha }, FULL_SHA.test(o.sha), () =>
            repo.getCommit(o),
          ),
        getCommitDiff: (o) =>
          data(
            id,
            'getCommitDiff',
            {
              sha: o.sha,
              baseSha: o.baseSha,
              gitApplyCompatible: o.gitApplyCompatible,
              paths: o.paths,
            },
            FULL_SHA.test(o.sha) && (!o.baseSha || FULL_SHA.test(o.baseSha)),
            () => repo.getCommitDiff(o),
          ),
        async getFileStream(o) {
          if (o.ephemeral || o.ephemeralBase || o.headers)
            return repo.getFileStream(o)
          const key = keyOf(id, 'getFileStream', { path: o.path, ref: o.ref })
          const snap = await read<Snapshot>(
            key,
            FULL_SHA.test(o.ref ?? ''),
            async () => {
              const res = await repo.getFileStream(o)
              return {
                status: res.status,
                headers: [...res.headers.entries()],
                body: await res.arrayBuffer(),
              }
            },
          )
          if (snap.status >= 400) entries.delete(key)
          return new Response(snap.body.slice(0), {
            status: snap.status,
            headers: snap.headers,
          })
        },
      }
    },
  }
}
