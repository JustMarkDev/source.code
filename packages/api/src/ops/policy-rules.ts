import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { repoParams } from './common'

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
    "Every open change's requirements are worked out again, so a change can become landable, or stop being.",
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/policy/rules/{rule}',
  params: repoParams.extend({ rule: z.string().describe('The rule id') }),
  body: bodies['policy.update_rule'],
  response: S.PolicySet.shape.rules.element,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
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
    'Up to 90 days. For core-paths the person counts as a maintainer; for the other rules their own changes pass it. Send an `Idempotency-Key` to retry safely.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/policy/exceptions',
  params: repoParams,
  body: bodies['policy.add_exception'],
  response: S.PolicyException,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
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
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/policy/exceptions/{exception}',
  params: repoParams.extend({ exception: z.string() }),
  safety: 'destructive',
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
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
    "Three kinds. `required_check`: `check` has to pass on the tree that lands. `path_approval`: a change touching `paths` (globs, `**` crosses folders) needs `approvals` human approvals, from the people in `from` if given. `max_lines`: a change may add and remove at most `max_lines`. Sending the same `id` again replaces the rule. Every open change's requirements are worked out again.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/policy/rules',
  params: repoParams,
  body: bodies['policy.create_rule'],
  response: S.PolicySet.shape.rules.element,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
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
    'Its exceptions go with it. A built-in rule cannot be deleted; turn it off instead.',
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/policy/rules/{rule}',
  params: repoParams.extend({ rule: z.string().describe('The rule id') }),
  safety: 'destructive',
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
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

export const policyRuleOps = [
  getPolicySet,
  setRuleMode,
  createRule,
  deleteRule,
  addPolicyException,
  removePolicyException,
]
