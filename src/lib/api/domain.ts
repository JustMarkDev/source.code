/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-condition --
   Every method is async on purpose: the Convex-backed domain has to fit the same
   surface, and callers already await. Indexed reads of maps and arrays are checked
   at run time; the repo does not turn on noUncheckedIndexedAccess. */
import { createHash } from 'node:crypto'
import { newId, seededId } from './ids'
import { pageSorted } from './cursor'
import { apiError } from './problem'
import { EventLog, parseEvent  } from './events'
import { Pre } from './registry'
import type { CursorPosition, Page } from './cursor'
import type { EventRecord, StoredEvent } from './events'
import type { WebhookService } from './webhooks'
import type { SearchDoc, SearchIndex } from './search'
import type { GitData } from './git'
import type { UploadRec, UploadService } from './uploads'
import type { ExtrasStore } from './extras'
import type { AuthStore, Principal } from './auth'
import type { z } from 'zod'
import type * as S from './schemas'

/**
 * The data behind the API, in memory. It is the whole of what the API needs
 * from storage, written as plain async methods, so the Convex-backed version
 * implements the same surface and nothing above this file changes.
 *
 * What it enforces is the product, not the storage: who may see a repository,
 * what policy requires, that an approval follows a rewrite only when the code
 * did not change, that a change lands only as the exact tree that was checked,
 * and that every mutation writes one event.
 */
export type Urls = { api: string; html: string }

export class Moved extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`${from} moved to ${to}`)
  }
}

type ActorClass = 'human' | 'agent' | 'bot'
export type ActorRec = { id: string; handle: string; class: ActorClass }
type Role = 'owner' | 'admin' | 'member'

export type AccountRec = {
  id: string
  handle: string
  name: string
  kind: 'person' | 'organization'
  created: number
  members: Map<string, Role>
}

export type RunRec = {
  id: string
  repo: string
  task: string
  state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  handle: string
  change: number | null
  scopes: Array<string>
  tokenId: string
  notes: Array<{ at: number; text: string }>
  summary: string | null
  started: number
  expires: number
  finished: number | null
  version: number
}

export type TeamRec = {
  id: string
  org: string
  slug: string
  name: string
  description: string
  members: Set<string>
  repos: Map<string, 'read' | 'write'>
  created: number
  updated: number
  version: number
}

type FileStat = { hash: string; add: number; del: number }
export type PatchSetRec = {
  n: number
  sha: string
  tree: string
  note: string
  author: ActorRec
  created: number
  files: Record<string, FileStat>
  kind: 'initial' | 'update' | 'rebase'
}
export type ReviewRec = {
  id: string
  actor: ActorRec
  state: 'approved' | 'commented' | 'changes'
  patchSet: number
  carries: boolean
  body: string
  created: number
}
export type FindingRec = {
  id: string
  label: string
  by: string
  severity: 'high' | 'medium' | 'low'
  state: 'open' | 'resolved' | 'dismissed'
  reason: string | null
  file: string
  line: number
  title: string
  body: string
  patchSet: number
  created: number
}
export type CheckRec = {
  id: string
  key: string
  name: string
  state: 'pending' | 'pass' | 'fail'
  tree: string
  detailsUrl: string | null
  created: number
  updated: number
}
export type ChangeRec = {
  id: string
  number: number
  title: string
  description: string
  state: 'draft' | 'open' | 'landed' | 'abandoned'
  author: ActorRec
  base: string
  branch: string
  patchSets: Array<PatchSetRec>
  reviews: Array<ReviewRec>
  findings: Array<FindingRec>
  checks: Array<CheckRec>
  stackId: string | null
  labels: Array<string>
  mirrors: Array<{ host: string; number: number; origin: 'here' | 'there' }>
  evidence?: Array<EvidenceRec>
  /** What policy said at `version`. A change does not change between versions. */
  policyMemo?: { version: number; reqs: Array<z.infer<typeof S.Requirement>> }
  latest?: { map: Map<string, ReviewRec>; seen: number }
  created: number
  updated: number
  landed: number | null
  version: number
}
export type EvidenceRec = {
  id: string
  kind: 'image' | 'recording' | 'preview' | 'test_results'
  caption: string
  uploadId: string
  by: ActorRec
  created: number
}
export type IssueRec = {
  id: string
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  author: ActorRec
  labels: Array<string>
  created: number
  updated: number
  closed: number | null
  version: number
}
export type OperationRec = {
  id: string
  kind: string
  /** The repository this operation belongs to, checked when it is read. */
  repoId: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  done: number
  total: number
  result: { object: string; id: string; url: string } | null
  error: Record<string, unknown> | null
  created: number
  finished: number | null
}

export type RepoRec = {
  id: string
  /** The immutable git store key. A rename keeps it; a recreate gets a new one. */
  storeId: string
  owner: string
  name: string
  description: string
  visibility: 'public' | 'private'
  defaultBranch: string
  stars: number
  created: number
  updated: number
  version: number
  /** Bumped by every event in the repository. Anything derived from many objects keys on it. */
  rev: number
  /** Per-collection counters, so a changes list is not invalidated by an issue event. */
  changeRev: number
  issueRev: number
  nextNumber: number
  collaborators: Set<string>
  installs: Set<string>
  maintainers: Set<string>
  changes: Map<number, ChangeRec>
  issues: Map<number, IssueRec>
  stacks: Map<string, Array<number>>
  byUpdated: Sorted<ChangeRec>
  byNumber: Sorted<ChangeRec>
  issuesByNumber: Sorted<IssueRec>
  /** Open issues by exact title, so opening the same one twice is a lookup, not a scan. */
  openIssueByTitle: Map<string, IssueRec>
  /** Open and draft changes by branch, so a second push finds its change without a scan. */
  openChangeByBranch: Map<string, ChangeRec>
  /** Counts shown on the repository, recomputed only after something changed. */
  counts: { key: string; openChanges: number; openIssues: number }
  env: Array<{ name: string; kind: string; set: Array<string> }>
}

// ---------------------------------------------------------------------------
// A list kept in order, so a page costs the same however deep the cursor is.

class Sorted<T> {
  readonly items: Array<T> = []
  constructor(
    private readonly key: (t: T) => number,
    private readonly id: (t: T) => string,
  ) {}

  private cmp(a: T, b: T) {
    const d = this.key(a) - this.key(b)
    if (d !== 0) return d
    const x = this.id(a)
    const y = this.id(b)
    return x < y ? -1 : x > y ? 1 : 0
  }

  private lower(t: T) {
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cmp(this.items[mid], t) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Kept ascending. Things usually arrive newest, so adding is usually an append. */
  add(t: T) {
    const n = this.items.length
    if (n === 0 || this.cmp(this.items[n - 1], t) < 0) this.items.push(t)
    else this.items.splice(this.lower(t), 0, t)
  }

  remove(t: T) {
    const i = this.lower(t)
    if (this.items[i] === t) this.items.splice(i, 1)
  }
}

const changeUpdated = (c: ChangeRec) => c.updated
const changeNumber = (c: ChangeRec) => c.number
const issueNumber = (i: IssueRec) => i.number
const recId = (r: { id: string }) => r.id
const seqId = (e: { sequence: number }) => String(e.sequence)

// The same instant is formatted many times (a write stamps the object, the event
// and the answer), so remember the last one.
let isoMs = Number.NaN
let isoText = ''
export const iso = (ms: number) => {
  if (ms !== isoMs) {
    isoText = new Date(ms).toISOString()
    isoMs = ms
  }
  return isoText
}

type Assume = {
  approve?: Array<string>
  checks?: Record<string, 'pending' | 'pass' | 'fail'>
  resolve?: Array<string>
}
type Requirement = z.infer<typeof S.Requirement>
type PolicyState = 'met' | 'blocked' | 'pending'

export type Viewer = Principal | null

/** Services the domain's operations reach, attached when the API is assembled. */
export type Attached = {
  auth: AuthStore
  hooks: WebhookService
  search: SearchIndex
  uploads: UploadService
  extras: ExtrasStore
  git: GitData
}

export class MemoryDomain {
  readonly events: EventLog
  readonly accounts = new Map<string, AccountRec>()
  readonly actors = new Map<string, ActorRec>()
  readonly repos = new Map<string, RepoRec>()
  private readonly reposById = new Map<string, RepoRec>()
  private readonly aliases = new Map<string, string>()
  /** Teams by `org/slug`, and the teams each person is in. */
  readonly teams = new Map<string, TeamRec>()
  /** Runs by id, and each repository's runs oldest first. */
  readonly runs = new Map<string, RunRec>()
  private readonly runsByRepo = new Map<string, Array<RunRec>>()
  private readonly teamsOf = new Map<string, Set<string>>()
  readonly operations = new Map<string, OperationRec>()
  /** Bumped by every ACL change, so cached bodies and ETags cannot outlive access. */
  accessRevision = 0
  /** Delay between steps of a long operation. Tests set it to 0. */
  stepDelayMs = 5
  /** Attached by whoever assembles the API: tokens, webhooks, search, blobs. */
  svc = {} as Attached

  constructor(
    readonly urls: Urls,
    private readonly now: () => number = Date.now,
    events?: EventLog,
  ) {
    this.events = events ?? new EventLog(now)
  }

  // ----- seeding ----------------------------------------------------------

  seedActor(handle: string, cls: ActorClass, at = this.now()): ActorRec {
    const found = this.actors.get(handle)
    if (found) return found
    const rec = { id: seededId('account', at, handle), handle, class: cls }
    this.actors.set(handle, rec)
    return rec
  }

  seedAccount(
    handle: string,
    name: string,
    kind: AccountRec['kind'],
    members: Array<[string, Role]> = [],
    at = this.now(),
  ) {
    const actor = this.seedActor(handle, 'human', at)
    const rec: AccountRec = {
      id: actor.id,
      handle,
      name,
      kind,
      created: at,
      members: new Map(members),
    }
    this.accounts.set(handle, rec)
    return rec
  }

  seedRepo(
    owner: string,
    name: string,
    init: Partial<
      Pick<RepoRec, 'id' | 'storeId' | 'description' | 'visibility' | 'stars' | 'created' | 'env'>
    > & {
      collaborators?: Array<string>
      installs?: Array<string>
      maintainers?: Array<string>
    } = {},
  ): RepoRec {
    const rec = this.makeRepo(owner, name, init)
    this.repos.set(`${owner}/${name}`, rec)
    this.reposById.set(rec.id, rec)
    this.svc.git?.setRepo?.(`${owner}/${name}`, rec.storeId)
    return rec
  }

  /** Point the git reads at every repository's immutable store id. */
  registerGitStores() {
    for (const rec of this.repos.values()) this.svc.git?.setRepo?.(`${rec.owner}/${rec.name}`, rec.storeId)
  }

  private makeRepo(
    owner: string,
    name: string,
    init: Partial<Pick<RepoRec, 'id' | 'storeId' | 'description' | 'visibility' | 'stars' | 'created' | 'env'>> & {
      collaborators?: Array<string>
      installs?: Array<string>
      maintainers?: Array<string>
    } = {},
  ): RepoRec {
    const at = init.created ?? this.now()
    const id = init.id ?? seededId('repo', at, `${owner}/${name}`)
    const rec: RepoRec = {
      id,
      storeId: init.storeId ?? id,
      owner,
      name,
      description: init.description ?? '',
      visibility: init.visibility ?? 'public',
      defaultBranch: 'main',
      stars: init.stars ?? 0,
      created: at,
      updated: at,
      version: 1,
      rev: 0,
      changeRev: 0,
      issueRev: 0,
      nextNumber: 1,
      collaborators: new Set(init.collaborators ?? []),
      installs: new Set(init.installs ?? []),
      maintainers: new Set(init.maintainers ?? [owner]),
      changes: new Map(),
      issues: new Map(),
      stacks: new Map(),
      byUpdated: new Sorted(changeUpdated, recId),
      byNumber: new Sorted(changeNumber, recId),
      issuesByNumber: new Sorted(issueNumber, recId),
      openIssueByTitle: new Map(),
      openChangeByBranch: new Map(),
      counts: { key: '', openChanges: 0, openIssues: 0 },
      env: init.env ?? [],
    }
    return rec
  }

  seedAlias(from: string, to: string) {
    this.aliases.set(from, to)
  }

  seedChange(repo: RepoRec, c: ChangeRec) {
    repo.changes.set(c.number, c)
    repo.byUpdated.add(c)
    repo.byNumber.add(c)
    repo.nextNumber = Math.max(repo.nextNumber, c.number + 1)
    if ((c.state === 'open' || c.state === 'draft') && !repo.openChangeByBranch.has(c.branch))
      repo.openChangeByBranch.set(c.branch, c)
    if (c.stackId) {
      const members = repo.stacks.get(c.stackId) ?? []
      members.push(c.number)
      members.sort((a, b) => a - b)
      repo.stacks.set(c.stackId, members)
    }
  }

  seedIssue(repo: RepoRec, i: IssueRec) {
    repo.issues.set(i.number, i)
    repo.issuesByNumber.add(i)
    repo.nextNumber = Math.max(repo.nextNumber, i.number + 1)
    if (i.state === 'open' && !repo.openIssueByTitle.has(i.title)) repo.openIssueByTitle.set(i.title, i)
  }

  // ----- access -----------------------------------------------------------

  private isMember(handle: string, who: string) {
    const acc = this.accounts.get(handle)
    return !!acc && (handle === who || acc.members.has(who))
  }

  private canRead(repo: RepoRec, p: Viewer) {
    const full = `${repo.owner}/${repo.name}`.toLowerCase()
    if (p?.repos && !p.repos.includes(full)) return repo.visibility === 'public'
    if (repo.visibility === 'public') return true
    return !!p && (this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) !== null)
  }

  /** What the teams someone is in give them on a repository. Looked at only when nothing else does. */
  private teamLevel(repo: RepoRec, handle: string): 'read' | 'write' | null {
    const keys = this.teamsOf.get(handle)
    if (!keys) return null
    const full = `${repo.owner}/${repo.name}`
    let level: 'read' | 'write' | null = null
    for (const k of keys) {
      const g = this.teams.get(k)?.repos.get(full)
      if (g === 'write') return 'write'
      if (g) level = 'read'
    }
    return level
  }

  private hasAccess(repo: RepoRec, p: Principal) {
    return (
      this.isMember(repo.owner, p.handle) ||
      repo.collaborators.has(p.handle) ||
      repo.installs.has(p.handle)
    )
  }

  private canWrite(repo: RepoRec, p: Viewer): p is Principal {
    if (!p) return false
    if (p.repos && !p.repos.includes(`${repo.owner}/${repo.name}`.toLowerCase())) return false
    return this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) === 'write'
  }

  private resolve(
    owner: string,
    name: string,
    p: Viewer,
    need: 'read' | 'write' = 'read',
  ): RepoRec {
    let repo: RepoRec | undefined
    if (name === '~' && owner.startsWith('rep_')) repo = this.reposById.get(owner)
    else {
      const key = `${owner}/${name}`.toLowerCase()
      repo = this.repos.get(key) ?? this.byLower(key)
      if (!repo) {
        let target = key
        const seen = new Set<string>([target])
        for (let i = 0; i < 10; i++) {
          const next = this.aliases.get(target)
          if (!next || seen.has(next)) break
          seen.add(next)
          target = next
        }
        if (target !== key) {
          const moved = this.repos.get(target) ?? this.byLower(target.toLowerCase())
          if (moved && this.canRead(moved, p)) throw new Moved(key, target)
        }
      }
    }
    if (!repo || !this.canRead(repo, p))
      throw apiError('not_found', `No repository ${owner}/${name}.`)
    if (need === 'write' && !this.canWrite(repo, p))
      throw apiError('forbidden', 'You can read this repository but not change it.')
    return repo
  }

  private byLower(key: string) {
    for (const [k, v] of this.repos) if (k.toLowerCase() === key) return v
    return undefined
  }

  // ----- presentation -----------------------------------------------------

  private actor(a: ActorRec): z.infer<typeof S.Actor> {
    return { object: 'actor', id: a.id, handle: a.handle, class: a.class }
  }

  private repoUrl(r: RepoRec) {
    return `${this.urls.api}/repos/${r.owner}/${r.name}`
  }

  private repoRef(r: RepoRec): z.infer<typeof S.RepoRef> {
    return {
      object: 'repo',
      id: r.id,
      full_name: `${r.owner}/${r.name}`,
      url: this.repoUrl(r),
    }
  }

  private presentRepo(r: RepoRec): z.infer<typeof S.Repo> {
    // Counting needs a pass over everything, so do it once per change to the repository.
    const key = `${r.rev}:${r.changes.size}:${r.issues.size}`
    if (r.counts.key !== key) {
      let openChanges = 0
      for (const c of r.changes.values()) if (c.state === 'open' || c.state === 'draft') openChanges++
      let openIssues = 0
      for (const i of r.issues.values()) if (i.state === 'open') openIssues++
      r.counts = { key, openChanges, openIssues }
    }
    const { openChanges, openIssues } = r.counts
    return {
      object: 'repo',
      id: r.id,
      owner: r.owner,
      name: r.name,
      full_name: `${r.owner}/${r.name}`,
      description: r.description,
      visibility: r.visibility,
      default_branch: r.defaultBranch,
      stars: r.stars,
      maintainers: [...r.maintainers].sort(),
      open_changes: openChanges,
      open_issues: openIssues,
      url: this.repoUrl(r),
      html_url: `${this.urls.html}/${r.owner}/${r.name}`,
      created_at: iso(r.created),
      updated_at: iso(r.updated),
      version: r.version,
    }
  }

  private head(c: ChangeRec) {
    return c.patchSets[c.patchSets.length - 1]
  }

  private checksFor(c: ChangeRec): z.infer<typeof S.Change>['checks'] {
    const tree = this.head(c).tree
    const own = c.checks.filter((k) => k.tree === tree)
    const passed = own.filter((k) => k.state === 'pass').length
    const failed = own.filter((k) => k.state === 'fail').length
    const pending = own.filter((k) => k.state === 'pending').length
    return {
      state: own.length === 0 ? 'none' : failed ? 'fail' : pending ? 'pending' : 'pass',
      passed,
      failed,
      pending,
    }
  }

  /** The newest review from each person. Kept up to date as reviews arrive, not rebuilt from all of them. */
  private latestReviews(c: ChangeRec) {
    let l = c.latest
    if (!l) c.latest = l = { map: new Map(), seen: 0 }
    for (; l.seen < c.reviews.length; l.seen++) {
      const r = c.reviews[l.seen]
      l.map.set(r.actor.handle, r)
    }
    return [...l.map.values()]
  }

  /**
   * What policy says about a change. It depends on nothing but the change's own
   * state (its version moves whenever that does) and the repository's
   * maintainers, so it is worked out once per version. Asking "what if" with
   * `assume` always works it out fresh.
   */
  private evaluate(repo: RepoRec, c: ChangeRec, assume?: Assume): Array<Requirement> {
    if (assume) return this.evaluateFresh(repo, c, assume)
    const memo = c.policyMemo
    if (memo && memo.version === c.version) return memo.reqs
    const reqs = this.evaluateFresh(repo, c, {})
    c.policyMemo = { version: c.version, reqs }
    return reqs
  }

  private evaluateFresh(
    repo: RepoRec,
    c: ChangeRec,
    assume: Assume,
  ): Array<Requirement> {
    const head = this.head(c)
    const out: Array<Requirement> = []

    const reviews = this.latestReviews(c)
    const humanApprovals = new Set<string>()
    for (const r of reviews)
      if (
        r.state === 'approved' &&
        r.carries &&
        r.actor.class === 'human' &&
        r.actor.handle !== c.author.handle
      )
        humanApprovals.add(r.actor.handle)
    for (const h of assume.approve ?? [])
      if (this.actors.get(h)?.class === 'human' && h !== c.author.handle)
        humanApprovals.add(h)
    const humanObjections = reviews.filter(
      (r) => r.state === 'changes' && r.actor.class === 'human',
    )

    // core-paths: a maintainer has to approve.
    const maintainerApprovals = [...humanApprovals].filter((h) =>
      repo.maintainers.has(h),
    )
    out.push({
      id: 'core-paths',
      rule: 'Core paths need a maintainer',
      state: humanObjections.length
        ? 'fail'
        : maintainerApprovals.length
          ? 'pass'
          : 'pending',
      detail: humanObjections.length
        ? `${humanObjections.map((r) => r.actor.handle).join(', ')} asked for changes.`
        : maintainerApprovals.length
          ? `${maintainerApprovals.join(', ')} approved, and the approval holds for patch set ${head.n}.`
          : 'src/** needs 1 human approval from a maintainer.',
      needs: { approval: { min: 1, class: 'human', from: 'maintainers' } },
      blocking: humanObjections.map((r) => r.id),
    })

    // agent-authored: a person has to approve work an agent or bot wrote.
    if (c.author.class === 'human')
      out.push({
        id: 'agent-authored',
        rule: 'Agent-authored changes need a human',
        state: 'na',
        detail: 'The author is a person.',
        needs: null,
        blocking: [],
      })
    else
      out.push({
        id: 'agent-authored',
        rule: 'Agent-authored changes need a human',
        state: humanApprovals.size ? 'pass' : 'pending',
        detail: humanApprovals.size
          ? `${[...humanApprovals].join(', ')} approved.`
          : `${c.author.handle} is ${c.author.class === 'agent' ? 'an agent' : 'a bot'}; a person has to approve.`,
        needs: { approval: { min: 1, class: 'human' }, not_author: true },
        blocking: [],
      })

    // ci-evidence: tests passed on the tree that will land.
    const runs = c.checks.filter(
      (k) => k.name === 'ci/test' && k.tree === head.tree,
    )
    const run = runs.sort((a, b) => b.updated - a.updated)[0]
    const ciState = assume.checks?.['ci/test'] ?? run?.state ?? 'pending'
    out.push({
      id: 'ci-evidence',
      rule: 'Tests pass on the tree that will land',
      state: ciState,
      detail:
        ciState === 'pass'
          ? `ci/test passed on tree ${head.tree}, the tree that lands.`
          : ciState === 'fail'
            ? `ci/test failed on tree ${head.tree}.`
            : run
              ? `ci/test is running on tree ${head.tree}.`
              : `No ci/test result for tree ${head.tree} yet.`,
      needs: { check: 'ci/test', bound_to: 'tree', tree: head.tree },
      blocking: ciState === 'fail' && run ? [run.id] : [],
    })

    // findings: nothing high is left open.
    const open = c.findings.filter(
      (f) =>
        f.severity === 'high' &&
        f.state === 'open' &&
        !(assume.resolve ?? []).includes(f.label),
    )
    out.push({
      id: 'findings',
      rule: 'No open high-severity findings',
      state: open.length ? 'fail' : 'pass',
      detail: open.length
        ? `${open.length} open: ${open.map((f) => `${f.label} from ${f.by}`).join(', ')}.`
        : 'No open high-severity findings.',
      needs: open.length ? { resolve: open.map((f) => f.label) } : null,
      blocking: open.map((f) => f.id),
    })
    return out
  }

  private policyState(reqs: ReadonlyArray<Requirement>): PolicyState {
    if (reqs.some((r) => r.state === 'fail')) return 'blocked'
    if (reqs.some((r) => r.state === 'pending')) return 'pending'
    return 'met'
  }

  private unmet(reqs: ReadonlyArray<Requirement>) {
    return reqs.filter((r) => r.state === 'fail' || r.state === 'pending').length
  }

  private actionsFor(repo: RepoRec, c: ChangeRec, p: Viewer) {
    const no = (why: string) => ({ allowed: false, reasons: [why] })
    if (!p) {
      const s = no('sign_in')
      return { land: s, abandon: s, restore: s, mark_ready: s }
    }
    const canWrite = this.canWrite(repo, p)
    const canPull = canWrite && p.scopes.has('pulls:write')
    const canMerge = canWrite && p.scopes.has('pulls:merge')
    const reqs = this.evaluate(repo, c)
    const reasons: Array<string> = []
    if (c.state !== 'open') reasons.push(`state:${c.state}`)
    if (!canMerge) reasons.push('scope:pulls:merge')
    for (const r of reqs)
      if (r.state === 'fail' || r.state === 'pending')
        reasons.push(`policy:${r.id} ${r.state === 'fail' ? 'fail' : 'pending'}`)
    const parent = this.parentOf(repo, c)
    if (parent && parent.state !== 'landed')
      reasons.push(`parent:#${parent.number} not landed`)
    return {
      land: { allowed: reasons.length === 0, reasons },
      abandon: canPull && (c.state === 'open' || c.state === 'draft')
        ? { allowed: true, reasons: [] }
        : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      restore: canPull && c.state === 'abandoned'
        ? { allowed: true, reasons: [] }
        : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      mark_ready: canPull && c.state === 'draft'
        ? { allowed: true, reasons: [] }
        : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
    }
  }

  private parentOf(repo: RepoRec, c: ChangeRec) {
    if (!c.stackId) return null
    const members = repo.stacks.get(c.stackId) ?? []
    const i = members.indexOf(c.number)
    return i > 0 ? (repo.changes.get(members[i - 1]) ?? null) : null
  }

  private presentFinding(
    repo: RepoRec,
    c: ChangeRec,
    f: FindingRec,
  ): z.infer<typeof S.Finding> {
    return {
      object: 'finding',
      id: f.id,
      label: f.label,
      by: f.by,
      severity: f.severity,
      state: f.state,
      reason: f.reason,
      file: f.file,
      line: f.line,
      title: f.title,
      body: f.body,
      patch_set: f.patchSet,
      url: `${this.repoUrl(repo)}/changes/${c.number}/findings/${f.id}`,
      created_at: iso(f.created),
    }
  }

  private presentCheck(k: CheckRec): z.infer<typeof S.CheckRun> {
    return {
      object: 'check_run',
      id: k.id,
      key: k.key,
      name: k.name,
      state: k.state,
      tree: k.tree,
      details_url: k.detailsUrl,
      created_at: iso(k.created),
      updated_at: iso(k.updated),
    }
  }

  /**
   * A change as a caller sees it, already serialized. Keyed by everything the
   * answer depends on, which includes the change's version, so an entry is never
   * stale, only replaced. A list of fifty unchanged changes is fifty lookups.
   */
  private readonly shown = new Map<string, Pre>()
  private shownChars = 0
  static readonly SHOWN_MAX = 8000
  static readonly SHOWN_CHARS_MAX = 24_000_000

  shownChange(repo: RepoRec, c: ChangeRec, viewer: Viewer | 'event', expand: ReadonlyArray<string> = []): Pre {
    const who = viewer === 'event' ? 'event' : viewer ? viewer.capId : 'anonymous'
    const ex = expand.length ? expand.join(',') : ''
    const key = `${repo.id}|${c.id}|${c.version}|${c.stackId ? this.stackRev(repo, c) : 0}|${ex}|${who}|${repo.version}|${this.accessRevision}${expand.includes('repo') ? `|${repo.rev}` : ''}`
    const hit = this.shown.get(key)
    if (hit) return hit
    const obj = this.presentChange(repo, c, viewer, expand)
    const pre = new Pre(JSON.stringify(obj), obj, key)
    this.shown.set(key, pre)
    this.shownChars += pre.json.length
    // First in, first out. Dropping an entry that is still wanted costs one rebuild;
    // reordering on every hit costs more than that across a busy list.
    while ((this.shown.size > MemoryDomain.SHOWN_MAX || this.shownChars > MemoryDomain.SHOWN_CHARS_MAX) && this.shown.size > 1) {
      const gone = this.shown.keys().next().value as string
      this.shownChars -= this.shown.get(gone)!.json.length
      this.shown.delete(gone)
    }
    return pre
  }

  presentChange(
    repo: RepoRec,
    c: ChangeRec,
    viewer: Viewer | 'event',
    expand: ReadonlyArray<string> = [],
  ): z.infer<typeof S.Change> {
    const head = this.head(c)
    const reqs = this.evaluate(repo, c)
    const members = c.stackId ? (repo.stacks.get(c.stackId) ?? []) : []
    const parent = this.parentOf(repo, c)
    let additions = 0
    let deletions = 0
    for (const f of Object.values(head.files)) {
      additions += f.add
      deletions += f.del
    }
    const reviewers = new Map<
      string,
      z.infer<typeof S.Change>['reviewers'][number]
    >()
    for (const r of this.latestReviews(c))
      reviewers.set(r.actor.handle, {
        actor: this.actor(r.actor),
        state: r.state,
        patch_set: r.patchSet,
        carries_to_head: r.carries,
      })
    return {
      object: 'change',
      id: c.id,
      number: c.number,
      url: `${this.repoUrl(repo)}/changes/${c.number}`,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/changes/${c.number}`,
      repo: expand.includes('repo') ? this.presentRepo(repo) : this.repoRef(repo),
      title: c.title,
      description: c.description,
      state: c.state,
      author: this.actor(c.author),
      base: c.base,
      branch: c.branch,
      patch_set_count: c.patchSets.length,
      head: { patch_set: head.n, sha: head.sha, tree: head.tree },
      stack: c.stackId
        ? {
            id: c.stackId,
            position: members.indexOf(c.number) + 1,
            size: members.length,
            parent: parent?.number ?? null,
          }
        : null,
      stats: {
        files: Object.keys(head.files).length,
        additions,
        deletions,
      },
      checks: this.checksFor(c),
      policy: { state: this.policyState(reqs), blocking: this.unmet(reqs) },
      reviewers: [...reviewers.values()],
      mirrors: c.mirrors,
      labels: c.labels,
      evidence_count: c.evidence?.length ?? 0,
      findings: expand.includes('findings')
        ? c.findings.map((f) => this.presentFinding(repo, c, f))
        : null,
      check_runs: expand.includes('check_runs')
        ? c.checks.map((k) => this.presentCheck(k))
        : null,
      actions: viewer === 'event' ? null : this.actionsFor(repo, c, viewer),
      landed_at: c.landed ? iso(c.landed) : null,
      created_at: iso(c.created),
      updated_at: iso(c.updated),
      version: c.version,
    }
  }

  /** An issue already serialized, kept by version like `shownChange`. The object is rebuilt from the text only if someone asks for it. */
  private readonly shownIssues = new Map<string, Pre>()
  private shownIssueChars = 0
  static readonly SHOWN_ISSUES_MAX = 6000
  static readonly SHOWN_ISSUES_CHARS_MAX = 12_000_000

  shownIssue(repo: RepoRec, i: IssueRec): Pre {
    const key = `${repo.id}|${i.id}|${i.version}|${repo.version}`
    const hit = this.shownIssues.get(key)
    if (hit) return hit
    const json = JSON.stringify(this.presentIssue(repo, i))
    const pre = new Pre(json, () => JSON.parse(json), key)
    this.shownIssues.set(key, pre)
    this.shownIssueChars += json.length
    while ((this.shownIssues.size > MemoryDomain.SHOWN_ISSUES_MAX || this.shownIssueChars > MemoryDomain.SHOWN_ISSUES_CHARS_MAX) && this.shownIssues.size > 1) {
      const gone = this.shownIssues.keys().next().value as string
      this.shownIssueChars -= this.shownIssues.get(gone)!.json.length
      this.shownIssues.delete(gone)
    }
    return pre
  }

  presentIssue(repo: RepoRec, i: IssueRec): z.infer<typeof S.Issue> {
    return {
      object: 'issue',
      id: i.id,
      number: i.number,
      url: `${this.repoUrl(repo)}/issues/${i.number}`,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/issues/${i.number}`,
      repo: this.repoRef(repo),
      title: i.title,
      body: i.body,
      state: i.state,
      author: this.actor(i.author),
      labels: i.labels,
      closed_at: i.closed ? iso(i.closed) : null,
      created_at: iso(i.created),
      updated_at: iso(i.updated),
      version: i.version,
    }
  }

  private presentOp(o: OperationRec): z.infer<typeof S.Operation> {
    return {
      object: 'operation',
      id: o.id,
      kind: o.kind,
      state: o.state,
      progress: { done: o.done, total: o.total },
      result: o.result,
      error: o.error,
      url: `${this.urls.api}/operations/${o.id}`,
      created_at: iso(o.created),
      finished_at: o.finished ? iso(o.finished) : null,
    }
  }

  // ----- events -----------------------------------------------------------

  private emit(
    repo: RepoRec,
    type: string,
    by: ActorRec,
    subject: { object: string; id: string; number: number | null },
    changes: Array<string>,
    data: Record<string, unknown> | null,
  ): EventRecord {
    repo.updated = this.now()
    repo.rev++
    return this.events.append({
      type,
      repo: `${repo.owner}/${repo.name}`,
      repo_id: repo.id,
      actor: this.actor(by),
      subject,
      changes,
      data,
    })
  }

  private asActor(p: Principal): ActorRec {
    return this.actorFor(p.handle, p.class)
  }

  /**
   * Who an action is recorded as. A person and an agent acting for them share a
   * handle but are not the same actor: policy counts approvals from people, and
   * a run token must never be mistaken for the person who started the run.
   */
  private actorFor(handle: string, cls: ActorClass): ActorRec {
    const found = this.actors.get(handle)
    if (found?.class === cls) return found
    if (!found) return this.seedActor(handle, cls, this.now())
    const key = `${handle}~${cls}`
    let rec = this.actors.get(key)
    if (!rec) this.actors.set(key, (rec = { id: seededId('account', this.now(), key), handle, class: cls }))
    return rec
  }

  private touchChange(repo: RepoRec, c: ChangeRec, mutate: () => void) {
    repo.byUpdated.remove(c)
    mutate()
    c.updated = Math.max(this.now(), c.updated + 1)
    c.version++
    repo.byUpdated.add(c)
    if (c.state === 'open' || c.state === 'draft') {
      if (!repo.openChangeByBranch.has(c.branch)) repo.openChangeByBranch.set(c.branch, c)
    } else if (repo.openChangeByBranch.get(c.branch) === c) repo.openChangeByBranch.delete(c.branch)
  }

  private changeEvent(
    repo: RepoRec,
    c: ChangeRec,
    type: string,
    by: ActorRec,
    changes: Array<string>,
  ) {
    repo.changeRev++
    this.emit(
      repo,
      type,
      by,
      { object: 'change', id: c.id, number: c.number },
      changes,
      this.presentChange(repo, c, 'event'),
    )
  }

  // ----- accounts and repositories ---------------------------------------

  async addEvidence(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    input: { upload: UploadRec; kind: EvidenceRec['kind']; caption: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const by = this.asActor(p!)
    const rec: EvidenceRec = {
      id: newId('evidence', this.now()),
      kind: input.kind,
      caption: input.caption,
      uploadId: input.upload.id,
      by,
      created: this.now(),
    }
    if (!dry) {
      input.upload.attachedTo = `${repo.owner}/${repo.name}`
      input.upload.attachedRepoId = repo.id
      this.touchChange(repo, c, () => (c.evidence ??= []).push(rec))
      this.changeEvent(repo, c, 'change.updated', by, ['evidence_count'])
    }
    return this.presentEvidence(c, rec, input.upload)
  }

  async listEvidence(owner: string, name: string, ref: string, p: Viewer, find: (id: string) => UploadRec | null) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return (c.evidence ?? []).flatMap((e) => {
      const u = find(e.uploadId)
      return u ? [this.presentEvidence(c, e, u)] : []
    })
  }

  private presentEvidence(c: ChangeRec, e: EvidenceRec, u: UploadRec): z.infer<typeof S.Evidence> {
    return {
      object: 'evidence',
      id: e.id,
      change: c.number,
      kind: e.kind,
      caption: e.caption,
      upload: { id: u.id, content_type: u.contentType, size: u.size, sha256: u.sha256 ?? '', content_url: `${this.urls.api}/uploads/${u.id}/content` },
      created_by: this.actor(e.by),
      created_at: iso(e.created),
    }
  }

  /** Whether a viewer may read a repository's files. */
  mayRead(repoFull: string, p: Viewer) {
    const r = this.repos.get(repoFull)
    return !!r && this.canRead(r, p)
  }

  /** Every searchable thing, for building the search index. */
  *searchDocs(): Iterable<SearchDoc> {
    for (const r of this.repos.values()) {
      const full = `${r.owner}/${r.name}`
      yield { key: `repo:${r.id}`, type: 'repo', id: r.id, repo: full, number: null, title: full, text: r.description, state: r.visibility, author: r.owner, labels: [], updated: r.updated, url: this.repoUrl(r) }
      for (const c of r.changes.values())
        yield { key: `change:${c.id}`, type: 'change', id: c.id, repo: full, number: c.number, title: c.title, text: c.description, state: c.state, author: c.author.handle, labels: c.labels, updated: c.updated, url: `${this.repoUrl(r)}/changes/${c.number}` }
      for (const i of r.issues.values())
        yield { key: `issue:${i.id}`, type: 'issue', id: i.id, repo: full, number: i.number, title: i.title, text: i.body, state: i.state, author: i.author.handle, labels: i.labels, updated: i.updated, url: `${this.repoUrl(r)}/issues/${i.number}` }
    }
  }

  async createRepo(
    p: Principal,
    input: { owner?: string; name: string; description?: string; visibility: 'public' | 'private'; maintainers?: Array<string> },
    dry: boolean,
  ) {
    const owner = input.owner ?? p.actingAs
    const acct = this.accounts.get(owner)
    if (!acct) throw apiError('not_found', `No account ${owner}.`)
    const role = owner === p.handle ? 'owner' : acct.members.get(p.handle)
    if (!role) throw apiError('not_found', `No account ${owner}.`)
    if (role === 'member')
      throw apiError('forbidden', `Members of ${owner} cannot create repositories there.`, {
        hint: 'Ask an owner or admin, or create it in an account you manage. GET /v1/accounts shows your role in each.',
      })
    if (p.repos) throw apiError('forbidden', 'A token limited to repositories cannot create new ones.')
    const maintainers = new Set(input.maintainers ?? [])
    if (input.maintainers) {
      if (input.maintainers.length === 0)
        throw apiError('invalid_request', 'A repository needs at least one maintainer.', {
          errors: [{ pointer: '/body/maintainers', code: 'empty', message: 'Name at least one person.' }],
        })
      for (const h of input.maintainers)
        if (this.accounts.get(h)?.kind !== 'person') throw apiError('invalid_request', `${h} is not a person.`, {
          errors: [{ pointer: '/body/maintainers', code: 'not_a_person', message: `${h} is not a person.` }],
        })
    } else {
      if (acct.kind === 'person') maintainers.add(acct.handle)
      for (const [h, r] of acct.members)
        if ((r === 'owner' || r === 'admin') && this.accounts.get(h)?.kind === 'person') maintainers.add(h)
      if (this.accounts.get(p.handle)?.kind === 'person') maintainers.add(p.handle)
    }
    if (maintainers.size === 0)
      throw apiError('invalid_request', 'A repository needs at least one maintainer.', {
        errors: [{ pointer: '/body/maintainers', code: 'empty', message: 'Name at least one person.' }],
      })
    const existing = this.repos.get(`${owner}/${input.name}`) ?? this.byLower(`${owner}/${input.name}`.toLowerCase())
    if (existing) return { repo: this.presentRepo(existing), created: false }
    if (dry)
      return {
        repo: this.presentRepo(this.makeRepo(owner, input.name, { description: input.description ?? '', visibility: input.visibility, created: this.now(), maintainers: [...maintainers], collaborators: [...maintainers] })),
        created: true,
      }
    const rec = this.seedRepo(owner, input.name, { id: newId('repo', this.now()), description: input.description ?? '', visibility: input.visibility, created: this.now(), maintainers: [...maintainers], collaborators: [...maintainers] })
    const lower = `${owner}/${input.name}`.toLowerCase()
    this.aliases.delete(lower)
    for (const [key, value] of this.aliases) if (value.toLowerCase() === lower) this.aliases.delete(key)
    this.svc.git?.setRepo?.(`${owner}/${input.name}`, rec.storeId)
    this.svc.search?.upsertIfBuilt?.({ key: `repo:${rec.id}`, type: 'repo', id: rec.id, repo: `${owner}/${input.name}`, number: null, title: `${owner}/${input.name}`, text: rec.description, state: rec.visibility, author: owner, labels: [], updated: rec.updated, url: this.repoUrl(rec) })
    return { repo: this.presentRepo(rec), created: true }
  }

  // ----- runs -------------------------------------------------------------

  static readonly RUN_NOTES = 50
  static readonly RUNS_RUNNING = 20
  static readonly RUN_SCOPES = ['repo:read', 'issues:read', 'issues:comment', 'pulls:read', 'pulls:comment', 'secrets:schema'] as const

  /** A run that outlived its token is over, whether or not anyone said so. */
  private runState(r: RunRec): z.infer<typeof S.Run>['state'] {
    return r.state === 'running' && r.expires <= this.now() ? 'expired' : r.state
  }

  presentRun(r: RunRec, secret: string | null = null): z.infer<typeof S.Run> {
    const repo = this.repos.get(r.repo)
    return {
      object: 'run',
      id: r.id,
      repo: repo ? this.repoRef(repo) : { object: 'repo', id: 'rep_deleted', full_name: r.repo, url: `${this.urls.api}/repos/${r.repo}` },
      task: r.task,
      state: this.runState(r),
      actor: this.actor(this.actorFor(r.handle, 'agent')),
      change: r.change,
      scopes: r.scopes,
      token: secret,
      token_id: r.tokenId,
      notes: r.notes.map((n) => ({ at: iso(n.at), text: n.text })),
      summary: r.summary,
      url: `${this.urls.api}/repos/${r.repo}/runs/${r.id}`,
      started_at: iso(r.started),
      expires_at: iso(r.expires),
      finished_at: r.finished ? iso(r.finished) : null,
      version: r.version,
    }
  }

  private runRec(repo: RepoRec, id: string): RunRec {
    const r = this.runs.get(id)
    if (!r || r.repo !== `${repo.owner}/${repo.name}`) throw apiError('not_found', `No run ${id} in ${repo.owner}/${repo.name}.`)
    return r
  }

  async startRun(
    owner: string,
    name: string,
    p: Principal,
    input: { task: string; change?: number; scopes?: Array<string>; ttl_minutes: number },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const full = `${repo.owner}/${repo.name}`
    if (input.change !== undefined && !repo.changes.has(input.change)) throw apiError('not_found', `No change #${input.change} in ${full}.`)
    // A run token can never do more than the one that started it.
    if (!p.scopes.has('repo:read'))
      throw apiError('insufficient_scope', 'A run token needs repo:read to report on itself.', {
        extra: { required_scopes: ['repo:read'], token_scopes: [...p.scopes] },
      })
    const wanted = [...new Set([...(input.scopes ?? MemoryDomain.RUN_SCOPES.filter((s) => p.scopes.has(s))), 'repo:read'])]
    const missing = wanted.filter((s) => !p.scopes.has(s as never))
    if (missing.length)
      throw apiError('insufficient_scope', `A run cannot have scopes you do not have: ${missing.join(', ')}.`, {
        extra: { required_scopes: missing, token_scopes: [...p.scopes] },
      })
    if (wanted.includes('tokens:manage'))
      throw apiError('forbidden', 'A run cannot be given tokens:manage.', { hint: 'A run token that could mint tokens would outlive its run.' })
    if (wanted.includes('secrets:write'))
      throw apiError('forbidden', 'A run cannot be given secrets:write.', { hint: 'Setting secrets is a person-only action.' })
    let running = 0
    for (const r of this.runs.values()) if (r.handle === p.handle && this.runState(r) === 'running') running++
    if (running >= MemoryDomain.RUNS_RUNNING) throw apiError('limit_reached', `You can have ${MemoryDomain.RUNS_RUNNING} runs going at once.`, { hint: 'Finish or cancel one first.' })
    const at = this.now()
    const id = newId('run', at)
    const rec: RunRec = {
      id,
      repo: full,
      task: input.task,
      state: 'running',
      handle: p.handle,
      change: input.change ?? null,
      scopes: wanted,
      tokenId: 'tok_dryrun',
      notes: [],
      summary: null,
      started: at,
      expires: at + input.ttl_minutes * 60_000,
      finished: null,
      version: 1,
    }
    if (dry) return { run: this.presentRun(rec, null) }
    const { record, secret } = this.svc.auth.create({
      name: `run ${id}`,
      kind: 'run',
      handle: p.handle,
      class: 'agent',
      scopes: wanted as never,
      repos: [full],
      ttlMs: input.ttl_minutes * 60_000,
    })
    rec.tokenId = record.id
    this.runs.set(id, rec)
    let list = this.runsByRepo.get(full)
    if (!list) this.runsByRepo.set(full, (list = []))
    list.push(rec)
    this.emit(repo, 'run.started', this.asActor(p), { object: 'run', id, number: null }, ['state'], this.presentRun(rec))
    return { run: this.presentRun(rec, secret) }
  }

  async listRuns(owner: string, name: string, p: Viewer, q: { state?: string; after: CursorPosition | null; limit: number }) {
    const repo = this.resolve(owner, name, p)
    const all = [...(this.runsByRepo.get(`${repo.owner}/${repo.name}`) ?? [])].sort((a, b) => a.started - b.started || (a.id < b.id ? -1 : 1))
    const page = pageSorted(all, (r) => r.started, (r) => r.id, {
      limit: q.limit,
      after: q.after,
      desc: true,
      stored: 'asc',
      match: (r) => !q.state || this.runState(r) === q.state,
    })
    return { items: page.items.map((r) => this.presentRun(r)), next: page.next }
  }

  async getRun(owner: string, name: string, id: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return this.presentRun(this.runRec(repo, id))
  }

  /** The run's own token, the person who started it, or an admin of the account may act on it. */
  private assertRunOwner(repo: RepoRec, r: RunRec, p: Principal) {
    if (p.repos && !p.repos.includes(`${repo.owner}/${repo.name}`.toLowerCase()))
      throw apiError('forbidden', 'This token is not granted for this repository.')
    if (p.tokenId === r.tokenId) return
    if (p.class === 'human' && r.handle === p.handle) return
    if (p.class === 'human') return this.assertAdmin(repo, p)
    throw apiError('forbidden', 'A run token can only control its own run.')
  }

  async noteRun(owner: string, name: string, id: string, p: Principal, text: string, dry: boolean) {
    const repo = this.resolve(owner, name, p, 'read')
    const r = this.runRec(repo, id)
    this.assertRunOwner(repo, r, p)
    if (this.runState(r) !== 'running') throw apiError('invalid_state', `Run ${id} is ${this.runState(r)}.`, { hint: 'Start another run.' })
    if (dry) return this.presentRun({ ...r, notes: [...r.notes, { at: this.now(), text }] })
    {
      r.notes.push({ at: this.now(), text })
      if (r.notes.length > MemoryDomain.RUN_NOTES) r.notes.splice(0, r.notes.length - MemoryDomain.RUN_NOTES)
      r.version++
    }
    return this.presentRun(r)
  }

  async endRun(owner: string, name: string, id: string, p: Principal, state: 'succeeded' | 'failed' | 'cancelled', summary: string | undefined, dry: boolean) {
    const repo = this.resolve(owner, name, p, 'read')
    const r = this.runRec(repo, id)
    this.assertRunOwner(repo, r, p)
    const now = this.runState(r)
    // Finishing twice with the same outcome is a no-op, so a retry is safe.
    if (now === state) return this.presentRun(r)
    if (now !== 'running') throw apiError('invalid_state', `Run ${id} is already ${now}.`)
    if (dry) return this.presentRun({ ...r, state, finished: this.now(), summary: summary ?? r.summary })
    {
      r.state = state
      r.finished = this.now()
      if (summary !== undefined) r.summary = summary
      r.version++
      this.svc.auth.revoke(r.tokenId)
      this.emit(repo, 'run.finished', this.asActor(p), { object: 'run', id, number: null }, ['state'], this.presentRun(r))
    }
    return this.presentRun(r)
  }

  /** Drop finished runs and operations after a week. */
  sweepRunsOperations() {
    const cutoff = this.now() - 7 * 86_400_000
    for (const [id, r] of this.runs) {
      if (this.runState(r) === 'running') continue
      if ((r.finished ?? r.expires) >= cutoff) continue
      this.runs.delete(id)
      const list = this.runsByRepo.get(r.repo)
      if (list) {
        const at = list.indexOf(r)
        if (at >= 0) list.splice(at, 1)
        if (list.length === 0) this.runsByRepo.delete(r.repo)
      }
    }
    for (const [id, op] of this.operations)
      if (op.finished !== null && op.finished < cutoff) this.operations.delete(id)
  }

  // ----- teams ------------------------------------------------------------

  private orgFor(handle: string, p: Principal, need: 'member' | 'admin'): AccountRec {
    const acct = this.accounts.get(handle)
    if (!acct || acct.kind !== 'organization') throw apiError('not_found', `No organization ${handle}.`)
    const role = acct.members.get(p.handle)
    if (!role) throw apiError('not_found', `No organization ${handle}.`)
    if (need === 'admin' && role !== 'owner' && role !== 'admin')
      throw apiError('forbidden', `Only an owner or admin of ${handle} can change its teams.`, {
        hint: 'GET /v1/accounts shows your role in each account.',
      })
    if (need === 'admin' && p.repos)
      throw apiError('forbidden', 'A token limited to repositories cannot administer teams.', {
        hint: 'Use a token that is not limited to repositories.',
      })
    return acct
  }

  private teamRec(org: string, slug: string): TeamRec {
    const t = this.teams.get(`${org}/${slug}`)
    if (!t) throw apiError('not_found', `No team ${slug} in ${org}.`)
    return t
  }

  presentTeam(t: TeamRec): z.infer<typeof S.Team> {
    return {
      object: 'team',
      id: t.id,
      org: t.org,
      slug: t.slug,
      name: t.name,
      description: t.description,
      members: [...t.members].sort(),
      repos: [...t.repos].map(([full_name, permission]) => ({ full_name, permission })).sort((a, b) => (a.full_name < b.full_name ? -1 : 1)),
      url: `${this.urls.api}/accounts/${t.org}/teams/${t.slug}`,
      created_at: iso(t.created),
      updated_at: iso(t.updated),
      version: t.version,
    }
  }

  async listTeams(org: string, p: Principal) {
    this.orgFor(org, p, 'member')
    return [...this.teams.values()].filter((t) => t.org === org).sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((t) => this.presentTeam(t))
  }

  async getTeam(org: string, slug: string, p: Principal) {
    this.orgFor(org, p, 'member')
    return this.presentTeam(this.teamRec(org, slug))
  }

  async teamVersion(org: string, slug: string, p: Principal) {
    this.orgFor(org, p, 'member')
    const t = this.teamRec(org, slug)
    return `${t.id}.${t.version}`
  }

  async createTeam(org: string, p: Principal, input: { slug: string; name?: string; description?: string }, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const key = `${org}/${input.slug}`
    const existing = this.teams.get(key)
    if (existing) return { team: this.presentTeam(existing), created: false }
    const t: TeamRec = {
      id: newId('team', this.now()),
      org,
      slug: input.slug,
      name: input.name ?? input.slug,
      description: input.description ?? '',
      members: new Set(),
      repos: new Map(),
      created: this.now(),
      updated: this.now(),
      version: 1,
    }
    if (!dry) this.teams.set(key, t)
    return { team: this.presentTeam(t), created: true }
  }

  async updateTeam(org: string, slug: string, p: Principal, body: { name?: string; description?: string }, ifMatch: string | null, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    this.assertMatch(ifMatch, `${t.id}.${t.version}`, () => this.presentTeam(t))
    const same = (body.name === undefined || body.name === t.name) &&
      (body.description === undefined || body.description === t.description)
    if (same) return this.presentTeam(t)
    if (!dry) {
      if (body.name !== undefined) t.name = body.name
      if (body.description !== undefined) t.description = body.description
      t.updated = this.now()
      t.version++
    }
    const shown = dry ? { ...t, name: body.name ?? t.name, description: body.description ?? t.description } : t
    return this.presentTeam(shown)
  }

  async deleteTeam(org: string, slug: string, p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    if (dry) return
    for (const m of t.members) this.unindexMember(m, `${org}/${slug}`)
    this.teams.delete(`${org}/${slug}`)
    this.accessRevision++
    this.svc.search?.reset()
  }

  private unindexMember(handle: string, key: string) {
    const set = this.teamsOf.get(handle)
    set?.delete(key)
    if (set?.size === 0) this.teamsOf.delete(handle)
  }

  async setTeamMember(org: string, slug: string, login: string, p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const person = this.accounts.get(login)
    if (!person || person.kind !== 'person') throw apiError('not_found', `No person ${login}.`)
    if (t.members.size >= 500 && !t.members.has(login)) throw apiError('limit_reached', 'A team can have 500 members.')
    if (dry) return this.presentTeam({ ...t, members: new Set([...t.members, login]) })
    if (!t.members.has(login)) {
      t.members.add(login)
      let set = this.teamsOf.get(login)
      if (!set) this.teamsOf.set(login, (set = new Set()))
      set.add(`${org}/${slug}`)
      t.updated = this.now()
      t.version++
      this.accessRevision++
      this.svc.search?.reset()
    }
    return this.presentTeam(t)
  }

  async removeTeamMember(org: string, slug: string, login: string, p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    if (!t.members.has(login)) throw apiError('not_found', `${login} is not in ${slug}.`)
    if (dry) return
    t.members.delete(login)
    this.unindexMember(login, `${org}/${slug}`)
    t.updated = this.now()
    t.version++
    this.accessRevision++
    this.svc.search?.reset()
  }

  async setTeamRepo(org: string, slug: string, owner: string, name: string, permission: 'read' | 'write', p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const repo = this.resolve(owner, name, p, 'read')
    // A team belongs to an organization and reaches only that organization's repositories.
    if (repo.owner !== org) throw apiError('invalid_request', `${repo.owner}/${repo.name} is not in ${org}.`, { hint: 'A team can only be given repositories of its own organization.' })
    if (t.repos.get(`${repo.owner}/${repo.name}`) === permission) return this.presentTeam(t)
    if (!dry) {
      t.repos.set(`${repo.owner}/${repo.name}`, permission)
      t.updated = this.now()
      t.version++
      this.accessRevision++
      // Visibility changed, so cached search results may be stale.
      this.svc.search?.reset()
    }
    if (dry) return this.presentTeam({ ...t, repos: new Map(t.repos).set(`${repo.owner}/${repo.name}`, permission) })
    return this.presentTeam(t)
  }

  async removeTeamRepo(org: string, slug: string, owner: string, name: string, p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const repo = this.resolve(owner, name, p, 'read')
    const full = `${repo.owner}/${repo.name}`
    if (!t.repos.has(full)) throw apiError('not_found', `${slug} has no access to ${full}.`)
    if (dry) return
    t.repos.delete(full)
    t.updated = this.now()
    t.version++
    this.accessRevision++
    this.svc.search?.reset()
  }

  /** Who may rename, hide or delete a repository: the owner of its account, or an admin of the organization. */
  private assertAdmin(repo: RepoRec, p: Principal) {
    const acct = this.accounts.get(repo.owner)
    const role = repo.owner === p.handle ? 'owner' : acct?.members.get(p.handle)
    if (role !== 'owner' && role !== 'admin')
      throw apiError('forbidden', `Only an owner or admin of ${repo.owner} can do this.`, {
        hint: 'GET /v1/accounts shows your role in each account.',
      })
  }

  async updateRepo(
    owner: string,
    name: string,
    p: Principal,
    body: { name?: string; description?: string; visibility?: 'public' | 'private'; default_branch?: string; maintainers?: Array<string> },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.assertAdmin(repo, p)
    this.assertMatch(ifMatch, `${repo.id}.${repo.version}`, () => this.presentRepo(repo))
    const renaming = body.name !== undefined && body.name !== repo.name
    if (renaming && p.repos)
      throw apiError('forbidden', 'A token limited to repositories cannot rename one.', {
        hint: 'Use a token that is not limited to repositories.',
      })
    if (renaming) {
      const target = `${repo.owner}/${body.name}`
      const taken = this.repos.get(target) ?? this.byLower(target.toLowerCase())
      if (taken && taken !== repo)
        throw apiError('invalid_state', `${target} already exists.`, {
          hint: 'Pick another name, or delete the repository that has it.',
        })
    }
    if (body.maintainers !== undefined) {
      if (body.maintainers.length === 0)
        throw apiError('invalid_request', 'A repository needs at least one maintainer.', {
          errors: [{ pointer: '/body/maintainers', code: 'empty', message: 'Name at least one person.' }],
        })
      for (const h of body.maintainers)
        if (this.accounts.get(h)?.kind !== 'person') throw apiError('invalid_request', `${h} is not a person.`, {
          errors: [{ pointer: '/body/maintainers', code: 'not_a_person', message: `${h} is not a person.` }],
        })
    }
    if (dry)
      return this.presentRepo({
        ...repo,
        name: body.name ?? repo.name,
        description: body.description ?? repo.description,
        visibility: body.visibility ?? repo.visibility,
        defaultBranch: body.default_branch ?? repo.defaultBranch,
        maintainers: body.maintainers ? new Set(body.maintainers) : repo.maintainers,
      })
    const from = `${repo.owner}/${repo.name}`
    const changed: Array<string> = []
    if (body.description !== undefined && body.description !== repo.description) {
      repo.description = body.description
      changed.push('description')
    }
    if (body.visibility !== undefined && body.visibility !== repo.visibility) {
      repo.visibility = body.visibility
      changed.push('visibility')
    }
    if (body.default_branch !== undefined && body.default_branch !== repo.defaultBranch) {
      repo.defaultBranch = body.default_branch
      changed.push('default_branch')
    }
    if (body.maintainers !== undefined) {
      const next = [...new Set(body.maintainers)].sort()
      if (JSON.stringify([...repo.maintainers].sort()) !== JSON.stringify(next)) {
        repo.maintainers = new Set(next)
        for (const h of next) repo.collaborators.add(h)
        for (const c of repo.changes.values()) c.policyMemo = undefined
        changed.push('maintainers')
      }
    }
    if (renaming) {
      const to = `${repo.owner}/${body.name}`
      this.repos.delete(from)
      repo.name = body.name!
      this.repos.set(to, repo)
      this.svc.auth.renameRepo(from, to)
      this.svc.git?.setRepo?.(to, repo.storeId)
      if (from.toLowerCase() !== to.toLowerCase()) this.svc.git?.dropRepo?.(from)
      // The old address keeps working: it answers 308 with the new one. Any
      // alias that pointed at the old name follows the chain.
      for (const [key, value] of this.aliases)
        if (value === from || value.toLowerCase() === from.toLowerCase()) this.aliases.set(key, to)
      this.aliases.set(from.toLowerCase(), to)
      this.aliases.delete(to.toLowerCase())
      this.svc.hooks?.rename(from, to)
      this.svc.extras?.rename(from, to)
      const runs = this.runsByRepo.get(from)
      if (runs) {
        this.runsByRepo.delete(from)
        this.runsByRepo.set(to, runs)
        for (const r of runs) r.repo = to
      }
      for (const t of this.teams.values())
        if (t.repos.has(from)) {
          t.repos.set(to, t.repos.get(from)!)
          t.repos.delete(from)
          t.updated = this.now()
          t.version++
        }
      changed.push('name')
    }
    if (changed.length) {
      repo.version++
      if (changed.includes('visibility')) this.accessRevision++
      // Search keeps the repository's name, description and visibility in every document.
      if (renaming || changed.includes('visibility') || changed.includes('description')) this.svc.search?.reset()
      this.emit(repo, 'repo.updated', this.asActor(p), { object: 'repo', id: repo.id, number: null }, changed, this.presentRepo(repo))
    }
    return this.presentRepo(repo)
  }

  async deleteRepo(owner: string, name: string, p: Principal, confirm: string | undefined, dry: boolean) {
    const repo = this.resolve(owner, name, p, 'write')
    this.assertAdmin(repo, p)
    const full = `${repo.owner}/${repo.name}`
    if (p.repos) throw apiError('forbidden', 'A token limited to repositories cannot delete one.')
    if (confirm !== full)
      throw apiError('invalid_request', `Deleting ${full} cannot be undone. Pass confirm=${full} to do it.`, {
        errors: [{ pointer: '/query/confirm', code: 'confirmation_required', message: `Send confirm=${full}.` }],
        hint: 'Check you are deleting the right repository, then repeat the request with ?confirm=owner/name.',
      })
    if (dry) return { deleted: false, full }
    // The event is written first, while the repository still exists to be named.
    this.emit(repo, 'repo.deleted', this.asActor(p), { object: 'repo', id: repo.id, number: null }, ['deleted'], null)
    this.repos.delete(full)
    this.aliases.delete(full.toLowerCase())
    for (const [key, value] of this.aliases) if (value.toLowerCase() === full.toLowerCase()) this.aliases.delete(key)
    this.svc.auth.dropRepo(full)
    this.svc.uploads.dropRepo(repo.id)
    this.svc.git?.dropRepo?.(full)
    this.deleted.set(full, repo.owner)
    this.deletedRepos.set(repo.id, { full, owner: repo.owner })
    this.deletedIds.set(full.toLowerCase(), repo.id)
    this.accessRevision++
    this.reposById.delete(repo.id)
    this.svc.hooks?.dropRepo(full)
    this.svc.extras?.drop(full)
    for (const t of this.teams.values())
      if (t.repos.delete(full)) {
        t.updated = this.now()
        t.version++
      }
    // Its runs end with it, and their tokens stop working.
    for (const r of this.runsByRepo.get(full) ?? []) {
      if (r.state === 'running') this.svc.auth.revoke(r.tokenId)
      this.runs.delete(r.id)
    }
    this.runsByRepo.delete(full)
    this.svc.search?.reset()
    return { deleted: true, full }
  }

  private hasRepoGrant(repo: RepoRec, p: Viewer) {
    if (!p) return false
    const full = `${repo.owner}/${repo.name}`.toLowerCase()
    if (p.repos && !p.repos.includes(full)) return false
    return this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) !== null
  }

  /** Read access that requires a real relationship, not public visibility. */
  async repoAccessStrict(owner: string, name: string, p: Viewer, need: 'read' | 'write' = 'read') {
    const r = this.resolve(owner, name, p, need)
    if (!this.hasRepoGrant(r, p)) throw apiError('not_found', `No repository ${owner}/${name}.`, {
      hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
    })
    return `${r.owner}/${r.name}`
  }

  /** Checks the caller may read or write a repository, and names it `owner/name`. */
  async repoAccess(owner: string, name: string, p: Viewer, need: 'read' | 'write') {
    const r = this.resolve(owner, name, p, need)
    return `${r.owner}/${r.name}`
  }

  async listAccounts(p: Principal): Promise<Array<z.infer<typeof S.Account>>> {
    const out: Array<z.infer<typeof S.Account>> = []
    for (const a of this.accounts.values())
      if (a.handle === p.handle || a.members.has(p.handle))
        out.push(this.presentAccount(a, p))
    return out
  }

  async getAccount(handle: string, p: Viewer) {
    const a = this.accounts.get(handle)
    if (!a) throw apiError('not_found', `No account ${handle}.`)
    return this.presentAccount(a, p)
  }

  private presentAccount(a: AccountRec, p: Viewer): z.infer<typeof S.Account> {
    return {
      object: 'account',
      id: a.id,
      handle: a.handle,
      name: a.name,
      kind: a.kind,
      role: !p ? null : a.handle === p.handle ? 'owner' : (a.members.get(p.handle) ?? null),
      url: `${this.urls.api}/accounts/${a.handle}`,
      html_url: `${this.urls.html}/${a.handle}`,
      created_at: iso(a.created),
    }
  }

  async canActAs(login: string, account: string) {
    return this.isMember(account, login)
  }

  async accountVersion(handle: string) {
    const a = this.accounts.get(handle)
    return a ? `${a.id}.${this.accessRevision}` : null
  }

  async listRepos(
    p: Viewer,
    q: { owner?: string; after: CursorPosition | null; limit: number },
  ): Promise<Page<z.infer<typeof S.Repo>>> {
    const all = [...this.repos.values()]
      .filter((r) => this.canRead(r, p) && (!q.owner || r.owner === q.owner))
      .sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1))
    const page = pageSorted(all, (r) => r.created, recId, { limit: q.limit, after: q.after, desc: true, stored: 'desc' })
    return { items: page.items.map((r) => this.presentRepo(r)), next: page.next }
  }

  async getRepo(owner: string, name: string, p: Viewer) {
    return this.presentRepo(this.resolve(owner, name, p))
  }

  async repoVersion(owner: string, name: string, p: Viewer) {
    return this.repoKey(this.resolve(owner, name, p))
  }

  async changeListVersion(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p)
    return `${r.id}.${r.changeRev}.${r.version}.${this.accessRevision}`
  }

  async issueListVersion(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p)
    return `${r.id}.${r.issueRev}.${r.version}.${this.accessRevision}`
  }

  private repoKey(r: RepoRec) {
    return `${r.id}.${r.version}.${r.rev}.${r.changes.size}.${r.issues.size}.${this.accessRevision}`
  }

  /** The event log's position, for conditional reads of the log itself. */
  eventVersion() {
    return `${this.events.head}.${this.events.oldest}`
  }

  async syncVersion(owner: string, name: string, p: Viewer) {
    const full = owner.startsWith('rep_') ? owner : `${owner}/${name}`
    return `${this.repoKey(this.repoForSync(full, p))}.${this.events.oldest}`
  }

  /** Sync accepts an old name and the current name; it resolves the stable id. */
  private repoForSync(full: string, p: Viewer) {
    const id = this.repoIdForHistory(full)
    const r = id ? this.reposById.get(id) : null
    if (!r || !this.canRead(r, p)) throw apiError('not_found', `No repository ${full}.`, {
      hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
    })
    return r
  }

  /** The repository id behind an address, after checking the caller may read it. */
  async repoIdOf(owner: string, name: string, p: Viewer) {
    return this.resolve(owner, name, p).id
  }

  /** Marks a repository's derived state (env metadata, say) as changed without an event. */
  async bumpRepo(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p, 'write')
    r.updated = this.now()
    r.version++
  }

  /** Whether the caller may read the repository with this stable id. */
  mayReadId(id: string | null, p: Viewer) {
    if (!id) return false
    const r = this.reposById.get(id)
    return r ? this.canRead(r, p) : false
  }

  async numberRef(owner: string, name: string, n: number, p: Viewer) {
    const r = this.resolve(owner, name, p)
    const type: 'change' | 'issue' | null = r.changes.has(n) ? 'change' : r.issues.has(n) ? 'issue' : null
    if (!type) throw apiError('not_found', `Nothing numbered #${n} in ${owner}/${name}.`)
    return {
      object: 'number_ref' as const,
      number: n,
      type,
      url: `${this.repoUrl(r)}/${type === 'change' ? 'changes' : 'issues'}/${n}`,
    }
  }

  async context(owner: string, name: string, p: Viewer): Promise<z.infer<typeof S.Context>> {
    const r = this.resolve(owner, name, p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const open: Array<ChangeRec> = []
    if (canPull)
      for (let k = r.byUpdated.items.length - 1; k >= 0 && open.length < 50; k--) {
        const c = r.byUpdated.items[k]
        if (c.state === 'open' || c.state === 'draft') open.push(c)
      }
    const issues: Array<IssueRec> = []
    if (canIssue)
      for (let k = r.issuesByNumber.items.length - 1; k >= 0 && issues.length < 50; k--) {
        const i = r.issuesByNumber.items[k]
        if (i.state === 'open') issues.push(i)
      }
    return {
      object: 'context',
      repo: this.presentRepo(r),
      changes: open.slice(0, 50).map((c) => {
        const reqs = this.evaluate(r, c)
        return {
          number: c.number,
          title: c.title,
          state: c.state,
          author: this.actor(c.author),
          checks: this.checksFor(c).state,
          policy: this.policyState(reqs),
          blocking: reqs
            .filter((q) => q.state === 'fail' || q.state === 'pending')
            .map((q) => `${q.id}:${q.state}`),
        }
      }),
      issues: issues.slice(0, 50).map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels,
      })),
      policy: { rules: 4, mode: 'enforce' },
      env: p?.scopes.has('secrets:schema') && this.hasRepoGrant(r, p)
        ? this.svc.extras
          ? this.svc.extras.for(`${r.owner}/${r.name}`).env.map((v) => ({ name: v.name, kind: v.kind, set: [...v.set] }))
          : r.env
        : [],
      cursor: `e_${r.id}_${this.events.head}`,
    }
  }

  // ----- changes ----------------------------------------------------------

  private getChangeRec(repo: RepoRec, ref: string): ChangeRec {
    const n = /^\d+$/.test(ref) ? Number(ref) : undefined
    let c: ChangeRec | undefined
    if (n !== undefined) c = repo.changes.get(n)
    else if (ref.startsWith('chg_'))
      for (const x of repo.changes.values()) if (x.id === ref) c = x
    if (!c) throw apiError('not_found', `No change ${ref} in ${repo.owner}/${repo.name}.`)
    return c
  }

  async listChanges(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      state?: string
      author?: string
      label?: string
      branch?: string
      sort: 'updated_at' | 'number'
      desc: boolean
      after: CursorPosition | null
      limit: number
      expand: ReadonlyArray<string>
    },
  ): Promise<Page<Pre>> {
    const repo = this.resolve(owner, name, p)
    const source = q.sort === 'updated_at' ? repo.byUpdated : repo.byNumber
    const keyOf = q.sort === 'updated_at' ? changeUpdated : changeNumber
    const states = q.state && q.state !== 'all' ? q.state.split(',') : null
    const everything = q.state === 'all'
    const page = pageSorted(source.items, keyOf, recId, {
      limit: q.limit,
      stored: 'asc',
      after: q.after,
      desc: q.desc,
      match: (c) =>
        (everything ||
          (states ? states.includes(c.state) : c.state === 'open' || c.state === 'draft')) &&
        (!q.author || c.author.handle === q.author) &&
        (!q.branch || c.branch === q.branch) &&
        (!q.label || c.labels.includes(q.label)),
    })
    return {
      items: page.items.map((c) => this.shownChange(repo, c, p, q.expand)),
      next: page.next,
    }
  }

  async getChange(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand: ReadonlyArray<string> = [],
  ) {
    const repo = this.resolve(owner, name, p)
    return this.shownChange(repo, this.getChangeRec(repo, ref), p, expand)
  }

  async changeVersion(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand: ReadonlyArray<string> = [],
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    // The change's own version covers everything in its representation.
    // The repository version covers the `repo` stub and the stack's other members.
    // The id keeps a deleted change's cached body from matching a new one.
    return this.changeKey(repo, c, expand)
  }

  private changeKey(repo: RepoRec, c: ChangeRec, expand: ReadonlyArray<string> = []) {
    return `${c.id}.${c.version}.${c.stackId ? this.stackRev(repo, c) : 0}.${repo.version}.${this.accessRevision}${expand.includes('repo') ? `.${repo.rev}` : ''}`
  }

  private stackRev(repo: RepoRec, c: ChangeRec) {
    let rev = 0
    for (const n of repo.stacks.get(c.stackId!) ?? [])
      rev += repo.changes.get(n)?.version ?? 0
    return rev
  }

  async createChange(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      branch: string
      base?: string
      title?: string
      description?: string
      draft?: boolean
      sha?: string
      dry_run?: boolean
    },
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const by = this.asActor(p!)
    const sha = body.sha ?? this.fakeSha(repo, body.branch)
    const existing = repo.openChangeByBranch.get(body.branch)
    if (existing) {
      if (this.head(existing).sha === sha)
        return { change: this.presentChange(repo, existing, p), outcome: 'unchanged' as const }
      if (body.dry_run) {
        const prev = this.head(existing)
        const preview = {
          ...existing,
          patchSets: [...existing.patchSets, {
            ...prev,
            n: prev.n + 1,
            sha,
            tree: sha.slice(0, 7),
            kind: 'update' as const,
            note: 'Updated from branch',
            author: by,
            created: this.now(),
            files: Object.fromEntries(Object.entries(prev.files).map(([path, f]) => [path, { ...f, hash: `${f.hash.slice(0, 4)}${prev.n + 1}` }])),
          }],
          reviews: existing.reviews.map((r) => ({ ...r, carries: false })),
          latest: undefined,
          policyMemo: undefined,
          updated: Math.max(this.now(), existing.updated + 1),
          version: existing.version + 1,
        }
        return { change: this.presentChange(repo, preview, p), outcome: 'patch_set_added' as const }
      }
      this.pushPatchSet(repo, existing, by, { sha, kind: 'update', note: 'Updated from branch' })
      return { change: this.presentChange(repo, existing, p), outcome: 'patch_set_added' as const }
    }
    const at = this.now()
    const number = repo.nextNumber
    const c: ChangeRec = {
      id: newId('change', at),
      number,
      title: body.title ?? `Changes from ${body.branch}`,
      description: body.description ?? '',
      state: body.draft ? 'draft' : 'open',
      author: by,
      base: body.base ?? repo.defaultBranch,
      branch: body.branch,
      patchSets: [],
      reviews: [],
      findings: [],
      checks: [],
      stackId: null,
      labels: [],
      mirrors: [],
      created: at,
      updated: at,
      landed: null,
      version: 1,
    }
    c.patchSets.push({
      n: 1,
      sha,
      tree: sha.slice(0, 7),
      note: 'Initial version',
      author: by,
      created: at,
      files: { [`src/${body.branch.replace(/\W+/g, '_')}.rs`]: { hash: sha.slice(0, 6), add: 10, del: 1 } },
      kind: 'initial',
    })
    if (body.dry_run) return { change: this.presentChange(repo, c, p), outcome: 'created' as const }
    repo.nextNumber++
    this.seedChange(repo, c)
    this.changeEvent(repo, c, 'change.opened', by, ['state'])
    return { change: this.presentChange(repo, c, p), outcome: 'created' as const }
  }

  private shaCounter = 0

  /** Stands in for the branch head the git store would report. */
  private fakeSha(repo: RepoRec, branch: string) {
    return createHash('sha1')
      .update(`${repo.id}/${branch}/${this.now()}/${this.shaCounter++}`)
      .digest('hex')
  }

  private pushPatchSet(
    repo: RepoRec,
    c: ChangeRec,
    by: ActorRec,
    ps: { sha: string; kind: 'update' | 'rebase'; note: string; tree?: string },
  ) {
    const prev = this.head(c)
    const tree = ps.tree ?? (ps.kind === 'rebase' ? prev.tree : ps.sha.slice(0, 7))
    this.touchChange(repo, c, () => {
      c.patchSets.push({
        n: prev.n + 1,
        sha: ps.sha,
        tree,
        note: ps.note,
        author: by,
        created: this.now(),
        files:
          ps.kind === 'rebase'
            ? prev.files
            : Object.fromEntries(
                Object.entries(prev.files).map(([path, f]) => [
                  path,
                  { ...f, hash: `${f.hash.slice(0, 4)}${prev.n + 1}` },
                ]),
              ),
        kind: ps.kind,
      })
      // An approval follows a rewrite only when the code did not change.
      if (ps.kind === 'update') for (const r of c.reviews) r.carries = false
    })
    this.changeEvent(repo, c, 'change.updated', by, ['head.patch_set', 'policy.state', 'checks.state'])
  }

  async updateChange(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { title?: string; description?: string; labels?: Array<string> },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    this.assertMatch(ifMatch, `${c.id}.${c.version}`, () => this.presentChange(repo, c, p))
    const same = (body.title === undefined || body.title === c.title) &&
      (body.description === undefined || body.description === c.description) &&
      (body.labels === undefined || JSON.stringify(body.labels) === JSON.stringify(c.labels))
    if (same) return this.presentChange(repo, c, p)
    if (!dry) {
      const by = this.asActor(p!)
      const changed = Object.keys(body)
      this.touchChange(repo, c, () => {
        if (body.title !== undefined) c.title = body.title
        if (body.description !== undefined) c.description = body.description
        if (body.labels !== undefined) c.labels = body.labels
      })
      this.changeEvent(repo, c, 'change.updated', by, changed)
    }
    const shown = dry
      ? { ...c, title: body.title ?? c.title, description: body.description ?? c.description, labels: body.labels ?? c.labels }
      : c
    return this.presentChange(repo, shown, p)
  }

  /** Public entry for operations that keep their own versioned records. */
  assertVersion(ifMatch: string | null, version: string, current: () => unknown) {
    this.assertMatch(ifMatch, version, current)
  }

  /** `If-Match` carries the ETag the client read: `W/"<version>"`. */
  private assertMatch(
    ifMatch: string | null,
    version: string,
    current: () => unknown,
  ) {
    if (ifMatch === null) return
    const tags = ifMatch.split(',').map((t) => t.trim().replace(/^W\//, '').replace(/"/g, ''))
    if (tags.includes('*') || tags.some((t) => t === version || t.startsWith(`${version}-`) || t.startsWith(`${version}.`)))
      return
    throw apiError('version_mismatch', 'The object changed since you read it.', {
      extra: { current: current() },
    })
  }

  async listPatchSets(owner: string, name: string, ref: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.patchSets.map((ps) => this.presentPatchSet(repo, c, ps))
  }

  private presentPatchSet(
    repo: RepoRec,
    c: ChangeRec,
    ps: PatchSetRec,
  ): z.infer<typeof S.PatchSet> {
    return {
      object: 'patch_set',
      number: ps.n,
      change: c.number,
      sha: ps.sha,
      tree: ps.tree,
      note: ps.note,
      author: this.actor(ps.author),
      files: Object.keys(ps.files).length,
      url: `${this.repoUrl(repo)}/changes/${c.number}/patch-sets/${ps.n}`,
      created_at: iso(ps.created),
    }
  }

  async getPatchSet(owner: string, name: string, ref: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const ps = c.patchSets[n - 1]
    if (!ps) throw apiError('not_found', `Change #${c.number} has no patch set ${n}.`)
    return this.presentPatchSet(repo, c, ps)
  }

  async addPatchSet(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { sha: string; kind: 'update' | 'rebase'; note?: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    if (c.state === 'landed' || c.state === 'abandoned')
      throw apiError('invalid_state', `Change #${c.number} is ${c.state}.`)
    if (dry) {
      const prev = this.head(c)
      const preview = {
        ...prev,
        n: prev.n + 1,
        sha: body.sha,
        tree: body.kind === 'rebase' ? prev.tree : body.sha.slice(0, 7),
        kind: body.kind,
        note: body.note ?? (body.kind === 'rebase' ? 'Rebased' : 'Updated'),
        author: this.asActor(p!),
        created: this.now(),
      }
      return this.presentPatchSet(repo, c, preview)
    }
    this.pushPatchSet(repo, c, this.asActor(p!), {
        sha: body.sha,
        kind: body.kind,
        note: body.note ?? (body.kind === 'rebase' ? 'Rebased' : 'Updated'),
      })
    return this.presentPatchSet(repo, c, this.head(c))
  }

  async comparePatchSets(
    owner: string,
    name: string,
    ref: string,
    from: number,
    to: number,
    p: Viewer,
  ): Promise<z.infer<typeof S.PatchSetComparison>> {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const a = c.patchSets[from - 1]
    const b = c.patchSets[to - 1]
    if (!a || !b)
      throw apiError('not_found', `Change #${c.number} has ${c.patchSets.length} patch sets.`)
    const files: z.infer<typeof S.PatchSetComparison>['files'] = []
    let unchanged = 0
    for (const path of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
      const x = a.files[path]
      const y = b.files[path]
      if (x && y && x.hash === y.hash) unchanged++
      else
        files.push({
          path,
          status: !x ? 'added' : !y ? 'removed' : 'modified',
          additions: Math.max(0, (y?.add ?? 0) - (x?.add ?? 0)) || (y && !x ? y.add : 0),
          deletions: Math.max(0, (y?.del ?? 0) - (x?.del ?? 0)) || (x && !y ? x.del : 0),
        })
    }
    return {
      object: 'patch_set_comparison',
      change: c.number,
      from,
      to,
      files,
      unchanged_files: unchanged,
    }
  }

  async review(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { state: ReviewRec['state']; body?: string; patch_set?: number },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const by = this.asActor(p!)
    if (c.state !== 'open' && c.state !== 'draft')
      throw apiError('invalid_state', `Change #${c.number} is ${c.state}.`)
    if (body.state === 'approved' && c.author.handle === by.handle)
      throw apiError(
        by.class === 'human' ? 'forbidden' : 'human_required',
        'You cannot approve your own change.',
        { hint: 'Ask someone else to review it.' },
      )
    const patchSet = body.patch_set ?? this.head(c).n
    if (patchSet < 1 || patchSet > c.patchSets.length)
      throw apiError('invalid_request', `Change #${c.number} has no patch set ${patchSet}.`, {
        errors: [{ pointer: '/body/patch_set', code: 'out_of_range', message: `1 to ${c.patchSets.length}` }],
      })
    const review: ReviewRec = {
      id: newId('review', this.now()),
      actor: by,
      state: body.state,
      patchSet,
      carries: patchSet === this.head(c).n,
      body: body.body ?? '',
      created: this.now(),
    }
    if (!dry) {
      this.touchChange(repo, c, () => c.reviews.push(review))
      this.changeEvent(repo, c, 'change.reviewed', by, ['reviewers', 'policy.state'])
    }
    return {
      object: 'review' as const,
      id: review.id,
      actor: this.actor(by),
      state: review.state,
      patch_set: review.patchSet,
      carries_to_head: review.carries,
      body: review.body,
      created_at: iso(review.created),
    }
  }

  async listFindings(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    state?: string,
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.findings
      .filter((f) => !state || state === 'all' || f.state === state)
      .map((f) => this.presentFinding(repo, c, f))
  }

  async setFinding(
    owner: string,
    name: string,
    ref: string,
    findingId: string,
    p: Viewer,
    to: 'resolved' | 'dismissed',
    reason: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const f = c.findings.find((x) => x.id === findingId || x.label === findingId)
    if (!f) throw apiError('not_found', `No finding ${findingId} on #${c.number}.`)
    if (to === 'dismissed' && !reason)
      throw apiError('invalid_request', 'Dismissing needs a reason.', {
        errors: [{ pointer: '/body/reason', code: 'required', message: 'Say why it is dismissed.' }],
      })
    if (!dry && f.state !== to) {
      this.touchChange(repo, c, () => {
        f.state = to
        f.reason = reason
      })
      this.changeEvent(repo, c, 'finding.resolved', this.asActor(p!), ['findings', 'policy.state'])
    }
    if (dry && f.state !== to) return this.presentFinding(repo, c, { ...f, state: to, reason })
    return this.presentFinding(repo, c, f)
  }

  async reportCheck(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: {
      key: string
      state: CheckRec['state']
      tree: string
      name?: string
      details_url?: string
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const found = c.checks.find((k) => k.key === body.key && k.tree === body.tree)
    let outcome: 'created' | 'updated' | 'unchanged' = 'created'
    let rec = found
    if (found) {
      const nextDetails = body.details_url ?? found.detailsUrl
      outcome =
        found.state === body.state && nextDetails === found.detailsUrl
          ? 'unchanged'
          : 'updated'
    }
    if (!dry && outcome !== 'unchanged') {
      this.touchChange(repo, c, () => {
        if (found) {
          found.state = body.state
          found.detailsUrl = body.details_url ?? found.detailsUrl
          found.updated = this.now()
        } else {
          rec = {
            id: newId('check', this.now()),
            key: body.key,
            name: body.name ?? body.key,
            state: body.state,
            tree: body.tree,
            detailsUrl: body.details_url ?? null,
            created: this.now(),
            updated: this.now(),
          }
          c.checks.push(rec)
        }
      })
      this.changeEvent(
        repo,
        c,
        body.state === 'fail' ? 'ci.failed' : 'check.reported',
        this.asActor(p!),
        ['checks', 'policy.state'],
      )
    }
    const out = dry && found
      ? { ...found, state: body.state, detailsUrl: body.details_url ?? found.detailsUrl, updated: this.now() }
      : rec ?? {
          id: newId('check', this.now()),
          key: body.key,
          name: body.name ?? body.key,
          state: body.state,
          tree: body.tree,
          detailsUrl: body.details_url ?? null,
          created: this.now(),
          updated: this.now(),
        }
    return { check: this.presentCheck(out), outcome }
  }

  async listChecks(owner: string, name: string, ref: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.checks.map((k) => this.presentCheck(k))
  }

  async policy(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    assume?: Assume,
  ): Promise<z.infer<typeof S.PolicyEvaluation>> {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const reqs = this.evaluate(repo, c, assume)
    const assumed: Array<string> = []
    for (const h of assume?.approve ?? []) assumed.push(`approve:${h}`)
    for (const [k, v] of Object.entries(assume?.checks ?? {})) assumed.push(`check:${k}=${v}`)
    for (const l of assume?.resolve ?? []) assumed.push(`resolve:${l}`)
    return {
      object: 'policy_evaluation',
      change: c.number,
      tree: this.head(c).tree,
      state: this.policyState(reqs),
      requirements: reqs,
      assumed,
    }
  }

  /** Mark a draft ready, abandon, restore. */
  async transition(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    action: 'ready' | 'abandon' | 'restore',
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    if (!p!.scopes.has('pulls:write'))
      throw apiError('insufficient_scope', 'This needs pulls:write.', {
        extra: { required_scopes: ['pulls:write'], token_scopes: [...p!.scopes] },
      })
    const from: Record<typeof action, Array<ChangeRec['state']>> = {
      ready: ['draft'],
      abandon: ['draft', 'open'],
      restore: ['abandoned'],
    }
    if (!from[action].includes(c.state))
      throw apiError('invalid_state', `Change #${c.number} is ${c.state}; it cannot be ${action === 'ready' ? 'marked ready' : action === 'abandon' ? 'abandoned' : 'restored'}.`)
    const next = action === 'abandon' ? 'abandoned' : 'open'
    if (action === 'restore') {
      const branchOwner = repo.openChangeByBranch.get(c.branch)
      if (branchOwner && branchOwner !== c)
        throw apiError('invalid_state', `#${branchOwner.number} already owns branch ${c.branch}.`, {
          hint: 'Land or abandon that change before restoring this one.',
        })
    }
    if (dry) return this.presentChange(repo, { ...c, state: next }, p)
    this.touchChange(repo, c, () => {
        c.state = next
      })
    this.changeEvent(
      repo,
      c,
      action === 'abandon' ? 'change.abandoned' : 'change.updated',
      this.asActor(p!),
      ['state'],
    )
    return this.presentChange(repo, c, p)
  }

  /** Land one change. `expected_tree` must be the tree that was checked. */
  async land(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { expected_tree: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    this.checkLandable(repo, c, p!, body.expected_tree)
    if (!dry) this.doLand(repo, c, this.asActor(p!))
    else return this.presentChange(repo, { ...c, state: 'landed', landed: this.now() }, p)
    return this.presentChange(repo, c, p)
  }

  private checkLandable(repo: RepoRec, c: ChangeRec, p: Principal, expectedTree: string) {
    if (!p.scopes.has('pulls:merge'))
      throw apiError('insufficient_scope', 'Landing needs pulls:merge.', {
        extra: { required_scopes: ['pulls:merge'], token_scopes: [...p.scopes] },
      })
    if (c.state !== 'open')
      throw apiError(
        'invalid_state',
        c.state === 'draft'
          ? `#${c.number} is a draft. Mark it ready first.`
          : `#${c.number} is ${c.state}.`,
      )
    const head = this.head(c)
    if (head.tree !== expectedTree)
      throw apiError('stale_head', `#${c.number} is now at ${head.tree}, not ${expectedTree}.`, {
        extra: { current: { patch_set: head.n, tree: head.tree, sha: head.sha } },
      })
    const parent = this.parentOf(repo, c)
    if (parent && parent.state !== 'landed')
      throw apiError('parent_not_landed', `#${parent.number} below #${c.number} has not landed.`, {
        extra: { parent: parent.number },
      })
    const reqs = this.evaluate(repo, c)
    const bad = reqs.filter((r) => r.state === 'fail' || r.state === 'pending')
    if (bad.length)
      throw apiError(
        'policy_blocked',
        `#${c.number} cannot land: ${bad.map((r) => r.detail.replace(/\.$/, '')).join('; ')}.`,
        {
          extra: { requirements: reqs },
          // Only waiting is left when nothing has failed: it can clear by itself.
          retryable: !bad.some((r) => r.state === 'fail'),
          hint: bad.some((r) => r.state === 'fail')
            ? 'Stop and report the failed requirements. Do not work around the policy.'
            : 'Wait for the pending requirements, then try again.',
        },
      )
  }

  private doLand(repo: RepoRec, c: ChangeRec, by: ActorRec) {
    this.touchChange(repo, c, () => {
      c.state = 'landed'
      c.landed = this.now()
    })
    this.changeEvent(repo, c, 'change.landed', by, ['state', 'landed_at'])
    // Changes above it are rebased onto the result. Their trees do not change,
    // so approvals and evidence stay valid.
    if (c.stackId) {
      const members = repo.stacks.get(c.stackId) ?? []
      const above = repo.changes.get(members[members.indexOf(c.number) + 1])
      if (above && (above.state === 'open' || above.state === 'draft'))
        this.pushPatchSet(repo, above, by, {
          sha: this.fakeSha(repo, `${above.branch}/rebase`),
          kind: 'rebase',
          note: `Rebased onto main after #${c.number} landed`,
        })
    }
  }

  async landStack(
    owner: string,
    name: string,
    stackId: string,
    p: Viewer,
    body: { expected_trees: Record<string, string> },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const members = repo.stacks.get(stackId)
    if (!members) throw apiError('not_found', `No stack ${stackId}.`)
    const by = this.asActor(p!)
    const open = members.map((n) => repo.changes.get(n)!).filter((c) => c.state === 'open')
    if (open.length === 0) throw apiError('invalid_state', 'Nothing in this stack is open.')
    // A draft or abandoned member between two open members would make the
    // operation fail after the ones below it already landed.
    const firstAt = members.indexOf(open[0].number)
    const lastAt = members.indexOf(open[open.length - 1].number)
    for (const n of members.slice(firstAt, lastAt + 1)) {
      const c = repo.changes.get(n)!
      if (c.state !== 'open' && c.state !== 'landed')
        throw apiError('invalid_state', `#${c.number} in this stack is ${c.state}.`, {
          hint: 'Every change between the open ones must be open or already landed.',
        })
    }
    // Check the first now so an obvious refusal is a plain error, not an operation.
    const first = open[0]
    const trees = body.expected_trees
    const missing = open.filter((c) => !trees[String(c.number)]).map((c) => c.number)
    if (missing.length)
      throw apiError('invalid_request', `expected_trees is missing ${missing.map((n) => `#${n}`).join(', ')}.`, {
        hint: 'Send the tree you checked for every open change in the stack.',
      })
    // Every open member must be preflighted against the tree the caller checked,
    // so a later stale member cannot fail after earlier ones have already landed.
    for (const c of open) {
      const head = this.head(c)
      const expected = trees[String(c.number)]
      if (head.tree !== expected)
        throw apiError('stale_head', `#${c.number} is now at ${head.tree}, not ${expected}.`, {
          extra: { current: { patch_set: head.n, tree: head.tree, sha: head.sha } },
        })
    }
    this.checkLandable(repo, first, p!, trees[String(first.number)])
    const op: OperationRec = {
      id: newId('operation', this.now()),
      kind: 'stack.land',
      repoId: repo.id,
      state: 'queued',
      done: 0,
      total: open.length,
      result: null,
      error: null,
      created: this.now(),
      finished: null,
    }
    if (dry) return this.presentOp(op)
    this.operations.set(op.id, op)
    const step = (i: number) => {
      op.state = 'running'
      if (i >= open.length) {
        op.state = 'succeeded'
        op.finished = this.now()
        op.result = { object: 'stack', id: stackId, url: `${this.repoUrl(repo)}/stacks/${stackId}` }
        this.emit(repo, 'operation.finished', by, { object: 'operation', id: op.id, number: null }, ['state'], null)
        return
      }
      const c = open[i]
      try {
        this.checkLandable(repo, c, p!, trees[String(c.number)])
        this.doLand(repo, c, by)
        op.done = i + 1
        setTimeout(() => step(i + 1), this.stepDelayMs)
      } catch (e) {
        op.state = 'failed'
        op.finished = this.now()
        const failure = e as { code?: string; detail?: string }
        op.error = { code: failure.code ?? 'internal', detail: failure.detail ?? 'Unexpected failure.' }
        this.emit(repo, 'operation.finished', by, { object: 'operation', id: op.id, number: null }, ['state'], null)
      }
    }
    setTimeout(() => step(0), this.stepDelayMs)
    return this.presentOp(op)
  }

  async getOperation(id: string, p: Viewer) {
    const op = this.operations.get(id)
    if (!op || !p || !this.mayReadId(op.repoId, p)) throw apiError('not_found', `No operation ${id}.`)
    return this.presentOp(op)
  }

  operationRepoId(id: string) {
    return this.operations.get(id)?.repoId ?? null
  }

  async operationVersion(id: string, p: Viewer) {    const op = this.operations.get(id)
    if (!op || !p || !this.mayReadId(op.repoId, p)) return null
    return `${id}.${op.state}.${op.done}`
  }

  // ----- issues -----------------------------------------------------------

  async listIssues(
    owner: string,
    name: string,
    p: Viewer,
    q: { state: string; label?: string; author?: string; after: CursorPosition | null; limit: number },
  ) {
    const repo = this.resolve(owner, name, p)
    const page = pageSorted(repo.issuesByNumber.items, issueNumber, recId, {
      limit: q.limit,
      after: q.after,
      desc: true,
      stored: 'asc',
      match: (i) =>
        (q.state === 'all' || i.state === q.state) &&
        (!q.label || i.labels.includes(q.label)) &&
        (!q.author || i.author.handle === q.author),
    })
    return { items: page.items.map((i) => this.shownIssue(repo, i)), next: page.next }
  }

  async getIssue(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const i = repo.issues.get(n)
    if (!i) throw apiError('not_found', `No issue #${n} in ${owner}/${name}.`)
    return this.presentIssue(repo, i)
  }

  async issueVersion(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const i = repo.issues.get(n)
    return i ? `${i.id}.${i.version}.${repo.version}.${this.accessRevision}` : null
  }

  async createIssue(
    owner: string,
    name: string,
    p: Viewer,
    body: { title: string; body?: string; labels?: Array<string> },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const same = repo.openIssueByTitle.get(body.title)
    if (same) return { issue: this.presentIssue(repo, same), outcome: 'unchanged' as const }
    const at = this.now()
    const by = this.asActor(p!)
    const issue: IssueRec = {
      id: newId('issue', at),
      number: repo.nextNumber,
      title: body.title,
      body: body.body ?? '',
      state: 'open',
      author: by,
      labels: body.labels ?? [],
      created: at,
      updated: at,
      closed: null,
      version: 1,
    }
    // The same object goes into the event and the answer, so it is built once.
    const shown = this.presentIssue(repo, issue)
    if (!dry) {
      repo.nextNumber++
      repo.issueRev++
      this.seedIssue(repo, issue)
      this.emit(repo, 'issue.created', by, { object: 'issue', id: issue.id, number: issue.number }, ['state'], shown)
    }
    return { issue: shown, outcome: 'created' as const }
  }

  async updateIssue(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    body: { title?: string; body?: string; labels?: Array<string>; state?: 'open' | 'closed' },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const i = repo.issues.get(n)
    if (!i) throw apiError('not_found', `No issue #${n} in ${owner}/${name}.`)
    this.assertMatch(ifMatch, `${i.id}.${i.version}`, () => this.presentIssue(repo, i))
    const same = (body.title === undefined || body.title === i.title) &&
      (body.body === undefined || body.body === i.body) &&
      (body.labels === undefined || JSON.stringify(body.labels) === JSON.stringify(i.labels)) &&
      (body.state === undefined || body.state === i.state)
    if (same) return this.presentIssue(repo, i)
    if (!dry) {
      if (repo.openIssueByTitle.get(i.title) === i) repo.openIssueByTitle.delete(i.title)
      if (body.title !== undefined) i.title = body.title
      if (body.body !== undefined) i.body = body.body
      if (body.labels !== undefined) i.labels = body.labels
      if (body.state !== undefined && body.state !== i.state) {
        i.state = body.state
        i.closed = body.state === 'closed' ? this.now() : null
      }
      if (i.state === 'open' && !repo.openIssueByTitle.has(i.title)) repo.openIssueByTitle.set(i.title, i)
      i.updated = this.now()
      i.version++
      const shown = this.presentIssue(repo, i)
      repo.issueRev++
      this.emit(repo, i.state === 'closed' ? 'issue.closed' : 'issue.updated', this.asActor(p!),
        { object: 'issue', id: i.id, number: i.number }, Object.keys(body), shown)
      return shown
    }
    if (dry) {
      const preview = {
        ...i,
        title: body.title ?? i.title,
        body: body.body ?? i.body,
        labels: body.labels ?? i.labels,
        state: body.state ?? i.state,
        closed: body.state === 'closed' ? this.now() : body.state === 'open' ? null : i.closed,
      }
      return this.presentIssue(repo, preview)
    }
    return this.presentIssue(repo, i)
  }

  // ----- events and sync --------------------------------------------------

  /** A predicate for the repositories `p` can read. Null repo means an account-level event. */
  canSee(p: Viewer) {
    return this.readableRepos(p)
  }

  /** Names of deleted repositories, with the account that owned each. */
  private readonly deleted = new Map<string, string>()
  private readonly deletedRepos = new Map<string, { full: string; owner: string }>()
  private readonly deletedIds = new Map<string, string>()

  private administered(full: string, p: Viewer): boolean {
    if (!p) return false
    if (p.repos && !p.repos.includes(full.toLowerCase())) return false
    const owner = this.deleted.get(full)
    if (!owner) return false
    const role = owner === p.handle ? 'owner' : this.accounts.get(owner)?.members.get(p.handle)
    return role === 'owner' || role === 'admin'
  }

  private readableRepos(p: Viewer) {
    const cache = new Map<string, boolean>()
    return (full: string | null) => {
      if (!full) return !!p
      let ok = cache.get(full)
      if (ok === undefined) {
        const r = this.repos.get(full)
        // The history of a deleted repository stays readable by those who administered it.
        ok = r ? this.canRead(r, p) : this.administered(full, p)
        cache.set(full, ok)
      }
      return ok
    }
  }

  private readableRepoIds(p: Viewer) {
    const cache = new Map<string, boolean>()
    return (id: string | null) => {
      if (!id) return !!p
      let ok = cache.get(id)
      if (ok === undefined) {
        const r = this.reposById.get(id)
        if (r) ok = this.canRead(r, p)
        else {
          // The history of a deleted repository stays readable by those who administered it.
          const d = this.deletedRepos.get(id)
          ok = d ? this.administered(d.full, p) : false
        }
        cache.set(id, ok)
      }
      return ok
    }
  }

  canSeeId(p: Viewer) {
    return this.readableRepoIds(p)
  }

  /** The event log's position for one repository, after checking the caller may read it. */
  async repoHistoryVersion(full: string, p: Viewer) {
    const id = this.repoIdForHistory(full)
    if (!id) throw apiError('not_found', `No repository ${full}.`)
    if (!this.readableRepoIds(p)(id)) throw apiError('not_found', `No repository ${full}.`, {
      hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
    })
    const list = this.events.repoEvents(id)
    return `${id}.${list.at(-1)?.sequence ?? 0}.${this.events.oldest}`
  }

  /** The stable id behind a repository address, without requiring that it still exists. */
  repoIdForHistory(full: string): string | null {
    if (full.startsWith('rep_'))
      return this.reposById.has(full) || this.deletedRepos.has(full) ? full : this.deletedIds.get(full) ?? null
    const direct = this.repos.get(full) ?? this.byLower(full.toLowerCase())
    if (direct) return direct.id
    let key = full.toLowerCase()
    const seen = new Set<string>([key])
    for (let i = 0; i < 10; i++) {
      const next = this.aliases.get(key)
      if (!next || seen.has(next.toLowerCase())) break
      key = next.toLowerCase()
      seen.add(key)
    }
    const repo = this.repos.get(key) ?? this.byLower(key)
    if (repo) return repo.id
    const to = this.aliases.get(key)
    if (to) return this.repos.get(to)?.id ?? this.deletedIds.get(to.toLowerCase()) ?? null
    return this.deletedIds.get(key) ?? null
  }

  async listEvents(
    p: Viewer,
    q: { repo?: string; type?: string; after: CursorPosition | null; limit: number },
  ) {
    const can = this.readableRepoIds(p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const types = q.type ? q.type.split(',') : null
    const typeOk = (t: string) =>
      !types || types.some((x) => (x.endsWith('.*') ? t.startsWith(x.slice(0, -1)) : x === t))
    const scopeOk = (t: string) =>
      t.startsWith('issue.') ? canIssue : /^(change|finding|check|ci|operation)\./.test(t) ? canPull : true
    // A repository's own list when one is asked for, so a quiet repository is not
    // found by reading everyone else's events. The key is the stable id, so a
    // rename does not split the history.
    const repoId = q.repo ? this.repoIdForHistory(q.repo) : null
    const source = q.repo ? (repoId ? this.events.repoEvents(repoId) : []) : this.events.all()
    const page = pageSorted(source, (e) => e.sequence, seqId, {
      limit: q.limit,
      after: q.after,
      desc: false,
      stored: 'asc',
      match: (e) => typeOk(e.type) && scopeOk(e.type) && can(e.repoId),
    })
    // An event never changes, so its text is its own version.
    return {
      items: page.items.map((e: StoredEvent) => new Pre(e.json, () => parseEvent(e), `ev${e.sequence}`)),
      next: page.next,
    }
  }

  async sync(
    p: Viewer,
    q: { repo: string; cursor?: string; limit: number },
  ): Promise<z.infer<typeof S.Sync>> {
    const [owner, name] = q.repo.split('/')
    const repo = this.repoForSync(owner.startsWith('rep_') ? owner : `${owner}/${name ?? ''}`, p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const scopeOk = (t: string) =>
      t.startsWith('issue.') ? canIssue : /^(change|finding|check|ci|operation)\./.test(t) ? canPull : true
    const snapshot = (from: number, head: number, reset: boolean) => {
      const all: Array<Record<string, unknown>> = [
        this.presentRepo(repo),
        ...(canPull ? [...repo.changes.values()].map((c) => this.presentChange(repo, c, 'event') as unknown as Record<string, unknown>) : []),
        ...(canIssue ? [...repo.issues.values()].map((i) => this.presentIssue(repo, i) as unknown as Record<string, unknown>) : []),
      ]
      const slice = all.slice(from, from + q.limit)
      const more = from + q.limit < all.length
      return {
        object: 'sync' as const,
        cursor: more ? `s_${repo.id}_${head}_${from + q.limit}` : `e_${repo.id}_${head}`,
        objects: slice,
        deleted: [],
        has_more: more,
        reset,
      }
    }
    const c = q.cursor
    if (!c) return snapshot(0, this.events.head, true)
    const snap = /^s_(.+)_(\d+)_(\d+)$/.exec(c)
    if (snap) {
      if (snap[1] !== repo.id) throw apiError('cursor_mismatch', 'This cursor belongs to another repository.', {
        errors: [{ pointer: '/query/cursor', code: 'cursor_mismatch', message: 'Use a cursor returned for this repository.' }],
      })
      return snapshot(Number(snap[3]), Number(snap[2]), false)
    }
    const ev = /^e_(.+)_(\d+)$/.exec(c)
    if (!ev) throw apiError('invalid_request', 'The cursor is not valid.', {
      errors: [{ pointer: '/query/cursor', code: 'invalid_cursor', message: 'Use cursor exactly as returned.' }],
    })
    if (ev[1] !== repo.id) throw apiError('cursor_mismatch', 'This cursor belongs to another repository.', {
      errors: [{ pointer: '/query/cursor', code: 'cursor_mismatch', message: 'Use a cursor returned for this repository.' }],
    })
    const after = Number(ev[2])
    if (after + 1 < this.events.oldest) return snapshot(0, this.events.head, true)
    const { events: stored, exhausted, scannedTo } = this.events.since(after, q.limit, (e) => e.repoId === repo.id && scopeOk(e.type) && /^(repo|change|issue|finding|check|ci)\./.test(e.type))
    // Keep only the newest state of each object, and remember what was deleted
    // after the cursor so a local copy can remove it.
    const latest = new Map<string, Record<string, unknown>>()
    const deleted = new Map<string, { object: string; id: string }>()
    for (const s of stored) {
      const e = parseEvent(s)
      if (e.data) {
        latest.set(e.subject.id, e.data)
        deleted.delete(e.subject.id)
      } else if (e.type.endsWith('.deleted')) {
        latest.delete(e.subject.id)
        deleted.set(e.subject.id, { object: e.subject.object, id: e.subject.id })
      }
    }
    return {
      object: 'sync',
      cursor: `e_${repo.id}_${exhausted ? Math.max(scannedTo, this.events.head) : scannedTo}`,
      objects: [...latest.values()],
      deleted: [...deleted.values()],
      has_more: !exhausted,
      reset: false,
    }
  }
}

export type DomainCore = MemoryDomain
