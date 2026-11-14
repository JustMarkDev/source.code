import type { Landing, PolicyEdit, RuleMode } from './policy-file'

/**
 * Edits to the rules, as the API takes them (`POST …/policy/proposals` and
 * the policy endpoints of a repository whose rules live in the file), turned
 * into edits of the file. Plain JavaScript: the Convex functions import it.
 */

export type ProposalEditBody =
  | { op: 'set_mode'; rule: string; mode: RuleMode }
  | {
      op: 'create_rule'
      id: string
      name: string
      kind: 'required_check' | 'path_approval' | 'max_lines'
      check?: string
      paths?: Array<string>
      approvals?: number
      from?: Array<string>
      max_lines?: number
      mode?: RuleMode
    }
  | { op: 'delete_rule'; rule: string }
  | {
      op: 'add_exception'
      rule: string
      who: string
      reason: string
      expires_at: string
    }
  | { op: 'remove_exception'; exception: string }
  | ({ op: 'set_landing' } & Partial<Landing>)

type Fail = (
  code: string,
  detail: string,
  more?: { errors?: Array<{ pointer: string; code: string; message: string }> },
) => never

export function proposalEdits(
  edits: ReadonlyArray<ProposalEditBody>,
  env: {
    now: number
    by: string
    newId: () => string
    isPerson: (handle: string) => boolean
  },
  fail: Fail,
): Array<PolicyEdit> {
  const bad = (k: number, field: string, code: string, message: string) =>
    fail('invalid_request', message, {
      errors: [{ pointer: `/body/edits/${k}/${field}`, code, message }],
    })
  return edits.map((e, k): PolicyEdit => {
    if (e.op === 'set_mode') return e
    if (e.op === 'delete_rule') return e
    if (e.op === 'remove_exception') return e
    if (e.op === 'set_landing') {
      const { op: _, ...landing } = e
      return { op: 'set_landing', landing }
    }
    if (e.op === 'create_rule') {
      const need: Record<typeof e.kind, keyof typeof e> = {
        required_check: 'check',
        path_approval: 'paths',
        max_lines: 'max_lines',
      }
      if (e[need[e.kind]] === undefined)
        bad(
          k,
          need[e.kind],
          'required',
          `A ${e.kind} rule needs ${need[e.kind]}.`,
        )
      for (const h of e.from ?? [])
        if (!env.isPerson(h))
          bad(k, 'from', 'not_a_person', `${h} is not a person.`)
      return {
        op: 'create_rule',
        rule: {
          id: e.id,
          name: e.name,
          kind: e.kind,
          ...(e.kind === 'required_check' ? { check: e.check } : {}),
          ...(e.kind === 'path_approval'
            ? {
                paths: e.paths,
                approvals: e.approvals ?? 1,
                from: e.from ?? [],
              }
            : {}),
          ...(e.kind === 'max_lines' ? { maxLines: e.max_lines } : {}),
          mode: e.mode,
        },
      }
    }
    if (!env.isPerson(e.who))
      bad(k, 'who', 'not_a_person', `${e.who} is not a person.`)
    const expires = Date.parse(e.expires_at)
    if (!(expires > env.now) || expires - env.now > 90 * 86_400_000)
      bad(
        k,
        'expires_at',
        'out_of_range',
        'Set an end in the future, at most 90 days away.',
      )
    return {
      op: 'add_exception',
      exception: {
        id: env.newId(),
        rule: e.rule,
        who: e.who,
        reason: e.reason,
        createdBy: env.by,
        created: env.now,
        expires,
      },
    }
  })
}

/** A short title for the change or patch set that carries the edits. */
export function proposalTitle(
  edits: ReadonlyArray<PolicyEdit>,
  moving: boolean,
): string {
  const say = (e: PolicyEdit) => {
    if (e.op === 'set_mode') return `${e.rule} to ${e.mode}`
    if (e.op === 'create_rule') return `add rule ${e.rule.id}`
    if (e.op === 'delete_rule') return `delete rule ${e.rule}`
    if (e.op === 'add_exception')
      return `exception to ${e.exception.rule} for ${e.exception.who}`
    if (e.op === 'remove_exception') return `end exception ${e.exception}`
    return 'landing settings'
  }
  // A landing edit that sets nothing is how the move is asked for on its own.
  const real = edits.filter(
    (e) => e.op !== 'set_landing' || Object.keys(e.landing).length > 0,
  )
  const what = real.map(say).join(', ')
  if (moving)
    return what
      ? `Move the rules into the policy file, with ${what}`
      : 'Move the rules into the policy file'
  return `Policy: ${what}`
}
