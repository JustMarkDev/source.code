import type { z } from 'zod'
import type { Principal, Scope } from '../auth'
import type { CursorPosition, Page } from '../cursor'
import type { EventLog } from '../events'
import type { Pre } from '../registry'
import type * as S from '../schemas'
import type { SearchDoc } from '../search'
import type { UploadRec } from '../uploads'
import type {
  Assume,
  Attached,
  CheckRec,
  EvidenceRec,
  LabelColor,
  NotificationKind,
  ReviewRec,
  Urls,
  Viewer,
} from './records'

type Out<TSchema extends z.ZodType> = z.output<TSchema>

type Dry = boolean
type IfMatch = string | null
type Paging = { after: CursorPosition | null; limit: number }

/**
 * What the API needs from its data. This is the whole surface the pipeline
 * and the operations call, and nothing else: it was sized by listing every
 * member they use. `MemoryDomain` implements it today; the hosted version
 * implements it on Convex, and neither the pipeline nor an operation changes.
 *
 * It is written in terms of the public objects (`schemas.ts`), never in terms
 * of how one implementation stores them. Seeding is not part of it: that
 * belongs to the implementation and to the tests.
 *
 * Rules an implementation keeps:
 *  - a method that reads checks the caller first; a private thing is `not_found`
 *  - a write bumps the object's `version` and emits exactly one event
 *  - `dry` runs the same checks and writes nothing
 *  - a `*Version` method answers without building the object
 */
export interface DomainPort {
  // ---- wiring -------------------------------------------------------------

  /** Where links in responses point. */
  readonly urls: Urls
  /** The event log every write appends to. */
  readonly events: EventLog
  /** Tokens, webhooks, search, uploads, extras and git, attached at assembly. */
  readonly svc: Attached
  /** Rises on every access change, so cached bodies cannot outlive access. */
  readonly accessRevision: number
  /** Housekeeping: drop finished runs and operations after a week. */
  sweepRunsOperations: () => void | Promise<void>

  // ---- access -------------------------------------------------------------

  /** Whether `login` may act as `account` (itself, or an organization it is in). */
  canActAs: (login: string, account: string) => Promise<boolean>
  /** A predicate for the repositories `p` can read. Null means account-level. */
  canSee: (p: Viewer) => (full: string | null) => boolean | Promise<boolean>
  canSeeId: (p: Viewer) => (id: string | null) => boolean | Promise<boolean>
  /** Whether the caller may read the repository with this stable id. */
  mayReadId: (id: string | null, p: Viewer) => boolean | Promise<boolean>
  /** Checks the caller may read or write a repository, and names it `owner/name`. */
  repoAccess: (
    owner: string,
    name: string,
    p: Viewer,
    need: 'read' | 'write',
  ) => Promise<string>
  /** Read access that requires a real relationship, not public visibility. */
  repoAccessStrict: (
    owner: string,
    name: string,
    p: Viewer,
    need?: 'read' | 'write',
  ) => Promise<string>
  /** For operations that keep their own versioned records. Throws on a mismatch. */
  assertVersion: (
    ifMatch: IfMatch,
    version: string,
    current: () => unknown,
  ) => void
  /** The stable repository identity and access stamp for a keyed write. */
  replayKey: (
    opId: string,
    params: Record<string, string>,
    p: Principal,
  ) => { id: string; stamp: string } | Promise<{ id: string; stamp: string }>
  /** Every searchable thing, for building the search index. */
  searchDocs: () => Iterable<SearchDoc>

  // ---- accounts and repositories -----------------------------------------

  listAccounts: (p: Principal) => Promise<Array<Out<typeof S.Account>>>
  getAccount: (handle: string, p: Viewer) => Promise<Out<typeof S.Account>>
  accountVersion: (handle: string) => Promise<string | null>
  /**
   * A person signed in. The server calls this once it knows who they are; no
   * operation does, so it takes no caller and checks nothing.
   */
  knowPerson: (handle: string, name: string) => Promise<void>
  updateAccount: (
    handle: string,
    p: Principal,
    body: { name?: string; bio?: string },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.Account>>
  /** Create an organization owned by the caller. Repeat-safe on the handle. */
  createOrganization: (
    p: Principal,
    input: { handle: string; name?: string; bio?: string },
    dry: Dry,
  ) => Promise<{ account: Out<typeof S.Account>; created: boolean }>
  listMembers: (
    handle: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.Member>>>
  membersVersion: (handle: string, p: Viewer) => Promise<string>
  /** Add a person to an organization or change their role. */
  setMember: (
    handle: string,
    login: string,
    role: 'owner' | 'admin' | 'member',
    p: Principal,
    dry: Dry,
  ) => Promise<{
    member: Out<typeof S.Member>
    outcome: 'created' | 'updated' | 'unchanged'
  }>
  removeMember: (
    handle: string,
    login: string,
    p: Principal,
    dry: Dry,
  ) => Promise<void>

  listRepos: (
    p: Viewer,
    q: Paging & { owner?: string },
  ) => Promise<Page<Out<typeof S.Repo>>>
  getRepo: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Repo>>
  listInvitations: (
    handle: string,
    p: Principal,
  ) => Promise<Array<Out<typeof S.Invitation>>>
  /** Invite by email. The link goes out through `svc.mail`. */
  invite: (
    handle: string,
    p: Principal,
    input: { email: string; role: Out<typeof S.Member>['role'] },
    dry: Dry,
  ) => Promise<{
    invitation: Out<typeof S.Invitation>
    outcome: 'created' | 'updated'
  }>
  revokeInvitation: (
    handle: string,
    id: string,
    p: Principal,
    dry: Dry,
  ) => Promise<void>
  /** Join with the secret from an invitation's link. */
  acceptInvitation: (
    secret: string,
    p: Principal,
    dry: Dry,
  ) => Promise<Out<typeof S.Member>>
  repoVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  /** Per commit: the account behind its author, its change and its checks. */
  commitFacts: (
    full: string,
    commits: ReadonlyArray<{ sha: string; author: { email: string } }>,
  ) => Promise<
    Array<Pick<Out<typeof S.GitCommit>, 'actor' | 'change' | 'checks'>>
  >
  /** Whether the caller starred it, and how many people did. */
  getStar: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Star>>
  /** Star or unstar, as a person. `changed` is false when it already was so. */
  setStar: (
    owner: string,
    name: string,
    p: Principal,
    on: boolean,
    dry: Dry,
  ) => Promise<{ star: Out<typeof S.Star>; changed: boolean }>
  /** The repository id behind an address, after checking the caller may read it. */
  repoIdOf: (owner: string, name: string, p: Viewer) => Promise<string>
  /** The stable id behind an address, without requiring that it still exists. */
  repoIdForHistory: (full: string) => string | null | Promise<string | null>
  /** The current `owner/name` for an address, following renames, unchecked. */
  canonicalRepoName: (full: string) => string | Promise<string>
  createRepo: (
    p: Principal,
    input: {
      owner?: string
      name: string
      description?: string
      visibility: 'public' | 'private'
      maintainers?: Array<string>
    },
    dry: Dry,
  ) => Promise<{ repo: Out<typeof S.Repo>; created: boolean }>
  updateRepo: (
    owner: string,
    name: string,
    p: Principal,
    body: {
      name?: string
      description?: string
      visibility?: 'public' | 'private'
      default_branch?: string
      maintainers?: Array<string>
      category?: Out<typeof S.Repo>['category'] | null
      website?: string | null
      docs_url?: string | null
      install?: string | null
    },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.Repo>>
  transferRepo: (
    owner: string,
    name: string,
    p: Principal,
    body: { owner: string; name?: string; confirm: string },
    dry: Dry,
  ) => Promise<Out<typeof S.Repo>>
  deleteRepo: (
    owner: string,
    name: string,
    p: Principal,
    confirm: string | undefined,
    dry: Dry,
  ) => Promise<{ deleted: boolean; full: string }>
  /** Marks a repository's derived state as changed, without an event. */
  bumpRepo: (owner: string, name: string, p: Viewer) => Promise<void>
  context: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Context>>
  /** Whether a number in a repository is a change or an issue. */
  numberRef: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
  ) => Promise<Out<typeof S.NumberRef>>

  // ---- teams --------------------------------------------------------------

  listTeams: (org: string, p: Principal) => Promise<Array<Out<typeof S.Team>>>
  getTeam: (
    org: string,
    slug: string,
    p: Principal,
  ) => Promise<Out<typeof S.Team>>
  teamVersion: (org: string, slug: string, p: Principal) => Promise<string>
  createTeam: (
    org: string,
    p: Principal,
    input: { slug: string; name?: string; description?: string },
    dry: Dry,
  ) => Promise<{ team: Out<typeof S.Team>; created: boolean }>
  updateTeam: (
    org: string,
    slug: string,
    p: Principal,
    body: { name?: string; description?: string },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.Team>>
  deleteTeam: (
    org: string,
    slug: string,
    p: Principal,
    dry: Dry,
  ) => Promise<void>
  setTeamMember: (
    org: string,
    slug: string,
    login: string,
    p: Principal,
    dry: Dry,
  ) => Promise<Out<typeof S.Team>>
  removeTeamMember: (
    org: string,
    slug: string,
    login: string,
    p: Principal,
    dry: Dry,
  ) => Promise<void>
  setTeamRepo: (
    org: string,
    slug: string,
    owner: string,
    name: string,
    permission: 'read' | 'write',
    p: Principal,
    dry: Dry,
  ) => Promise<Out<typeof S.Team>>
  removeTeamRepo: (
    org: string,
    slug: string,
    owner: string,
    name: string,
    p: Principal,
    dry: Dry,
  ) => Promise<void>

  // ---- runs and long operations ------------------------------------------

  listRuns: (
    owner: string,
    name: string,
    p: Viewer,
    q: Paging & { state?: string; actor?: string },
  ) => Promise<Page<Out<typeof S.Run>>>
  claimRun: (
    owner: string,
    name: string,
    id: string,
    p: Principal,
  ) => Promise<Out<typeof S.Run>>
  getRun: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Run>>
  startRun: (
    owner: string,
    name: string,
    p: Principal,
    input: {
      task: string
      change?: number
      scopes?: Array<string>
      ttl_minutes: number
    },
    dry: Dry,
  ) => Promise<{ run: Out<typeof S.Run> }>
  noteRun: (
    owner: string,
    name: string,
    id: string,
    p: Principal,
    text: string,
    dry: Dry,
  ) => Promise<Out<typeof S.Run>>
  endRun: (
    owner: string,
    name: string,
    id: string,
    p: Principal,
    state: 'succeeded' | 'failed' | 'cancelled',
    summary: string | undefined,
    dry: Dry,
  ) => Promise<Out<typeof S.Run>>
  getOperation: (id: string, p: Viewer) => Promise<Out<typeof S.Operation>>
  operationVersion: (id: string, p: Viewer) => Promise<string | null>
  /** The repository an operation belongs to, for waiting on it. Unchecked. */
  operationRepoId: (id: string) => string | null | Promise<string | null>

  // ---- issues -------------------------------------------------------------

  listIssues: (
    owner: string,
    name: string,
    p: Viewer,
    q: Paging & { state: string; label?: string; author?: string },
  ) => Promise<Page<Pre>>
  issueListVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  getIssue: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
  ) => Promise<Out<typeof S.Issue>>
  issueVersion: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
  ) => Promise<string | null>
  createIssue: (
    owner: string,
    name: string,
    p: Viewer,
    body: {
      title: string
      body?: string
      labels?: Array<string>
      assignees?: Array<string>
    },
    dry: Dry,
  ) => Promise<{
    issue: Out<typeof S.Issue>
    outcome: 'created' | 'unchanged'
  }>
  updateIssue: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    body: {
      title?: string
      body?: string
      labels?: Array<string>
      state?: 'open' | 'closed'
      assignees?: Array<string>
    },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.Issue>>

  // ---- releases -------------------------------------------------------------

  listReleases: (
    owner: string,
    name: string,
    p: Viewer,
    q: Paging & { channel?: 'stable' | 'beta' | 'nightly' },
  ) => Promise<Page<Out<typeof S.Release>>>
  releasesVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  getRelease: (
    owner: string,
    name: string,
    tag: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Release>>
  createRelease: (
    owner: string,
    name: string,
    p: Viewer,
    body: {
      tag: string
      channel: 'stable' | 'beta' | 'nightly'
      title: string
      notes?: {
        added?: Array<string>
        changed?: Array<string>
        fixed?: Array<string>
      }
      signed?: boolean
      commit?: string
      assets?: Array<{
        name: string
        platform: 'macos' | 'windows' | 'linux'
        arch: string
        size?: number
        sha256?: string
        upload?: string
      }>
    },
    dry: Dry,
  ) => Promise<{
    release: Out<typeof S.Release>
    outcome: 'created' | 'unchanged'
  }>
  updateRelease: (
    owner: string,
    name: string,
    tag: string,
    p: Viewer,
    body: {
      title?: string
      notes?: {
        added?: Array<string>
        changed?: Array<string>
        fixed?: Array<string>
      }
      withdrawn?: string | null
    },
    dry: Dry,
  ) => Promise<Out<typeof S.Release>>
  downloadAsset: (
    owner: string,
    name: string,
    tag: string,
    asset: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Download>>

  // ---- pipelines ------------------------------------------------------------

  listPipelineRuns: (
    owner: string,
    name: string,
    p: Viewer,
    q: Paging & {
      status?: 'queued' | 'running' | 'success' | 'failure' | 'canceled'
      workflow?: string
    },
  ) => Promise<Page<Out<typeof S.PipelineRun>>>
  pipelinesVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  getPipelineRun: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
  ) => Promise<Out<typeof S.PipelineRun>>
  getPipelineLog: (
    owner: string,
    name: string,
    n: number,
    job: number,
    step: number,
    p: Viewer,
  ) => Promise<Out<typeof S.PipelineLog>>
  startPipeline: (
    owner: string,
    name: string,
    p: Viewer,
    body: { workflow: string; branch?: string },
    dry: Dry,
  ) => Promise<Out<typeof S.PipelineRun>>
  claimPipelineJob: (
    owner: string,
    name: string,
    p: Viewer,
    body: { runner: string },
  ) => Promise<Out<typeof S.PipelineJob> | null>
  reportPipelineStep: (
    owner: string,
    name: string,
    n: number,
    job: number,
    step: number,
    p: Viewer,
    body: {
      status: 'running' | 'success' | 'failure' | 'skipped'
      lines?: Array<{
        text: string
        level?: 'cmd' | 'info' | 'ok' | 'warn' | 'error' | null
      }>
      duration_ms?: number
    },
  ) => Promise<Out<typeof S.PipelineRun>>
  rerunPipeline: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    dry: Dry,
  ) => Promise<Out<typeof S.PipelineRun>>
  cancelPipeline: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    dry: Dry,
  ) => Promise<Out<typeof S.PipelineRun>>

  // ---- policy rules ---------------------------------------------------------

  getPolicySet: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Out<typeof S.PolicySet>>
  policySetVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  setRuleMode: (
    owner: string,
    name: string,
    rule: string,
    p: Viewer,
    mode: 'enforce' | 'dry-run' | 'off',
    dry: Dry,
  ) => Promise<Out<typeof S.PolicySet>['rules'][number]>
  createRule: (
    owner: string,
    name: string,
    p: Viewer,
    body: {
      id: string
      name: string
      kind: 'required_check' | 'path_approval' | 'max_lines'
      check?: string
      paths?: Array<string>
      approvals?: number
      from?: Array<string>
      max_lines?: number
      mode?: 'enforce' | 'dry-run' | 'off'
    },
    dry: Dry,
  ) => Promise<{
    rule: Out<typeof S.PolicySet>['rules'][number]
    created: boolean
  }>
  deleteRule: (
    owner: string,
    name: string,
    rule: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>
  addPolicyException: (
    owner: string,
    name: string,
    p: Viewer,
    body: { rule: string; who: string; reason: string; expires_at: string },
    dry: Dry,
  ) => Promise<Out<typeof S.PolicyException>>
  removePolicyException: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>

  // ---- integrations ---------------------------------------------------------

  listConnections: (
    handle: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.IntegrationConnection>>>
  connectionsVersion: (handle: string, p: Viewer) => Promise<string>
  connect: (
    handle: string,
    id: string,
    p: Viewer,
    body: { key?: string },
    dry: Dry,
  ) => Promise<{
    connection: Out<typeof S.IntegrationConnection>
    created: boolean
  }>
  disconnect: (handle: string, id: string, p: Viewer, dry: Dry) => Promise<void>
  listRepoIntegrations: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.RepoIntegration>>>
  repoIntegrationsVersion: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<string>
  setRepoIntegration: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    on: boolean,
    dry: Dry,
  ) => Promise<Out<typeof S.RepoIntegration>>

  // ---- bots and automations ------------------------------------------------

  listBots: (handle: string, p: Viewer) => Promise<Array<Out<typeof S.Bot>>>
  createBot: (
    handle: string,
    p: Viewer,
    body: {
      slug: string
      name: string
      description?: string
      class: 'bot' | 'agent'
      scopes: Array<Scope>
    },
    dry: Dry,
  ) => Promise<{ bot: Out<typeof S.Bot>; created: boolean }>
  installBot: (
    owner: string,
    name: string,
    slug: string,
    p: Viewer,
    on: boolean,
    dry: Dry,
  ) => Promise<Out<typeof S.Bot>>
  updateBot: (
    slug: string,
    p: Viewer,
    body: { name?: string; description?: string; scopes?: Array<Scope> },
    dry: Dry,
  ) => Promise<Out<typeof S.Bot>>
  mintBotToken: (
    slug: string,
    p: Viewer,
    days: number,
  ) => Promise<Out<typeof S.BotToken>>
  listAutomations: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.Automation>>>
  automationsVersion: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<string>
  createAutomation: (
    owner: string,
    name: string,
    p: Viewer,
    body: {
      name: string
      bot: string
      triggers: Array<(typeof S.automationTriggers)[number]>
      runtime: string
      target: string
      instructions: string
      enabled?: boolean
      every?: 'hour' | 'day' | 'week'
    },
    dry: Dry,
  ) => Promise<Out<typeof S.Automation>>
  /** Fire the scheduled automations that are due. Returns how many fired. */
  tickSchedules: () => number | Promise<number>
  runAutomation: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
  ) => Promise<Out<typeof S.Run>>
  updateAutomation: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    body: {
      name?: string
      triggers?: Array<(typeof S.automationTriggers)[number]>
      runtime?: string
      target?: string
      instructions?: string
      enabled?: boolean
      every?: 'hour' | 'day' | 'week'
    },
    dry: Dry,
  ) => Promise<Out<typeof S.Automation>>
  deleteAutomation: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>

  // ---- imports and linked accounts -----------------------------------------

  listLinks: (
    handle: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.LinkedAccount>>>
  linkAccount: (
    handle: string,
    host: 'github' | 'gitlab' | 'codeberg' | 'gitea',
    p: Viewer,
    body: { login: string; instance?: string },
  ) => Promise<Out<typeof S.LinkedAccount>>
  unlinkAccount: (
    handle: string,
    host: 'github' | 'gitlab' | 'codeberg' | 'gitea',
    p: Viewer,
  ) => Promise<void>
  importRepo: (
    p: Principal,
    body: {
      host: 'github' | 'gitlab' | 'codeberg' | 'gitea'
      slug: string
      owner?: string
      name?: string
      visibility: 'public' | 'private'
    },
    dry: Dry,
  ) => Promise<{ repo: Out<typeof S.Repo>; created: boolean }>
  listImports: (p: Viewer) => Promise<Array<Out<typeof S.Import>>>

  // ---- insights and the dashboard -----------------------------------------

  repoInsights: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Out<typeof S.RepoInsights>>
  insightsVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  dashboard: (p: Viewer, account?: string) => Promise<Out<typeof S.Dashboard>>

  // ---- notifications --------------------------------------------------------

  listNotifications: (
    p: Viewer,
    q: Paging & { unread?: boolean; kind?: NotificationKind },
  ) => Promise<Page<Out<typeof S.Notification>>>
  notificationsVersion: (p: Viewer) => Promise<string>
  getAccountPrefs: (p: Viewer) => Promise<Out<typeof S.AccountPreferences>>
  updateAccountPrefs: (
    p: Viewer,
    body: Partial<Omit<Out<typeof S.AccountPreferences>, 'object'>>,
  ) => Promise<Out<typeof S.AccountPreferences>>
  follow: (p: Viewer, handle: string, on: boolean) => Promise<void>
  listFollows: (
    handle: string,
    which: 'followers' | 'following',
    q: { after: CursorPosition | null; limit: number },
  ) => Promise<{
    items: Array<Out<typeof S.AccountRef>>
    next: CursorPosition | null
  }>
  peopleVersion: (p: Viewer) => Promise<string>
  profile: (handle: string, p: Viewer) => Promise<Out<typeof S.Profile>>
  profileVersion: (handle: string, p: Viewer) => Promise<string>
  listPeople: (
    p: Viewer,
    q: { q?: string; after: CursorPosition | null; limit: number },
  ) => Promise<{
    items: Array<Out<typeof S.PersonEntry>>
    next: CursorPosition | null
  }>
  unreadCount: (p: Viewer) => Promise<Out<typeof S.NotificationCount>>
  markRead: (p: Viewer, id: string | null) => Promise<void>
  getNotificationPrefs: (
    p: Viewer,
  ) => Promise<Out<typeof S.NotificationPreferences>>
  updateNotificationPrefs: (
    p: Viewer,
    body: Partial<Record<NotificationKind | 'digest', boolean>>,
  ) => Promise<Out<typeof S.NotificationPreferences>>

  // ---- labels and issue comments -------------------------------------------

  listLabels: (
    owner: string,
    name: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.Label>>>
  labelsVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  createLabel: (
    owner: string,
    name: string,
    p: Viewer,
    body: { name: string; color?: LabelColor; description?: string },
    dry: Dry,
  ) => Promise<{
    label: Out<typeof S.Label>
    outcome: 'created' | 'unchanged'
  }>
  updateLabel: (
    owner: string,
    name: string,
    label: string,
    p: Viewer,
    body: { name?: string; color?: LabelColor; description?: string },
    dry: Dry,
  ) => Promise<Out<typeof S.Label>>
  deleteLabel: (
    owner: string,
    name: string,
    label: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>
  listComments: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    q: Paging,
  ) => Promise<Page<Out<typeof S.IssueComment>>>
  commentsVersion: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
  ) => Promise<string | null>
  createComment: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    body: { body: string },
    dry: Dry,
  ) => Promise<Out<typeof S.IssueComment>>
  updateComment: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    body: { body: string },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.IssueComment>>
  deleteComment: (
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>

  // ---- changes ------------------------------------------------------------
  // `ref` is the change number or its `chg_` id.

  listChanges: (
    owner: string,
    name: string,
    p: Viewer,
    q: Paging & {
      state?: string
      author?: string
      label?: string
      branch?: string
      sort: 'updated_at' | 'number'
      desc: boolean
      expand: ReadonlyArray<string>
    },
  ) => Promise<Page<Pre>>
  changeListVersion: (owner: string, name: string, p: Viewer) => Promise<string>
  getChange: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand?: ReadonlyArray<string>,
  ) => Promise<Pre>
  changeVersion: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand?: ReadonlyArray<string>,
  ) => Promise<string>
  createChange: (
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
  ) => Promise<{
    change: Out<typeof S.Change>
    outcome: 'created' | 'patch_set_added' | 'unchanged'
  }>
  updateChange: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { title?: string; description?: string; labels?: Array<string> },
    ifMatch: IfMatch,
    dry: Dry,
  ) => Promise<Out<typeof S.Change>>
  /** Mark a draft ready, abandon, restore. */
  transition: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    action: 'ready' | 'abandon' | 'restore',
    dry: Dry,
  ) => Promise<Out<typeof S.Change>>
  /** Land one change. `expected_tree` must be the tree that was checked. */
  land: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { expected_tree: string },
    dry: Dry,
  ) => Promise<Out<typeof S.Change>>
  /** Land a stack bottom-up as one long operation. */
  landStack: (
    owner: string,
    name: string,
    stackId: string,
    p: Viewer,
    body: { expected_trees: Record<string, string> },
    dry: Dry,
  ) => Promise<Out<typeof S.Operation>>

  listPatchSets: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.PatchSet>>>
  getPatchSet: (
    owner: string,
    name: string,
    ref: string,
    n: number,
    p: Viewer,
  ) => Promise<Out<typeof S.PatchSet>>
  addPatchSet: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: {
      sha?: string
      kind: 'update' | 'rebase'
      note?: string
      files?: Record<string, string | null>
    },
    dry: Dry,
  ) => Promise<Out<typeof S.PatchSet>>
  getPatchSetFiles: (
    owner: string,
    name: string,
    ref: string,
    n: number,
    p: Viewer,
  ) => Promise<Out<typeof S.PatchSetFiles>>
  comparePatchSets: (
    owner: string,
    name: string,
    ref: string,
    from: number,
    to: number,
    p: Viewer,
  ) => Promise<Out<typeof S.PatchSetComparison>>

  review: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { state: ReviewRec['state']; body?: string; patch_set?: number },
    dry: Dry,
  ) => Promise<Out<typeof S.Review>>
  listReviewComments: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    q: { file?: string; unresolved?: boolean },
  ) => Promise<Array<Out<typeof S.ChangeComment>>>
  reviewCommentsVersion: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
  ) => Promise<string | null>
  createReviewComment: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: {
      body: string
      file?: string
      line?: number
      patch_set?: number
      reply_to?: string
    },
    dry: Dry,
  ) => Promise<Out<typeof S.ChangeComment>>
  updateReviewComment: (
    owner: string,
    name: string,
    ref: string,
    id: string,
    p: Viewer,
    body: { body?: string; resolved?: boolean },
    dry: Dry,
  ) => Promise<Out<typeof S.ChangeComment>>
  deleteReviewComment: (
    owner: string,
    name: string,
    ref: string,
    id: string,
    p: Viewer,
    dry: Dry,
  ) => Promise<void>
  listFindings: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    state?: string,
  ) => Promise<Array<Out<typeof S.Finding>>>
  raiseFinding: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: {
      severity: 'high' | 'medium' | 'low'
      file: string
      line: number
      title: string
      body?: string
      suggestion?: {
        summary: string
        file: string
        replace: Array<string>
        after: string | null
        lines: Array<string>
      }
      prompt?: string
    },
    dry: Dry,
  ) => Promise<Out<typeof S.Finding>>
  setFinding: (
    owner: string,
    name: string,
    ref: string,
    findingId: string,
    p: Viewer,
    to: 'resolved' | 'dismissed',
    reason: string | null,
    dry: Dry,
  ) => Promise<Out<typeof S.Finding>>
  listChecks: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
  ) => Promise<Array<Out<typeof S.CheckRun>>>
  reportCheck: (
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
      cases?: Array<Out<typeof S.TestCase>>
    },
    dry: Dry,
  ) => Promise<{
    check: Out<typeof S.CheckRun>
    outcome: 'created' | 'updated' | 'unchanged'
  }>
  /** Evaluate policy for a change, optionally assuming checks or findings. */
  policy: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    assume?: Assume,
  ) => Promise<Out<typeof S.PolicyEvaluation>>

  listEvidence: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    find: (id: string) => UploadRec | null | Promise<UploadRec | null>,
  ) => Promise<Array<Out<typeof S.Evidence>>>
  status: () => Promise<Out<typeof S.Status>>
  addIssueEvidence: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    input: { upload: UploadRec; kind: 'image' | 'recording'; caption: string },
    dry: Dry,
  ) => Promise<Out<typeof S.IssueEvidence>>
  listIssueEvidence: (
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    find: (id: string) => UploadRec | null | Promise<UploadRec | null>,
  ) => Promise<Array<Out<typeof S.IssueEvidence>>>
  addEvidence: (
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    input: { upload: UploadRec; kind: EvidenceRec['kind']; caption: string },
    dry: Dry,
  ) => Promise<Out<typeof S.Evidence>>

  // ---- events and sync ----------------------------------------------------

  listEvents: (
    p: Viewer,
    q: Paging & { repo?: string; type?: string },
  ) => Promise<Page<Pre>>
  /** The event log's position, for conditional reads of the log itself. */
  eventVersion: () => string | Promise<string>
  /** The log's position for one repository, after checking read access. */
  repoHistoryVersion: (full: string, p: Viewer) => Promise<string>
  sync: (
    p: Viewer,
    q: { repo: string; cursor?: string; limit: number },
  ) => Promise<Out<typeof S.Sync>>
  syncVersion: (owner: string, name: string, p: Viewer) => Promise<string>
}
