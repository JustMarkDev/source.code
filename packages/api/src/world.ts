/**
 * The sample data as plain documents, the way `convex/seed.ts` loads it.
 * Plain types only, so the Convex functions can name it without reaching
 * into the rest of the API.
 */
type Role = 'owner' | 'admin' | 'member'
type Class = 'human' | 'agent' | 'bot'
type Actor = { id: string; handle: string; class: Class }

export type WorldIssue = {
  publicId: string
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  author: Actor
  labels: Array<string>
  assignees: Array<Actor>
  created: number
  updated: number
  closed: number | null
  version: number
  comments: Array<{
    publicId: string
    author: Actor
    body: string
    created: number
    updated: number
    version: number
  }>
}

export type World = {
  accounts: Array<{
    publicId: string
    kind: 'person' | 'organization'
    handle: string
    name: string
    bio: string
    created: number
    updated: number
    version: number
    members: Array<[string, Role]>
    invites: Array<{
      id: string
      email: string
      role: Role
      secretHash: string
      invitedBy: string
      created: number
      expires: number
    }>
  }>
  actors: Array<{ key: string; publicId: string; handle: string; class: Class }>
  repos: Array<{
    publicId: string
    storeId: string
    owner: string
    name: string
    description: string
    visibility: 'public' | 'private'
    defaultBranch: string
    stars: number
    starsTodayBase: number
    forks: number
    upstream: {
      host: 'github' | 'gitlab' | 'codeberg' | 'gitea'
      slug: string
    } | null
    install: string | null
    category: string | null
    languages: Array<[string, number]>
    license: string | null
    website: string | null
    docsUrl: string | null
    collaborators: Array<string>
    installs: Array<string>
    maintainers: Array<string>
    maintainerGrants: Array<string>
    env: Array<{ name: string; kind: string; set: Array<string> }>
    sampleFacts?: boolean
    created: number
    updated: number
    version: number
    starredBy: Array<readonly [string, number]>
    labels: Array<{
      publicId: string
      name: string
      color: string
      description: string
      created: number
    }>
    issues: Array<WorldIssue>
    /** Each change as `ChangeRec`, JSON text: its parts travel with it. */
    changes: Array<string>
    /** Pipeline runs, newest first, as `PipelineRunRec` JSON text. */
    pipelines: Array<string>
    /** Releases as `ReleaseRec` JSON text. */
    releases: Array<string>
    policy: {
      ruleModes: Array<[string, string]>
      customRules: string
      exceptions: string
    } | null
    counters: {
      nextNumber: number
      seq: number
      rev: number
      changeRev: number
      issueRev: number
      labelRev: number
      policyRev: number
      openChanges: number
      openIssues: number
    }
  }>
  aliases: Array<[string, string]>
  /** Each repository's extras as JSON text (`RepoExtras`). */
  extras: Array<[string, string]>
  downloadDays: Array<{ repo: string; day: number; n: number }>
  accountPrefs: Array<[string, string]>
  follows: Array<[string, string]>
  contributions: Array<{
    handle: string
    kind: 'review' | 'change' | 'issue' | 'release'
    at: number
    title: string
    repo: string
    agent: boolean
  }>
  connections: Array<{
    account: string
    integration: string
    hint: string | null
    keyHash: string | null
    by: string
    connected: number
  }>
  repoIntegrations: Array<[string, Array<string>]>
  links: Array<{
    handle: string
    host: string
    login: string
    instance: string | null
    linked: number
  }>
  bots: Array<{
    slug: string
    name: string
    description: string
    owner: string
    class: 'bot' | 'agent'
    scopes: Array<string>
    created: number
  }>
  /** By repository, as `AutomationRec` JSON text. */
  automations: Array<[string, Array<string>]>
  notifications: Array<{
    handle: string
    id: string
    kind: string
    title: string
    repo: string | null
    path: string
    unread: boolean
    created: number
  }>
  notificationPrefs: Array<[string, Record<string, boolean>]>
  teams: Array<{
    publicId: string
    org: string
    slug: string
    name: string
    description: string
    created: number
    updated: number
    version: number
    members: Array<string>
    repos: Array<[string, 'read' | 'write']>
  }>
  tokens: Array<{
    publicId: string
    hash: string
    name: string
    kind: 'personal' | 'bot' | 'run' | 'oauth'
    handle: string
    actingAs: string
    class: Class
    scopes: Array<string>
    repos: Array<string> | null
    audience: Array<'api' | 'mcp'>
    prefix: string
    createdAt: number
    expiresAt: number
    lastUsedAt: number | null
    revokedAt: number | null
    authorizationId?: string
    limitKey?: string
  }>
  authorizations: Array<{
    publicId: string
    clientId: string
    clientName: string
    handle: string
    scopes: Array<string>
    audience: Array<'api' | 'mcp'>
    createdAt: number
    lastUsedAt: number | null
    revokedAt: number | null
  }>
}
