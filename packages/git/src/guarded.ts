import type { GitRepo } from './index'

/**
 * Every call to code.storage goes through here. It respects their limits and
 * says how they went:
 *
 *  - a `429` on a read waits for `Retry-After` (or backs off) and tries again,
 *    a few times at most;
 *  - a write is never retried blind: one that timed out may have gone through,
 *    and the caller checks the branch before trying again;
 *  - each call's time and each refusal are counted per repository, for the
 *    status page and for alerts when a repository nears the limit.
 */
export type StoreStats = {
  calls: number
  refused: number
  /** Milliseconds, the most recent last; at most 1,000. */
  latencies: Array<number>
}

export const storeStats = new Map<string, StoreStats>()

const READS = new Set([
  'listFiles',
  'getFileStream',
  'listCommits',
  'getCommit',
  'getCommitDiff',
])
const MAX_RETRIES = 3

function statsFor(id: string) {
  let s = storeStats.get(id)
  if (!s) storeStats.set(id, (s = { calls: 0, refused: 0, latencies: [] }))
  return s
}

/** How long a refusal says to wait, in milliseconds, or a backoff. */
function waitFor(e: unknown, attempt: number) {
  const h = (e as { headers?: Headers | Record<string, string> }).headers
  const raw = h instanceof Headers ? h.get('retry-after') : h?.['retry-after']
  const secs = raw ? Number(raw) : Number.NaN
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000)
  return Math.min(250 * 2 ** attempt, 5_000)
}

export function guarded(
  id: string,
  repo: GitRepo,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): GitRepo {
  return new Proxy(repo, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown
      if (typeof value !== 'function' || typeof key !== 'string') return value
      return async (...args: Array<unknown>) => {
        const s = statsFor(id)
        for (let attempt = 0; ; attempt++) {
          const started = performance.now()
          s.calls++
          try {
            return await (
              value as (...a: Array<unknown>) => Promise<unknown>
            ).apply(target, args)
          } catch (e) {
            const status = (e as { status?: number }).status
            if (status !== 429) throw e
            s.refused++
            if (!READS.has(key) || attempt >= MAX_RETRIES) throw e
            await sleep(waitFor(e, attempt))
          } finally {
            s.latencies.push(Math.round(performance.now() - started))
            if (s.latencies.length > 1000)
              s.latencies.splice(0, s.latencies.length - 1000)
          }
        }
      }
    },
  })
}
