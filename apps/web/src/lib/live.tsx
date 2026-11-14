import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Query } from '@tanstack/react-query'

/**
 * Keeps what is on screen current. The page's reads are named by their query
 * keys (`['sx', id, input]`), and their inputs say which repository or
 * account each is about. One live Convex query watches just those, and the
 * viewer's own things; when one moves, only the reads about it are fetched
 * again. A write in one repository does not make every open page read
 * everything again.
 */
type Scope = { repos: Array<string>; accounts: Array<string> }
type Watched = {
  repos: Record<string, number>
  accounts: Record<string, number>
  me: string
}

const inputOf = (q: Pick<Query, 'queryKey'>) => {
  const [root, , input] = q.queryKey
  if (root !== 'sx' || !input || typeof input !== 'object') return null
  return input as Record<string, unknown>
}

/** The repository a read is about, as `owner/name`, lowercase. */
const repoOf = (input: Record<string, unknown>) =>
  typeof input.owner === 'string' && typeof input.repo === 'string'
    ? `${input.owner}/${input.repo}`.toLowerCase()
    : null

/** The account a read is about, when it is about no repository. */
const accountOf = (input: Record<string, unknown>) =>
  typeof input.handle === 'string'
    ? input.handle
    : typeof input.owner === 'string' && typeof input.repo !== 'string'
      ? input.owner
      : typeof input.org === 'string'
        ? input.org
        : null

function scopeOf(all: ReadonlyArray<Pick<Query, 'queryKey'>>): Scope {
  const repos = new Set<string>()
  const accounts = new Set<string>()
  for (const q of all) {
    const input = inputOf(q)
    if (!input) continue
    const r = repoOf(input)
    if (r) repos.add(r)
    else {
      const a = accountOf(input)
      if (a) accounts.add(a)
    }
  }
  return { repos: [...repos].sort(), accounts: [...accounts].sort() }
}

const same = (a: Scope, b: Scope) =>
  a.repos.join() === b.repos.join() && a.accounts.join() === b.accounts.join()

export function LiveForge() {
  const queries = useQueryClient()
  const [scope, setScope] = React.useState<Scope>({ repos: [], accounts: [] })
  React.useEffect(() => {
    const cache = queries.getQueryCache()
    let timer: ReturnType<typeof setTimeout> | undefined
    const compute = () => {
      const next = scopeOf(cache.getAll())
      setScope((prev) => (same(prev, next) ? prev : next))
    }
    compute()
    const stop = cache.subscribe((e) => {
      if (e.type !== 'added' && e.type !== 'removed') return
      clearTimeout(timer)
      timer = setTimeout(compute, 100)
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [queries])

  const live = useQuery(api.forge.live.watch, scope)
  const seen = React.useRef<Watched | undefined>(undefined)
  React.useEffect(() => {
    if (live === undefined) return
    const before = seen.current
    seen.current = live
    if (!before) return
    const moved = (was: Record<string, number>, now: Record<string, number>) =>
      new Set(Object.keys(now).filter((k) => k in was && was[k] !== now[k]))
    const repos = moved(before.repos, live.repos)
    const accounts = moved(before.accounts, live.accounts)
    const me = before.me !== live.me
    if (!repos.size && !accounts.size && !me) return
    void queries.invalidateQueries({
      predicate: (q) => {
        const input = inputOf(q)
        if (!input) return false
        const r = repoOf(input)
        if (r) return repos.has(r)
        const a = accountOf(input)
        if (a && accounts.has(a)) return true
        // A read about no one place (the dashboard, notifications) follows
        // the viewer, and anything the page watches.
        return me || (!a && (repos.size > 0 || accounts.size > 0))
      },
    })
  }, [live, queries])
  return null
}
