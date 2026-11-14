/**
 * A change and its parts as the forge logic works on them. The same shapes
 * the API has always used (`packages/api/src/domain/records.ts`), kept here
 * so the Convex functions do not reach into the rest of the API.
 */
import type { Addressed, Anchor, Placement } from '@source-code/api/anchors'
export type ActorClass = 'human' | 'agent' | 'bot'
export type ActorRec = { id: string; handle: string; class: ActorClass }
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
  cases?: Array<TestCaseRec>
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
  file: string | null
  line: number | null
  patchSet: number
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
export type UploadSummary = {
  id: string
  contentType: string
  size: number
  sha256: string
}
export type EvidenceRec = {
  id: string
  kind: 'image' | 'recording' | 'preview' | 'test_results'
  caption: string
  uploadId: string
  upload?: UploadSummary
  by: ActorRec
  created: number
}
export type ChangeState = 'draft' | 'open' | 'landed' | 'abandoned'
export type ChangeRec = {
  id: string
  number: number
  title: string
  description: string
  state: ChangeState
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
  comments?: Array<ReviewCommentRec>
  /** The newest guide; a new one replaces it. */
  guide?: GuideRec
  commentRev?: number
  baseFiles?: Record<string, string | null>
  created: number
  updated: number
  landed: number | null
  version: number
}
export type RuleMode = 'enforce' | 'dry-run' | 'off'
export type PolicyExceptionRec = {
  id: string
  rule: string
  who: string
  reason: string
  createdBy: string
  created: number
  expires: number
}
export type CustomRuleRec = {
  id: string
  name: string
  kind: 'required_check' | 'path_approval' | 'max_lines'
  check?: string
  paths?: Array<string>
  approvals?: number
  from?: Array<string>
  maxLines?: number
  createdBy: string
  created: number
}
export type Requirement = {
  id: string
  rule: string
  state: 'pass' | 'fail' | 'pending' | 'na'
  detail: string
  needs: Record<string, unknown> | null
  blocking: Array<string>
}
export type Assume = {
  approve?: Array<string>
  checks?: Record<string, 'pending' | 'pass' | 'fail'>
  resolve?: Array<string>
}
