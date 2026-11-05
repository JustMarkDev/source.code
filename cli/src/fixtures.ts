/**
 * Sample data. Until the hosted API exists, sx answers from this so every
 * command, flag and output shape can be tried and tested today.
 */

export type Change = {
  id: string
  title: string
  branch: string
  author: string
  state: 'open' | 'draft' | 'landed'
  patchSets: number
  ci: 'pass' | 'fail' | 'pending'
  approvals: number
  findings: { high: number; medium: number; low: number }
  stack: { index: number; of: number } | null
  blockedBy: Array<string>
}

export type Issue = {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  labels: Array<string>
}

export type Mirror = {
  id: string
  host: string
  slug: string
  direction: 'push' | 'pull' | 'two-way'
  state: 'in-sync' | 'behind' | 'failing'
  lastSync: string
}

export type Repo = {
  slug: string
  description: string
  visibility: 'public' | 'private'
  defaultBranch: string
  stars: number
}

/**
 * Something you can act as: yourself, or an organization you belong to. One
 * login covers all of them. `role` is what you may do there; for your own
 * account it is always `owner`.
 */
export type Account = {
  handle: string
  name: string
  kind: 'person' | 'organization'
  role: 'owner' | 'admin' | 'member'
}

export type EnvVar = { name: string; secret: boolean; set: Array<string> }

export type Grant = {
  id: string
  bot: string
  env: 'development' | 'preview'
  /** Names the grant covers. */
  vars: Array<string>
  state: 'active' | 'pending' | 'revoked'
  /** ISO time the grant stops working. Pending requests have none yet. */
  expires?: string
  uses: number
  maxUses: number
  reason?: string
}

export type AuditEntry = { when: string; who: string; what: string }

export const store = {
  /** Who the token belongs to. Your own account is the one with this handle. */
  login: 'dana',
  accounts: <Array<Account>>[
    { handle: 'dana', name: 'Dana Okafor', kind: 'person', role: 'owner' },
    {
      handle: 'northwind',
      name: 'Northwind Labs',
      kind: 'organization',
      role: 'owner',
    },
    // A member can work in its repositories but not create new ones.
    {
      handle: 'lumen-studio',
      name: 'Lumen Studio',
      kind: 'organization',
      role: 'member',
    },
  ],
  repos: <Array<Repo>>[
    {
      slug: 'dana/gitfs',
      description: 'Git over object storage.',
      visibility: 'public',
      defaultBranch: 'main',
      stars: 2140,
    },
    {
      slug: 'dana/tinyqueue',
      description: 'Zero-dependency job queue.',
      visibility: 'public',
      defaultBranch: 'main',
      stars: 640,
    },
    {
      slug: 'northwind/relay',
      description: 'A small message relay with at-least-once delivery.',
      visibility: 'public',
      defaultBranch: 'main',
      stars: 310,
    },
  ],
  changes: <Array<Change>>[
    {
      id: 'ch_7f3a',
      title: 'Cache negative ref lookups',
      branch: 'neg-cache',
      author: 'dana',
      state: 'open',
      patchSets: 3,
      ci: 'pending',
      approvals: 1,
      findings: { high: 1, medium: 1, low: 1 },
      stack: { index: 1, of: 3 },
      blockedBy: [],
    },
    {
      id: 'ch_81b2',
      title: 'Bound the negative cache and evict LRU',
      branch: 'neg-cache-bound',
      author: 'claude via T3 Code',
      state: 'draft',
      patchSets: 1,
      ci: 'pass',
      approvals: 0,
      findings: { high: 0, medium: 0, low: 0 },
      stack: { index: 2, of: 3 },
      blockedBy: ['ch_7f3a'],
    },
  ],
  issues: <Array<Issue>>[
    {
      number: 4,
      title: 'Panic on trailing-dot ref names',
      state: 'open',
      author: 'mira',
      labels: ['bug'],
    },
    {
      number: 7,
      title: 'Support read-only mounts',
      state: 'closed',
      author: 'hollis',
      labels: ['feature'],
    },
  ],
  mirrors: <Array<Mirror>>[
    {
      id: 'm1',
      host: 'github',
      slug: 'dana/gitfs',
      direction: 'two-way',
      state: 'in-sync',
      lastSync: '2026-11-04T10:02:00Z',
    },
    {
      id: 'm2',
      host: 'gitlab',
      slug: 'dana-labs/gitfs',
      direction: 'push',
      state: 'failing',
      lastSync: '2026-11-02T08:30:00Z',
    },
  ],
  env: <Array<EnvVar>>[
    { name: 'DATABASE_URL', secret: true, set: ['development', 'production'] },
    { name: 'STRIPE_KEY', secret: true, set: ['production'] },
    { name: 'API_PORT', secret: false, set: ['development', 'production'] },
  ],
  grants: <Array<Grant>>[],
  audit: <Array<AuditEntry>>[],
  recipients: <Array<{ id: string; kind: string }>>[
    { id: 'dana', kind: 'person' },
    { id: 'deploy-fly', kind: 'deploy target' },
    { id: 'recovery', kind: 'recovery' },
  ],
}

export function nextChangeId(): string {
  const n = store.changes.length + 1
  return `ch_${(0x9a00 + n * 37).toString(16)}`
}

let grantSeq = 0
export function nextGrantId(): string {
  grantSeq += 1
  return `gr_${(0x4c10 + grantSeq * 17).toString(16)}`
}
