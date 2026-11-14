import type { Suggestion } from '~/lib/suggestions'

// How the screens see changes, policy rules, secrets, bots and runs. The
// adapters in `lib/` build these from the API's objects.

/** Builds a git patch from prefixed lines (' ', '+', '-') and counts hunks. */
function patch(path: string, oldStart: number, lines: Array<string>) {
  const oldCount = lines.filter((l) => l[0] !== '+').length
  const newCount = lines.filter((l) => l[0] !== '-').length
  return [
    `diff --git a/${path} b/${path}`,
    'index 3b1f2a0..9c4d7e1 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`,
    ...lines,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Changes (review model)
// ---------------------------------------------------------------------------

export type Author = { name: string; kind: 'human' | 'agent' | 'bot' }

export type PatchSet = { n: number; when: string; note: string; tree: string }

export type Finding = {
  id: string
  /** Which reviewer produced it. */
  by: string
  kind: 'reviewer' | 'human'
  severity: 'high' | 'medium' | 'low'
  file: string
  line: number
  title: string
  body: string
  /** Stack member that addresses it, once sent to an agent. */
  fixedIn?: string
  /** A change the reviewer proposes, applied with one click. */
  suggestion?: Suggestion
  /** The same fix as instructions for an agent, to copy or send. */
  prompt?: string
}

export type ChangeItem = {
  id: string
  title: string
  author: Author
  state: 'open' | 'landed' | 'draft' | 'abandoned'
  stack?: { index: number; of: number }
  /** Which stack, when it is in one. */
  stackId?: string
  /** Policy requirements that block landing. */
  blocking?: number
  patchSets: Array<PatchSet>
  files: number
  additions: number
  deletions: number
  reviewers: Array<{
    name: string
    kind: 'human' | 'agent' | 'reviewer'
    state: 'approved' | 'commented' | 'pending' | 'changes'
  }>
  ci: 'pass' | 'fail' | 'pending'
  when: string
  /** The pull request or merge request this change is mirrored to or from. */
  mirror?: {
    host: 'github' | 'gitlab' | 'codeberg' | 'gitea'
    number: number
    /** Where it was opened first. */
    origin: 'here' | 'there'
  }
}

export type FileVersions = Record<string, string>

/**
 * Every file a change touches, whole: how it is on main and how it is at each
 * patch set. A diff is drawn from two of these, and an edit starts from one.
 * Only the main sample change has history, the others repeat their one state.
 */

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type Rule = {
  id: string
  name: string
  mode: 'enforce' | 'dry-run' | 'off'
  when: string
  requires: Array<string>
  evaluated: number
  blocked: number
  note?: string
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export type EnvName = 'development' | 'preview' | 'production'
export const envNames: Array<EnvName> = ['development', 'preview', 'production']

export type EnvVar = {
  name: string
  type: string
  sensitive: boolean
  description: string
  /** Which environments hold a value. */
  set: Record<EnvName, boolean>
  required: Array<EnvName>
  rotated: string
  by: string
}

export type Recipient = {
  id: string
  name: string
  kind: 'member' | 'deploy' | 'ci' | 'agent' | 'escrow'
  fingerprint: string
  envs: Array<EnvName>
  added: string
  lastUsed: string
  note?: string
}

export type AuditEvent = {
  when: string
  who: string
  action: string
  target: string
  kind: 'rotate' | 'grant' | 'revoke' | 'read' | 'reject'
}

export const encryptedDiff = patch('.source/secrets/production.env', 12, [
  ' DATABASE_URL=enc:age:AGE-1q8xk…:Zmx1c2gtc2VjcmV0LXZhbHVl',
  ' S3_ACCESS_KEY=enc:age:AGE-1q8xk…:YXdzLWtleS1pZC12YWx1ZQ==',
  ' S3_SECRET_KEY=enc:age:AGE-1q8xk…:c2VjcmV0LWtleS12YWx1ZQ==',
  '-STRIPE_KEY=enc:age:AGE-1q8xk…:b2xkLXN0cmlwZS1rZXktYmxvYg==',
  '+STRIPE_KEY=enc:age:AGE-1q8xk…:bmV3LXN0cmlwZS1rZXktYmxvYg==',
  ' S3_BUCKET=gitfs-prod',
  ' LOG_LEVEL=info',
])

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const allScopes = [
  'repo:read',
  'repo:write',
  'issues:read',
  'issues:comment',
  'issues:write',
  'pulls:read',
  'pulls:comment',
  'pulls:write',
  'pulls:merge',
  'secrets:schema',
  'secrets:decrypt',
] as const
export type Scope = (typeof allScopes)[number]

export type Bot = {
  slug: string
  name: string
  description: string
  scopes: Array<Scope>
  installs: Array<string>
  tokens: number
  state: 'ready' | 'provisioning'
}

export type Trigger =
  | 'issue.created'
  | 'change.opened'
  | 'change.updated'
  | 'finding.raised'
  | 'ci.failed'
  | 'bot.mentioned'
  | 'repository.pushed'
  | 'schedule'

export const triggers: Array<Trigger> = [
  'issue.created',
  'change.opened',
  'change.updated',
  'finding.raised',
  'ci.failed',
  'bot.mentioned',
  'repository.pushed',
  'schedule',
]

export type Runtime = 'Claude Code' | 'Codex' | 'OpenCode' | 'Grok Build'
export type Target = 'E2B' | 'T3 Code' | 'boat.dev'
