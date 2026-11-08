// Mock data for integrations and mirrors. Nothing here talks to a backend.
// Taglines describe what each vendor says it does; how each one reports back
// to a host is not documented for every vendor, so the app treats results as
// "comments and checks on a change" and nothing more specific.

import * as React from 'react'
import type { BrandId } from '~/components/brand'
import type { Repo } from '~/mock/data'

export type IntegrationGroup =
  | 'review'
  | 'runners'
  | 'environments'
  | 'secrets'
  | 'planning'

/** `available` works today. `planned` is on the roadmap and cannot be connected yet. */
export type IntegrationStatus = 'available' | 'planned'

export type Integration = {
  id: BrandId | 'selfhosted' | 'selfhostedreviewer'
  group: IntegrationGroup
  status: IntegrationStatus
  tagline: string
  does: Array<string>
  /** What it is allowed to do once connected, in plain words. */
  access: Array<string>
  /** Needs a key or address rather than a sign-in. */
  credential?: { label: string; placeholder: string }
}

export const groups: Record<
  IntegrationGroup,
  { title: string; blurb: string; repoHint: string }
> = {
  review: {
    title: 'Code review',
    blurb: 'AI reviewers that comment on every change.',
    repoHint: 'Reviews each change in this repository.',
  },
  runners: {
    title: 'Runners',
    blurb:
      'Where your workflows run. source.code does not host runners; bring the ones you like.',
    repoHint: 'Runs this repository’s workflow jobs.',
  },
  environments: {
    title: 'Agent environments',
    blurb: 'Places where an agent can check out the code and do the work.',
    repoHint: 'Offered in “Work with an agent” on issues and changes.',
  },
  secrets: {
    title: 'Secrets and config',
    blurb: 'Where values live, and how the schema is checked.',
    repoHint: 'Used by this repository’s secrets and env schema.',
  },
  planning: {
    title: 'Planning and monitoring',
    blurb: 'Keep issues and errors in step with your changes.',
    repoHint: 'Links issues and errors to changes here.',
  },
}

export const catalog: Array<Integration> = [
  {
    id: 'greptile',
    group: 'review',
    status: 'planned',
    tagline: 'Reviews with an index of the whole repository.',
    does: ['Cross-file findings', 'Uses repo-wide context'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'macroscope',
    group: 'review',
    status: 'planned',
    tagline: 'Bug findings and plain-language change summaries.',
    does: ['Bug findings', 'Change summaries'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'coderabbit',
    group: 'review',
    status: 'available',
    tagline: 'Line-by-line review of each change, with a summary.',
    does: ['Comments on diff lines', 'Summarizes the change'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'bugbot',
    group: 'review',
    status: 'planned',
    tagline: 'Looks for bugs in changes before they land.',
    does: ['Bug findings'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'claudereview',
    group: 'review',
    status: 'planned',
    tagline: 'Anthropic’s code review for teams (research preview).',
    does: ['Review comments'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'qodo',
    group: 'review',
    status: 'planned',
    tagline: 'Review and test suggestions on each change.',
    does: ['Review comments', 'Test suggestions'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'selfhostedreviewer',
    group: 'review',
    status: 'available',
    tagline:
      'Your own AI reviewer, any model or tool, registered with a token.',
    does: ['Any model or tool you run', 'Posts findings through the API'],
    access: ['Read code and changes', 'Comment on changes'],
  },
  {
    id: 'blacksmith',
    group: 'runners',
    status: 'available',
    tagline: 'Faster hosted runners. Change one label to switch.',
    does: ['Hosted Linux runners', 'Cache next to the runner'],
    access: ['Read workflows', 'Report check results'],
  },
  {
    id: 'namespace',
    group: 'runners',
    status: 'planned',
    tagline: 'Runners with persistent cache volumes and remote builders.',
    does: ['Linux, macOS and Windows runners', 'Cache volumes'],
    access: ['Read workflows', 'Report check results'],
  },
  {
    id: 'depot',
    group: 'runners',
    status: 'planned',
    tagline: 'Hosted runners and fast container builds.',
    does: ['Hosted runners', 'Remote container builds'],
    access: ['Read workflows', 'Report check results'],
  },
  {
    id: 'warpbuild',
    group: 'runners',
    status: 'planned',
    tagline: 'Managed runners for Linux and macOS.',
    does: ['Hosted runners', 'Job observability'],
    access: ['Read workflows', 'Report check results'],
  },
  {
    id: 'selfhosted',
    group: 'runners',
    status: 'available',
    tagline: 'Your own machines, registered with a token.',
    does: ['Any machine you control'],
    access: ['Read workflows', 'Report check results'],
  },
  {
    id: 't3code',
    group: 'environments',
    status: 'available',
    tagline: 'Hand work to an agent on your own computer.',
    does: [
      'Start a thread from an issue or change',
      'Use your own agent logins',
    ],
    access: ['Your environment address', 'An access level you choose'],
    credential: { label: 'Environment address', placeholder: 'https://…' },
  },
  {
    id: 'boat',
    group: 'environments',
    status: 'available',
    tagline: 'Persistent Linux machines made for agents.',
    does: ['A clean machine per task', 'CLI, HTTP API and SDKs'],
    access: ['An API key', 'A spending limit'],
    credential: { label: 'API key', placeholder: 'boat_…' },
  },
  {
    id: 'e2b',
    group: 'environments',
    status: 'planned',
    tagline: 'Sandboxes for running agent-written code.',
    does: ['Isolated sandboxes', 'Broad framework support'],
    access: ['An API key', 'A spending limit'],
    credential: { label: 'API key', placeholder: 'e2b_…' },
  },
  {
    id: 'daytona',
    group: 'environments',
    status: 'planned',
    tagline: 'Fast-starting sandboxes with many SDK languages.',
    does: ['Fast starts', 'Optional GPU'],
    access: ['An API key', 'A spending limit'],
    credential: { label: 'API key', placeholder: 'dtn_…' },
  },
  {
    id: 'vercel',
    group: 'environments',
    status: 'planned',
    tagline: 'Sandboxes next to the apps you deploy on Vercel.',
    does: ['Firecracker microVMs', 'Billed on active time'],
    access: ['A token', 'A spending limit'],
    credential: { label: 'Token', placeholder: 'vrc_…' },
  },
  {
    id: 'cloudflare',
    group: 'environments',
    status: 'planned',
    tagline: 'Sandboxes built on Cloudflare Containers.',
    does: ['Runs close to Workers', 'Sleeps when idle'],
    access: ['A token', 'A spending limit'],
    credential: { label: 'API token', placeholder: 'cf_…' },
  },
  {
    id: 'varlock',
    group: 'secrets',
    status: 'available',
    tagline: 'A typed env schema, committed with the code.',
    does: ['Validates every environment', 'Shows variables without values'],
    access: ['Read the schema file'],
  },
  {
    id: 'linear',
    group: 'planning',
    status: 'planned',
    tagline: 'Link Linear issues to changes and move them as work lands.',
    does: ['Issue ↔ change links', 'Status follows the change'],
    access: ['Read and update issues'],
  },
  {
    id: 'sentry',
    group: 'planning',
    status: 'planned',
    tagline: 'Turn new errors into issues and link fixes back.',
    does: ['Errors become issues', 'Fixes link back'],
    access: ['Read projects and issues'],
  },
]

/**
 * The order a list is shown in. Connected services come first, then the ones
 * that work today, then the planned ones. Within each, the catalog order holds.
 */
export function sortIntegrations(
  list: ReadonlyArray<Integration>,
  connected: ReadonlySet<string>,
) {
  const rank = (i: Integration) =>
    connected.has(i.id) ? 0 : i.status === 'available' ? 1 : 2
  return list
    .map((i, n) => ({ i, n }))
    .sort((a, b) => rank(a.i) - rank(b.i) || a.n - b.n)
    .map(({ i }) => i)
}

/* A tiny external store so the account page and the repository page agree. */

type State = {
  connected: ReadonlySet<string>
  enabled: Readonly<Record<string, ReadonlySet<string>>>
}

let state: State = {
  connected: new Set(['coderabbit', 't3code', 'varlock', 'selfhosted']),
  enabled: {
    'dana/gitfs': new Set(['coderabbit', 't3code', 'varlock']),
  },
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const connections = {
  get: () => state,
  subscribe: (cb: () => void) => {
    listeners.add(cb)
    return () => void listeners.delete(cb)
  },
  connect(id: string, repo?: string) {
    const enabled = { ...state.enabled }
    if (repo) enabled[repo] = new Set([...(enabled[repo] ?? []), id])
    state = { connected: new Set([...state.connected, id]), enabled }
    emit()
  },
  disconnect(id: string) {
    const connected = new Set(state.connected)
    connected.delete(id)
    const enabled = Object.fromEntries(
      Object.entries(state.enabled).map(([k, v]) => {
        const next = new Set(v)
        next.delete(id)
        return [k, next]
      }),
    )
    state = { connected, enabled }
    emit()
  },
  setEnabled(repo: string, id: string, on: boolean) {
    const next = new Set(state.enabled[repo] ?? [])
    if (on) next.add(id)
    else next.delete(id)
    state = { ...state, enabled: { ...state.enabled, [repo]: next } }
    emit()
  },
}

export function useConnections() {
  return React.useSyncExternalStore(
    connections.subscribe,
    connections.get,
    connections.get,
  )
}

/* Mirrors: other hosts that keep a copy of a repository in step. */

export type Host =
  | 'github'
  | 'gitlab'
  | 'codeberg'
  | 'gitea'
  | 'bitbucket'
  | 'forgejo'
export type MirrorState = 'in-sync' | 'syncing' | 'behind' | 'failing'

export type Mirror = {
  id: string
  host: Host
  /** The repository on that host. */
  slug: string
  direction: 'two-way' | 'push' | 'pull'
  state: MirrorState
  last: string
  detail?: string
  /** What travels across. Git history always does. */
  carries: {
    issues: boolean
    changes: boolean
    releases: boolean
    wiki: boolean
  }
}

export const hostNames: Record<Host, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  codeberg: 'Codeberg',
  gitea: 'Gitea',
  bitbucket: 'Bitbucket',
  forgejo: 'Forgejo',
}

export function mirrorsFor(repo: Repo): Array<Mirror> {
  if (repo.owner !== 'dana') return []
  return [
    {
      id: 'm1',
      host: 'github',
      slug: `${repo.owner}/${repo.name}`,
      direction: 'two-way',
      state: 'in-sync',
      last: '2 minutes ago',
      carries: { issues: true, changes: true, releases: true, wiki: false },
    },
    {
      id: 'm2',
      host: 'gitlab',
      slug: `${repo.owner}-labs/${repo.name}`,
      direction: 'push',
      state: 'failing',
      last: '2 days ago',
      detail:
        'The access token expired. 14 commits are queued here and nothing is lost.',
      carries: { issues: false, changes: false, releases: true, wiki: false },
    },
    {
      id: 'm3',
      host: 'codeberg',
      slug: `${repo.owner}/${repo.name}`,
      direction: 'push',
      state: 'in-sync',
      last: '9 minutes ago',
      carries: { issues: false, changes: false, releases: true, wiki: false },
    },
  ]
}
