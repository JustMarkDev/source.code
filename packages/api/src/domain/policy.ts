import { newId } from '../ids'
import { apiError } from '../problem'
import { BIG_CHANGE, describeCustomRule, policyRules } from './present'
import type { CustomRuleRec, RepoRec, RuleMode, Viewer } from './records'
import { DomainPipelines } from './pipelines'

const day = (t: number) => new Date(t).toISOString().slice(0, 10)

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

  private yamlOf(repo: RepoRec) {
    const lines = [
      '# .source/policy/main.yml',
      '# Written by source.code from the repository settings.',
      'rules:',
    ]
    for (const r of this.rulesOf(repo)) {
      lines.push(`  - id: ${r.id}`, `    mode: ${this.modeOf(repo, r.id)}`)
      if (r.custom) lines.push(`    name: ${JSON.stringify(r.name)}`)
      lines.push(`    when: ${JSON.stringify(r.when)}`, '    require:')
      for (const q of r.requires) lines.push(`      - ${JSON.stringify(q)}`)
      lines.push('')
    }
    const live = (repo.policyExceptions ?? []).filter(
      (e) => e.expires > this.now(),
    )
    if (live.length) {
      lines.push('exceptions:')
      for (const e of live)
        lines.push(
          `  - { rule: ${e.rule}, who: ${e.who}, until: ${day(e.expires)}, reason: ${JSON.stringify(e.reason)} }`,
        )
    }
    return `${lines.join('\n').trimEnd()}\n`
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
      file: '.source/policy/main.yml',
      yaml: this.yamlOf(repo),
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
