import { fail } from './errors'
import { canWrite } from './access'
import { counters } from './events'
import { iso, presentRepo, repoRef, repoUrl, urls } from './present'
import { knownActor } from './issues'
import type { Actor } from './actor'
import type {
  ActorRec,
  Assume,
  ChangeRec,
  CheckRec,
  CustomRuleRec,
  EvidenceRec,
  FindingRec,
  PatchSetRec,
  PolicyExceptionRec,
  Requirement,
  ReviewCommentRec,
  ReviewRec,
  RuleMode,
} from './changeTypes'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Changes as one aggregate each: loading one with its parts, writing back
 * what changed, and everything worked out from one change: policy, checks,
 * reviewers, what the caller may do with it, and how the API shows it.
 */

/** Over this many lines added and removed, a change is large. */
export const BIG_CHANGE = 400

/** The rules a repository's policy is made of, and what each starts as. */
export const policyRules: ReadonlyArray<{
  id: string
  name: string
  mode: RuleMode
  when: string
  requires: Array<string>
}> = [
  {
    id: 'core-paths',
    name: 'Core paths need a maintainer',
    mode: 'enforce',
    when: 'paths src/**',
    requires: ['1 approval, human, a maintainer'],
  },
  {
    id: 'agent-authored',
    name: 'Agent-authored changes need a human',
    mode: 'enforce',
    when: 'author class is agent or bot',
    requires: ['1 approval, human', 'approver is not the author'],
  },
  {
    id: 'ci-evidence',
    name: 'Tests pass on the tree that will land',
    mode: 'enforce',
    when: 'any change',
    requires: ['ci/test passed, bound to the landing tree'],
  },
  {
    id: 'findings',
    name: 'No open high-severity findings',
    mode: 'enforce',
    when: 'any change',
    requires: ['every high finding resolved or dismissed with a reason'],
  },
  {
    id: 'big-change',
    name: 'Large changes need two reviewers',
    mode: 'dry-run',
    when: `additions + deletions > ${BIG_CHANGE}`,
    requires: ['2 approvals, at least 1 human'],
  },
]

/** A path glob as a pattern: `**` crosses folders, `*` does not. */
export function globToRegExp(glob: string) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += glob[i + 2] === '/' ? 2 : 1
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

// ---- the repository as change logic needs it ---------------------------------

export type RepoPolicy = {
  ruleModes: Map<string, RuleMode>
  customRules: Array<CustomRuleRec>
  exceptions: Array<PolicyExceptionRec>
  rev: number
  doc: Doc<'repoPolicy'> | null
}

export async function loadPolicy(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
): Promise<RepoPolicy> {
  const doc = await ctx.db
    .query('repoPolicy')
    .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
    .unique()
  const c = await counters(ctx, repo)
  return {
    ruleModes: new Map(
      (doc?.ruleModes ?? []).map((m) => [m.id, m.mode as RuleMode]),
    ),
    customRules: doc
      ? (JSON.parse(doc.customRules) as Array<CustomRuleRec>)
      : [],
    exceptions: doc
      ? (JSON.parse(doc.exceptions) as Array<PolicyExceptionRec>)
      : [],
    rev: c.policyRev,
    doc,
  }
}

export async function savePolicy(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  p: RepoPolicy,
) {
  const fields = {
    ruleModes: [...p.ruleModes].map(([id, mode]) => ({ id, mode })),
    customRules: JSON.stringify(p.customRules),
    exceptions: JSON.stringify(p.exceptions),
  }
  if (p.doc) await ctx.db.patch('repoPolicy', p.doc._id, fields)
  else await ctx.db.insert('repoPolicy', { repoId: repo._id, ...fields })
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, { policyRev: c.policyRev + 1 })
}

// ---- loading and saving one change ---------------------------------------------

type PartKind = Doc<'changeParts'>['kind']
const KINDS: Array<PartKind> = [
  'patchSet',
  'review',
  'finding',
  'check',
  'comment',
  'evidence',
]

export type Loaded = {
  doc: Doc<'changes'>
  rec: ChangeRec
  parts: Map<string, Doc<'changeParts'>>
}

const partKey = (kind: PartKind, key: string) => `${kind}:${key}`

export async function hydrate(
  ctx: QueryCtx,
  doc: Doc<'changes'>,
): Promise<Loaded> {
  const parts = new Map<string, Doc<'changeParts'>>()
  const lists: Record<PartKind, Array<unknown>> = {
    patchSet: [],
    review: [],
    finding: [],
    check: [],
    comment: [],
    evidence: [],
  }
  for (const kind of KINDS)
    for (const p of await ctx.db
      .query('changeParts')
      .withIndex('by_changeId_and_kind_and_seq', (q) =>
        q.eq('changeId', doc._id).eq('kind', kind),
      )
      .take(5000)) {
      parts.set(partKey(kind, p.key), p)
      lists[kind].push(JSON.parse(p.json))
    }
  const rec: ChangeRec = {
    id: doc.publicId,
    number: doc.number,
    title: doc.title,
    description: doc.description,
    state: doc.state,
    author: doc.author,
    base: doc.base,
    branch: doc.branch,
    patchSets: lists.patchSet as Array<PatchSetRec>,
    reviews: lists.review as Array<ReviewRec>,
    findings: lists.finding as Array<FindingRec>,
    checks: lists.check as Array<CheckRec>,
    stackId: doc.stackId,
    labels: doc.labels,
    mirrors: doc.mirrors,
    evidence: lists.evidence as Array<EvidenceRec>,
    comments: lists.comment as Array<ReviewCommentRec>,
    commentRev: doc.commentRev,
    ...(doc.baseFiles ? { baseFiles: JSON.parse(doc.baseFiles) } : {}),
    created: doc.created,
    updated: doc.updated,
    landed: doc.landed,
    version: doc.version,
  }
  return { doc, rec, parts }
}

/** The change `ref` (a number or a `chg_` id) in a repository. */
export async function loadChange(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  ref: string,
): Promise<Loaded> {
  const doc = await findChange(ctx, repo, ref)
  if (!doc) fail('not_found', `No change ${ref} in ${repo.owner}/${repo.name}.`)
  return await hydrate(ctx, doc)
}

export async function findChange(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  ref: string,
) {
  if (/^\d+$/.test(ref))
    return await ctx.db
      .query('changes')
      .withIndex('by_repoId_and_number', (q) =>
        q.eq('repoId', repo._id).eq('number', Number(ref)),
      )
      .unique()
  if (ref.startsWith('chg_')) {
    const c = await ctx.db
      .query('changes')
      .withIndex('by_publicId', (q) => q.eq('publicId', ref))
      .unique()
    return c && c.repoId === repo._id ? c : null
  }
  return null
}

function partsOf(
  rec: ChangeRec,
): Array<{ kind: PartKind; key: string; value: unknown }> {
  return [
    ...rec.patchSets.map((x) => ({
      kind: 'patchSet' as const,
      key: String(x.n),
      value: x,
    })),
    ...rec.reviews.map((x) => ({
      kind: 'review' as const,
      key: x.id,
      value: x,
    })),
    ...rec.findings.map((x) => ({
      kind: 'finding' as const,
      key: x.id,
      value: x,
    })),
    ...rec.checks.map((x) => ({ kind: 'check' as const, key: x.id, value: x })),
    ...(rec.comments ?? []).map((x) => ({
      kind: 'comment' as const,
      key: x.id,
      value: x,
    })),
    ...(rec.evidence ?? []).map((x) => ({
      kind: 'evidence' as const,
      key: x.id,
      value: x,
    })),
  ]
}

function changeFields(rec: ChangeRec) {
  return {
    publicId: rec.id,
    number: rec.number,
    title: rec.title,
    description: rec.description,
    text: `${rec.title}\n${rec.description}`,
    state: rec.state,
    author: rec.author,
    base: rec.base,
    branch: rec.branch,
    stackId: rec.stackId,
    labels: rec.labels,
    mirrors: rec.mirrors,
    ...(rec.baseFiles ? { baseFiles: JSON.stringify(rec.baseFiles) } : {}),
    commentRev: rec.commentRev ?? 0,
    headSha: rec.patchSets[rec.patchSets.length - 1]?.sha ?? '',
    created: rec.created,
    updated: rec.updated,
    landed: rec.landed,
    version: rec.version,
  }
}

/** Writes a change and only the parts of it that changed. */
export async function saveChange(ctx: MutationCtx, l: Loaded) {
  await ctx.db.patch('changes', l.doc._id, changeFields(l.rec))
  await saveParts(ctx, l.doc._id, l.rec, l.parts)
}

async function saveParts(
  ctx: MutationCtx,
  changeId: Id<'changes'>,
  rec: ChangeRec,
  parts: Map<string, Doc<'changeParts'>>,
) {
  const seen = new Set<string>()
  const seqs = new Map<PartKind, number>()
  for (const p of parts.values())
    seqs.set(p.kind, Math.max(seqs.get(p.kind) ?? 0, p.seq))
  for (const { kind, key, value } of partsOf(rec)) {
    const k = partKey(kind, key)
    seen.add(k)
    const json = JSON.stringify(value)
    const had = parts.get(k)
    if (had) {
      if (had.json !== json)
        await ctx.db.patch('changeParts', had._id, { json })
      continue
    }
    const seq = kind === 'patchSet' ? Number(key) : (seqs.get(kind) ?? 0) + 1
    seqs.set(kind, Math.max(seqs.get(kind) ?? 0, seq))
    await ctx.db.insert('changeParts', { changeId, kind, key, seq, json })
  }
  for (const [k, p] of parts)
    if (!seen.has(k)) await ctx.db.delete('changeParts', p._id)
}

/** A new change, with its parts. */
export async function insertChange(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  rec: ChangeRec,
) {
  const id = await ctx.db.insert('changes', {
    repoId: repo._id,
    ...changeFields(rec),
  })
  await saveParts(ctx, id, rec, new Map())
  return id
}

/** The open or draft change that owns a branch, if one does. */
export async function branchOwner(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  branch: string,
): Promise<Doc<'changes'> | null> {
  const all = await ctx.db
    .query('changes')
    .withIndex('by_repoId_and_branch', (q) =>
      q.eq('repoId', repo._id).eq('branch', branch),
    )
    .take(500)
  // The oldest open one owns it, as the first to claim the branch did.
  return (
    all
      .filter((c) => c.state === 'open' || c.state === 'draft')
      .sort((a, b) => a.number - b.number)
      .at(0) ?? null
  )
}

/** A stack's members, by number. */
export async function stackMembers(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  stackId: string,
) {
  const all = await ctx.db
    .query('changes')
    .withIndex('by_repoId_and_stackId', (q) =>
      q.eq('repoId', repo._id).eq('stackId', stackId),
    )
    .take(500)
  return all.sort((a, b) => a.number - b.number)
}

// ---- what is worked out from a change ------------------------------------------

/**
 * Everything a change's answer depends on besides the change: the
 * repository, its policy, its stack, who owns its branch and what the
 * viewer may do. Loaded once, before any of it is shown.
 */
export class ChangeView {
  constructor(
    readonly repo: Doc<'repos'>,
    readonly policy: RepoPolicy,
    readonly now: number,
    /** Stack members by number, for the change's stack. */
    readonly stack: Map<number, Doc<'changes'>>,
    readonly stacks: Map<string, Array<number>>,
    readonly branchOwnerOf: (branch: string) => Doc<'changes'> | null,
    readonly viewerCanWrite: boolean,
    readonly actorClass: (handle: string) => ActorRec['class'] | undefined,
    readonly repoShown: unknown,
  ) {}

  actor(a: ActorRec) {
    return {
      object: 'actor' as const,
      id: a.id,
      handle: a.handle,
      class: a.class,
    }
  }

  head(c: ChangeRec) {
    return c.patchSets[c.patchSets.length - 1]
  }

  checksFor(c: ChangeRec) {
    const tree = this.head(c).tree
    const own = c.checks.filter((k) => k.tree === tree)
    const passed = own.filter((k) => k.state === 'pass').length
    const failed = own.filter((k) => k.state === 'fail').length
    const pending = own.filter((k) => k.state === 'pending').length
    return {
      state:
        own.length === 0
          ? 'none'
          : failed
            ? 'fail'
            : pending
              ? 'pending'
              : 'pass',
      passed,
      failed,
      pending,
    }
  }

  /** The newest review from each reviewer. */
  latestReviews(c: ChangeRec) {
    const map = new Map<string, ReviewRec>()
    for (const r of c.reviews) map.set(r.actor.id, r)
    return [...map.values()]
  }

  modeOf(id: string): RuleMode {
    return (
      this.policy.ruleModes.get(id) ??
      policyRules.find((r) => r.id === id)?.mode ??
      'enforce'
    )
  }

  exceptionFor(rule: string, who: string) {
    return this.policy.exceptions.find(
      (e) => e.rule === rule && e.who === who && e.expires > this.now,
    )
  }

  evaluate(c: ChangeRec, assume: Assume = {}): Array<Requirement> {
    const out: Array<Requirement> = []
    for (const r of this.evaluateRules(c, assume)) {
      const mode = this.modeOf(r.id)
      if (mode === 'off') continue
      if (mode === 'dry-run' && (r.state === 'fail' || r.state === 'pending'))
        out.push({
          ...r,
          state: 'na',
          detail: `Dry run, would block: ${r.detail}`,
          needs: null,
          blocking: [],
        })
      else out.push(r)
    }
    return out
  }

  evaluateRules(c: ChangeRec, assume: Assume): Array<Requirement> {
    const head = this.head(c)
    const out: Array<Requirement> = []
    const reviews = this.latestReviews(c)
    const maintainers = new Set(this.repo.maintainers)
    const humanApprovals = new Set<string>()
    for (const r of reviews)
      if (
        r.state === 'approved' &&
        r.carries &&
        r.actor.class === 'human' &&
        r.actor.handle !== c.author.handle
      )
        humanApprovals.add(r.actor.handle)
    for (const h of assume.approve ?? [])
      if (this.actorClass(h) === 'human' && h !== c.author.handle)
        humanApprovals.add(h)
    const humanObjections = reviews.filter(
      (r) => r.state === 'changes' && r.actor.class === 'human',
    )
    const maintainerApprovals = [...humanApprovals].filter(
      (h) => maintainers.has(h) || !!this.exceptionFor('core-paths', h),
    )
    out.push({
      id: 'core-paths',
      rule: 'Core paths need a maintainer',
      state: humanObjections.length
        ? 'fail'
        : maintainerApprovals.length
          ? 'pass'
          : 'pending',
      detail: humanObjections.length
        ? `${humanObjections.map((r) => r.actor.handle).join(', ')} asked for changes.`
        : maintainerApprovals.length
          ? `${maintainerApprovals.join(', ')} approved, and the approval holds for patch set ${head.n}.`
          : 'src/** needs 1 human approval from a maintainer.',
      needs: { approval: { min: 1, class: 'human', from: 'maintainers' } },
      blocking: humanObjections.map((r) => r.id),
    })
    if (c.author.class === 'human')
      out.push({
        id: 'agent-authored',
        rule: 'Agent-authored changes need a human',
        state: 'na',
        detail: 'The author is a person.',
        needs: null,
        blocking: [],
      })
    else
      out.push({
        id: 'agent-authored',
        rule: 'Agent-authored changes need a human',
        state: humanApprovals.size ? 'pass' : 'pending',
        detail: humanApprovals.size
          ? `${[...humanApprovals].join(', ')} approved.`
          : `${c.author.handle} is ${c.author.class === 'agent' ? 'an agent' : 'a bot'}; a person has to approve.`,
        needs: { approval: { min: 1, class: 'human' }, not_author: true },
        blocking: [],
      })
    const runs = c.checks.filter(
      (k) => k.name === 'ci/test' && k.tree === head.tree,
    )
    const run = runs.sort((a, b) => b.updated - a.updated)[0] as
      | CheckRec
      | undefined
    const ciState = assume.checks?.['ci/test'] ?? run?.state ?? 'pending'
    out.push({
      id: 'ci-evidence',
      rule: 'Tests pass on the tree that will land',
      state: ciState,
      detail:
        ciState === 'pass'
          ? `ci/test passed on tree ${head.tree}, the tree that lands.`
          : ciState === 'fail'
            ? `ci/test failed on tree ${head.tree}.`
            : run
              ? `ci/test is running on tree ${head.tree}.`
              : `No ci/test result for tree ${head.tree} yet.`,
      needs: { check: 'ci/test', bound_to: 'tree', tree: head.tree },
      blocking: ciState === 'fail' && run ? [run.id] : [],
    })
    const lines = Object.values(head.files).reduce(
      (n, f) => n + f.add + f.del,
      0,
    )
    const approvals = new Set(
      reviews
        .filter((r) => r.state === 'approved' && r.carries)
        .map((r) => r.actor.handle),
    )
    for (const h of assume.approve ?? []) approvals.add(h)
    const big = lines > BIG_CHANGE
    out.push({
      id: 'big-change',
      rule: 'Large changes need two reviewers',
      state: !big
        ? 'na'
        : approvals.size >= 2 && humanApprovals.size >= 1
          ? 'pass'
          : 'pending',
      detail: !big
        ? `${lines} lines changed.`
        : `${lines} lines changed, needs 2 approvals with at least 1 person, has ${approvals.size}.`,
      needs: big ? { approval: { min: 2, human_min: 1 } } : null,
      blocking: [],
    })
    const open = c.findings.filter(
      (f) =>
        f.severity === 'high' &&
        f.state === 'open' &&
        !(assume.resolve ?? []).includes(f.label),
    )
    out.push({
      id: 'findings',
      rule: 'No open high-severity findings',
      state: open.length ? 'fail' : 'pass',
      detail: open.length
        ? `${open.length} open: ${open.map((f) => `${f.label} from ${f.by}`).join(', ')}.`
        : 'No open high-severity findings.',
      needs: open.length ? { resolve: open.map((f) => f.label) } : null,
      blocking: open.map((f) => f.id),
    })
    for (const r of this.policy.customRules)
      out.push(this.evaluateCustomRule(r, c, assume, humanApprovals, lines))
    return out.map((r) => {
      if (r.id === 'core-paths' || r.state === 'pass' || r.state === 'na')
        return r
      const e = this.exceptionFor(r.id, c.author.handle)
      return e
        ? {
            ...r,
            state: 'pass' as const,
            detail: `Exception for ${e.who} until ${new Date(e.expires).toISOString().slice(0, 10)}: ${e.reason}`,
            needs: null,
            blocking: [],
          }
        : r
    })
  }

  evaluateCustomRule(
    r: CustomRuleRec,
    c: ChangeRec,
    assume: Assume,
    humanApprovals: Set<string>,
    lines: number,
  ): Requirement {
    const head = this.head(c)
    const base = { id: r.id, rule: r.name }
    if (r.kind === 'required_check') {
      const key = r.check!
      const run = c.checks
        .filter(
          (k) => (k.key === key || k.name === key) && k.tree === head.tree,
        )
        .sort((a, b) => b.updated - a.updated)[0] as CheckRec | undefined
      const state = assume.checks?.[key] ?? run?.state ?? 'pending'
      return {
        ...base,
        state,
        detail:
          state === 'pass'
            ? `${key} passed on tree ${head.tree}.`
            : state === 'fail'
              ? `${key} failed on tree ${head.tree}.`
              : `No ${key} result for tree ${head.tree} yet.`,
        needs: { check: key, bound_to: 'tree', tree: head.tree },
        blocking: state === 'fail' && run ? [run.id] : [],
      }
    }
    if (r.kind === 'max_lines') {
      const over = lines > r.maxLines!
      return {
        ...base,
        state: over ? 'fail' : 'pass',
        detail: over
          ? `${lines} lines changed, over the ${r.maxLines} this repository allows. Split it into a stack.`
          : `${lines} lines changed, within ${r.maxLines}.`,
        needs: over ? { max_lines: r.maxLines } : null,
        blocking: [],
      }
    }
    const globs = (r.paths ?? []).map(globToRegExp)
    const touched = Object.keys(head.files).filter((f) =>
      globs.some((g) => g.test(f)),
    )
    if (!touched.length)
      return {
        ...base,
        state: 'na',
        detail: `Touches nothing in ${(r.paths ?? []).join(', ')}.`,
        needs: null,
        blocking: [],
      }
    const need = r.approvals ?? 1
    const from = r.from?.length ? new Set(r.from) : null
    const got = [...humanApprovals].filter((h) => !from || from.has(h))
    return {
      ...base,
      state: got.length >= need ? 'pass' : 'pending',
      detail:
        got.length >= need
          ? `${got.join(', ')} approved ${touched.length} file${touched.length === 1 ? '' : 's'} in ${(r.paths ?? []).join(', ')}.`
          : `${touched[0]}${touched.length > 1 ? ` and ${touched.length - 1} more` : ''} need ${need} human approval${need === 1 ? '' : 's'}${from ? ` from ${[...from].join(', ')}` : ''}, ${got.length} so far.`,
      needs: {
        approval: {
          min: need,
          class: 'human',
          ...(from ? { from: [...from] } : {}),
        },
        paths: touched,
      },
      blocking: [],
    }
  }

  policyState(reqs: ReadonlyArray<Requirement>) {
    if (reqs.some((r) => r.state === 'fail')) return 'blocked' as const
    if (reqs.some((r) => r.state === 'pending')) return 'pending' as const
    return 'met' as const
  }

  unmet(reqs: ReadonlyArray<Requirement>) {
    return reqs.filter((r) => r.state === 'fail' || r.state === 'pending')
      .length
  }

  orderOf(stackId: string | null) {
    return stackId ? (this.stacks.get(stackId) ?? []) : []
  }

  parentOf(c: ChangeRec) {
    if (!c.stackId) return null
    const order = this.orderOf(c.stackId)
    const i = order.indexOf(c.number)
    return i > 0 ? (this.stack.get(order[i - 1]) ?? null) : null
  }

  actionsFor(c: ChangeRec, p: Actor | null) {
    const no = (why: string) => ({ allowed: false, reasons: [why] })
    if (!p) {
      const s = no('sign_in')
      return { land: s, abandon: s, restore: s, mark_ready: s }
    }
    const canPull = this.viewerCanWrite && p.scopes.has('pulls:write')
    const canMerge = this.viewerCanWrite && p.scopes.has('pulls:merge')
    const reqs = this.evaluate(c)
    const reasons: Array<string> = []
    if (c.state !== 'open') reasons.push(`state:${c.state}`)
    if (!canMerge) reasons.push('scope:pulls:merge')
    for (const r of reqs)
      if (r.state === 'fail' || r.state === 'pending')
        reasons.push(
          `policy:${r.id} ${r.state === 'fail' ? 'fail' : 'pending'}`,
        )
    const parent = this.parentOf(c)
    if (parent && parent.state !== 'landed')
      reasons.push(`parent:#${parent.number} not landed`)
    const owner = this.branchOwnerOf(c.branch)
    return {
      land: { allowed: reasons.length === 0, reasons },
      abandon:
        canPull && (c.state === 'open' || c.state === 'draft')
          ? { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      restore:
        canPull && c.state === 'abandoned'
          ? owner
            ? { allowed: false, reasons: [`branch:#${owner.number}`] }
            : { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      mark_ready:
        canPull && c.state === 'draft'
          ? { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
    }
  }

  presentFinding(c: ChangeRec, f: FindingRec) {
    return {
      object: 'finding' as const,
      id: f.id,
      label: f.label,
      by: f.by,
      severity: f.severity,
      state: f.state,
      reason: f.reason,
      file: f.file,
      line: f.line,
      title: f.title,
      body: f.body,
      patch_set: f.patchSet,
      url: `${repoUrl(this.repo)}/changes/${c.number}/findings/${f.id}`,
      suggestion: f.suggestion ?? null,
      prompt: f.prompt ?? null,
      created_at: iso(f.created),
    }
  }

  presentCheck(k: CheckRec) {
    return {
      object: 'check_run' as const,
      id: k.id,
      key: k.key,
      name: k.name,
      state: k.state,
      tree: k.tree,
      details_url: k.detailsUrl,
      cases: k.cases ?? null,
      created_at: iso(k.created),
      updated_at: iso(k.updated),
    }
  }

  presentPatchSet(c: ChangeRec, ps: PatchSetRec) {
    return {
      object: 'patch_set' as const,
      number: ps.n,
      change: c.number,
      sha: ps.sha,
      tree: ps.tree,
      note: ps.note,
      author: this.actor(ps.author),
      files: Object.keys(ps.files).length,
      url: `${repoUrl(this.repo)}/changes/${c.number}/patch-sets/${ps.n}`,
      created_at: iso(ps.created),
    }
  }

  presentReviewComment(c: ChangeRec, x: ReviewCommentRec) {
    return {
      object: 'change_comment' as const,
      id: x.id,
      change: c.number,
      author: this.actor(x.author),
      body: x.body,
      file: x.file,
      line: x.line,
      patch_set: x.patchSet,
      reply_to: x.replyTo,
      resolved: x.resolved,
      created_at: iso(x.created),
      updated_at: iso(x.updated),
      version: x.version,
    }
  }

  presentEvidence(c: ChangeRec, e: EvidenceRec) {
    const u = e.upload ?? {
      id: e.uploadId,
      contentType: 'application/octet-stream',
      size: 0,
      sha256: '',
    }
    return {
      object: 'evidence' as const,
      id: e.id,
      change: c.number,
      kind: e.kind,
      caption: e.caption,
      upload: {
        id: u.id,
        content_type: u.contentType,
        size: u.size,
        sha256: u.sha256,
        content_url: `${urls().api}/uploads/${u.id}/content`,
      },
      created_by: this.actor(e.by),
      created_at: iso(e.created),
    }
  }

  presentChange(
    c: ChangeRec,
    viewer: Actor | null | 'event',
    expand: ReadonlyArray<string> = [],
  ) {
    const head = this.head(c)
    const reqs = this.evaluate(c)
    const members = this.orderOf(c.stackId)
    const parent = this.parentOf(c)
    let additions = 0
    let deletions = 0
    for (const f of Object.values(head.files)) {
      additions += f.add
      deletions += f.del
    }
    const reviewers = new Map<string, unknown>()
    for (const r of this.latestReviews(c))
      reviewers.set(r.actor.id, {
        actor: this.actor(r.actor),
        state: r.state,
        patch_set: r.patchSet,
        carries_to_head: r.carries,
      })
    return {
      object: 'change' as const,
      id: c.id,
      number: c.number,
      url: `${repoUrl(this.repo)}/changes/${c.number}`,
      html_url: `${urls().html}/${this.repo.owner}/${this.repo.name}/changes/${c.number}`,
      repo: expand.includes('repo') ? this.repoShown : repoRef(this.repo),
      title: c.title,
      description: c.description,
      state: c.state,
      author: this.actor(c.author),
      base: c.base,
      branch: c.branch,
      patch_set_count: c.patchSets.length,
      head: { patch_set: head.n, sha: head.sha, tree: head.tree },
      stack: c.stackId
        ? {
            id: c.stackId,
            position: members.indexOf(c.number) + 1,
            size: members.length,
            parent: parent?.number ?? null,
          }
        : null,
      stats: { files: Object.keys(head.files).length, additions, deletions },
      checks: this.checksFor(c),
      policy: { state: this.policyState(reqs), blocking: this.unmet(reqs) },
      reviewers: [...reviewers.values()],
      mirrors: c.mirrors,
      labels: c.labels,
      evidence_count: c.evidence?.length ?? 0,
      findings: expand.includes('findings')
        ? c.findings.map((f) => this.presentFinding(c, f))
        : null,
      check_runs: expand.includes('check_runs')
        ? c.checks.map((k) => this.presentCheck(k))
        : null,
      actions: viewer === 'event' ? null : this.actionsFor(c, viewer),
      landed_at: c.landed ? iso(c.landed) : null,
      created_at: iso(c.created),
      updated_at: iso(c.updated),
      version: c.version,
    }
  }
}

/**
 * Loads what showing changes needs, for a viewer. `changes` are the ones
 * about to be shown, so their stacks and branches are read once each.
 */
export async function viewFor(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  viewer: Actor | null,
  now: number,
  changes: Array<{ stackId: string | null; branch: string }>,
  opts: { expandRepo?: boolean; assume?: Assume } = {},
) {
  const policy = await loadPolicy(ctx, repo)
  const stack = new Map<number, Doc<'changes'>>()
  const stacks = new Map<string, Array<number>>()
  for (const s of new Set(
    changes.map((c) => c.stackId).filter((x): x is string => !!x),
  )) {
    const members = await stackMembers(ctx, repo, s)
    for (const m of members) stack.set(m.number, m)
    stacks.set(
      s,
      members.map((m) => m.number),
    )
  }
  const owners = new Map<string, Doc<'changes'> | null>()
  for (const b of new Set(changes.map((c) => c.branch)))
    owners.set(b, await branchOwner(ctx, repo, b))
  const classes = new Map<string, ActorRec['class'] | undefined>()
  for (const h of opts.assume?.approve ?? [])
    classes.set(h, (await knownActor(ctx, h))?.class)
  return new ChangeView(
    repo,
    policy,
    now,
    stack,
    stacks,
    (b) => owners.get(b) ?? null,
    viewer ? await canWrite(ctx, repo, viewer) : false,
    (h) => classes.get(h),
    opts.expandRepo ? await presentRepo(ctx, repo, now) : null,
  )
}
