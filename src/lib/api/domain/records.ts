import type { WebhookService } from '../webhooks'
import type { SearchIndex } from '../search'
import type { GitData } from '../git'
import type { UploadService } from '../uploads'
import type { ExtrasStore } from '../extras'
import type { AuthStore, Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'

export type Urls = { api: string; html: string }

export class Moved extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`${from} moved to ${to}`)
  }
}

export type ActorClass = 'human' | 'agent' | 'bot'
export type ActorRec = { id: string; handle: string; class: ActorClass }
export type Role = 'owner' | 'admin' | 'member'

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

export type FileStat = { hash: string; add: number; del: number }
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
  /** Collaborators granted only because they were maintainers, so removal revokes them. */
  maintainerGrants: Set<string>
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

export class Sorted<T> {
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

export const changeUpdated = (c: ChangeRec) => c.updated
export const changeNumber = (c: ChangeRec) => c.number
export const issueNumber = (i: IssueRec) => i.number
export const recId = (r: { id: string }) => r.id
export const seqId = (e: { sequence: number }) => String(e.sequence)

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

export type Assume = {
  approve?: Array<string>
  checks?: Record<string, 'pending' | 'pass' | 'fail'>
  resolve?: Array<string>
}
export type Requirement = z.infer<typeof S.Requirement>
export type PolicyState = 'met' | 'blocked' | 'pending'

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
