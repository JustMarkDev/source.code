// How a change maps to a pull request or merge request on another host, and
// back. Pure functions and tables, no network: the sync worker and the screens
// both read from here, so what the UI says travels is what the mapping does.
//
// The rule behind every row: a host only ever sees what it has a place for.
// Anything it has no place for stays on source.code and is marked as native.

export type Host = 'github' | 'gitlab' | 'codeberg' | 'gitea'

export const hostName: Record<Host, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  codeberg: 'Codeberg',
  gitea: 'Gitea',
}

/** What each host calls it, and how it writes a reference to one. */
export const hostTerms: Record<
  Host,
  { unit: string; short: string; ref: (n: number) => string }
> = {
  github: { unit: 'pull request', short: 'PR', ref: (n) => `#${n}` },
  gitlab: { unit: 'merge request', short: 'MR', ref: (n) => `!${n}` },
  codeberg: { unit: 'pull request', short: 'PR', ref: (n) => `#${n}` },
  gitea: { unit: 'pull request', short: 'PR', ref: (n) => `#${n}` },
}

/** A host's draft marker: a real flag on GitHub, a title prefix elsewhere. */
export const draftMarker: Record<Host, { flag: true } | { prefix: string }> = {
  github: { flag: true },
  gitlab: { prefix: 'Draft: ' },
  codeberg: { prefix: 'WIP: ' },
  gitea: { prefix: 'WIP: ' },
}

export type ChangeState = 'open' | 'draft' | 'landed' | 'abandoned'
export type RemoteState = 'open' | 'draft' | 'merged' | 'closed'

const toRemoteState: Record<ChangeState, RemoteState> = {
  open: 'open',
  draft: 'draft',
  landed: 'merged',
  abandoned: 'closed',
}

const fromRemoteState: Record<RemoteState, ChangeState> = {
  open: 'open',
  draft: 'draft',
  merged: 'landed',
  closed: 'abandoned',
}

/** The host-neutral shape of a pull request or merge request. */
export type RemoteChange = {
  host: Host
  number: number
  title: string
  body: string
  state: RemoteState
  /** The branch the host sees. */
  headRef: string
  /** The branch it merges into. A stacked change targets its parent's branch. */
  baseRef: string
  headSha: string
}

/** What source.code keeps about a change. */
export type LocalChange = {
  /** The number people say: #216. One counter per repository, shared with issues. */
  number: number
  title: string
  body: string
  state: ChangeState
  /** Tree of the newest patch set. */
  headSha: string
  /** The branch it is pushed to on a host. Fixed when the change is opened. */
  branch: string
  /** The change this one is stacked on, if any. */
  parent?: { number: number; branch: string }
  baseBranch: string
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const MARKER = /<!--\s*source\.code:change=(\d+)(?:\s+ps=(\d+))?\s*-->/

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

/**
 * The branch a change is pushed to on a host: the number, then the title as it
 * was when the change was opened. It never changes after that, so a rename
 * does not break the link between the two sides.
 */
export const branchFor = (number: number, title: string) =>
  `sx/${number}${slug(title) ? `-${slug(title)}` : ''}`

/** Hidden footer that lets either side find the other after a rewrite. */
export function marker(number: number, patchSet: number) {
  return `<!-- source.code:change=${number} ps=${patchSet} -->`
}

/** The change number a remote body carries, if it came from here. */
export function readMarker(body: string) {
  const m = MARKER.exec(body)
  return m
    ? { number: Number(m[1]), patchSet: m[2] ? Number(m[2]) : undefined }
    : null
}

// ---------------------------------------------------------------------------
// Titles and drafts
// ---------------------------------------------------------------------------

const DRAFT_PREFIX = /^\s*(?:draft:|\[draft\]|wip:|\[wip\])\s*/i

export const stripDraft = (title: string) => title.replace(DRAFT_PREFIX, '')

export const isDraftTitle = (title: string) => DRAFT_PREFIX.test(title)

// ---------------------------------------------------------------------------
// Outgoing and incoming
// ---------------------------------------------------------------------------

/** What to open or update on the host for a change here. */
export function toRemote(
  change: LocalChange,
  host: Host,
  patchSet: number,
): Omit<RemoteChange, 'number'> {
  const state = toRemoteState[change.state]
  const draft = draftMarker[host]
  const asDraft = state === 'draft' && 'prefix' in draft
  return {
    host,
    title: asDraft ? `${draft.prefix}${change.title}` : change.title,
    body: `${change.body}\n\n${marker(change.number, patchSet)}`.trim(),
    state,
    headRef: change.branch,
    // Stacks have no field on any host. A chain of requests, each aimed at its
    // parent's branch, is the one thing all of them understand.
    baseRef: change.parent ? change.parent.branch : change.baseBranch,
    headSha: change.headSha,
  }
}

/**
 * A change seed from a request on the host. A request that came from here
 * carries its number. One opened there gets the next number in the repository,
 * which the caller allocates, so numbers never depend on a host.
 */
export function fromRemote(
  remote: RemoteChange,
  nextNumber: number,
): {
  number: number
  title: string
  body: string
  state: ChangeState
  /** True when the request was opened on the host, not here. */
  openedThere: boolean
} {
  const found = readMarker(remote.body)
  const state =
    remote.state === 'open' && isDraftTitle(remote.title)
      ? 'draft'
      : fromRemoteState[remote.state]
  return {
    number: found?.number ?? nextNumber,
    title: stripDraft(remote.title),
    body: remote.body.replace(MARKER, '').trim(),
    state,
    openedThere: !found,
  }
}

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

type Linked = Pick<RemoteChange, 'number' | 'headRef' | 'baseRef' | 'state'>

export type StackPlace = {
  number: number
  /** Position from the bottom, starting at 1. The bottom lands first. */
  index: number
  of: number
  /** The request this one is aimed at, if that is another request. */
  parent?: number
}

/**
 * Stacks as hosts express them: a request aimed at another request's branch.
 * Finished requests are left out, because a host re-aims their children at
 * the default branch once the parent is merged. A request with two children
 * is not a line, so the chain is cut there and each child starts its own.
 * Requests that stand alone are not stacks and are not returned.
 */
export function stacksFromRemotes(remotes: Array<Linked>) {
  const live = remotes
    .filter((r) => r.state === 'open' || r.state === 'draft')
    .sort((a, b) => a.number - b.number)
  const parentOf = (r: Linked) =>
    live.find((p) => p.number !== r.number && p.headRef === r.baseRef)
  const kids = (r: Linked) =>
    live.filter((c) => parentOf(c)?.number === r.number)

  const places = new Map<number, StackPlace>()
  const emit = (chain: Array<Linked>, forkedFrom?: number) => {
    if (chain.length < 2 && forkedFrom === undefined) return
    chain.forEach((r, i) =>
      places.set(r.number, {
        number: r.number,
        index: i + 1,
        of: chain.length,
        parent: i === 0 ? forkedFrom : chain[i - 1].number,
      }),
    )
  }
  const walk = (node: Linked, chain: Array<Linked>, forkedFrom?: number) => {
    chain.push(node)
    const next = kids(node)
    if (next.length === 1) return walk(next[0], chain, forkedFrom)
    emit(chain, forkedFrom)
    for (const k of next) walk(k, [], node.number)
  }
  for (const root of live.filter((r) => !parentOf(r))) walk(root, [])
  return places
}

/**
 * When a request is merged on the host, what its children should be aimed at
 * now, and whether their commits need rebasing. A squash or rebase merge
 * rewrites the parent's commits, so the child still carries the old ones:
 * it becomes a new patch set, rebased onto what landed.
 */
export function afterParentLands(
  landed: Pick<RemoteChange, 'headRef'>,
  children: Array<Pick<RemoteChange, 'number' | 'baseRef'>>,
  defaultBranch: string,
) {
  return children
    .filter((c) => c.baseRef === landed.headRef)
    .map((c) => ({
      number: c.number,
      baseRef: defaultBranch,
      rebase: true as const,
    }))
}

/**
 * Patch sets from the heads a request has had, oldest first. A push that
 * moves the head, forced or not, is a new patch set. Pushing the same head
 * twice is not.
 */
export function patchSetsFromPushes(heads: Array<string>) {
  const seen: Array<string> = []
  for (const sha of heads) if (seen.at(-1) !== sha) seen.push(sha)
  return seen.map((tree, i) => ({ n: i + 1, tree }))
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type Verdict = 'approved' | 'changes' | 'commented'

/**
 * How a verdict is written on a host. Where a host has no such verdict the
 * closest honest thing is used, and the row in `features` says so.
 */
export function remoteVerdict(host: Host, v: Verdict) {
  if (v === 'commented') return { kind: 'comment' } as const
  if (v === 'approved') return { kind: 'approval' } as const
  // GitLab has approvals and resolvable threads, but no verdict that blocks.
  return host === 'gitlab'
    ? ({ kind: 'unresolved-thread' } as const)
    : ({ kind: 'request-changes' } as const)
}

// ---------------------------------------------------------------------------
// What travels
// ---------------------------------------------------------------------------

export type Fit = 'syncs' | 'partial' | 'native'

export type Feature = {
  id: string
  label: string
  /** How it appears on the host. */
  there: string
  fit: Fit | Partial<Record<Host, Fit>>
  /** Shown when the fit is partial or native. */
  note?: string
}

export const features: Array<Feature> = [
  {
    id: 'title',
    label: 'Title and description',
    there: 'The title and body. A hidden footer carries the change id.',
    fit: 'syncs',
  },
  {
    id: 'state',
    label: 'Draft, landed, abandoned',
    there: 'Draft, merged, closed.',
    fit: 'syncs',
    note: 'Where the host has no draft flag, the title gets a prefix.',
  },
  {
    id: 'patch-sets',
    label: 'Patch sets',
    there: 'Each patch set is a push to one stable branch.',
    fit: 'partial',
    note: 'The host shows pushes, not numbered patch sets. A comment names each one.',
  },
  {
    id: 'reviews',
    label: 'Approvals and requests for changes',
    there: 'Reviews on GitHub, Codeberg and Gitea. Approvals on GitLab.',
    fit: {
      github: 'syncs',
      codeberg: 'syncs',
      gitea: 'syncs',
      gitlab: 'partial',
    },
    note: 'GitLab has no review that blocks, so a request for changes becomes an unresolved thread.',
  },
  {
    id: 'comments',
    label: 'Comments and line threads',
    there: 'Review comments on the same lines.',
    fit: 'syncs',
  },
  {
    id: 'checks',
    label: 'Checks',
    there: 'Commit statuses on the pushed branch.',
    fit: 'syncs',
  },
  {
    id: 'labels',
    label: 'Labels',
    there: 'Labels, matched by name.',
    fit: 'syncs',
  },
  {
    id: 'stack',
    label: 'Stacks',
    there:
      'A chain of requests, each aimed at its parent branch. Read the same way when a stack is opened on the host.',
    fit: 'partial',
    note: 'Landing in order and rebasing the children is done here. On the host each one is merged by hand, and a merged parent re-aims its children, which become a new patch set here.',
  },
  {
    id: 'findings',
    label: 'Findings with severity',
    there: 'Line comments that start with the severity.',
    fit: 'partial',
    note: 'Whether a finding blocks landing is a policy here. The host sees only the comment.',
  },
  {
    id: 'policy',
    label: 'Policies as code',
    there: 'One required status, source.code/policy.',
    fit: 'partial',
    note: 'The host can require the status. The rules themselves stay here.',
  },
  {
    id: 'media',
    label: 'Images and videos',
    there: 'Linked from the description.',
    fit: 'partial',
    note: 'Before and after pairs arrive as two images. Sliders and interactive previews stay here, and the host gets a link.',
  },
  {
    id: 'tests',
    label: 'Test results',
    there: 'A check with the pass and fail counts.',
    fit: 'partial',
    note: 'Which tests ran, what failed on the base, and the screenshots from before and after stay here.',
  },
  {
    id: 'interdiff',
    label: 'Compare patch sets',
    there: 'Nothing.',
    fit: 'native',
  },
  {
    id: 'carry',
    label: 'Approvals that follow a rewrite',
    there: 'Nothing. The host may mark an approval stale after a force-push.',
    fit: 'native',
  },
  {
    id: 'agents',
    label: 'Send a finding to an agent',
    there: 'Nothing.',
    fit: 'native',
  },
]

export function fitFor(feature: Feature, host: Host): Fit {
  return typeof feature.fit === 'string'
    ? feature.fit
    : (feature.fit[host] ?? 'syncs')
}

/** The features grouped for one host, so a screen can list each side. */
export function compatibility(host: Host) {
  const rows = features.map((f) => ({ ...f, fit: fitFor(f, host) }))
  return {
    syncs: rows.filter((r) => r.fit === 'syncs'),
    partial: rows.filter((r) => r.fit === 'partial'),
    native: rows.filter((r) => r.fit === 'native'),
  }
}
