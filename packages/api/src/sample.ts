import { newId, seededId } from './ids'
import { change216 } from './sample-change'
import { sampleReleases } from './sample-releases'
import { samplePipelines } from './sample-pipelines'
import { AuthStore } from './auth'
import type { CreateToken, Scope } from './auth'
import type {
  ActorRec,
  ChangeRec,
  CommentRec,
  FindingRec,
  IssueRec,
  MemoryDomain,
  NotificationKind,
  PatchSetRec,
  RepoRec,
  ReviewRec,
  TestCaseRec,
} from './domain'

/**
 * Sample data for the preview, in the same story the app and the CLI tell:
 * dana/gitfs, a stack of three changes (#216, #217, #218), a mirrored change,
 * an agent's draft, and reviewers' findings. It is also what the tests run on.
 */
export const T0 = Date.parse('2026-11-07T09:00:00Z')
const hours = (h: number) => T0 - h * 3_600_000
const days = (d: number) => T0 - d * 86_400_000

export const sampleTokens = {
  dana: 'sxp_dana_full_access_0001',
  hollis: 'sxp_hollis_maintainer_02',
  /** An agent: can read, write and comment on changes, cannot land. */
  fixAgent: 'sxb_fix_agent_scoped_03',
  /** A triage bot: issues only, installed on dana/gitfs. */
  triage: 'sxb_triage_bot_issues_04',
  /** A token limited to one repository. */
  limited: 'sxp_dana_limited_repo_05',
  expired: 'sxp_dana_expired_token_06',
  stranger: 'sxp_stranger_no_access_07',
} as const

const all: Array<Scope> = [
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
  'secrets:write',
  'secrets:decrypt',
  'webhooks:read',
  'webhooks:write',
  'tokens:manage',
]

export function sampleTokenStore(
  now = T0,
  store = new AuthStore(() => now),
): AuthStore {
  const year = 365 * 86_400_000
  const add = (
    secret: string,
    tag: string,
    input: Partial<CreateToken> &
      Pick<CreateToken, 'handle' | 'class' | 'scopes'>,
  ) =>
    store.add(secret, {
      name: tag,
      kind: input.class === 'human' ? 'personal' : 'bot',
      ttlMs: year,
      id: seededId('token', T0, tag),
      ...input,
    })
  add(sampleTokens.dana, 'dana', {
    handle: 'dana',
    class: 'human',
    scopes: all,
  })
  add(sampleTokens.hollis, 'hollis', {
    handle: 'hollis',
    class: 'human',
    scopes: [
      'repo:read',
      'pulls:read',
      'pulls:comment',
      'pulls:write',
      'pulls:merge',
      'issues:read',
      'issues:comment',
      'secrets:schema',
      'webhooks:read',
    ],
  })
  add(sampleTokens.fixAgent, 'fix-agent', {
    handle: 'fix-agent',
    class: 'agent',
    scopes: [
      'repo:read',
      'repo:write',
      'pulls:read',
      'pulls:write',
      'pulls:comment',
      'secrets:schema',
      'secrets:decrypt',
    ],
    repos: ['dana/gitfs'],
  })
  add(sampleTokens.triage, 'triage-bot', {
    handle: 'triage-bot',
    class: 'bot',
    scopes: ['repo:read', 'issues:read', 'issues:comment', 'issues:write'],
    repos: ['dana/gitfs'],
  })
  add(sampleTokens.limited, 'limited', {
    handle: 'dana',
    class: 'human',
    scopes: all,
    repos: ['dana/tinyqueue'],
  })
  const expired = add(sampleTokens.expired, 'expired', {
    handle: 'dana',
    class: 'human',
    scopes: all,
  })
  expired.expiresAt = now - 1000
  add(sampleTokens.stranger, 'stranger', {
    handle: 'stranger',
    class: 'human',
    scopes: all,
  })
  return store
}

type Files = PatchSetRec['files']
const ps = (
  d: MemoryDomain,
  n: number,
  at: number,
  tree: string,
  note: string,
  author: string,
  files: Files,
  kind: PatchSetRec['kind'] = n === 1 ? 'initial' : 'update',
): PatchSetRec => ({
  n,
  sha: `${tree}${'0'.repeat(33)}`.slice(0, 40),
  tree,
  note,
  author: d.actors.get(author)!,
  created: at,
  files,
  kind,
})

/**
 * The sample history has no changes behind it, so say something steady about
 * each commit: about half landed through a change, a few failed checks.
 */
function sampleFacts() {
  return (sha: string) => {
    const n = parseInt(sha.slice(0, 6), 16) || 0
    return {
      change: n % 9 < 5 ? 100 + ((n >>> 4) % 120) : null,
      checks: n % 17 === 0 ? ('fail' as const) : ('pass' as const),
    }
  }
}

export function seedSample(d: MemoryDomain) {
  for (const [h, c] of [
    ['dana', 'human'],
    ['hollis', 'human'],
    ['ines', 'human'],
    ['tomas', 'human'],
    ['kofi', 'human'],
    ['yuki', 'human'],
    ['mira', 'human'],
    ['stranger', 'human'],
    ['claude-t3', 'agent'],
    ['fix-agent', 'agent'],
    ['triage-bot', 'bot'],
    ['dep-bot', 'bot'],
    ['greptile', 'bot'],
    ['coderabbit', 'bot'],
  ] as const)
    d.seedActor(h, c, days(60))
  d.seedAccount('dana', 'Dana Okafor', 'person', [], days(60))
  d.seedAccount('hollis', 'Hollis Reyes', 'person', [], days(60))
  d.seedAccount('ines', 'Inês Barbosa', 'person', [], days(60))
  d.seedAccount('stranger', 'Sam Stranger', 'person', [], days(30))
  d.seedAccount(
    'northwind',
    'Northwind Labs',
    'organization',
    [
      ['dana', 'owner'],
      ['hollis', 'member'],
    ],
    days(50),
  )
  // dana can work in lumen-studio but is only a member there.
  d.seedAccount(
    'lumen-studio',
    'Lumen Studio',
    'organization',
    [['dana', 'member']],
    days(45),
  )

  const gitfs = d.seedRepo('dana', 'gitfs', {
    storeId: 'gitfs',
    description:
      'Git over object storage. Mount any bucket as a repository and clone it from anywhere.',
    stars: 2140,
    starsTodayBase: 84,
    install: 'curl -fsSL https://source.code/dana/gitfs/install | sh',
    sampleCommitFacts: sampleFacts(),
    forks: 118,
    category: 'Developer tools',
    languages: [
      ['Rust', 88.4],
      ['Shell', 7.1],
      ['Nix', 4.5],
    ],
    license: 'MIT',
    website: 'https://gitfs.dev',
    docsUrl: 'https://gitfs.dev/docs',
    created: days(40),
    collaborators: ['hollis', 'ines'],
    installs: ['triage-bot', 'fix-agent'],
    maintainers: ['dana', 'hollis'],
    env: [
      { name: 'DATABASE_URL', kind: 'url', set: ['development', 'production'] },
      { name: 'STRIPE_KEY', kind: 'string', set: ['production'] },
      { name: 'API_PORT', kind: 'port', set: ['development', 'production'] },
    ],
  })
  d.seedRepo('dana', 'tinyqueue', {
    storeId: 'tinyqueue',
    description:
      'Zero-dependency job queue with retries and exponential backoff.',
    stars: 640,
    starsTodayBase: 9,
    upstream: { host: 'github', slug: 'dana/tinyqueue' },
    sampleCommitFacts: sampleFacts(),
    forks: 31,
    category: 'Infrastructure',
    languages: [
      ['TypeScript', 96.2],
      ['JavaScript', 3.8],
    ],
    license: 'MIT',
    created: days(30),
  })
  d.seedRepo('dana', 'notes', {
    description: 'Private notes.',
    visibility: 'private',
    created: days(20),
  })
  d.seedRepo('northwind', 'relay', {
    storeId: 'relay',
    description:
      'A small message relay with at-least-once delivery and a replayable log.',
    stars: 310,
    starsTodayBase: 6,
    sampleCommitFacts: sampleFacts(),
    forks: 18,
    category: 'Infrastructure',
    languages: [
      ['Go', 91.4],
      ['Shell', 8.6],
    ],
    license: 'Apache-2.0',
    created: days(25),
    collaborators: ['hollis'],
    maintainers: ['dana', 'hollis'],
  })
  d.seedRepo('hollis', 'lumen', {
    storeId: 'lumen',
    description:
      'A fast, local-first markdown notebook. Plain files on disk, instant search, no account.',
    stars: 18900,
    starsTodayBase: 412,
    forks: 904,
    category: 'Apps',
    languages: [
      ['Rust', 61],
      ['TypeScript', 34],
      ['CSS', 5],
    ],
    license: 'AGPL-3.0',
    website: 'https://lumen.app',
    docsUrl: 'https://lumen.app/docs',
    upstream: { host: 'codeberg', slug: 'hollis/lumen' },
    install: 'brew install lumen',
    sampleCommitFacts: sampleFacts(),
    created: days(55),
  })
  d.seedRepo('ines', 'tern', {
    storeId: 'tern',
    description:
      'Typed schema migrations for Postgres. Plan, diff and roll back from one binary.',
    stars: 7320,
    starsTodayBase: 133,
    forks: 288,
    category: 'Databases',
    languages: [
      ['Go', 94],
      ['SQL', 6],
    ],
    license: 'Apache-2.0',
    website: 'https://tern.dev',
    docsUrl: 'https://tern.dev/docs',
    upstream: { host: 'gitlab', slug: 'ines/tern' },
    install: 'go install tern.dev/cmd/tern@latest',
    sampleCommitFacts: sampleFacts(),
    created: days(50),
  })
  d.seedRepo('ines', 'inkwell', {
    storeId: 'inkwell',
    description:
      'Python library for typesetting beautiful PDFs from plain data.',
    stars: 4470,
    starsTodayBase: 38,
    forks: 201,
    category: 'Developer tools',
    languages: [['Python', 100]],
    license: 'BSD-3-Clause',
    upstream: { host: 'gitlab', slug: 'sol/inkwell' },
    install: 'pip install inkwell',
    sampleCommitFacts: sampleFacts(),
    created: days(48),
  })
  d.seedAlias('dana/git-fs', 'dana/gitfs')

  const a = (name: string) => d.actors.get(name)!
  const review = (
    who: string,
    state: ReviewRec['state'],
    patchSet: number,
    carries: boolean,
    at: number,
  ): ReviewRec => ({
    id: seededId('review', at, `${who}${patchSet}${state}`),
    actor: a(who),
    state,
    patchSet,
    carries,
    body: '',
    created: at,
  })
  const finding = (
    n: number,
    by: string,
    sev: FindingRec['severity'],
    file: string,
    line: number,
    title: string,
    state: FindingRec['state'] = 'open',
  ): FindingRec => ({
    id: seededId('finding', hours(20), `F-${n}`),
    label: `F-${n}`,
    by,
    severity: sev,
    state,
    reason: null,
    file,
    line,
    title,
    body: `${title}.`,
    patchSet: 3,
    created: hours(20),
  })

  const base = (
    n: number,
    title: string,
    author: string,
    state: ChangeRec['state'],
    branch: string,
  ): ChangeRec => ({
    id: seededId('change', days(5), `gitfs-${n}`),
    number: n,
    title,
    description: '',
    state,
    author: a(author),
    base: 'main',
    branch,
    patchSets: [],
    reviews: [],
    findings: [],
    checks: [],
    stackId: null,
    labels: [],
    mirrors: [],
    created: days(5),
    updated: hours(24),
    landed: null,
    version: 1,
  })

  // The stack: #216 below #217 below #218.
  const stk = seededId('stack', days(3), 'gitfs-neg-cache')
  const c216 = base(
    216,
    'Cache negative ref lookups',
    'dana',
    'open',
    'neg-cache',
  )
  c216.stackId = stk
  c216.description =
    'Remembers lookups for refs that do not exist, so asking again skips the disk. Added to `lookup()` in `src/refs.rs`, with a test that two misses cost one read. The next change in the stack bounds the cache.'
  c216.created = days(3)
  c216.updated = hours(24)
  c216.labels = ['perf']
  c216.mirrors = [{ host: 'github', number: 231, origin: 'here' }]
  c216.patchSets = [
    ps(d, 1, days(3), '41ac9e2', 'Initial version', 'dana', {
      'src/refs.rs': { hash: 'a1', add: 20, del: 2 },
      'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 },
    }),
    ps(
      d,
      2,
      days(2),
      '5d02b8f',
      'Address review: rename hit() to contains()',
      'dana',
      {
        'src/refs.rs': { hash: 'a2', add: 20, del: 2 },
        'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 },
      },
    ),
    ps(
      d,
      3,
      hours(24),
      '9c4d7e1',
      'Rebased onto main and renamed remember() to put()',
      'dana',
      {
        'src/refs.rs': { hash: 'a3', add: 20, del: 2 },
        'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 },
      },
      'rebase',
    ),
  ]
  c216.reviews = [
    review('hollis', 'approved', 2, true, hours(40)),
    review('greptile', 'changes', 3, true, hours(20)),
    review('coderabbit', 'commented', 3, true, hours(19)),
  ]
  c216.findings = [
    {
      ...finding(
        2,
        'greptile',
        'high',
        'src/refs.rs',
        13,
        'NegCache is unbounded',
      ),
      body: 'The positive cache in src/cache.rs evicts at 10,000 entries, but put() here never evicts. A scan of random names grows memory without limit.',
      suggestion: {
        summary: 'Cap the cache at the same size as the positive one',
        file: 'src/refs.rs',
        replace: ['            .or_else(|| self.neg.put(name))'],
        after: null,
        lines: [
          '            .or_else(|| self.neg.put_bounded(name, NEG_CACHE_MAX))',
        ],
      },
      prompt:
        'NegCache in src/refs.rs never evicts, while the positive cache in src/cache.rs stops at 10,000 entries. Bound it to the same size with LRU eviction: add put_bounded(name, max) and a NEG_CACHE_MAX constant, and use it in lookup(). Add a test that fills the cache past capacity and checks the oldest entry is read from disk again.',
    },
    {
      ...finding(
        3,
        'coderabbit',
        'medium',
        'src/refs.rs',
        8,
        'Lookup takes the cache lock on every call',
      ),
      body: 'contains() locks the whole map even for repeat hits. A read-mostly structure would keep lookups lock-free under load.',
      suggestion: {
        summary: 'Read a snapshot instead of taking the lock',
        file: 'src/refs.rs',
        replace: ['        if self.neg.contains(name) {'],
        after: null,
        lines: ['        if self.neg.peek(name) {'],
      },
      prompt:
        'In src/refs.rs, lookup() calls self.neg.contains(name), which takes the cache lock on every call even for repeat hits. Read from a lock-free snapshot instead (add peek() to NegCache if it does not exist) and keep the behaviour for misses unchanged. Run `cargo test refs` and confirm lookup_reads_disk_once still passes.',
    },
    {
      ...finding(
        4,
        'macroscope',
        'low',
        'tests/refs_test.rs',
        6,
        'Test does not cover eviction',
      ),
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
  ]
  // The files themselves, so the review screen can draw and edit them.
  c216.baseFiles = change216.base
  c216.patchSets.forEach((set, i) => (set.contents = change216.versions[i]))
  c216.checks = [
    {
      id: seededId('check', hours(20), '216ci'),
      key: 'ci/test',
      name: 'ci/test',
      state: 'pending',
      tree: '9c4d7e1',
      detailsUrl: null,
      created: hours(20),
      updated: hours(20),
      cases: [
        ['refs', 'lookup_reads_disk_once', 12, 'fail', 'pass'],
        ['refs', 'lookup_hits_cache', 8, 'pass', 'pass'],
        ['refs', 'lookup_survives_empty_name', 5, 'pass', 'pass'],
        ['mount', 'mounts_readonly', 140, 'pass', 'pass'],
        ['mount', 'remounts_after_error', 210, 'pass', 'pass'],
        ['store', 'retries_on_503', 480, 'pass', 'pass'],
        ['store', 'backoff_is_capped', 35, 'pass', 'pass'],
        ['refs', 'neg_cache_is_bounded', 0, 'missing', 'skip'],
      ].map(([suite, name, ms, onBase, head]) => ({
        suite,
        name,
        ms,
        base: onBase,
        head,
      })) as Array<TestCaseRec>,
    },
  ]

  const c217 = base(
    217,
    'Bound the negative cache and evict LRU',
    'claude-t3',
    'draft',
    'neg-cache-bound',
  )
  c217.stackId = stk
  c217.created = hours(2)
  c217.updated = hours(2)
  c217.mirrors = [{ host: 'github', number: 232, origin: 'here' }]
  c217.patchSets = [
    ps(d, 1, hours(2), 'a71e0c3', 'Opened from finding F-2', 'claude-t3', {
      'src/cache.rs': { hash: 'c1', add: 41, del: 3 },
    }),
  ]
  c217.reviews = [review('dana', 'commented', 1, true, hours(1))]
  c217.checks = [
    {
      id: seededId('check', hours(1), '217ci'),
      key: 'ci/test',
      name: 'ci/test',
      state: 'pass',
      tree: 'a71e0c3',
      detailsUrl: null,
      created: hours(1),
      updated: hours(1),
    },
  ]

  const c218 = base(
    218,
    'Show cache stats in `gitfs doctor`',
    'dana',
    'draft',
    'doctor-stats',
  )
  c218.stackId = stk
  c218.created = hours(1)
  c218.updated = hours(1)
  c218.mirrors = [{ host: 'github', number: 233, origin: 'here' }]
  c218.patchSets = [
    ps(d, 1, hours(1), 'c19b4d7', 'Initial version', 'dana', {
      'src/doctor.rs': { hash: 'd1', add: 58, del: 4 },
    }),
  ]

  const c212 = base(
    212,
    'Normalize Windows path separators',
    'ines',
    'open',
    'win-paths',
  )
  c212.created = days(5)
  c212.updated = days(4)
  c212.mirrors = [{ host: 'github', number: 226, origin: 'there' }]
  c212.patchSets = [
    ps(d, 1, days(5), 'e2250ab', 'Initial version', 'ines', {
      'src/path.rs': { hash: 'e1', add: 70, del: 12 },
    }),
    ps(d, 2, days(4), 'f31c8de', 'Add regression test', 'ines', {
      'src/path.rs': { hash: 'e1', add: 70, del: 12 },
      'tests/path_test.rs': { hash: 'f1', add: 7, del: 0 },
    }),
  ]
  c212.reviews = [review('hollis', 'changes', 2, true, days(4))]
  c212.checks = [
    {
      id: seededId('check', days(4), '212ci'),
      key: 'ci/test',
      name: 'ci/test',
      state: 'fail',
      tree: 'f31c8de',
      detailsUrl: null,
      created: days(4),
      updated: days(4),
    },
  ]

  const c215 = base(
    215,
    'Bump object-store client to 2.4',
    'dep-bot',
    'open',
    'deps/object-store',
  )
  c215.created = days(6)
  c215.updated = days(6)
  c215.patchSets = [
    ps(d, 1, days(6), '77b3f10', 'Automated update', 'dep-bot', {
      'Cargo.toml': { hash: 'g1', add: 9, del: 9 },
    }),
  ]
  c215.reviews = [review('coderabbit', 'approved', 1, true, days(6))]
  c215.checks = [
    {
      id: seededId('check', days(6), '215ci'),
      key: 'ci/test',
      name: 'ci/test',
      state: 'pass',
      tree: '77b3f10',
      detailsUrl: null,
      created: days(6),
      updated: days(6),
    },
  ]

  const c210 = base(
    210,
    'Document the mount flags',
    'tomas',
    'landed',
    'docs/mount',
  )
  c210.created = days(15)
  c210.updated = days(14)
  c210.landed = days(14)
  c210.patchSets = [
    ps(d, 1, days(15), '0f9d4a6', 'Initial version', 'tomas', {
      'docs/mount.md': { hash: 'h1', add: 34, del: 2 },
    }),
  ]
  c210.reviews = [review('dana', 'approved', 1, true, days(14))]

  for (const c of [c210, c212, c215, c216, c217, c218]) d.seedChange(gitfs, c)

  const issue = (
    n: number,
    title: string,
    state: IssueRec['state'],
    author: string,
    labels: Array<string>,
  ): IssueRec => ({
    id: seededId('issue', days(10), `gitfs-i${n}`),
    number: n,
    title,
    body: '',
    state,
    author: a(author),
    labels,
    created: days(10),
    updated: days(9),
    closed: state === 'closed' ? days(9) : null,
    version: 1,
  })
  const i4 = issue(4, 'Panic on trailing-dot ref names', 'open', 'mira', [
    'bug',
  ])
  i4.body =
    'Cloning a repository with a ref named `release.` panics in `Refs::lookup`.'
  i4.assignees = [a('dana')]
  i4.comments = [
    comment(
      'gitfs-i4-c1',
      a('dana'),
      days(9.5),
      'Thanks for the report. I can reproduce this on main.',
    ),
    comment(
      'gitfs-i4-c2',
      a('ines'),
      days(9.2),
      'Same here on macOS. The trailing dot is passed straight to the path join.',
    ),
  ]
  d.seedIssue(gitfs, i4)
  d.seedIssue(
    gitfs,
    issue(7, 'Support read-only mounts', 'closed', 'hollis', ['feature']),
  )
  d.seedIssue(
    gitfs,
    issue(209, 'Document the cache flags', 'open', 'tomas', ['docs']),
  )
  gitfs.nextNumber = 219

  for (const [owner, name] of [
    ['dana', 'tinyqueue'],
    ['northwind', 'relay'],
    ['hollis', 'lumen'],
    ['ines', 'tern'],
    ['ines', 'inkwell'],
  ] as const)
    seedIssues(d, d.repos.get(`${owner}/${name}`)!)

  for (const [full, list] of Object.entries(sampleReleases)) {
    const repo = d.repos.get(full)!
    for (const r of list)
      d.seedRelease(repo, {
        ...r,
        // Each domain gets its own copies: a download changes a count.
        notes: {
          added: [...r.notes.added],
          changed: [...r.notes.changed],
          fixed: [...r.notes.fixed],
        },
        assets: r.assets.map((x) => ({ ...x })),
        withdrawn: r.withdrawn ? { ...r.withdrawn } : null,
        id: seededId('release', r.published, `${full}@${r.tag}`),
        author: a(full.split('/')[0]),
        version: 1,
      })
  }

  for (const [full, runs] of Object.entries(samplePipelines)) {
    const repo = d.repos.get(full)!
    for (const r of runs) {
      const started = hours(r.ago)
      d.seedPipelineRun(repo, {
        ...r,
        id: seededId('pipeline', started, `${full}#${r.number}`),
        started,
        finished: r.duration === null ? null : started + r.duration,
        jobs: r.jobs.map((j) => ({
          ...j,
          steps: j.steps.map((s) => ({
            ...s,
            lines: s.lines.map(([t, level]) => ({ t, level: level ?? null })),
          })),
        })),
        version: 1,
      })
    }
  }

  // ines covers core paths in gitfs while hollis is away.
  gitfs.policyExceptions = [
    {
      id: seededId('exception', days(2), 'gitfs-ines-core'),
      rule: 'core-paths',
      who: 'ines',
      reason: 'Release week, covering for hollis',
      createdBy: 'dana',
      created: days(2),
      expires: days(-30),
    },
  ]

  // dana's connected services, three of them on for gitfs.
  for (const id of ['coderabbit', 't3code', 'varlock', 'selfhosted'])
    d.seedConnection('dana', id, 'dana', days(40))
  d.repoIntegrations.set(
    'dana/gitfs',
    new Set(['coderabbit', 't3code', 'varlock']),
  )

  // dana's bots, and what wakes them in gitfs.
  for (const [slug, name, description, cls, scopes, installs] of [
    [
      'triage-bot',
      'Triage bot',
      'Labels and answers new issues.',
      'bot',
      ['repo:read', 'issues:read', 'issues:comment', 'issues:write'],
      ['dana/gitfs', 'dana/tinyqueue'],
    ],
    [
      'release-bot',
      'Release bot',
      'Cuts release notes and tags builds.',
      'bot',
      ['repo:read', 'repo:write', 'pulls:read'],
      ['dana/gitfs'],
    ],
    [
      'fix-agent',
      'Fix agent',
      'Opens draft changes for failing CI and review findings.',
      'agent',
      [
        'repo:read',
        'repo:write',
        'pulls:read',
        'pulls:write',
        'pulls:comment',
        'secrets:schema',
      ],
      ['dana/gitfs'],
    ],
  ] as const)
    d.seedBot(
      {
        slug,
        name,
        description,
        owner: 'dana',
        class: cls,
        scopes: [...scopes],
        created: days(40),
      },
      [...installs],
    )
  for (const [
    id,
    name,
    bot,
    triggers,
    runtime,
    target,
    instructions,
    enabled,
    triggered,
    ago,
  ] of [
    [
      'a1',
      'Triage new issues',
      'triage-bot',
      ['issue.created'],
      'Claude Code',
      'E2B',
      'Label the issue, link duplicates, and ask for a repro when one is missing.',
      true,
      214,
      0.2,
    ],
    [
      'a2',
      'Fix high-severity findings',
      'fix-agent',
      ['finding.raised'],
      'Claude Code',
      'T3 Code',
      'For a high finding, open a draft change on top of the stack that fixes it and cite the finding id.',
      true,
      37,
      2,
    ],
    [
      'a3',
      'Repair red CI',
      'fix-agent',
      ['ci.failed'],
      'Codex',
      'boat.dev',
      'Reproduce the failure in a fresh environment, fix it, and open a draft change.',
      false,
      9,
      72,
    ],
    [
      'a4',
      'Weekly dependency sweep',
      'release-bot',
      ['schedule'],
      'OpenCode',
      'E2B',
      'Check for new dependency versions, open one change per major bump.',
      true,
      22,
      96,
    ],
  ] as const)
    d.seedAutomation('dana/gitfs', {
      id: seededId('automation', days(30), `gitfs-${id}`),
      name,
      bot,
      triggers: [...triggers],
      runtime,
      target,
      instructions,
      enabled,
      triggered,
      lastTriggered: hours(ago),
      // A scheduled one last fired when it was last triggered.
      ...(triggers.includes('schedule' as never)
        ? { lastScheduled: hours(ago) }
        : {}),
      created: days(30),
      version: 1,
    })

  // Downloads by day for the last 60 days, so the charts have a shape. Only
  // what is downloaded from now on is counted for real.
  for (const [full, perDay] of [
    ['dana/gitfs', 40],
    ['hollis/lumen', 300],
    ['ines/tern', 60],
  ] as const) {
    const times: Array<number> = []
    for (let day = 60; day >= 1; day--) {
      const n = Math.round(
        perDay * (1 + 0.35 * Math.sin(day / 4) + (day % 7 === 0 ? -0.3 : 0)),
      )
      for (let k = 0; k < n; k++)
        times.push(days(day) + (k * 86_400_000) / (n + 1))
    }
    d.seedDownloads(full, times)
  }

  // Who follows whom.
  for (const [who, whom] of [
    ['hollis', 'dana'],
    ['ines', 'dana'],
    ['stranger', 'dana'],
    ['dana', 'ines'],
    ['hollis', 'ines'],
  ] as const)
    d.seedFollow(who, whom)

  // Who dana is elsewhere.
  d.seedLink('dana', {
    host: 'github',
    login: 'dana-okafor',
    instance: null,
    linked: days(50),
  })

  // dana's inbox, oldest first so the newest ends on top.
  const inbox: Array<
    [NotificationKind, string, string | null, string, number, boolean]
  > = [
    [
      'release',
      'tern v1.12.0 is out: Plan mode',
      'ines/tern',
      '/ines/tern/releases',
      96,
      false,
    ],
    [
      'issue',
      'kofi assigned you #207 Memory grows steadily in long-running sessions',
      'hollis/lumen',
      '/hollis/lumen/issues?n=207',
      95,
      false,
    ],
    [
      'ci',
      'Checks failed on #212 Normalize Windows path separators',
      'dana/gitfs',
      '/dana/gitfs/changes?n=212',
      72,
      true,
    ],
    [
      'mention',
      'kofi mentioned you on #209 Document the cache flags',
      'dana/gitfs',
      '/dana/gitfs/issues?n=209',
      48,
      false,
    ],
    [
      'release',
      'lumen v2.4.1 is out: Sync conflicts, finally readable',
      'hollis/lumen',
      '/hollis/lumen/releases',
      24,
      false,
    ],
    [
      'review',
      'greptile reviewed #216 Cache negative ref lookups',
      'dana/gitfs',
      '/dana/gitfs/changes?n=216',
      2,
      true,
    ],
    [
      'import',
      'Finished linking your GitHub history: 2,410 contributions added to your profile',
      'Linked accounts',
      '/settings/accounts',
      0.2,
      true,
    ],
  ]
  for (const [kind, title, repo, path, ago, unread] of inbox)
    d.notify('dana', {
      kind,
      title,
      repo,
      path,
      at: hours(ago),
      unread,
      id: seededId('notification', hours(ago), title),
    })
}

const comment = (
  tag: string,
  author: ActorRec,
  at: number,
  body: string,
): CommentRec => ({
  id: seededId('comment', at, tag),
  author,
  body,
  created: at,
  updated: at,
  version: 1,
})

const HOUR = 3_600_000

/** The issues every sample repository but gitfs shows: the same eight, named for it. */
function seedIssues(d: MemoryDomain, repo: RepoRec) {
  const r = repo.name
  const list: Array<
    [
      number,
      string,
      IssueRec['state'],
      Array<string>,
      string,
      number,
      string,
      Array<[string, string]>,
    ]
  > = [
    [
      214,
      `${r} exits with code 1 when the config file is empty`,
      'open',
      ['bug'],
      'kofi',
      0.1,
      `Running \`${r} run\` against an empty \`${r}.toml\` prints nothing and exits 1. An empty file should behave like defaults.`,
      [
        ['dana', 'Thanks for the report. I can reproduce this on main.'],
        [
          'ines',
          'Same here on macOS. Looks like the empty-file branch returns early without defaults.',
        ],
      ],
    ],
    [
      213,
      'Publish a Windows ARM64 build',
      'open',
      ['enhancement', 'help wanted'],
      'yuki',
      1,
      'Surface and Snapdragon laptops are common now. Happy to test nightly builds.',
      [
        [
          'hollis',
          'The release pipeline can cross-compile this; it needs a runner to test on.',
        ],
        ['yuki', 'I can run the tests on mine before each release.'],
      ],
    ],
    [
      209,
      'Respect XDG_CONFIG_HOME on Linux',
      'open',
      ['enhancement', 'good first issue'],
      'mira',
      2,
      'Config is read from ~/.config regardless of the XDG variable.',
      [['dana', 'A good first one: the lookup is in one place.']],
    ],
    [
      207,
      'Memory grows steadily in long-running sessions',
      'open',
      ['bug', 'perf'],
      'kofi',
      4,
      'RSS goes from 40 MB to 1.1 GB over 36 hours with the watcher enabled.',
      [
        ['ines', 'Does it still grow with the watcher off?'],
        ['kofi', 'No, flat at 40 MB without it.'],
        ['dana', 'Then it is the event buffer. Taking a look.'],
      ],
    ],
    [
      203,
      'Explain retry behaviour in the docs',
      'open',
      ['docs', 'good first issue'],
      'tomas',
      7,
      'The README mentions retries but not the backoff schedule or how to disable them.',
      [],
    ],
    [
      198,
      'Panic on ref names with a trailing dot',
      'closed',
      ['bug'],
      'ines',
      8,
      'Fixed in the latest release.',
      [['dana', 'Fixed in the latest release.']],
    ],
    [
      191,
      'JSON output for the list command',
      'closed',
      ['enhancement'],
      'tomas',
      14,
      'Added `--json` in the previous release.',
      [],
    ],
    [
      187,
      'Deprecation warning is noisy in CI',
      'closed',
      ['bug'],
      'yuki',
      21,
      'Warnings now print once per run.',
      [],
    ],
  ]
  for (const [n, title, state, labels, author, ago, body, said] of list) {
    const at = days(ago)
    d.seedIssue(repo, {
      id: seededId('issue', at, `${repo.owner}/${r}#${n}`),
      number: n,
      title,
      body,
      state,
      author: d.actors.get(author)!,
      labels,
      assignees:
        n === 207 && repo.name === 'lumen' ? [d.actors.get('dana')!] : [],
      // An hour apart, after the issue was opened.
      comments: said.map(([who, text], k) =>
        comment(
          `${repo.owner}/${r}#${n}/${k}`,
          d.actors.get(who)!,
          at + (k + 1) * HOUR,
          text,
        ),
      ),
      created: at,
      updated: at + said.length * HOUR,
      closed: state === 'closed' ? at : null,
      version: 1,
    })
  }
}

/**
 * A repository with a stack of three changes that are ready to land: each has
 * an approval from a maintainer and passing CI on its own tree.
 */
export const STACK_ID = 'stk_stacky000000000000'
export function seedStack(d: MemoryDomain) {
  const repo = d.seedRepo('dana', 'stacky', {
    description: 'A stack that is ready to land.',
    maintainers: ['dana', 'hollis'],
    collaborators: ['hollis'],
    maintainerGrants: ['hollis'],
    created: days(2),
  })
  const dana = d.actors.get('dana')!
  const hollis = d.actors.get('hollis')!
  for (const n of [1, 2, 3]) {
    const tree = String(n).repeat(7)
    d.seedChange(repo, {
      id: `chg_stacky${n}`.padEnd(22, '0'),
      number: n,
      title: `Step ${n} of the migration`,
      description: '',
      state: 'open',
      author: dana,
      base: 'main',
      branch: `step-${n}`,
      patchSets: [
        {
          n: 1,
          sha: tree.padEnd(40, '0'),
          tree,
          note: 'Initial version',
          author: dana,
          created: hours(48 - n),
          kind: 'initial',
          files: { [`src/step${n}.rs`]: { hash: 'h', add: 12, del: 1 } },
        },
      ],
      reviews: [
        {
          id: `rev_stacky${n}`.padEnd(22, '0'),
          actor: hollis,
          state: 'approved',
          patchSet: 1,
          carries: true,
          body: '',
          created: hours(40 - n),
        },
      ],
      findings: [],
      checks: [
        {
          id: `chk_stacky${n}`.padEnd(22, '0'),
          key: 'ci/test',
          name: 'ci/test',
          state: 'pass',
          tree,
          detailsUrl: null,
          created: hours(30 - n),
          updated: hours(30 - n),
        },
      ],
      stackId: STACK_ID,
      labels: [],
      mirrors: [],
      created: hours(48 - n),
      updated: hours(30 - n),
      landed: null,
      version: 1,
    })
  }
}

/** Many changes and issues, for list and paging tests and the benchmark. */
export function seedBulk(
  d: MemoryDomain,
  owner: string,
  name: string,
  changes: number,
  issues: number,
) {
  const repo = d.seedRepo(owner, name, {
    description: 'Bulk',
    collaborators: ['dana'],
    created: days(1),
  })
  const dana = d.actors.get('dana')!
  const bots = ['dep-bot', 'claude-t3', 'ines'].map((h) => d.actors.get(h)!)
  for (let i = 0; i < changes; i++) {
    const n = repo.nextNumber++
    const at = days(30) + i * 1000
    const author = i % 4 === 0 ? bots[i % 3] : dana
    const tree = (0x1000000 + i).toString(16)
    d.seedChange(repo, {
      id: seededId('change', at, `bulk-${name}-${i}`),
      number: n,
      title: `Change ${i}`,
      description: '',
      state: i % 10 === 0 ? 'landed' : 'open',
      author,
      base: 'main',
      branch: `b${i}`,
      patchSets: [
        {
          n: 1,
          sha: tree.padEnd(40, '0'),
          tree,
          note: 'Initial version',
          author,
          created: at,
          kind: 'initial',
          files: { [`src/f${i}.rs`]: { hash: 'x', add: 5, del: 1 } },
        },
      ],
      reviews: [],
      findings: [],
      checks: [
        {
          id: seededId('check', at, `c${i}`),
          key: 'ci/test',
          name: 'ci/test',
          state: i % 7 === 0 ? 'fail' : 'pass',
          tree,
          detailsUrl: null,
          created: at,
          updated: at,
        },
      ],
      stackId: null,
      labels: i % 3 === 0 ? ['perf'] : [],
      mirrors: [],
      created: at,
      updated: at,
      landed: null,
      version: 1,
    })
  }
  for (let i = 0; i < issues; i++) {
    const n = repo.nextNumber++
    const at = days(30) + i * 1000
    d.seedIssue(repo, {
      id: seededId('issue', at, `bulk-i-${name}-${i}`),
      number: n,
      title: `Issue ${i}`,
      body: '',
      state: i % 5 === 0 ? 'closed' : 'open',
      author: dana,
      labels: i % 2 ? ['bug'] : [],
      created: at,
      updated: at,
      closed: null,
      version: 1,
    })
  }
  return repo
}

void newId
