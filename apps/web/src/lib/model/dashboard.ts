// What the dashboard shows for one account (`lib/dashboard.ts` builds it
// from the API's dashboard).
import type { LinkProps } from '@tanstack/react-router'
import type { Repo, Source } from './data'

export type Severity = 'stopped' | 'failing' | 'review' | 'assigned'

export type NeedsItem = {
  severity: Severity
  title: string
  where: string
  note: string
  age: string
  action: string
  link: LinkProps
}

/** Ordered by how much it costs to wait: lost sync, a red main, a review, a task. */

export type InProgress = {
  kind: 'agent' | 'change'
  title: string
  where: string
  status: string
  tone: 'info' | 'muted' | 'warning'
  detail: string
  link: LinkProps
}

/** Work that is moving without you. Nothing here needs a decision yet. */

export type ActivityKind = 'review' | 'release' | 'agent' | 'other'

export type Activity = {
  who: string
  did: string
  what: string
  where?: string
  when: string
  day: 'Today' | 'Yesterday' | 'Earlier this week'
  kind: ActivityKind
}

export type Health = {
  checks: 'passing' | 'failing'
  openChanges: number
  openIssues: number
  updated: string
}

/** Per-repository state for the list. Keyed by repository name. */

export type Mirror = {
  host: Extract<Source, 'github' | 'gitlab' | 'codeberg'>
  name: string
  state: 'synced' | 'stopped'
  note: string
}

type Series = { daily: Array<number>; total: number; change: number }

/** Everything the dashboard shows for one account. */
export type DashboardData = {
  /** No repositories yet: show how to start instead of empty charts. */
  empty: boolean
  needsYou: Array<NeedsItem>
  inProgress: Array<InProgress>
  activity: Array<Activity>
  repos: Array<Repo>
  health: Record<string, Health | undefined>
  mirrors: Array<Mirror>
  storage: { usedGb: number; limitGb: number }
  imported: number
  downloads: Series
  contributions: Omit<Series, 'daily'> & {
    daily: Array<{ label: string; value: number }>
    commits: number
    reviews: number
    changes: number
  }
  stars: { total: number; today: number }
}
