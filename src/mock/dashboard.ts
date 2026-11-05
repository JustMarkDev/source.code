// Mock data for the dashboard. Totals are computed from the series below so
// every number on the page agrees with the chart next to it.
import { ownerAsWritten, reposOwnedBy, seeded } from './data'
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
const personalNeeds: Array<NeedsItem> = [
  {
    severity: 'stopped',
    title: 'Mirror to GitLab stopped',
    where: 'dana/gitfs',
    note: 'The access token expired. 14 commits are waiting here and nothing is lost.',
    age: '2 days ago',
    action: 'Reconnect',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'settings' },
      search: { section: 'mirrors' },
    },
  },
  {
    severity: 'failing',
    title: 'Checks are failing on main',
    where: 'dana/gitfs · ci/test',
    note: 'windows-latest has failed on every run since 4b2907e.',
    age: '2 hours ago',
    action: 'See the run',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'pipelines' },
    },
  },
  {
    severity: 'review',
    title: 'Review: Cache negative ref lookups',
    where: 'dana/gitfs · #216',
    note: 'hollis approved. Greptile found 1 high finding: NegCache is unbounded.',
    age: '1 hour ago',
    action: 'Open change',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'changes' },
      search: { n: 1 },
    },
  },
  {
    severity: 'assigned',
    title: 'Panic on trailing-dot ref names',
    where: 'dana/gitfs · issue 4',
    note: 'Assigned to you. An agent could take this one.',
    age: '3 days ago',
    action: 'Open issue',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'issues' },
      search: { n: 4 },
    },
  },
]

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
const personalProgress: Array<InProgress> = [
  {
    kind: 'agent',
    title: 'Add an SSE transport to the mount daemon',
    where: 'dana/gitfs · #217',
    status: 'Agent working',
    tone: 'info',
    detail: 'claude via T3 Code · 12 min · 3 files · asks before it pushes',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'changes' },
      search: { n: 2 },
    },
  },
  {
    kind: 'change',
    title: 'Retry with jitter',
    where: 'dana/tinyqueue · #18',
    status: 'Waiting on ines',
    tone: 'muted',
    detail: '1 of 2 approvals · checks passed',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'tinyqueue', tab: 'changes' },
    },
  },
  {
    kind: 'change',
    title: 'Document the mount flags',
    where: 'dana/gitfs · #219',
    status: 'Checks running',
    tone: 'warning',
    detail: 'ci/test · 3 of 4 jobs done',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'changes' },
      search: { n: 3 },
    },
  },
]

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

const personalActivity: Array<Activity> = [
  {
    who: 'hollis',
    did: 'approved',
    what: '#216',
    where: 'dana/gitfs',
    when: '1 hour ago',
    day: 'Today',
    kind: 'review',
  },
  {
    who: 'greptile',
    did: 'found 1 high issue in',
    what: '#216',
    where: 'dana/gitfs',
    when: '1 hour ago',
    day: 'Today',
    kind: 'review',
  },
  {
    who: 'claude via T3 Code',
    did: 'opened a draft',
    what: '#217',
    where: 'dana/gitfs',
    when: '3 hours ago',
    day: 'Today',
    kind: 'agent',
  },
  {
    who: 'ines',
    did: 'starred',
    what: 'dana/gitfs',
    when: 'yesterday',
    day: 'Yesterday',
    kind: 'other',
  },
  {
    who: 'hollis',
    did: 'released',
    what: 'v2.4.1',
    where: 'hollis/lumen',
    when: 'yesterday',
    day: 'Yesterday',
    kind: 'release',
  },
  {
    who: 'claude via T3 Code',
    did: 'finished a session on',
    what: '#219',
    where: 'dana/gitfs',
    when: 'yesterday',
    day: 'Yesterday',
    kind: 'agent',
  },
  {
    who: 'ines',
    did: 'released',
    what: 'v1.12.0',
    where: 'ines/tern',
    when: '4 days ago',
    day: 'Earlier this week',
    kind: 'release',
  },
  {
    who: 'hollis',
    did: 'opened an issue on',
    what: 'dana/tinyqueue',
    when: '4 days ago',
    day: 'Earlier this week',
    kind: 'other',
  },
]

export type Health = {
  checks: 'passing' | 'failing'
  openChanges: number
  openIssues: number
  updated: string
}

/** Per-repository state for the list. Keyed by repository name. */
const personalHealth: Record<string, Health | undefined> = {
  gitfs: {
    checks: 'failing',
    openChanges: 5,
    openIssues: 5,
    updated: '2 hours ago',
  },
  tinyqueue: {
    checks: 'passing',
    openChanges: 1,
    openIssues: 3,
    updated: 'yesterday',
  },
}

export type Mirror = {
  host: Extract<Source, 'github' | 'gitlab' | 'codeberg'>
  name: string
  state: 'synced' | 'stopped'
  note: string
}

const personalMirrors: Array<Mirror> = [
  {
    host: 'gitlab',
    name: 'GitLab',
    state: 'stopped',
    note: 'Token expired · 14 commits waiting',
  },
  {
    host: 'github',
    name: 'GitHub',
    state: 'synced',
    note: 'Synced 14 minutes ago',
  },
  {
    host: 'codeberg',
    name: 'Codeberg',
    state: 'synced',
    note: 'Synced 1 hour ago',
  },
]

const personalStorage = { usedGb: 1.8, limitGb: 5 }
const personalImported = 2410

// ---------------------------------------------------------------------------
// Series. Two periods each, so a change against the last period is real.

function series(seed: number, length: number, base: number, wave: number) {
  const rand = seeded(seed)
  return Array.from({ length }, (_, i) =>
    Math.max(
      1,
      Math.round(
        base + rand() * wave + Math.sin(i / 3) * (wave / 3) + i * (base / 90),
      ),
    ),
  )
}

const sum = (xs: Array<number>) => xs.reduce((a, b) => a + b, 0)
const change = (now: number, before: number) =>
  Math.round(((now - before) / before) * 100)

function downloadsFrom(seed: number, base: number, wave: number) {
  const days = series(seed, 60, base, wave)
  const now = days.slice(30)
  return {
    daily: now,
    total: sum(now),
    change: change(sum(now), sum(days.slice(0, 30))),
  }
}

function contributionsFrom(seed: number, base: number, wave: number) {
  const days = series(seed, 56, base, wave)
  const now = days.slice(28)
  const total = sum(now)
  const commits = Math.round(total * 0.6)
  const reviews = Math.round(total * 0.3)
  return {
    daily: now.map((value, i) => ({ label: `Day ${i + 1}`, value })),
    total,
    change: change(total, sum(days.slice(0, 28))),
    // How the work splits. Rounded so the three always add up.
    commits,
    reviews,
    issues: total - commits - reviews,
  }
}

const starsOf = (owned: Array<Repo>) => ({
  total: owned.reduce((n, r) => n + r.stars, 0),
  today: owned.reduce((n, r) => n + r.starsToday, 0),
})

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
  downloads: ReturnType<typeof downloadsFrom>
  contributions: ReturnType<typeof contributionsFrom>
  stars: { total: number; today: number }
}

const personalOwned = reposOwnedBy('dana')
const personal: DashboardData = {
  empty: false,
  needsYou: personalNeeds,
  inProgress: personalProgress,
  activity: personalActivity,
  repos: personalOwned,
  health: personalHealth,
  mirrors: personalMirrors,
  storage: personalStorage,
  imported: personalImported,
  downloads: downloadsFrom(7, 300, 260),
  contributions: contributionsFrom(42, 4, 18),
  stars: starsOf(personalOwned),
}

const relayLink = (tab: string, n?: number): LinkProps => ({
  to: '/$handle/$repo/$tab',
  params: { handle: 'northwind', repo: 'relay', tab },
  ...(n !== undefined && { search: { n } }),
})

const northwindOwned = reposOwnedBy('northwind')
const northwind: DashboardData = {
  empty: false,
  needsYou: [
    {
      severity: 'failing',
      title: 'Checks are failing on main',
      where: 'northwind/relay · ci/integration',
      note: 'The postgres service container did not start on the last 2 runs.',
      age: '40 minutes ago',
      action: 'See the run',
      link: relayLink('pipelines'),
    },
    {
      severity: 'review',
      title: 'Review: Bound the replay window',
      where: 'northwind/relay · #88',
      note: 'ines asked for changes. 2 comments are unresolved.',
      age: '3 hours ago',
      action: 'Open change',
      link: relayLink('changes', 1),
    },
  ],
  inProgress: [
    {
      kind: 'agent',
      title: 'Add backpressure to the consumer loop',
      where: 'northwind/relay · #89',
      status: 'Agent working',
      tone: 'info',
      detail: 'codex via boat.dev · 6 min · 2 files · asks before it pushes',
      link: relayLink('changes', 2),
    },
    {
      kind: 'change',
      title: 'Document the delivery guarantees',
      where: 'northwind/relay · #90',
      status: 'Waiting on hollis',
      tone: 'muted',
      detail: '0 of 1 approvals · checks passed',
      link: relayLink('changes', 3),
    },
  ],
  activity: [
    {
      who: 'ines',
      did: 'asked for changes on',
      what: '#88',
      where: 'northwind/relay',
      when: '3 hours ago',
      day: 'Today',
      kind: 'review',
    },
    {
      who: 'codex via boat.dev',
      did: 'opened a draft',
      what: '#89',
      where: 'northwind/relay',
      when: '6 hours ago',
      day: 'Today',
      kind: 'agent',
    },
    {
      who: 'hollis',
      did: 'released',
      what: 'v0.4.2',
      where: 'northwind/relay',
      when: 'yesterday',
      day: 'Yesterday',
      kind: 'release',
    },
    {
      who: 'dana',
      did: 'merged',
      what: '#91',
      where: 'northwind/relay',
      when: '3 days ago',
      day: 'Earlier this week',
      kind: 'review',
    },
  ],
  repos: northwindOwned,
  health: {
    relay: {
      checks: 'failing',
      openChanges: 3,
      openIssues: 2,
      updated: '1 day ago',
    },
  },
  mirrors: [],
  storage: { usedGb: 0.4, limitGb: 5 },
  imported: 0,
  downloads: downloadsFrom(11, 80, 70),
  contributions: contributionsFrom(5, 3, 12),
  stars: starsOf(northwindOwned),
}

const emptyData = (): DashboardData => ({
  empty: true,
  needsYou: [],
  inProgress: [],
  activity: [],
  repos: [],
  health: {},
  mirrors: [],
  storage: { usedGb: 0, limitGb: 5 },
  imported: 0,
  downloads: { daily: [], total: 0, change: 0 },
  contributions: {
    daily: [],
    total: 0,
    change: 0,
    commits: 0,
    reviews: 0,
    issues: 0,
  },
  stars: { total: 0, today: 0 },
})
const empty = emptyData()

/**
 * The dashboard of an account. The sample people and the sample organization
 * have full ones; any account made in the browser starts empty, because it
 * has done nothing yet.
 */
export function dashboardFor(handle: string): DashboardData {
  const written = ownerAsWritten(handle)
  if (written === 'dana') return personal
  if (written === 'northwind') return northwind
  return empty
}
