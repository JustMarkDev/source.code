import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import type { Reply } from '../registry'
import * as S from '../schemas'
import { changeParams, repoParams } from './common'
import type { DomainPort } from '../domain'
import type { ProposalEditBody } from '../policy-proposals'

/**
 * Once a repository's rules live in its policy file, these writes do not
 * apply: each opens (or adds to) a change to the file, and answers 202 with
 * the proposal. Before the move they apply at once, as they always have.
 */
const accepted = {
  response: S.PolicyProposal,
  description:
    'When the rules live in the policy file: the edit, as a change to the file that applies once it lands',
}

/** The proposal for one edit, when the rules live in the file; null before. */
const proposeIfMoved = (
  ctx: {
    params: { owner: string; repo: string }
    principal: Parameters<DomainPort['proposePolicy']>[2]
    dryRun: boolean
  },
  edit: ProposalEditBody,
) =>
  Effect.gen(function* () {
    const { run } = yield* Domain
    const { owner, repo } = ctx.params
    if (!(yield* run((d) => d.policyInFile(owner, repo, ctx.principal))))
      return null
    const prop = yield* run((d) =>
      d.proposePolicy(owner, repo, ctx.principal, [edit], ctx.dryRun),
    )
    // The operation's other answer (`accepted`), not its usual response.
    return reply(prop, {
      status: 202,
      headers: prop.url ? { location: prop.url } : {},
    }) as unknown as Reply<never>
  })

const write = {
  tags: ['changes'],
  auth: 'required' as const,
  scopes: ['repo:write' as const],
  pool: 'write' as const,
  safety: 'write' as const,
  idempotent: true,
  dryRun: true,
}

export const getPolicySet = defineOp({
  id: 'policy.rules',
  summary: "A repository's policy",
  description:
    'Its rules with their modes, what each applied to and held back, what a rule in dry run would block now, live exceptions, and the policy file they make.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/policy',
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  response: S.PolicySet,
  errors: ['not_found', 'moved'],
  probe: (ctx, d) =>
    d.policySetVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getPolicySet(ctx.params.owner, ctx.params.repo, ctx.principal),
      )
    }),
})

export const setRuleMode = defineOp({
  ...write,
  id: 'policy.update_rule',
  summary: 'Enforce a rule, dry-run it, or turn it off',
  description:
    "Every open change's requirements are worked out again, so a change can become landable, or stop being. When the policy lives in the repository, this proposes instead of applying: it answers `202` with a `PolicyProposal`, a change to the policy file that applies once it lands.",
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/policy/rules/{rule}',
  params: repoParams.extend({ rule: z.string().describe('The rule id') }),
  body: bodies['policy.update_rule'],
  response: S.PolicySet.shape.rules.element,
  accepted,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const proposed = yield* proposeIfMoved(ctx, {
        op: 'set_mode',
        rule: ctx.params.rule,
        mode: ctx.body.mode,
      })
      if (proposed) return proposed
      return yield* run((d) =>
        d.setRuleMode(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.rule,
          ctx.principal,
          ctx.body.mode,
          ctx.dryRun,
        ),
      )
    }),
})

export const addPolicyException = defineOp({
  ...write,
  idempotent: false,
  id: 'policy.add_exception',
  summary: 'Let a rule bend for one person, for a while',
  description:
    'Up to 90 days. For core-paths the person counts as a maintainer; for the other rules their own changes pass it. Send an `Idempotency-Key` to retry safely. When the policy lives in the repository, this proposes instead of applying: it answers `202` with a `PolicyProposal`, a change to the policy file that applies once it lands.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/policy/exceptions',
  params: repoParams,
  body: bodies['policy.add_exception'],
  response: S.PolicyException,
  status: 201,
  accepted,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const proposed = yield* proposeIfMoved(ctx, {
        op: 'add_exception',
        ...ctx.body,
      })
      if (proposed) return proposed
      const e = yield* run((d) =>
        d.addPolicyException(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(e, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const removePolicyException = defineOp({
  ...write,
  id: 'policy.remove_exception',
  summary: 'End an exception now',
  description:
    'When the policy lives in the repository, this proposes instead of applying: it answers `202` with a `PolicyProposal`, a change to the policy file that applies once it lands.',
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/policy/exceptions/{exception}',
  params: repoParams.extend({ exception: z.string() }),
  safety: 'destructive',
  response: z.null(),
  status: 204,
  accepted,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const proposed = yield* proposeIfMoved(ctx, {
        op: 'remove_exception',
        exception: ctx.params.exception,
      })
      if (proposed) return proposed
      yield* run((d) =>
        d.removePolicyException(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.exception,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const createRule = defineOp({
  ...write,
  id: 'policy.create_rule',
  summary: "Write a rule of the repository's own",
  description:
    "Three kinds. `required_check`: `check` has to pass on the tree that lands. `path_approval`: a change touching `paths` (globs, `**` crosses folders) needs `approvals` human approvals, from the people in `from` if given. `max_lines`: a change may add and remove at most `max_lines`. Sending the same `id` again replaces the rule. Every open change's requirements are worked out again. When the policy lives in the repository, this proposes instead of applying: it answers `202` with a `PolicyProposal`, a change to the policy file that applies once it lands.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/policy/rules',
  params: repoParams,
  body: bodies['policy.create_rule'],
  response: S.PolicySet.shape.rules.element,
  status: 201,
  accepted,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const proposed = yield* proposeIfMoved(ctx, {
        op: 'create_rule',
        ...ctx.body,
      })
      if (proposed) return proposed
      const out = yield* run((d) =>
        d.createRule(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(out.rule, {
        status: out.created && !ctx.dryRun ? 201 : 200,
        headers: { 'sx-outcome': out.created ? 'created' : 'updated' },
      })
    }),
})

export const deleteRule = defineOp({
  ...write,
  id: 'policy.delete_rule',
  summary: 'Delete a rule the repository wrote',
  description:
    'Its exceptions go with it. A built-in rule cannot be deleted; turn it off instead. When the policy lives in the repository, this proposes instead of applying: it answers `202` with a `PolicyProposal`, a change to the policy file that applies once it lands.',
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/policy/rules/{rule}',
  params: repoParams.extend({ rule: z.string().describe('The rule id') }),
  safety: 'destructive',
  response: z.null(),
  status: 204,
  accepted,
  errors: [
    'not_found',
    'forbidden',
    'invalid_state',
    'moved',
    'invalid_request',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const proposed = yield* proposeIfMoved(ctx, {
        op: 'delete_rule',
        rule: ctx.params.rule,
      })
      if (proposed) return proposed
      yield* run((d) =>
        d.deleteRule(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.rule,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const proposePolicy = defineOp({
  ...write,
  idempotent: false,
  id: 'policy.proposals.create',
  summary: 'Propose edits to the rules',
  description:
    "The edits, made to `.source/policy/main.yml` as a change: it keeps the file's comments and layout, puts the policy owners on review, and applies once it lands. Your open policy change takes further edits as patch sets, so you have one at a time. In a repository whose rules are still settings, the first proposal moves them into the file. A dry run answers the diff and opens nothing. Send an `Idempotency-Key` to retry safely.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/policy/proposals',
  params: repoParams,
  body: bodies['policy.proposals.create'],
  response: S.PolicyProposal,
  status: 202,
  errors: [
    'not_found',
    'forbidden',
    'moved',
    'invalid_request',
    'invalid_state',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const prop = yield* run((d) =>
        d.proposePolicy(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body.edits,
          ctx.dryRun,
        ),
      )
      return reply(prop, {
        status: 202,
        headers: prop.url ? { location: prop.url } : {},
      })
    }),
})

export const landability = defineOp({
  id: 'changes.landability',
  summary: 'What stops a change from landing',
  description:
    "Each failed or pending requirement and each landing step it waits on, with why, and how it will land (the policy file's `landing:`). `tree` is what to send as `expected_tree`.",
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/landability',
  auth: 'optional',
  scopes: ['pulls:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: changeParams,
  response: S.Landability,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.landability(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
    }),
})

export const policyRuleOps = [
  proposePolicy,
  landability,
  getPolicySet,
  setRuleMode,
  createRule,
  deleteRule,
  addPolicyException,
  removePolicyException,
]
