import { createHash } from 'node:crypto'
import { newId } from '../ids'
import { apiError } from '../problem'
import {
  DEFAULT_LANDING,
  POLICY_FILE,
  editPolicy,
  landingWaits,
  lineStats,
  parsePolicy,
  policyYaml,
  unifiedDiff,
} from '../policy-file'
import { proposalEdits, proposalTitle } from '../policy-proposals'
import type { Principal } from '../auth'
import type { PolicyContent } from '../policy-file'
import type { LandingStepRec } from '../landing'
import type { ProposalEditBody } from '../policy-proposals'
import { BIG_CHANGE, describeCustomRule, policyRules } from './present'
import type {
  ActorRec,
  ChangeRec,
  CustomRuleRec,
  RepoRec,
  Requirement,
  RuleMode,
  Viewer,
} from './records'
import { DomainPipelines } from './pipelines'

/**
 * A repository's policy: which rules apply and how hard, and who a rule bends
 * for and until when. A change's requirements come from the evaluator in
 * `present.ts`; this layer edits what it reads and reports what the rules did.
 */
export abstract class DomainPolicy extends DomainPipelines {
  /** The built-in rules, then the repository's own, as the list shows them. */
  private rulesOf(repo: RepoRec) {
    return [
      ...policyRules.map((r) => ({ ...r, custom: null })),
      ...(repo.customRules ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        mode: 'enforce' as RuleMode,
        ...describeCustomRule(r),
        custom: r,
      })),
    ]
  }

  /** The rules as settings say them, in the file's terms. */
  private contentOf(repo: RepoRec): PolicyContent {
    return {
      modes: Object.fromEntries(repo.ruleModes ?? []),
      custom: repo.customRules ?? [],
      exceptions: repo.policyExceptions ?? [],
      landing: repo.landing ?? DEFAULT_LANDING,
    }
  }

  /** The policy file as it stands on the default branch, or as the move would write it. */
  protected policyText(repo: RepoRec) {
    return (
      repo.policyFile?.text ??
      policyYaml(this.contentOf(repo), policyRules, this.now())
    )
  }

  /** Once the rules live in the file, a write proposes instead of applying. */
  async policyInFile(owner: string, name: string, p: Viewer) {
    return !!this.resolve(owner, name, p).policyFile
  }

  /** Open changes that edit the policy file. */
  private policyChanges(repo: RepoRec) {
    return [...repo.changes.values()].filter(
      (c) =>
        (c.state === 'open' || c.state === 'draft') &&
        POLICY_FILE in this.head(c).files,
    )
  }

  async getPolicySet(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const changes = [...repo.changes.values()].filter(
      (c) => c.state !== 'abandoned',
    )
    // What each rule said about every change, enforced, as if no mode were set.
    const said = changes.map((c) => ({
      c,
      reqs: this.evaluateRules(repo, c, {}),
    }))
    const now = this.now()
    return {
      object: 'policy_set' as const,
      repo: `${repo.owner}/${repo.name}`,
      file: POLICY_FILE,
      yaml: this.policyText(repo),
      rules: this.rulesOf(repo).map((r) => {
        const applied = said
          .map(({ c, reqs }) => ({ c, q: reqs.find((x) => x.id === r.id) }))
          .filter((x) => x.q && x.q.state !== 'na')
        const blocks = applied.filter(
          (x) => x.q!.state === 'fail' || x.q!.state === 'pending',
        )
        const mode = this.modeOf(repo, r.id)
        return {
          id: r.id,
          name: r.name,
          mode,
          when: r.when,
          requires: r.requires,
          evaluated: applied.length,
          blocked: blocks.length,
          custom: !!r.custom,
          would_block:
            mode === 'dry-run'
              ? blocks.map((x) => ({
                  change: x.c.number,
                  title: x.c.title,
                  why: x.q!.detail,
                }))
              : [],
        }
      }),
      exceptions: (repo.policyExceptions ?? [])
        .filter((e) => e.expires > now)
        .map((e) => ({
          object: 'policy_exception' as const,
          id: e.id,
          rule: e.rule,
          who: e.who,
          reason: e.reason,
          created_by: e.createdBy,
          created_at: new Date(e.created).toISOString(),
          expires_at: new Date(e.expires).toISOString(),
        })),
      large_change_lines: BIG_CHANGE,
      version: repo.policyRev ?? 0,
      source: {
        state: !repo.policyFile
          ? ('settings' as const)
          : repo.policyFile.errors.length
            ? ('errors' as const)
            : ('file' as const),
        sha: repo.policyFile?.sha ?? null,
        errors: repo.policyFile?.errors ?? [],
        pending: this.policyChanges(repo).map((c) => ({
          change: c.number,
          title: c.title,
          author: c.author.handle,
          url: `${this.repoUrl(repo)}/changes/${c.number}`,
        })),
      },
      landing: repo.landing ?? DEFAULT_LANDING,
    }
  }

  // ---- the file is the source of truth ------------------------------------------

  /**
   * A change that edits the policy file landed: the file on the default
   * branch is now its text. When it reads, its rules are the repository's;
   * when it does not, the last valid rules stay and the errors are shown.
   * On code.storage this runs from the push that lands it.
   */
  protected override doLand(repo: RepoRec, c: ChangeRec, by: ActorRec) {
    super.doLand(repo, c, by)
    const head = this.head(c)
    const text = head.contents?.[POLICY_FILE]
    if (typeof text === 'string') this.readPolicyFile(repo, text, head.sha, by)
  }

  protected readPolicyFile(
    repo: RepoRec,
    text: string,
    sha: string,
    by: ActorRec,
  ) {
    const { content, errors } = parsePolicy(text, policyRules)
    repo.policyFile = { text, sha, errors, at: this.now() }
    if (content) {
      const had = new Map((repo.customRules ?? []).map((r) => [r.id, r]))
      repo.ruleModes = new Map(Object.entries(content.modes))
      repo.customRules = content.custom.map((r) => ({
        ...r,
        createdBy: had.get(r.id)?.createdBy ?? by.handle,
        created: had.get(r.id)?.created ?? this.now(),
      }))
      repo.policyExceptions = content.exceptions
      repo.landing = content.landing
    }
    repo.policyRev = (repo.policyRev ?? 0) + 1
    for (const x of repo.changes.values()) x.version++
    repo.changeRev++
    this.emit(
      repo,
      'repo.policy_changed',
      by,
      { object: 'repo', id: repo.id, number: null },
      [errors.length ? 'source.errors' : 'source'],
      null,
    )
  }

  /**
   * Edits to the rules as a change to the policy file. Your open policy
   * change takes them as a new patch set; without one a change is opened.
   * Nothing applies until it lands. In a repository whose rules are still
   * settings, the first proposal is the move: the file written from them,
   * with the edits made.
   */
  async proposePolicy(
    owner: string,
    name: string,
    p: Viewer,
    edits: Array<ProposalEditBody>,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const by = this.asActor(p!)
    const made = proposalEdits(
      edits,
      {
        now: this.now(),
        by: p!.handle,
        newId: () => newId('exception', this.now()),
        isPerson: (h) => this.accounts.get(h)?.kind === 'person',
      },
      fail,
    )
    const branch = `policy/${p!.handle}`
    const draft = repo.openChangeByBranch.get(branch)
    const mine = draft && draft.author.handle === p!.handle ? draft : undefined
    const main = this.policyText(repo)
    const base = mine ? (this.head(mine).contents?.[POLICY_FILE] ?? main) : main
    const next = editPolicy(base, made, policyRules, fail)
    const diff = unifiedDiff(POLICY_FILE, base, next)
    const shown = (c: ChangeRec | null) => ({
      object: 'policy_proposal' as const,
      change: c?.number ?? null,
      url: c ? `${this.repoUrl(repo)}/changes/${c.number}` : null,
      patch_set: c ? this.head(c).n : null,
      created: !mine,
      edits: edits as Array<Record<string, unknown>>,
      diff,
    })
    if (dry) return shown(null)
    const sha = createHash('sha1')
      .update(`${repo.id}/${branch}/${this.now()}/${next}`)
      .digest('hex')
    const stats = lineStats(main, next)
    const files = { [POLICY_FILE]: { hash: sha.slice(0, 6), ...stats } }
    const note = proposalTitle(made, !repo.policyFile)
    if (mine) {
      this.pushPatchSet(repo, mine, by, {
        sha,
        kind: 'update',
        note,
        files,
        contents: { [POLICY_FILE]: next },
      })
      return shown(mine)
    }
    const at = this.now()
    const c: ChangeRec = {
      id: newId('change', at),
      number: repo.nextNumber,
      title: note,
      description: repo.policyFile
        ? 'Proposed from the policy settings. The rules change when this lands.'
        : 'Moves the rules from the repository settings into the policy file. The settings stay in force until this lands; after it, the file is the rules.',
      state: 'open',
      author: by,
      base: repo.defaultBranch,
      branch,
      patchSets: [
        {
          n: 1,
          sha,
          tree: sha.slice(0, 7),
          note,
          author: by,
          created: at,
          files,
          kind: 'initial',
          contents: { [POLICY_FILE]: next },
        },
      ],
      reviews: [],
      findings: [],
      checks: [],
      stackId: null,
      labels: [],
      mirrors: [],
      created: at,
      updated: at,
      landed: null,
      version: 1,
    }
    repo.nextNumber++
    this.seedChange(repo, c)
    this.changeEvent(repo, c, 'change.opened', by, ['state'])
    return shown(c)
  }

  // ---- whether a change may land, and how ---------------------------------------

  /** The landing steps that hold a change back now: checks it waits for. */
  protected landingWaits(repo: RepoRec, c: ChangeRec): Array<Requirement> {
    return landingWaits(repo.landing ?? DEFAULT_LANDING, c.checks, this.head(c))
  }

  /** The policy file's steps after landing: start a pipeline, or call a webhook. */
  protected override async runLandingStep(
    repo: RepoRec,
    s: LandingStepRec,
    p: Principal,
  ): Promise<string> {
    if (s.kind === 'run_pipeline') {
      const r = await this.startPipeline(
        repo.owner,
        repo.name,
        p,
        { workflow: s.target },
        false,
      )
      return `Started ${s.target} run #${r.number}.`
    }
    // The URL must be one of the repository's webhooks, so the call is signed
    // with its secret and retried like any delivery.
    const hook = (await this.svc.hooks.list(`${repo.owner}/${repo.name}`)).find(
      (h) => h.url === s.target,
    )
    if (!hook)
      throw apiError(
        'invalid_state',
        `No webhook for ${s.target} on ${repo.owner}/${repo.name}.`,
        {
          hint: 'Add it with POST /repos/{owner}/{repo}/webhooks, then land again.',
        },
      )
    const at = this.now()
    const d = await this.svc.hooks.deliver(hook, {
      object: 'event',
      id: newId('event', at),
      sequence: 0,
      type: 'change.landed',
      created_at: new Date(at).toISOString(),
      repo: `${repo.owner}/${repo.name}`,
      repo_id: repo.id,
      actor: this.actor(this.asActor(p)),
      subject: { object: 'repo', id: repo.id, number: null },
      changes: ['landing.step'],
      data: null,
    })
    return `Queued delivery ${d.id} to ${hook.id}.`
  }

  protected override checkLandable(
    repo: RepoRec,
    c: ChangeRec,
    p: Principal,
    expectedTree: string,
  ) {
    super.checkLandable(repo, c, p, expectedTree)
    const waits = this.landingWaits(repo, c)
    if (waits.length)
      throw apiError(
        'policy_blocked',
        `#${c.number} cannot land yet: ${waits.map((w) => w.detail.replace(/\.$/, '')).join('; ')}.`,
        {
          extra: { requirements: waits },
          retryable: !waits.some((w) => w.state === 'fail'),
          hint: 'The policy file says landing waits for these checks.',
        },
      )
  }

  async landability(owner: string, name: string, ref: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const head = this.head(c)
    const requirements = this.evaluate(repo, c)
    const blockers = [
      ...(c.state === 'open'
        ? []
        : [
            {
              id: 'state',
              rule: 'The change is open',
              state: c.state === 'draft' ? 'pending' : 'fail',
              detail:
                c.state === 'draft'
                  ? `#${c.number} is a draft. Mark it ready first.`
                  : `#${c.number} is ${c.state}.`,
              needs: null,
              blocking: [],
            } as Requirement,
          ]),
      ...requirements.filter(
        (r) => r.state === 'fail' || r.state === 'pending',
      ),
      ...this.landingWaits(repo, c),
    ]
    const parent = this.parentOf(repo, c)
    if (parent && parent.state !== 'landed')
      blockers.push({
        id: 'stack',
        rule: 'Lands after its parent',
        state: 'pending',
        detail: `#${parent.number} below #${c.number} has not landed.`,
        needs: null,
        blocking: [],
      })
    return {
      object: 'landability' as const,
      change: c.number,
      patch_set: head.n,
      tree: head.tree,
      landable: blockers.length === 0,
      blockers,
      requirements,
      landing: repo.landing ?? DEFAULT_LANDING,
    }
  }

  async policySetVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return `${repo.id}.pol${repo.policyRev ?? 0}.${repo.changeRev}.${this.accessRevision}`
  }

  /** Policy changed: every change's requirements are worked out again. */
  private policyChanged(repo: RepoRec, p: Viewer, what: string) {
    repo.policyRev = (repo.policyRev ?? 0) + 1
    for (const c of repo.changes.values()) c.version++
    repo.changeRev++
    this.emit(
      repo,
      'repo.policy_changed',
      this.asActor(p!),
      { object: 'repo', id: repo.id, number: null },
      [what],
      null,
    )
  }

  private ruleOf(repo: RepoRec, id: string) {
    const r = this.rulesOf(repo).find((x) => x.id === id)
    if (!r) throw apiError('not_found', `No rule ${id}.`)
    return r
  }

  async createRule(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      id: string
      name: string
      kind: CustomRuleRec['kind']
      check?: string
      paths?: Array<string>
      approvals?: number
      from?: Array<string>
      max_lines?: number
      mode?: RuleMode
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const bad = (pointer: string, message: string) =>
      apiError('invalid_request', message, {
        errors: [{ pointer, code: 'invalid', message }],
      })
    if (policyRules.some((r) => r.id === body.id))
      throw bad('/body/id', `${body.id} is a built-in rule; pick another id.`)
    const need: Record<CustomRuleRec['kind'], Array<keyof typeof body>> = {
      required_check: ['check'],
      path_approval: ['paths'],
      max_lines: ['max_lines'],
    }
    for (const k of need[body.kind])
      if (body[k] === undefined)
        throw bad(`/body/${k}`, `A ${body.kind} rule needs ${k}.`)
    for (const h of body.from ?? [])
      if (this.accounts.get(h)?.kind !== 'person')
        throw bad('/body/from', `${h} is not a person.`)
    const have = repo.customRules?.find((r) => r.id === body.id)
    const rec: CustomRuleRec = {
      id: body.id,
      name: body.name,
      kind: body.kind,
      ...(body.kind === 'required_check' ? { check: body.check } : {}),
      ...(body.kind === 'path_approval'
        ? {
            paths: body.paths,
            approvals: body.approvals ?? 1,
            from: body.from ?? [],
          }
        : {}),
      ...(body.kind === 'max_lines' ? { maxLines: body.max_lines } : {}),
      createdBy: have?.createdBy ?? p!.handle,
      created: have?.created ?? this.now(),
    }
    if (!dry) {
      repo.customRules = [
        ...(repo.customRules ?? []).filter((r) => r.id !== body.id),
        rec,
      ]
      repo.ruleModes ??= new Map()
      repo.ruleModes.set(body.id, body.mode ?? 'enforce')
      this.policyChanged(repo, p, 'rules')
    }
    const set = await this.getPolicySet(owner, name, p)
    const shown = set.rules.find((r) => r.id === body.id)
    return {
      rule: shown ?? {
        id: rec.id,
        name: rec.name,
        mode: body.mode ?? 'enforce',
        ...describeCustomRule(rec),
        evaluated: 0,
        blocked: 0,
        custom: true,
        would_block: [],
      },
      created: !have,
    }
  }

  async deleteRule(
    owner: string,
    name: string,
    rule: string,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const r = this.ruleOf(repo, rule)
    if (!r.custom)
      throw apiError(
        'invalid_state',
        `${rule} is built in. Turn it off instead: PATCH it with mode=off.`,
      )
    if (dry) return
    repo.customRules = repo.customRules!.filter((x) => x.id !== rule)
    repo.ruleModes?.delete(rule)
    repo.policyExceptions = repo.policyExceptions?.filter(
      (e) => e.rule !== rule,
    )
    this.policyChanged(repo, p, 'rules')
  }

  async setRuleMode(
    owner: string,
    name: string,
    rule: string,
    p: Viewer,
    mode: RuleMode,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.ruleOf(repo, rule)
    if (!dry && this.modeOf(repo, rule) !== mode) {
      repo.ruleModes ??= new Map()
      repo.ruleModes.set(rule, mode)
      this.policyChanged(repo, p, 'rules')
    }
    const set = await this.getPolicySet(owner, name, p)
    const shown = set.rules.find((r) => r.id === rule)!
    return dry ? { ...shown, mode } : shown
  }

  async addPolicyException(
    owner: string,
    name: string,
    p: Viewer,
    body: { rule: string; who: string; reason: string; expires_at: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.ruleOf(repo, body.rule)
    if (
      !this.accounts.get(body.who) ||
      this.accounts.get(body.who)?.kind !== 'person'
    )
      throw apiError('invalid_request', `${body.who} is not a person.`, {
        errors: [
          {
            pointer: '/body/who',
            code: 'not_a_person',
            message: `${body.who} is not a person.`,
          },
        ],
      })
    const expires = Date.parse(body.expires_at)
    const now = this.now()
    if (!(expires > now) || expires - now > 90 * 86_400_000)
      throw apiError('invalid_request', 'An exception lasts up to 90 days.', {
        errors: [
          {
            pointer: '/body/expires_at',
            code: 'out_of_range',
            message: 'Set an end in the future, at most 90 days away.',
          },
        ],
      })
    const e = {
      id: newId('exception', now),
      rule: body.rule,
      who: body.who,
      reason: body.reason,
      createdBy: p!.handle,
      created: now,
      expires,
    }
    if (!dry) {
      repo.policyExceptions = [...(repo.policyExceptions ?? []), e]
      this.policyChanged(repo, p, 'exceptions')
    }
    return {
      object: 'policy_exception' as const,
      id: e.id,
      rule: e.rule,
      who: e.who,
      reason: e.reason,
      created_by: e.createdBy,
      created_at: new Date(e.created).toISOString(),
      expires_at: new Date(e.expires).toISOString(),
    }
  }

  async removePolicyException(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const had = repo.policyExceptions?.some((e) => e.id === id)
    if (!had) throw apiError('not_found', `No exception ${id}.`)
    if (dry) return
    repo.policyExceptions = repo.policyExceptions!.filter((e) => e.id !== id)
    this.policyChanged(repo, p, 'exceptions')
  }
}

const fail = (
  code: string,
  detail: string,
  more?: { errors?: Array<{ pointer: string; code: string; message: string }> },
): never => {
  throw apiError(code as never, detail, more)
}
