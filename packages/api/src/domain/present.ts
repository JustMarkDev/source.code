import { Pre } from '../registry'
import type { UploadRec } from '../uploads'
import type { z } from 'zod'
import type * as S from '../schemas'
import { iso } from './records'
import { DEFAULT_LANDING, policyFileCheck } from '../policy-file'
import { presentSteps } from '../landing'
import type {
  AccountRec,
  ActorRec,
  Assume,
  ChangeRec,
  CheckRec,
  CustomRuleRec,
  EvidenceRec,
  FindingRec,
  IssueRec,
  OperationRec,
  PolicyState,
  RepoRec,
  Requirement,
  RuleMode,
  Viewer,
} from './records'
import { DomainAccess } from './access'

/** How records are shown in answers, including policy evaluation. */
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

/** How a repository's own rule reads in the list and the policy file. */
export function describeCustomRule(r: CustomRuleRec) {
  if (r.kind === 'required_check')
    return {
      when: 'any change',
      requires: [`${r.check} passed, bound to the landing tree`],
    }
  if (r.kind === 'max_lines')
    return {
      when: 'any change',
      requires: [`at most ${r.maxLines} lines added and removed`],
    }
  const n = r.approvals ?? 1
  return {
    when: `paths ${(r.paths ?? []).join(', ')}`,
    requires: [
      `${n} approval${n === 1 ? '' : 's'}, human${r.from?.length ? `, from ${r.from.join(', ')}` : ''}`,
    ],
  }
}

export abstract class DomainPresent extends DomainAccess {
  protected actor(a: ActorRec): z.infer<typeof S.Actor> {
    return { object: 'actor', id: a.id, handle: a.handle, class: a.class }
  }

  protected repoRef(r: RepoRec): z.infer<typeof S.RepoRef> {
    return {
      object: 'repo',
      id: r.id,
      full_name: `${r.owner}/${r.name}`,
      url: this.repoUrl(r),
    }
  }

  protected presentRepo(r: RepoRec): z.infer<typeof S.Repo> {
    // Counting needs a pass over everything, so do it once per change to the repository.
    const key = `${r.rev}:${r.changes.size}:${r.issues.size}`
    if (r.counts.key !== key) {
      let openChanges = 0
      for (const c of r.changes.values())
        if (c.state === 'open' || c.state === 'draft') openChanges++
      let openIssues = 0
      for (const i of r.issues.values()) if (i.state === 'open') openIssues++
      r.counts = { key, openChanges, openIssues }
    }
    const { openChanges, openIssues } = r.counts
    return {
      object: 'repo',
      id: r.id,
      owner: r.owner,
      name: r.name,
      full_name: `${r.owner}/${r.name}`,
      description: r.description,
      visibility: r.visibility,
      default_branch: r.defaultBranch,
      stars: r.stars,
      stars_today:
        r.starsTodayBase +
        r.starTimes.filter((t) => t > this.now() - 86_400_000).length,
      forks: r.forks,
      upstream: r.upstream,
      install: r.install,
      category: r.category,
      language: r.languages[0]?.[0] ?? null,
      languages: r.languages.map(([name, percent]) => ({ name, percent })),
      license: r.license,
      website: r.website,
      docs_url: r.docsUrl,
      maintainers: [...r.maintainers].sort(),
      transcripts: r.transcripts ?? 'off',
      run_trailer: r.runTrailer ?? 'auto',
      open_changes: openChanges,
      open_issues: openIssues,
      url: this.repoUrl(r),
      html_url: `${this.urls.html}/${r.owner}/${r.name}`,
      created_at: iso(r.created),
      updated_at: iso(r.updated),
      version: r.version,
    }
  }

  protected head(c: ChangeRec) {
    return c.patchSets[c.patchSets.length - 1]
  }

  protected checksFor(c: ChangeRec): z.infer<typeof S.Change>['checks'] {
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

  /** The newest review from each person. Kept up to date as reviews arrive, not rebuilt from all of them. */
  protected latestReviews(c: ChangeRec) {
    let l = c.latest
    if (!l) c.latest = l = { map: new Map(), seen: 0 }
    for (; l.seen < c.reviews.length; l.seen++) {
      const r = c.reviews[l.seen]
      l.map.set(r.actor.id, r)
    }
    return [...l.map.values()]
  }

  /**
   * What policy says about a change. It depends on nothing but the change's own
   * state (its version moves whenever that does) and the repository's
   * maintainers, so it is worked out once per version. Asking "what if" with
   * `assume` always works it out fresh.
   */
  protected evaluate(
    repo: RepoRec,
    c: ChangeRec,
    assume?: Assume,
  ): Array<Requirement> {
    if (assume) return this.evaluateFresh(repo, c, assume)
    const memo = c.policyMemo
    const rev = repo.policyRev ?? 0
    if (memo && memo.version === c.version && (memo.rev ?? 0) === rev)
      return memo.reqs
    const reqs = this.evaluateFresh(repo, c, {})
    c.policyMemo = { version: c.version, rev, reqs }
    return reqs
  }

  /** A rule's mode in a repository: what it was set to, or its default. */
  protected modeOf(repo: RepoRec, id: string): RuleMode {
    return (
      repo.ruleModes?.get(id) ??
      policyRules.find((r) => r.id === id)?.mode ??
      'enforce'
    )
  }

  /** The person's live exception to a rule in a repository, if they have one. */
  protected exceptionFor(repo: RepoRec, rule: string, who: string) {
    const now = this.now()
    return repo.policyExceptions?.find(
      (e) => e.rule === rule && e.who === who && e.expires > now,
    )
  }

  /**
   * Each rule's requirement, then the repository's modes: an `off` rule is
   * left out, and a `dry-run` rule says what it would do without blocking.
   */
  protected evaluateFresh(
    repo: RepoRec,
    c: ChangeRec,
    assume: Assume,
  ): Array<Requirement> {
    const out: Array<Requirement> = []
    for (const r of this.evaluateRules(repo, c, assume)) {
      const mode = this.modeOf(repo, r.id)
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

  /** Every rule, enforced, as if no mode were set. */
  protected evaluateRules(
    repo: RepoRec,
    c: ChangeRec,
    assume: Assume,
  ): Array<Requirement> {
    const head = this.head(c)
    const out: Array<Requirement> = []

    // With fresh approvals, an approval holds only on the patch set it was
    // given on, even when a rebase left the tree the same.
    const fresh = (repo.landing ?? DEFAULT_LANDING).fresh_approvals
    const reviews = this.latestReviews(c).map((r) =>
      fresh && r.patchSet !== head.n ? { ...r, carries: false } : r,
    )
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
      if (this.actors.get(h)?.class === 'human' && h !== c.author.handle)
        humanApprovals.add(h)
    const humanObjections = reviews.filter(
      (r) => r.state === 'changes' && r.actor.class === 'human',
    )

    // core-paths: a maintainer has to approve. Someone with an exception to
    // it counts as one while the exception lasts.
    const maintainerApprovals = [...humanApprovals].filter(
      (h) =>
        repo.maintainers.has(h) || !!this.exceptionFor(repo, 'core-paths', h),
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

    // agent-authored: a person has to approve work an agent or bot wrote.
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

    // ci-evidence: tests passed on the tree that will land.
    const runs = c.checks.filter(
      (k) => k.name === 'ci/test' && k.tree === head.tree,
    )
    const run = runs.sort((a, b) => b.updated - a.updated)[0] as
      | (typeof runs)[number]
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

    // big-change: a large change needs two approvals, one of them a person.
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

    // findings: nothing high is left open.
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

    for (const r of repo.customRules ?? [])
      out.push(this.evaluateCustomRule(r, c, assume, humanApprovals, lines))

    // The rules protect themselves: a change to the policy folder needs a
    // maintainer, and a file that reads. Not a rule a repository can turn off.
    const policy = policyFileCheck(
      head,
      policyRules,
      (h) => repo.maintainers.has(h),
      [...humanApprovals],
    )
    if (policy) out.push(policy)

    // An exception for the author lets their change through a rule.
    return out.map((r) => {
      if (r.id === 'core-paths' || r.state === 'pass' || r.state === 'na')
        return r
      const e = this.exceptionFor(repo, r.id, c.author.handle)
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

  /** A rule the repository wrote, against one change. */
  protected evaluateCustomRule(
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
        .sort((a, b) => b.updated - a.updated)[0] as
        | (typeof c.checks)[number]
        | undefined
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

  protected policyState(reqs: ReadonlyArray<Requirement>): PolicyState {
    if (reqs.some((r) => r.state === 'fail')) return 'blocked'
    if (reqs.some((r) => r.state === 'pending')) return 'pending'
    return 'met'
  }

  protected unmet(reqs: ReadonlyArray<Requirement>) {
    return reqs.filter((r) => r.state === 'fail' || r.state === 'pending')
      .length
  }

  protected actionsFor(repo: RepoRec, c: ChangeRec, p: Viewer) {
    const no = (why: string) => ({ allowed: false, reasons: [why] })
    if (!p) {
      const s = no('sign_in')
      return { land: s, abandon: s, restore: s, mark_ready: s }
    }
    const canWrite = this.canWrite(repo, p)
    const canPull = canWrite && p.scopes.has('pulls:write')
    const canMerge = canWrite && p.scopes.has('pulls:merge')
    const reqs = this.evaluate(repo, c)
    const reasons: Array<string> = []
    if (c.state !== 'open') reasons.push(`state:${c.state}`)
    if (!canMerge) reasons.push('scope:pulls:merge')
    for (const r of reqs)
      if (r.state === 'fail' || r.state === 'pending')
        reasons.push(
          `policy:${r.id} ${r.state === 'fail' ? 'fail' : 'pending'}`,
        )
    const parent = this.parentOf(repo, c)
    if (parent && parent.state !== 'landed')
      reasons.push(`parent:#${parent.number} not landed`)
    const branchOwner = repo.openChangeByBranch.get(c.branch)
    return {
      land: { allowed: reasons.length === 0, reasons },
      abandon:
        canPull && (c.state === 'open' || c.state === 'draft')
          ? { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      restore:
        canPull && c.state === 'abandoned'
          ? branchOwner
            ? { allowed: false, reasons: [`branch:#${branchOwner.number}`] }
            : { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
      mark_ready:
        canPull && c.state === 'draft'
          ? { allowed: true, reasons: [] }
          : no(canPull ? `state:${c.state}` : 'scope:pulls:write'),
    }
  }

  protected parentOf(repo: RepoRec, c: ChangeRec) {
    if (!c.stackId) return null
    const members = repo.stacks.get(c.stackId) ?? []
    const i = members.indexOf(c.number)
    return i > 0 ? (repo.changes.get(members[i - 1]) ?? null) : null
  }

  protected presentFinding(
    repo: RepoRec,
    c: ChangeRec,
    f: FindingRec,
  ): z.infer<typeof S.Finding> {
    return {
      object: 'finding',
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
      url: `${this.repoUrl(repo)}/changes/${c.number}/findings/${f.id}`,
      suggestion: f.suggestion ?? null,
      prompt: f.prompt ?? null,
      run: f.via?.run ?? null,
      created_at: iso(f.created),
    }
  }

  protected presentCheck(k: CheckRec): z.infer<typeof S.CheckRun> {
    return {
      object: 'check_run',
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

  /**
   * A change as a caller sees it, already serialized. Keyed by everything the
   * answer depends on, which includes the change's version, so an entry is never
   * stale, only replaced. A list of fifty unchanged changes is fifty lookups.
   */
  protected readonly shown = new Map<string, Pre>()

  protected shownChars = 0

  static readonly SHOWN_MAX = 8000

  static readonly SHOWN_CHARS_MAX = 24_000_000

  shownChange(
    repo: RepoRec,
    c: ChangeRec,
    viewer: Viewer | 'event',
    expand: ReadonlyArray<string> = [],
  ): Pre {
    const who =
      viewer === 'event' ? 'event' : viewer ? viewer.capId : 'anonymous'
    const ex = expand.length ? expand.join(',') : ''
    const key = `${repo.id}|${c.id}|${c.version}|${c.stackId ? this.stackRev(repo, c) : 0}|${repo.openChangeByBranch.get(c.branch)?.id ?? ''}|${ex}|${who}|${repo.version}|${this.accessRevision}${expand.includes('repo') ? `|${repo.rev}` : ''}`
    const hit = this.shown.get(key)
    if (hit) return hit
    const obj = this.presentChange(repo, c, viewer, expand)
    const pre = new Pre(JSON.stringify(obj), obj, key)
    this.shown.set(key, pre)
    this.shownChars += pre.json.length
    // First in, first out. Dropping an entry that is still wanted costs one rebuild;
    // reordering on every hit costs more than that across a busy list.
    while (
      (this.shown.size > DomainPresent.SHOWN_MAX ||
        this.shownChars > DomainPresent.SHOWN_CHARS_MAX) &&
      this.shown.size > 1
    ) {
      const gone = this.shown.keys().next().value as string
      this.shownChars -= this.shown.get(gone)!.json.length
      this.shown.delete(gone)
    }
    return pre
  }

  presentChange(
    repo: RepoRec,
    c: ChangeRec,
    viewer: Viewer | 'event',
    expand: ReadonlyArray<string> = [],
  ): z.infer<typeof S.Change> {
    const head = this.head(c)
    const reqs = this.evaluate(repo, c)
    const members = c.stackId ? (repo.stacks.get(c.stackId) ?? []) : []
    const parent = this.parentOf(repo, c)
    let additions = 0
    let deletions = 0
    for (const f of Object.values(head.files)) {
      additions += f.add
      deletions += f.del
    }
    const reviewers = new Map<
      string,
      z.infer<typeof S.Change>['reviewers'][number]
    >()
    for (const r of this.latestReviews(c))
      reviewers.set(r.actor.id, {
        actor: this.actor(r.actor),
        state: r.state,
        patch_set: r.patchSet,
        carries_to_head: r.carries,
      })
    return {
      object: 'change',
      id: c.id,
      number: c.number,
      url: `${this.repoUrl(repo)}/changes/${c.number}`,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/changes/${c.number}`,
      repo: expand.includes('repo')
        ? this.presentRepo(repo)
        : this.repoRef(repo),
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
      stats: {
        files: Object.keys(head.files).length,
        additions,
        deletions,
      },
      checks: this.checksFor(c),
      policy: { state: this.policyState(reqs), blocking: this.unmet(reqs) },
      reviewers: [...reviewers.values()],
      mirrors: c.mirrors,
      labels: c.labels,
      evidence_count: c.evidence?.length ?? 0,
      findings: expand.includes('findings')
        ? c.findings.map((f) => this.presentFinding(repo, c, f))
        : null,
      check_runs: expand.includes('check_runs')
        ? c.checks.map((k) => this.presentCheck(k))
        : null,
      actions: viewer === 'event' ? null : this.actionsFor(repo, c, viewer),
      landed_at: c.landed ? iso(c.landed) : null,
      created_at: iso(c.created),
      updated_at: iso(c.updated),
      version: c.version,
    }
  }

  /** An issue already serialized, kept by version like `shownChange`. The object is rebuilt from the text only if someone asks for it. */
  protected readonly shownIssues = new Map<string, Pre>()

  protected shownIssueChars = 0

  static readonly SHOWN_ISSUES_MAX = 6000

  static readonly SHOWN_ISSUES_CHARS_MAX = 12_000_000

  shownIssue(repo: RepoRec, i: IssueRec): Pre {
    const key = `${repo.id}|${i.id}|${i.version}|${repo.version}`
    const hit = this.shownIssues.get(key)
    if (hit) return hit
    const json = JSON.stringify(this.presentIssue(repo, i))
    const pre = new Pre(json, () => JSON.parse(json), key)
    this.shownIssues.set(key, pre)
    this.shownIssueChars += json.length
    while (
      (this.shownIssues.size > DomainPresent.SHOWN_ISSUES_MAX ||
        this.shownIssueChars > DomainPresent.SHOWN_ISSUES_CHARS_MAX) &&
      this.shownIssues.size > 1
    ) {
      const gone = this.shownIssues.keys().next().value as string
      this.shownIssueChars -= this.shownIssues.get(gone)!.json.length
      this.shownIssues.delete(gone)
    }
    return pre
  }

  presentIssue(repo: RepoRec, i: IssueRec): z.infer<typeof S.Issue> {
    return {
      object: 'issue',
      id: i.id,
      number: i.number,
      url: `${this.repoUrl(repo)}/issues/${i.number}`,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/issues/${i.number}`,
      repo: this.repoRef(repo),
      title: i.title,
      body: i.body,
      state: i.state,
      author: this.actor(i.author),
      labels: i.labels,
      assignees: (i.assignees ?? []).map((a) => this.actor(a)),
      comments: i.comments?.length ?? 0,
      closed_at: i.closed ? iso(i.closed) : null,
      created_at: iso(i.created),
      updated_at: iso(i.updated),
      version: i.version,
    }
  }

  protected presentOp(o: OperationRec): z.infer<typeof S.Operation> {
    return {
      object: 'operation',
      id: o.id,
      kind: o.kind,
      state: o.state,
      progress: { done: o.done, total: o.total },
      result: o.result,
      error: o.error,
      url: `${this.urls.api}/operations/${o.id}`,
      created_at: iso(o.created),
      finished_at: o.finished ? iso(o.finished) : null,
      steps: presentSteps(o.steps ?? [], iso),
    }
  }

  protected presentEvidence(
    c: ChangeRec,
    e: EvidenceRec,
    u: UploadRec,
  ): z.infer<typeof S.Evidence> {
    return {
      object: 'evidence',
      id: e.id,
      change: c.number,
      kind: e.kind,
      caption: e.caption,
      upload: {
        id: u.id,
        content_type: u.contentType,
        size: u.size,
        sha256: u.sha256 ?? '',
        content_url: `${this.urls.api}/uploads/${u.id}/content`,
      },
      created_by: this.actor(e.by),
      created_at: iso(e.created),
    }
  }

  protected presentAccount(
    a: AccountRec,
    p: Viewer,
  ): z.infer<typeof S.Account> {
    return {
      object: 'account',
      id: a.id,
      handle: a.handle,
      name: a.name,
      kind: a.kind,
      bio: a.bio,
      role: !p
        ? null
        : a.handle === p.handle
          ? 'owner'
          : (a.members.get(p.handle) ?? null),
      url: `${this.urls.api}/accounts/${a.handle}`,
      html_url: `${this.urls.html}/${a.handle}`,
      created_at: iso(a.created),
      updated_at: iso(a.updated),
      version: a.version,
    }
  }

  protected stackRev(repo: RepoRec, c: ChangeRec) {
    let rev = 0
    for (const n of repo.stacks.get(c.stackId!) ?? [])
      rev += repo.changes.get(n)?.version ?? 0
    return rev
  }
}
