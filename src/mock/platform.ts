import type { Suggestion } from '~/lib/suggestions'

// Mock data for the developer-platform surface: secrets, policies, changes,
// agents and integrations. Nothing here talks to a backend.

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
  state: 'open' | 'landed' | 'draft'
  stack?: { index: number; of: number }
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

export const changes: Array<ChangeItem> = [
  {
    id: '216',
    title: 'Cache negative ref lookups',
    author: { name: 'dana', kind: 'human' },
    state: 'open',
    stack: { index: 1, of: 3 },
    patchSets: [
      { n: 1, when: '3 days ago', note: 'Initial version', tree: '41ac9e2' },
      {
        n: 2,
        when: '2 days ago',
        note: 'Address review: rename hit() to contains()',
        tree: '5d02b8f',
      },
      {
        n: 3,
        when: 'yesterday',
        note: 'Rebased onto main and renamed remember() to put()',
        tree: '9c4d7e1',
      },
    ],
    files: 2,
    additions: 23,
    deletions: 2,
    reviewers: [
      { name: 'hollis', kind: 'human', state: 'approved' },
      { name: 'greptile', kind: 'reviewer', state: 'changes' },
      { name: 'coderabbit', kind: 'reviewer', state: 'commented' },
      { name: 'macroscope', kind: 'reviewer', state: 'commented' },
    ],
    ci: 'pending',
    when: 'updated yesterday',
    mirror: { host: 'github', number: 231, origin: 'here' },
  },
  {
    id: '217',
    title: 'Bound the negative cache and evict LRU',
    author: { name: 'claude via T3 Code', kind: 'agent' },
    state: 'draft',
    stack: { index: 2, of: 3 },
    patchSets: [
      {
        n: 1,
        when: '2 hours ago',
        note: 'Opened from finding F-2',
        tree: 'a71e0c3',
      },
    ],
    files: 2,
    additions: 41,
    deletions: 3,
    reviewers: [{ name: 'dana', kind: 'human', state: 'pending' }],
    ci: 'pass',
    when: 'opened 2 hours ago',
    mirror: { host: 'github', number: 232, origin: 'here' },
  },
  {
    id: '218',
    title: 'Show cache stats in `gitfs doctor`',
    author: { name: 'dana', kind: 'human' },
    state: 'draft',
    stack: { index: 3, of: 3 },
    patchSets: [
      { n: 1, when: '1 hour ago', note: 'Initial version', tree: 'c19b4d7' },
    ],
    files: 3,
    additions: 58,
    deletions: 4,
    reviewers: [],
    ci: 'pending',
    when: 'opened 1 hour ago',
    mirror: { host: 'github', number: 233, origin: 'here' },
  },
  {
    id: '212',
    title: 'Normalize Windows path separators',
    author: { name: 'ines', kind: 'human' },
    state: 'open',
    patchSets: [
      { n: 1, when: '5 days ago', note: 'Initial version', tree: 'e2250ab' },
      {
        n: 2,
        when: '4 days ago',
        note: 'Add regression test',
        tree: 'f31c8de',
      },
    ],
    files: 4,
    additions: 77,
    deletions: 12,
    reviewers: [{ name: 'hollis', kind: 'human', state: 'changes' }],
    ci: 'fail',
    when: 'updated 4 days ago',
    mirror: { host: 'github', number: 226, origin: 'there' },
  },
  {
    id: '215',
    title: 'Bump object-store client to 2.4',
    author: { name: 'dep-bot', kind: 'bot' },
    state: 'open',
    patchSets: [
      { n: 1, when: '6 days ago', note: 'Automated update', tree: '77b3f10' },
    ],
    files: 2,
    additions: 9,
    deletions: 9,
    reviewers: [{ name: 'coderabbit', kind: 'reviewer', state: 'approved' }],
    ci: 'pass',
    when: 'opened 6 days ago',
  },
  {
    id: '210',
    title: 'Document the mount flags',
    author: { name: 'tomas', kind: 'human' },
    state: 'landed',
    patchSets: [
      { n: 1, when: '2 weeks ago', note: 'Initial version', tree: '0f9d4a6' },
    ],
    files: 1,
    additions: 34,
    deletions: 2,
    reviewers: [{ name: 'dana', kind: 'human', state: 'approved' }],
    ci: 'pass',
    when: 'landed 2 weeks ago',
  },
]

/**
 * The changes a repository has. gitfs has them all, a stack and a mirror
 * included. lumen has two that came from another host, relay has three, and
 * the rest have none, so each state of the list can be seen.
 */
export function changesFor(repo: { name: string }): Array<ChangeItem> {
  if (repo.name === 'gitfs') return changes
  if (repo.name === 'lumen')
    return changes.filter((c) => c.id === '212' || c.id === '215')
  if (repo.name === 'relay')
    return changes.filter((c) => ['212', '215', '210'].includes(c.id))
  return []
}

export const openChangeCount = (repo: { name: string }) =>
  changesFor(repo).filter((c) => c.state !== 'landed').length

export const refsPatch = patch('src/refs.rs', 1, [
  ' pub struct Refs {',
  '     disk: Disk,',
  '+    neg: NegCache,',
  ' }',
  ' ',
  ' impl Refs {',
  '     pub fn lookup(&self, name: &str) -> Option<Oid> {',
  '-        self.disk.read_ref(name)',
  '+        if self.neg.contains(name) {',
  '+            return None;',
  '+        }',
  '+        self.disk',
  '+            .read_ref(name)',
  '+            .or_else(|| self.neg.put(name))',
  '     }',
  ' }',
])

export const refsTestPatch = patch('tests/refs_test.rs', 1, [
  ' #[test]',
  ' fn lookup_reads_disk_once() {',
  '+    let refs = Refs::with_counter();',
  '+    assert!(refs.lookup("refs/heads/missing").is_none());',
  '+    assert!(refs.lookup("refs/heads/missing").is_none());',
  '+    assert_eq!(refs.disk_reads(), 1);',
  ' }',
])

const refsV1 = patch('src/refs.rs', 1, [
  ' pub struct Refs {',
  '     disk: Disk,',
  '+    neg: NegCache,',
  ' }',
  ' ',
  ' impl Refs {',
  '     pub fn lookup(&self, name: &str) -> Option<Oid> {',
  '-        self.disk.read_ref(name)',
  '+        if self.neg.hit(name) {',
  '+            return None;',
  '+        }',
  '+        self.disk',
  '+            .read_ref(name)',
  '+            .or_else(|| self.neg.remember(name))',
  '     }',
  ' }',
])

const refsV2 = patch('src/refs.rs', 1, [
  ' pub struct Refs {',
  '     disk: Disk,',
  '+    neg: NegCache,',
  ' }',
  ' ',
  ' impl Refs {',
  '     pub fn lookup(&self, name: &str) -> Option<Oid> {',
  '-        self.disk.read_ref(name)',
  '+        if self.neg.contains(name) {',
  '+            return None;',
  '+        }',
  '+        self.disk',
  '+            .read_ref(name)',
  '+            .or_else(|| self.neg.remember(name))',
  '     }',
  ' }',
])

const testV1 = patch('tests/refs_test.rs', 1, [
  ' #[test]',
  ' fn lookup_reads_disk_once() {',
  '+    let refs = Refs::with_counter();',
  '+    assert!(refs.lookup("refs/heads/missing").is_none());',
  '+    assert!(refs.lookup("refs/heads/missing").is_none());',
  ' }',
])

/** The two sides of a patch, as whole files. Context and one side's lines. */
function sidesOf(raw: string) {
  const body = raw.split('\n').slice(5)
  const keep = (drop: string) =>
    body
      .filter((l) => l !== '' && l[0] !== drop)
      .map((l) => l.slice(1))
      .join('\n') + '\n'
  return { before: keep('+'), after: keep('-') }
}

export type FileVersions = Record<string, string>

/**
 * Every file a change touches, whole: how it is on main and how it is at each
 * patch set. A diff is drawn from two of these, and an edit starts from one.
 * Only the main sample change has history, the others repeat their one state.
 */
export function changeVersions(
  changeId: string,
  patchSets: number,
): { base: FileVersions; versions: Array<FileVersions> } {
  const ps3 = {
    'src/refs.rs': sidesOf(refsPatch),
    'tests/refs_test.rs': sidesOf(refsTestPatch),
  }
  const base = {
    'src/refs.rs': ps3['src/refs.rs'].before,
    'tests/refs_test.rs': ps3['tests/refs_test.rs'].before,
  }
  const at3 = {
    'src/refs.rs': ps3['src/refs.rs'].after,
    'tests/refs_test.rs': ps3['tests/refs_test.rs'].after,
  }
  if (changeId !== '216')
    return { base, versions: Array.from({ length: patchSets }, () => at3) }
  return {
    base,
    versions: [
      {
        'src/refs.rs': sidesOf(refsV1).after,
        'tests/refs_test.rs': sidesOf(testV1).after,
      },
      {
        'src/refs.rs': sidesOf(refsV2).after,
        'tests/refs_test.rs': at3['tests/refs_test.rs'],
      },
      at3,
    ],
  }
}

export const findings: Array<Finding> = [
  {
    id: 'F-1',
    by: 'coderabbit',
    kind: 'reviewer',
    severity: 'medium',
    file: 'src/refs.rs',
    line: 8,
    title: 'Lookup takes the cache lock on every call',
    body: 'contains() locks the whole map even for repeat hits. A read-mostly structure would keep lookups lock-free under load.',
    suggestion: {
      summary: 'Read a snapshot instead of taking the lock',
      file: 'src/refs.rs',
      replace: ['        if self.neg.contains(name) {'],
      lines: ['        if self.neg.peek(name) {'],
    },
    prompt:
      'In src/refs.rs, lookup() calls self.neg.contains(name), which takes the cache lock on every call even for repeat hits. Read from a lock-free snapshot instead (add peek() to NegCache if it does not exist) and keep the behaviour for misses unchanged. Run `cargo test refs` and confirm lookup_reads_disk_once still passes.',
  },
  {
    id: 'F-2',
    by: 'greptile',
    kind: 'reviewer',
    severity: 'high',
    file: 'src/refs.rs',
    line: 13,
    title: 'NegCache is unbounded',
    body: 'The positive cache in src/cache.rs evicts at 10,000 entries, but put() here never evicts. A scan of random names grows memory without limit.',
    suggestion: {
      summary: 'Cap the cache at the same size as the positive one',
      file: 'src/refs.rs',
      replace: ['            .or_else(|| self.neg.put(name))'],
      lines: [
        '            .or_else(|| self.neg.put_bounded(name, NEG_CACHE_MAX))',
      ],
    },
    prompt:
      'NegCache in src/refs.rs never evicts, while the positive cache in src/cache.rs stops at 10,000 entries. Bound it to the same size with LRU eviction: add put_bounded(name, max) and a NEG_CACHE_MAX constant, and use it in lookup(). Add a test that fills the cache past capacity and checks the oldest entry is read from disk again.',
  },
  {
    id: 'F-3',
    by: 'macroscope',
    kind: 'reviewer',
    severity: 'low',
    file: 'tests/refs_test.rs',
    line: 6,
    title: 'Test does not cover eviction',
    body: 'The test asserts a single disk read for two misses. Add a case that fills the cache past capacity and checks the oldest entry is read again.',
    suggestion: {
      summary:
        'Fill the cache past capacity, then look the first name up again',
      file: 'tests/refs_test.rs',
      replace: [],
      after: '    assert_eq!(refs.disk_reads(), 1);',
      lines: [
        '    for i in 0..=NEG_CACHE_MAX {',
        '        refs.lookup(&format!("refs/heads/miss-{i}"));',
        '    }',
        '    assert!(refs.lookup("refs/heads/missing").is_none());',
        '    assert_eq!(refs.disk_reads(), NEG_CACHE_MAX + 2);',
      ],
    },
    prompt:
      'tests/refs_test.rs asserts one disk read for two lookups of a missing ref, but nothing covers eviction. Add a case after lookup_reads_disk_once: fill the negative cache past NEG_CACHE_MAX, look the first missing name up again, and assert it is read from disk. Depends on the cache being bounded.',
  },
  {
    id: 'F-4',
    by: 'hollis',
    kind: 'human',
    severity: 'low',
    file: 'src/refs.rs',
    line: 3,
    title: 'Name',
    body: 'neg is fine, but add a one-line doc comment saying what it caches.',
    suggestion: {
      summary: 'Add the doc comment',
      file: 'src/refs.rs',
      replace: [],
      after: '    disk: Disk,',
      lines: [
        '    /// Names known not to exist, so asking again skips the disk.',
      ],
    },
  },
]

export type PolicyClause = {
  id: string
  rule: string
  detail: string
  state: 'pass' | 'fail' | 'pending' | 'na'
}

/** Clauses for #216. The findings clause flips once F-2 is addressed. */
export function clausesFor(
  open: Set<string>,
  ci: ChangeItem['ci'],
): Array<PolicyClause> {
  const blockers = findings.filter(
    (f) => f.severity === 'high' && open.has(f.id),
  )
  return [
    {
      id: 'core-paths',
      rule: 'Core paths need a maintainer',
      detail:
        'src/** needs 1 human approval from team:maintainers. hollis approved patch set 2. Patch set 3 only renames one call, so the approval carries over.',
      state: 'pass',
    },
    {
      id: 'agent-authored',
      rule: 'Agent-authored changes need a human',
      detail: 'Not applicable. The author is a person.',
      state: 'na',
    },
    {
      id: 'ci-evidence',
      rule: 'Tests pass on the tree that will land',
      detail:
        ci === 'pass'
          ? 'ci/test passed on tree 9c4d7e1, the same tree the stack lands.'
          : 'ci/test is still running on tree 9c4d7e1.',
      state: ci === 'pass' ? 'pass' : 'pending',
    },
    {
      id: 'findings',
      rule: 'No open high-severity findings',
      detail: blockers.length
        ? `${blockers.length} open: ${blockers.map((b) => `${b.id} from ${b.by}`).join(', ')}.`
        : 'No open high-severity findings.',
      state: blockers.length ? 'fail' : 'pass',
    },
    {
      id: 'no-plaintext-secrets',
      rule: 'No plaintext in sensitive keys',
      detail: 'Checked 0 encrypted files. Nothing to decrypt.',
      state: 'pass',
    },
  ]
}

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

export const rules: Array<Rule> = [
  {
    id: 'core-paths',
    name: 'Core paths need a maintainer',
    mode: 'enforce',
    when: 'paths src/**, !src/**/tests/**',
    requires: [
      '1 approval, human, team:maintainers',
      'ci/test bound to the landing tree',
    ],
    evaluated: 41,
    blocked: 6,
  },
  {
    id: 'agent-authored',
    name: 'Agent-authored changes need a human',
    mode: 'enforce',
    when: 'author class is agent',
    requires: [
      '1 approval, human',
      'approver is not the identity that opened it',
    ],
    evaluated: 14,
    blocked: 3,
  },
  {
    id: 'docs-agent',
    name: 'Agents may approve docs',
    mode: 'enforce',
    when: 'paths docs/**',
    requires: ['1 approval, any class, must cite tests run and tree hash'],
    evaluated: 9,
    blocked: 0,
  },
  {
    id: 'findings',
    name: 'No open high-severity findings',
    mode: 'enforce',
    when: 'any change',
    requires: [
      'every high finding resolved, dismissed with a reason, or fixed in the stack',
    ],
    evaluated: 41,
    blocked: 8,
  },
  {
    id: 'policy-self',
    name: 'Policy files protect themselves',
    mode: 'enforce',
    when: 'paths .source/policy/**',
    requires: [
      '1 approval, human, team:policy-owners',
      'agents cannot approve',
    ],
    evaluated: 2,
    blocked: 0,
  },
  {
    id: 'secret-recipients',
    name: 'Recipient changes need an owner',
    mode: 'enforce',
    when: 'paths .source/secrets/**',
    requires: [
      '1 approval, human, team:security',
      'rotation commit present when a recipient is removed',
    ],
    evaluated: 5,
    blocked: 1,
  },
  {
    id: 'big-change',
    name: 'Large changes need two reviewers',
    mode: 'dry-run',
    when: 'additions + deletions > 400',
    requires: ['2 approvals, at least 1 human'],
    evaluated: 41,
    blocked: 4,
    note: 'Dry run for 12 more days. Would have blocked 4 of the last 41 changes.',
  },
]

export const policyYaml = `# .source/policy/main.yml
rules:
  - id: core-paths
    when: { paths: ["src/**", "!src/**/tests/**"] }
    require:
      - approval: { min: 1, class: human, from: team:maintainers }
      - evidence: { check: ci/test, bound_to: tree }

  - id: agent-authored
    when: { author_class: agent }
    require:
      - approval: { min: 1, class: human }
      - not_same_identity_as_author: true

  - id: findings
    require:
      - findings: { severity: high, open: 0 }

  - id: big-change
    mode: dry-run
    when: { size: "> 400" }
    require:
      - approval: { min: 2, includes: human }

exceptions:
  - rule: core-paths
    for: ines
    reason: Release week, covering for hollis
    expires: 2026-11-12
`

export type Exception = {
  rule: string
  who: string
  reason: string
  owner: string
  expires: string
}

export const exceptions: Array<Exception> = [
  {
    rule: 'core-paths',
    who: 'ines',
    reason: 'Release week, covering for hollis',
    owner: 'dana',
    expires: 'Nov 12',
  },
]

export type Bypass = { change: string; rule: string; who: string; when: string }

export const dryRunSamples: Array<{
  change: string
  title: string
  outcome: 'would block' | 'would pass'
  why: string
}> = [
  {
    change: '212',
    title: 'Normalize Windows path separators',
    outcome: 'would block',
    why: '89 lines changed, needs 2 approvals, has 0 approvals',
  },
  {
    change: '216',
    title: 'Cache negative ref lookups',
    outcome: 'would pass',
    why: '25 lines changed',
  },
  {
    change: '210',
    title: 'Document the mount flags',
    outcome: 'would pass',
    why: '36 lines changed',
  },
]

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

export const envVars: Array<EnvVar> = [
  {
    name: 'DATABASE_URL',
    type: 'url',
    sensitive: true,
    description: 'Postgres connection string',
    set: { development: true, preview: true, production: true },
    required: ['development', 'preview', 'production'],
    rotated: '12 days ago',
    by: 'dana',
  },
  {
    name: 'S3_ACCESS_KEY',
    type: 'string(startsWith=AKIA)',
    sensitive: true,
    description: 'Object store access key id',
    set: { development: true, preview: true, production: true },
    required: ['production'],
    rotated: '41 days ago',
    by: 'hollis',
  },
  {
    name: 'S3_SECRET_KEY',
    type: 'string',
    sensitive: true,
    description: 'Object store secret',
    set: { development: true, preview: true, production: true },
    required: ['production'],
    rotated: '41 days ago',
    by: 'hollis',
  },
  {
    name: 'STRIPE_KEY',
    type: 'string(startsWith=sk_)',
    sensitive: true,
    description: 'Billing secret key',
    set: { development: false, preview: true, production: true },
    required: ['production'],
    rotated: '3 hours ago',
    by: 'dana',
  },
  {
    name: 'SENTRY_DSN',
    type: 'url',
    sensitive: true,
    description: 'Error reporting endpoint',
    set: { development: false, preview: false, production: false },
    required: ['production'],
    rotated: 'never',
    by: '—',
  },
  {
    name: 'S3_BUCKET',
    type: 'string',
    sensitive: false,
    description: 'Bucket name',
    set: { development: true, preview: true, production: true },
    required: ['development', 'preview', 'production'],
    rotated: '90 days ago',
    by: 'dana',
  },
  {
    name: 'LOG_LEVEL',
    type: 'enum(debug, info, warn)',
    sensitive: false,
    description: 'Verbosity',
    set: { development: true, preview: true, production: true },
    required: [],
    rotated: '90 days ago',
    by: 'dana',
  },
  {
    name: 'API_PORT',
    type: 'port',
    sensitive: false,
    description: 'Listen port',
    set: { development: true, preview: true, production: true },
    required: [],
    rotated: '90 days ago',
    by: 'dana',
  },
]

export const envSchema = `# @defaultSensitive=true @defaultRequired=infer
# ---
# Postgres connection string
# @required @type=url
DATABASE_URL=

# Object store credentials
# @required=forEnv(production) @type=string(startsWith=AKIA)
S3_ACCESS_KEY=
# @required=forEnv(production)
S3_SECRET_KEY=

# Billing secret key
# @required=forEnv(production) @type=string(startsWith=sk_)
STRIPE_KEY=

# Error reporting endpoint
# @required=forEnv(production) @type=url
SENTRY_DSN=

# @public
S3_BUCKET=
# @public @type=enum(debug, info, warn)
LOG_LEVEL=info
# @public @type=port
API_PORT=8080
`

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

export const recipients: Array<Recipient> = [
  {
    id: 'r1',
    name: 'dana',
    kind: 'member',
    fingerprint: 'age1q8xk…m4rz',
    envs: ['development', 'preview', 'production'],
    added: '2024',
    lastUsed: '2 hours ago',
  },
  {
    id: 'r2',
    name: 'hollis',
    kind: 'member',
    fingerprint: 'age1d0vt…9x2c',
    envs: ['development', 'preview', 'production'],
    added: '2024',
    lastUsed: 'yesterday',
  },
  {
    id: 'r3',
    name: 'ines',
    kind: 'member',
    fingerprint: 'age1h7wa…k3pq',
    envs: ['development', 'preview'],
    added: 'Aug 2026',
    lastUsed: '4 days ago',
  },
  {
    id: 'r4',
    name: 'production deploy',
    kind: 'deploy',
    fingerprint: 'age1z5ne…u8tf',
    envs: ['production'],
    added: '2025',
    lastUsed: '3 hours ago',
    note: 'Key lives in the deploy platform KMS',
  },
  {
    id: 'r5',
    name: 'ci/release job',
    kind: 'ci',
    fingerprint: 'short-lived',
    envs: ['preview', 'production'],
    added: '2025',
    lastUsed: 'yesterday',
    note: 'Minted per run, expires in 15 minutes',
  },
  {
    id: 'r6',
    name: 'claude via T3 Code',
    kind: 'agent',
    fingerprint: 'age1c2jm…l6ys',
    envs: ['development'],
    added: 'Oct 2026',
    lastUsed: '2 hours ago',
    note: 'Development only. Expires Nov 30',
  },
  {
    id: 'r7',
    name: 'Recovery key',
    kind: 'escrow',
    fingerprint: 'age1f9bp…q0dn',
    envs: ['development', 'preview', 'production'],
    added: '2024',
    lastUsed: 'never',
    note: 'Held offline by two owners',
  },
]

export type AuditEvent = {
  when: string
  who: string
  action: string
  target: string
  kind: 'rotate' | 'grant' | 'revoke' | 'read' | 'reject'
}

export const auditLog: Array<AuditEvent> = [
  {
    when: '3 hours ago',
    who: 'dana',
    action: 'Rotated',
    target: 'STRIPE_KEY in production',
    kind: 'rotate',
  },
  {
    when: '3 hours ago',
    who: 'ci/release job',
    action: 'Decrypted',
    target: 'production for deploy run #812',
    kind: 'read',
  },
  {
    when: 'yesterday',
    who: 'push guard',
    action: 'Rejected a push',
    target: 'plaintext in S3_SECRET_KEY (hollis)',
    kind: 'reject',
  },
  {
    when: '2 days ago',
    who: 'dana',
    action: 'Granted',
    target: 'claude via T3 Code, development, 30 days',
    kind: 'grant',
  },
  {
    when: '12 days ago',
    who: 'dana',
    action: 'Rotated',
    target: 'DATABASE_URL in all environments',
    kind: 'rotate',
  },
  {
    when: '3 weeks ago',
    who: 'hollis',
    action: 'Revoked',
    target: 'build-box-2 and rotated the data key',
    kind: 'revoke',
  },
]

/** A rotation commit with value-level diffs. Ciphertext only. */
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

export const bots: Array<Bot> = [
  {
    slug: 'triage-bot',
    name: 'Triage bot',
    description: 'Labels and answers new issues.',
    scopes: ['repo:read', 'issues:read', 'issues:comment', 'issues:write'],
    installs: ['dana/gitfs', 'dana/tinyqueue'],
    tokens: 1,
    state: 'ready',
  },
  {
    slug: 'release-bot',
    name: 'Release bot',
    description: 'Cuts release notes and tags builds.',
    scopes: ['repo:read', 'repo:write', 'pulls:read'],
    installs: ['dana/gitfs'],
    tokens: 2,
    state: 'ready',
  },
  {
    slug: 'fix-agent',
    name: 'Fix agent',
    description: 'Opens draft changes for failing CI and review findings.',
    scopes: [
      'repo:read',
      'repo:write',
      'pulls:read',
      'pulls:write',
      'pulls:comment',
      'secrets:schema',
    ],
    installs: ['dana/gitfs'],
    tokens: 1,
    state: 'ready',
  },
]

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

export type Automation = {
  id: string
  name: string
  bot: string
  triggers: Array<Trigger>
  runtime: Runtime
  target: Target
  instructions: string
  enabled: boolean
  lastRun: string
  runs: number
}

export const automations: Array<Automation> = [
  {
    id: 'a1',
    name: 'Triage new issues',
    bot: 'triage-bot',
    triggers: ['issue.created'],
    runtime: 'Claude Code',
    target: 'E2B',
    instructions:
      'Label the issue, link duplicates, and ask for a repro when one is missing.',
    enabled: true,
    lastRun: '12 minutes ago',
    runs: 214,
  },
  {
    id: 'a2',
    name: 'Fix high-severity findings',
    bot: 'fix-agent',
    triggers: ['finding.raised'],
    runtime: 'Claude Code',
    target: 'T3 Code',
    instructions:
      'For a high finding, open a draft change on top of the stack that fixes it and cite the finding id.',
    enabled: true,
    lastRun: '2 hours ago',
    runs: 37,
  },
  {
    id: 'a3',
    name: 'Repair red CI',
    bot: 'fix-agent',
    triggers: ['ci.failed'],
    runtime: 'Codex',
    target: 'boat.dev',
    instructions:
      'Reproduce the failure in a fresh environment, fix it, and open a draft change.',
    enabled: false,
    lastRun: '3 days ago',
    runs: 9,
  },
  {
    id: 'a4',
    name: 'Weekly dependency sweep',
    bot: 'release-bot',
    triggers: ['schedule'],
    runtime: 'OpenCode',
    target: 'E2B',
    instructions:
      'Check for new dependency versions, open one change per major bump.',
    enabled: true,
    lastRun: 'Monday 06:00 UTC',
    runs: 22,
  },
]

export type Run = {
  id: string
  automation: string
  trigger: string
  target: Target
  status: 'succeeded' | 'running' | 'failed'
  duration: string
  cost: string
  when: string
  result: string
  log: Array<string>
}

export const runs: Array<Run> = [
  {
    id: 'run_912',
    automation: 'Fix high-severity findings',
    trigger: 'finding.raised F-2 on #216',
    target: 'T3 Code',
    status: 'succeeded',
    duration: '4m 12s',
    cost: '$0.31',
    when: '2 hours ago',
    result: 'Opened draft #217',
    log: [
      'Started thread on dana-macbook via T3 Code',
      'Read finding F-2 and src/cache.rs',
      'Wrote src/neg_cache.rs with a bounded LRU',
      'Ran cargo test: 31 passed',
      'Opened draft change #217 on top of #216',
    ],
  },
  {
    id: 'run_911',
    automation: 'Triage new issues',
    trigger: 'issue.created #12',
    target: 'E2B',
    status: 'succeeded',
    duration: '41s',
    cost: '$0.04',
    when: '12 minutes ago',
    result: 'Labeled bug, linked #9',
    log: [
      'Read issue #12',
      'Searched 214 issues',
      'Applied label bug',
      'Commented with a link to #9',
    ],
  },
  {
    id: 'run_908',
    automation: 'Repair red CI',
    trigger: 'ci.failed on #212',
    target: 'boat.dev',
    status: 'failed',
    duration: '9m 50s',
    cost: '$0.62',
    when: '3 days ago',
    result: 'Could not reproduce on Linux',
    log: [
      'Started boat environment gitfs-ci-908',
      'Checked out #212',
      'Ran the test matrix: passed on Linux',
      'The failure is Windows only. Stopped.',
    ],
  },
  {
    id: 'run_913',
    automation: 'Weekly dependency sweep',
    trigger: 'schedule 0 6 * * 1',
    target: 'E2B',
    status: 'running',
    duration: '1m 03s',
    cost: '$0.05',
    when: 'now',
    result: 'Checking 38 dependencies',
    log: ['Started sandbox', 'Resolved 38 dependencies', 'Comparing versions'],
  },
]

// ---------------------------------------------------------------------------
// Profile extras
// ---------------------------------------------------------------------------

export type WorkShare = { label: string; value: number }

export function workShape(seed: number): Array<WorkShare> {
  const base = [
    ['Commits', 46],
    ['Reviews', 24],
    ['Changes', 16],
    ['Issues', 9],
    ['Releases', 5],
  ] as const
  return base.map(([label, v], i) => ({
    label,
    value: Math.max(2, v + ((seed + i * 7) % 7) - 3),
  }))
}

export const agentUse = [
  { name: 'Claude Code', share: 54 },
  { name: 'Codex', share: 31 },
  { name: 'OpenCode', share: 15 },
]
