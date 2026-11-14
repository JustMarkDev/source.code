import type { LandingStepRec } from '../landing'
import type { FileError, Landing } from '../policy-file'
import type { Addressed, Anchor, Placement } from '../anchors'
import type { HookPort } from '../webhooks'
import type { SearchIndex } from '../search'
import type { GitData } from '../git'
import type { Mailer } from '../mail'
import type { Health } from '../health'
import type { UploadPort } from '../uploads'
import type { ExtrasPort } from '../extras'
import type { Principal, TokenService } from '../auth'
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
  bio: string
  created: number
  updated: number
  /** Rises when the name, the bio or the members change. */
  version: number
  members: Map<string, Role>
  /** Invitations by email that were not accepted yet, by id. */
  invites: Map<string, InviteRec>
}

export type InviteRec = {
  id: string
  email: string
  role: Role
  /** Hash of the secret in the emailed link. The secret is never kept. */
  secretHash: string
  invitedBy: string
  created: number
  expires: number
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
  issue?: number | null
  harness?: string | null
  links?: Array<string>
  transcript?: {
    uploadId: string
    size: number
    sha256: string
    redactions: number
  } | null
  /** The patch sets this run pushed, oldest first. */
  patchSets?: Array<{ change: number; patchSet: number }>
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
/**
 * Which run made a part, and with what kind of token. Filled in from the
 * caller's token, never sent by a client. Older parts have none.
 */
export type ViaRec = {
  run: string | null
  /** `push` when it came as a git push rather than through the API. */
  tokenKind: 'personal' | 'bot' | 'run' | 'oauth' | 'session' | 'push'
}
export type PatchSetRec = {
  n: number
  sha: string
  tree: string
  note: string
  author: ActorRec
  created: number
  files: Record<string, FileStat>
  kind: 'initial' | 'update' | 'rebase'
  /**
   * Every file the change touches, whole, as it is at this patch set. Null is
   * deleted. Absent when the change came without contents (a push the store
   * has not read), so a reader says the files are not available.
   */
  contents?: Record<string, string | null>
  via?: ViaRec
}
export type SuggestionRec = {
  summary: string
  file: string
  replace: Array<string>
  after: string | null
  lines: Array<string>
}
export type TestCaseRec = {
  suite: string
  name: string
  ms: number
  base: 'pass' | 'fail' | 'skip' | 'missing'
  head: 'pass' | 'fail' | 'skip'
}
export type ReviewRec = {
  id: string
  actor: ActorRec
  state: 'approved' | 'commented' | 'changes'
  patchSet: number
  carries: boolean
  body: string
  created: number
  via?: ViaRec
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
  suggestion?: SuggestionRec
  /** The same fix as instructions for an agent. */
  prompt?: string
  via?: ViaRec
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
  /** Test results, case by case, when the check reported them. */
  cases?: Array<TestCaseRec>
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
  /** Review comments, oldest first: on a line, on a file or on the whole change. */
  comments?: Array<ReviewCommentRec>
  /** The newest guide; a new one replaces it. */
  guide?: GuideRec
  /** Bumped by every comment write, for the comments list's version. */
  commentRev?: number
  /** The touched files as they are on the base. Null is "not there". */
  baseFiles?: Record<string, string | null>
  /** What policy said at `version`. A change does not change between versions. */
  policyMemo?: {
    version: number
    /** The repository's policy revision it was worked out under. */
    rev?: number
    reqs: Array<z.infer<typeof S.Requirement>>
  }
  latest?: { map: Map<string, ReviewRec>; seen: number }
  created: number
  updated: number
  landed: number | null
  version: number
}
/** How to read a change: what it does and its files in order. */
export type GuideRec = {
  patchSet: number
  summary: string
  order: Array<{ path: string; why: string; risk: 'low' | 'medium' | 'high' }>
  by: ActorRec
  run: string | null
  created: number
}
export type ReviewCommentRec = {
  id: string
  author: ActorRec
  body: string
  /** Null for a comment on the whole change. */
  file: string | null
  /** Null for a comment on the whole file. */
  line: number | null
  /** The patch set it was written against. */
  patchSet: number
  /** The comment that starts the thread; null when this one starts it. */
  replyTo: string | null
  resolved: boolean
  created: number
  updated: number
  version: number
  /** What a comment on a line is about, so it can follow the code. */
  anchor?: Anchor | null
  /** Where the thread is in each later patch set. Only on a thread's start. */
  placements?: Record<string, Placement>
  /** The patch set that answers this thread, said by whoever pushed it. */
  addressed?: Addressed | null
  via?: ViaRec
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
  /** Who is working on it. Absent is none. */
  assignees?: Array<ActorRec>
  /** Its comments, oldest first. Absent is none. */
  comments?: Array<CommentRec>
  /** Images and recordings attached to it, oldest first. */
  evidence?: Array<EvidenceRec>
  created: number
  updated: number
  closed: number | null
  version: number
}
export type CommentRec = {
  id: string
  author: ActorRec
  body: string
  created: number
  updated: number
  version: number
}
export type LabelColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
export type LabelRec = {
  id: string
  name: string
  color: LabelColor
  description: string
  created: number
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
  /** A landing's plan, each step with how it went. */
  steps?: Array<LandingStepRec>
}

export type RepoCategory = (typeof S.repoCategories)[number]

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
  /** People who starred it since it was created here. `stars` counts them too. */
  starredBy: Set<string>
  /** When each recent star was given, to count the last day's. */
  starTimes: Array<number>
  /** Stars a day the sample starts with, so its numbers look lived-in. */
  starsTodayBase: number
  forks: number
  upstream: {
    host: 'github' | 'gitlab' | 'codeberg' | 'gitea'
    slug: string
  } | null
  install: string | null
  /** Sample only: what to say about a commit no change of ours landed. */
  sampleCommitFacts?: (sha: string) => {
    change: number | null
    checks: 'pass' | 'fail' | null
  }
  category: RepoCategory | null
  /** Share of the code by language, largest first. */
  languages: Array<[name: string, percent: number]>
  license: string | null
  website: string | null
  docsUrl: string | null
  /** Whether runs may attach transcripts. Off when absent. */
  transcripts?: 'off' | 'on'
  /** The `Run-Id:` commit trailer. `auto` when absent. */
  runTrailer?: 'auto' | 'on' | 'off'
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
  /** Newest first. */
  releases?: Array<ReleaseRec>
  /** Newest first. */
  pipelines?: Array<PipelineRunRec>
  /** Rule modes that differ from the default. */
  ruleModes?: Map<string, RuleMode>
  policyExceptions?: Array<PolicyExceptionRec>
  /** Rules the repository wrote for itself, after the built-in ones. */
  customRules?: Array<CustomRuleRec>
  /** Bumped by every policy write, so evaluations are worked out again. */
  policyRev?: number
  /**
   * The policy file, once the rules live in it: its text as last landed, the
   * commit, and why it did not read if it did not (the last valid rules then
   * stay in force).
   */
  policyFile?: {
    text: string
    sha: string
    errors: Array<FileError>
    at: number
  }
  /** How changes land: from the policy file, or the defaults. */
  landing?: Landing
  /** By lowercase name. */
  labels: Map<string, LabelRec>
  /** Bumped by every label write, for the list's version. */
  labelRev: number
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
  auth: TokenService
  hooks: HookPort
  search: SearchIndex
  uploads: UploadPort
  extras: ExtrasPort
  git: GitData
  mail: Mailer
  /** What the API measured about its own requests, for the status page. */
  health?: Health
}

export type NotificationKind =
  | 'review'
  | 'mention'
  | 'release'
  | 'ci'
  | 'issue'
  | 'import'
export type NotificationRec = {
  id: string
  kind: NotificationKind
  title: string
  /** `owner/name`, an account-level place such as "Linked accounts", or null. */
  repo: string | null
  /** Where it leads in the web app. */
  path: string
  unread: boolean
  created: number
}
export type NotificationPrefs = Record<NotificationKind, boolean> & {
  /** One email a week with what changed. Kept; nothing sends it yet. */
  digest: boolean
}

export type ReleaseChannel = 'stable' | 'beta' | 'nightly'
export type AssetRec = {
  name: string
  platform: 'macos' | 'windows' | 'linux'
  arch: string
  /** Bytes. */
  size: number
  downloads: number
  sha256: string
  /** The uploaded file, when the release carries it here. */
  uploadId?: string
}
export type ReleaseRec = {
  id: string
  tag: string
  channel: ReleaseChannel
  title: string
  notes: { added: Array<string>; changed: Array<string>; fixed: Array<string> }
  signed: boolean
  /** The commit a beta or nightly was built from. */
  commit: string | null
  /** Pulled, and why. The release stays listed so its page can say so. */
  withdrawn: { reason: string; at: number } | null
  assets: Array<AssetRec>
  author: ActorRec
  published: number
  version: number
}

export type PipelineStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'canceled'
export type LogLevel = 'cmd' | 'info' | 'dim' | 'ok' | 'warn' | 'error'
export type PipelineRunRec = {
  id: string
  number: number
  workflow: string
  title: string
  branch: string
  sha: string
  status: PipelineStatus
  trigger: 'push' | 'change' | 'tag' | 'schedule' | 'manual'
  actor: string
  started: number
  finished: number | null
  /** The workflow file it ran. */
  file: string
  annotations: Array<{
    level: 'error' | 'warn'
    text: string
    job: string
    step: string
  }>
  jobs: Array<{
    name: string
    runner: string
    status: PipelineStatus | 'skipped'
    duration: number
    steps: Array<{
      name: string
      status: PipelineStatus | 'skipped'
      duration: number
      lines: Array<{ t: string; level: LogLevel | null }>
    }>
  }>
  version: number
}

export type RuleMode = 'enforce' | 'dry-run' | 'off'
export type PolicyExceptionRec = {
  id: string
  rule: string
  /** Who the rule bends for. */
  who: string
  reason: string
  createdBy: string
  created: number
  expires: number
}

/** A rule a repository wrote for itself. */
export type CustomRuleRec = {
  id: string
  name: string
  kind: 'required_check' | 'path_approval' | 'max_lines'
  /** required_check: the check that has to pass on the tree that lands. */
  check?: string
  /** path_approval: globs, such as `docs/**` or `*.sql`. */
  paths?: Array<string>
  /** path_approval: how many people have to approve. */
  approvals?: number
  /** path_approval: who counts; empty is anyone but the author. */
  from?: Array<string>
  /** max_lines: the most lines a change may add and remove. */
  maxLines?: number
  createdBy: string
  created: number
}
