import { newId, seededId } from './ids'
import { AuthStore } from './auth'
import type { CreateToken, Scope  } from './auth'
import type {
  ChangeRec,
  FindingRec,
  IssueRec,
  MemoryDomain,
  PatchSetRec,
  ReviewRec,
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
  'repo:read', 'repo:write', 'issues:read', 'issues:comment', 'issues:write',
  'pulls:read', 'pulls:comment', 'pulls:write', 'pulls:merge', 'secrets:schema',
  'secrets:write', 'secrets:decrypt', 'webhooks:read', 'webhooks:write', 'tokens:manage',
]

export function sampleTokenStore(now = T0, store = new AuthStore(() => now)): AuthStore {
  const year = 365 * 86_400_000
  const add = (secret: string, tag: string, input: Partial<CreateToken> & Pick<CreateToken, 'handle' | 'class' | 'scopes'>) =>
    store.add(secret, {
      name: tag,
      kind: input.class === 'human' ? 'personal' : 'bot',
      ttlMs: year,
      id: seededId('token', T0, tag),
      ...input,
    })
  add(sampleTokens.dana, 'dana', { handle: 'dana', class: 'human', scopes: all })
  add(sampleTokens.hollis, 'hollis', { handle: 'hollis', class: 'human', scopes: ['repo:read', 'pulls:read', 'pulls:comment', 'pulls:write', 'pulls:merge', 'issues:read', 'issues:comment', 'secrets:schema', 'webhooks:read'] })
  add(sampleTokens.fixAgent, 'fix-agent', { handle: 'fix-agent', class: 'agent', scopes: ['repo:read', 'repo:write', 'pulls:read', 'pulls:write', 'pulls:comment', 'secrets:schema', 'secrets:decrypt'], repos: ['dana/gitfs'] })
  add(sampleTokens.triage, 'triage-bot', { handle: 'triage-bot', class: 'bot', scopes: ['repo:read', 'issues:read', 'issues:comment', 'issues:write'], repos: ['dana/gitfs'] })
  add(sampleTokens.limited, 'limited', { handle: 'dana', class: 'human', scopes: all, repos: ['dana/tinyqueue'] })
  const expired = add(sampleTokens.expired, 'expired', { handle: 'dana', class: 'human', scopes: all })
  expired.expiresAt = now - 1000
  add(sampleTokens.stranger, 'stranger', { handle: 'stranger', class: 'human', scopes: all })
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

export function seedSample(d: MemoryDomain) {
  for (const [h, c] of [
    ['dana', 'human'], ['hollis', 'human'], ['ines', 'human'], ['tomas', 'human'],
    ['mira', 'human'], ['stranger', 'human'], ['claude-t3', 'agent'], ['fix-agent', 'agent'],
    ['triage-bot', 'bot'], ['dep-bot', 'bot'], ['greptile', 'bot'], ['coderabbit', 'bot'],
  ] as const)
    d.seedActor(h, c, days(60))
  d.seedAccount('dana', 'Dana Okafor', 'person', [], days(60))
  d.seedAccount('hollis', 'Hollis Reyes', 'person', [], days(60))
  d.seedAccount('stranger', 'Sam Stranger', 'person', [], days(30))
  d.seedAccount('northwind', 'Northwind Labs', 'organization', [['dana', 'owner'], ['hollis', 'member']], days(50))
  // dana can work in lumen-studio but is only a member there.
  d.seedAccount('lumen-studio', 'Lumen Studio', 'organization', [['dana', 'member']], days(45))

  const gitfs = d.seedRepo('dana', 'gitfs', {
    storeId: 'gitfs',
    description: 'Git over object storage.', stars: 2140, created: days(40),
    collaborators: ['hollis', 'ines'], installs: ['triage-bot', 'fix-agent'], maintainers: ['dana', 'hollis'],
    env: [
      { name: 'DATABASE_URL', kind: 'url', set: ['development', 'production'] },
      { name: 'STRIPE_KEY', kind: 'string', set: ['production'] },
      { name: 'API_PORT', kind: 'port', set: ['development', 'production'] },
    ],
  })
  d.seedRepo('dana', 'tinyqueue', { storeId: 'tinyqueue', description: 'Zero-dependency job queue.', stars: 640, created: days(30) })
  d.seedRepo('dana', 'notes', { description: 'Private notes.', visibility: 'private', created: days(20) })
  d.seedRepo('northwind', 'relay', { description: 'A small message relay with at-least-once delivery.', stars: 310, created: days(25), collaborators: ['hollis'], maintainers: ['dana', 'hollis'] })
  d.seedAlias('dana/git-fs', 'dana/gitfs')

  const a = (name: string) => d.actors.get(name)!
  const review = (who: string, state: ReviewRec['state'], patchSet: number, carries: boolean, at: number): ReviewRec => ({
    id: seededId('review', at, `${who}${patchSet}${state}`), actor: a(who), state, patchSet, carries, body: '', created: at,
  })
  const finding = (n: number, by: string, sev: FindingRec['severity'], file: string, line: number, title: string, state: FindingRec['state'] = 'open'): FindingRec => ({
    id: seededId('finding', hours(20), `F-${n}`), label: `F-${n}`, by, severity: sev, state, reason: null, file, line, title, body: `${title}.`, patchSet: 3, created: hours(20),
  })

  const base = (n: number, title: string, author: string, state: ChangeRec['state'], branch: string): ChangeRec => ({
    id: seededId('change', days(5), `gitfs-${n}`), number: n, title, description: '', state,
    author: a(author), base: 'main', branch, patchSets: [], reviews: [], findings: [], checks: [],
    stackId: null, labels: [], mirrors: [], created: days(5), updated: hours(24), landed: null, version: 1,
  })

  // The stack: #216 below #217 below #218.
  const stk = seededId('stack', days(3), 'gitfs-neg-cache')
  const c216 = base(216, 'Cache negative ref lookups', 'dana', 'open', 'neg-cache')
  c216.stackId = stk
  c216.created = days(3)
  c216.updated = hours(24)
  c216.labels = ['perf']
  c216.mirrors = [{ host: 'github', number: 231, origin: 'here' }]
  c216.patchSets = [
    ps(d, 1, days(3), '41ac9e2', 'Initial version', 'dana', { 'src/refs.rs': { hash: 'a1', add: 20, del: 2 }, 'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 } }),
    ps(d, 2, days(2), '5d02b8f', 'Address review: rename hit() to contains()', 'dana', { 'src/refs.rs': { hash: 'a2', add: 20, del: 2 }, 'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 } }),
    ps(d, 3, hours(24), '9c4d7e1', 'Rebased onto main and renamed remember() to put()', 'dana', { 'src/refs.rs': { hash: 'a3', add: 20, del: 2 }, 'tests/refs_test.rs': { hash: 'b1', add: 3, del: 0 } }, 'rebase'),
  ]
  c216.reviews = [
    review('hollis', 'approved', 2, true, hours(40)),
    review('greptile', 'changes', 3, true, hours(20)),
    review('coderabbit', 'commented', 3, true, hours(19)),
  ]
  c216.findings = [
    finding(2, 'greptile', 'high', 'src/refs.rs', 41, 'The negative cache has no bound and can grow without limit'),
    finding(3, 'coderabbit', 'medium', 'src/refs.rs', 12, 'Rename contains() consistently in the docs'),
    finding(4, 'macroscope', 'low', 'tests/refs_test.rs', 9, 'Name the test after the behaviour'),
  ]
  c216.checks = [{ id: seededId('check', hours(20), '216ci'), key: 'ci/test', name: 'ci/test', state: 'pending', tree: '9c4d7e1', detailsUrl: null, created: hours(20), updated: hours(20) }]

  const c217 = base(217, 'Bound the negative cache and evict LRU', 'claude-t3', 'draft', 'neg-cache-bound')
  c217.stackId = stk
  c217.created = hours(2); c217.updated = hours(2)
  c217.mirrors = [{ host: 'github', number: 232, origin: 'here' }]
  c217.patchSets = [ps(d, 1, hours(2), 'a71e0c3', 'Opened from finding F-2', 'claude-t3', { 'src/cache.rs': { hash: 'c1', add: 41, del: 3 } })]
  c217.reviews = [review('dana', 'commented', 1, true, hours(1))]
  c217.checks = [{ id: seededId('check', hours(1), '217ci'), key: 'ci/test', name: 'ci/test', state: 'pass', tree: 'a71e0c3', detailsUrl: null, created: hours(1), updated: hours(1) }]

  const c218 = base(218, 'Show cache stats in `gitfs doctor`', 'dana', 'draft', 'doctor-stats')
  c218.stackId = stk
  c218.created = hours(1); c218.updated = hours(1)
  c218.mirrors = [{ host: 'github', number: 233, origin: 'here' }]
  c218.patchSets = [ps(d, 1, hours(1), 'c19b4d7', 'Initial version', 'dana', { 'src/doctor.rs': { hash: 'd1', add: 58, del: 4 } })]

  const c212 = base(212, 'Normalize Windows path separators', 'ines', 'open', 'win-paths')
  c212.created = days(5); c212.updated = days(4)
  c212.mirrors = [{ host: 'github', number: 226, origin: 'there' }]
  c212.patchSets = [
    ps(d, 1, days(5), 'e2250ab', 'Initial version', 'ines', { 'src/path.rs': { hash: 'e1', add: 70, del: 12 } }),
    ps(d, 2, days(4), 'f31c8de', 'Add regression test', 'ines', { 'src/path.rs': { hash: 'e1', add: 70, del: 12 }, 'tests/path_test.rs': { hash: 'f1', add: 7, del: 0 } }),
  ]
  c212.reviews = [review('hollis', 'changes', 2, true, days(4))]
  c212.checks = [{ id: seededId('check', days(4), '212ci'), key: 'ci/test', name: 'ci/test', state: 'fail', tree: 'f31c8de', detailsUrl: null, created: days(4), updated: days(4) }]

  const c215 = base(215, 'Bump object-store client to 2.4', 'dep-bot', 'open', 'deps/object-store')
  c215.created = days(6); c215.updated = days(6)
  c215.patchSets = [ps(d, 1, days(6), '77b3f10', 'Automated update', 'dep-bot', { 'Cargo.toml': { hash: 'g1', add: 9, del: 9 } })]
  c215.reviews = [review('coderabbit', 'approved', 1, true, days(6))]
  c215.checks = [{ id: seededId('check', days(6), '215ci'), key: 'ci/test', name: 'ci/test', state: 'pass', tree: '77b3f10', detailsUrl: null, created: days(6), updated: days(6) }]

  const c210 = base(210, 'Document the mount flags', 'tomas', 'landed', 'docs/mount')
  c210.created = days(15); c210.updated = days(14); c210.landed = days(14)
  c210.patchSets = [ps(d, 1, days(15), '0f9d4a6', 'Initial version', 'tomas', { 'docs/mount.md': { hash: 'h1', add: 34, del: 2 } })]
  c210.reviews = [review('dana', 'approved', 1, true, days(14))]

  for (const c of [c210, c212, c215, c216, c217, c218]) d.seedChange(gitfs, c)

  const issue = (n: number, title: string, state: IssueRec['state'], author: string, labels: Array<string>): IssueRec => ({
    id: seededId('issue', days(10), `gitfs-i${n}`), number: n, title, body: '', state, author: a(author), labels,
    created: days(10), updated: days(9), closed: state === 'closed' ? days(9) : null, version: 1,
  })
  d.seedIssue(gitfs, issue(4, 'Panic on trailing-dot ref names', 'open', 'mira', ['bug']))
  d.seedIssue(gitfs, issue(7, 'Support read-only mounts', 'closed', 'hollis', ['feature']))
  d.seedIssue(gitfs, issue(209, 'Document the cache flags', 'open', 'tomas', ['docs']))
  gitfs.nextNumber = 219
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
export function seedBulk(d: MemoryDomain, owner: string, name: string, changes: number, issues: number) {
  const repo = d.seedRepo(owner, name, { description: 'Bulk', collaborators: ['dana'], created: days(1) })
  const dana = d.actors.get('dana')!
  const bots = ['dep-bot', 'claude-t3', 'ines'].map((h) => d.actors.get(h)!)
  for (let i = 0; i < changes; i++) {
    const n = repo.nextNumber++
    const at = days(30) + i * 1000
    const author = i % 4 === 0 ? bots[i % 3] : dana
    const tree = (0x1000000 + i).toString(16)
    d.seedChange(repo, {
      id: seededId('change', at, `bulk-${name}-${i}`), number: n, title: `Change ${i}`, description: '',
      state: i % 10 === 0 ? 'landed' : 'open', author, base: 'main', branch: `b${i}`,
      patchSets: [{ n: 1, sha: tree.padEnd(40, '0'), tree, note: 'Initial version', author, created: at, kind: 'initial', files: { [`src/f${i}.rs`]: { hash: 'x', add: 5, del: 1 } } }],
      reviews: [], findings: [], checks: [{ id: seededId('check', at, `c${i}`), key: 'ci/test', name: 'ci/test', state: i % 7 === 0 ? 'fail' : 'pass', tree, detailsUrl: null, created: at, updated: at }],
      stackId: null, labels: i % 3 === 0 ? ['perf'] : [], mirrors: [], created: at, updated: at, landed: null, version: 1,
    })
  }
  for (let i = 0; i < issues; i++) {
    const n = repo.nextNumber++
    const at = days(30) + i * 1000
    d.seedIssue(repo, {
      id: seededId('issue', at, `bulk-i-${name}-${i}`), number: n, title: `Issue ${i}`, body: '', state: i % 5 === 0 ? 'closed' : 'open',
      author: dana, labels: i % 2 ? ['bug'] : [], created: at, updated: at, closed: null, version: 1,
    })
  }
  return repo
}

void newId
