import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import type { Reply } from '../registry'
import * as S from '../schemas'
import { changeMarkdown } from '../markdown'
import {
  afterOf,
  changeParams,
  expandSchema,
  fp,
  listOf,
  pageShape,
  repoParams,
} from './common'

const write = {
  auth: 'required' as const,
  pool: 'write' as const,
  safety: 'write' as const,
  dryRun: true,
  idempotent: false,
}
const read = {
  auth: 'optional' as const,
  scopes: ['pulls:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
}

const expandChange = ['repo', 'findings', 'check_runs']
const states = ['draft', 'open', 'landed', 'abandoned', 'all']
const topic = async (
  p: { owner: string; repo: string },
  d?: {
    repoIdForHistory?: (full: string) => string | null | Promise<string | null>
  },
) => {
  const id = await d?.repoIdForHistory?.(`${p.owner}/${p.repo}`)
  if (id) return `repo-id:${id}`
  const owner = p.owner.toLowerCase()
  return owner.startsWith('rep_')
    ? `repo-id:${owner}`
    : `repo:${owner}/${p.repo.toLowerCase()}`
}

const list = <T extends z.ZodType>(item: T) => S.listOf(item)

export const listChanges = defineOp({
  ...read,
  id: 'changes.list',
  summary: 'Changes in a repository',
  description:
    'Open and draft changes by default, most recently updated first. Each change carries its checks and policy rollups, so one request is enough to show a list with CI and policy state.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes',
  params: repoParams,
  query: z.strictObject({
    ...pageShape,
    state: z
      .string()
      .optional()
      .refine((v) => !v || v.split(',').every((s) => states.includes(s)), {
        message: `Use a comma list of: ${states.join(', ')}.`,
      })
      .describe('Comma list. Default: open,draft'),
    author: z.string().optional().describe('Handle of the author'),
    label: z.string().optional().describe('A label name'),
    branch: z
      .string()
      .optional()
      .describe('The branch the change was made from'),
    sort: z
      .enum(['-updated_at', 'updated_at', '-number', 'number'])
      .default('-updated_at'),
    expand: expandSchema(expandChange),
  }),
  response: list(S.Change),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  shapeable: true,
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.changeListVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      const f = fp(
        'changes.list',
        ctx.params.owner,
        ctx.params.repo,
        q.state,
        q.author,
        q.label,
        q.branch,
        q.sort,
        q.expand,
      )
      const sort = q.sort.replace('-', '') as 'updated_at' | 'number'
      const page = yield* run((d) =>
        d.listChanges(ctx.params.owner, ctx.params.repo, ctx.principal, {
          state: q.state,
          author: q.author,
          label: q.label,
          branch: q.branch,
          sort,
          desc: q.sort.startsWith('-'),
          after: afterOf(q.cursor, f),
          limit: q.limit,
          expand: q.expand ? q.expand.split(',') : [],
        }),
      )
      // The items are already JSON text; the pipeline joins them without parsing.
      return listOf(
        page.items as unknown as Array<z.infer<typeof S.Change>>,
        page.next,
        f,
      )
    }),
})

export const getChange = defineOp({
  ...read,
  id: 'changes.get',
  summary: 'One change',
  description:
    'A change is addressed by its number or its id. The object says what you may do next in `actions`. Send If-None-Match to get 304 when nothing changed, and add ?wait=20 to hold the request until it does.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}',
  params: changeParams,
  query: z.strictObject({ expand: expandSchema(expandChange) }),
  response: S.Change,
  errors: ['not_found', 'moved'],
  shapeable: true,
  markdown: changeMarkdown,
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.changeVersion(
      ctx.params.owner,
      ctx.params.repo,
      ctx.params.number,
      ctx.principal,
      ctx.query.expand?.split(',') ?? [],
    ),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getChange(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.query.expand?.split(',') ?? [],
        ),
      )
    }),
})

export const createChange = defineOp({
  ...write,
  id: 'changes.create',
  summary: 'Create a change from a branch',
  description:
    'Naturally idempotent: asking again for a branch that already has an open change adds a patch set, or returns the same change when the branch did not move. `Sx-Outcome` says which: created, patch_set_added or unchanged.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes',
  params: repoParams,
  scopes: ['pulls:write'],
  idempotent: true,
  body: z.strictObject({
    branch: z.string().min(1),
    base: z.string().optional(),
    title: z.string().max(300).optional(),
    description: z.string().max(65536).optional(),
    draft: z.boolean().optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    message: z
      .string()
      .max(65536)
      .optional()
      .describe(
        "The head commit's message. A `Run-Id:` trailer in it names the run that made the commit, when the token is not that run's own",
      ),
    addresses: z
      .array(
        z.strictObject({
          comment: z.string().describe('The `cmt_` id that starts a thread'),
          note: z.string().max(2000).optional(),
        }),
      )
      .max(100)
      .optional()
      .describe(
        'When this adds a patch set: the review threads it answers, marked in the same write',
      ),
  }),
  response: S.Change,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createChange(ctx.params.owner, ctx.params.repo, ctx.principal, {
          ...ctx.body,
          dry_run: ctx.dryRun,
        }),
      )
      return reply(r.change, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: {
          'sx-outcome': r.outcome,
          ...(r.outcome === 'created' ? { location: r.change.url } : {}),
        },
      })
    }),
})

export const updateChange = defineOp({
  ...write,
  id: 'changes.update',
  summary: 'Edit title, description or labels',
  description:
    'Send If-Match with the ETag you read to avoid overwriting someone else’s edit.',
  tags: ['changes'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/changes/{number}',
  params: changeParams,
  scopes: ['pulls:write'],
  idempotent: true,
  ifMatch: true,
  body: z.strictObject({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(65536).optional(),
    labels: z.array(z.string().max(50)).max(50).optional(),
  }),
  response: S.Change,
  errors: ['not_found', 'forbidden', 'version_mismatch', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateChange(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.ifMatch,
          ctx.dryRun,
        ),
      )
    }),
})

export const listPatchSets = defineOp({
  ...read,
  id: 'patch_sets.list',
  summary: 'Patch sets of a change, oldest first',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/patch-sets',
  params: changeParams,
  response: S.listOf(S.PatchSet),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listPatchSets(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const getPatchSet = defineOp({
  ...read,
  id: 'patch_sets.get',
  summary: 'One patch set',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/patch-sets/{patchSet}',
  params: changeParams.extend({
    patchSet: z.coerce.number().int().min(1).describe('Patch set number'),
  }),
  response: S.PatchSet,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getPatchSet(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.patchSet,
          ctx.principal,
        ),
      )
    }),
})

export const createPatchSet = defineOp({
  ...write,
  id: 'patch_sets.create',
  summary: 'Add a patch set',
  description:
    '`kind: rebase` says the code did not change, so approvals and evidence carry over. `kind: update` says it did, so earlier approvals stop counting for the new head.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/patch-sets',
  params: changeParams,
  scopes: ['pulls:write'],
  body: z.strictObject({
    sha: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional()
      .describe('The commit. Required unless `files` is sent'),
    kind: z.enum(['update', 'rebase']).default('update'),
    note: z.string().max(500).optional(),
    files: z
      .record(z.string().max(500), z.string().max(1_000_000).nullable())
      .optional()
      .describe(
        'Edited files, whole, by path; null deletes. Only files the change already touches. The patch set is the head with these on top, and its commit id is a hash of the result',
      ),
    addresses: z
      .array(
        z.strictObject({
          comment: z.string().describe('The `cmt_` id that starts a thread'),
          note: z.string().max(2000).optional().describe('What changed'),
        }),
      )
      .max(100)
      .optional()
      .describe(
        'Review threads this patch set answers. They are marked addressed in the same write and their authors are told; they stay open until someone resolves them',
      ),
  }),
  response: S.PatchSet,
  status: 201,
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
      const ps = yield* run((d) =>
        d.addPatchSet(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(ps, { status: 201, headers: { location: ps.url } })
    }),
})

export const patchSetFiles = defineOp({
  ...read,
  id: 'patch_sets.files',
  summary: 'The files of a patch set, whole',
  description:
    'Every file the change touches, on the base and at this patch set, to draw a diff from or edit. `available` is false when the change came without its files.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/patch-sets/{patchSet}/files',
  params: changeParams.extend({
    patchSet: z.coerce.number().int().min(1).describe('Patch set number'),
  }),
  pool: 'heavy',
  response: S.PatchSetFiles,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getPatchSetFiles(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.patchSet,
          ctx.principal,
        ),
      )
    }),
})

export const comparePatchSets = defineOp({
  ...read,
  id: 'patch_sets.compare',
  summary: 'What changed between two patch sets',
  description:
    'The files that differ between patch sets, so a reviewer who read patch set 2 reads only what is new in 3. Unchanged files are counted, not listed.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/compare',
  params: changeParams,
  pool: 'heavy',
  cost: 2,
  query: z.strictObject({
    from: z.coerce
      .number()
      .int()
      .min(1)
      .describe('Patch set number to compare from'),
    to: z.coerce
      .number()
      .int()
      .min(1)
      .describe('Patch set number to compare to'),
  }),
  response: S.PatchSetComparison,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.comparePatchSets(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.query.from,
          ctx.query.to,
          ctx.principal,
        ),
      )
    }),
})

export const createReview = defineOp({
  ...write,
  id: 'reviews.create',
  summary: 'Approve, comment or ask for changes',
  description:
    'An approval is tied to a patch set and says whether it still holds for the head. Approving your own change is refused: with human_required for an agent, forbidden for a person.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/reviews',
  params: changeParams,
  scopes: ['pulls:comment'],
  body: z.strictObject({
    state: z.enum(['approved', 'commented', 'changes']),
    body: z.string().max(65536).optional(),
    patch_set: z.number().int().min(1).optional(),
  }),
  response: S.Review,
  status: 201,
  errors: [
    'not_found',
    'forbidden',
    'human_required',
    'invalid_state',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.review(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r, { status: 201 })
    }),
})

export const listFindings = defineOp({
  ...read,
  id: 'findings.list',
  summary: 'Findings left by reviewers',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/findings',
  params: changeParams,
  query: z.strictObject({
    state: z.enum(['open', 'resolved', 'dismissed', 'all']).default('all'),
  }),
  response: S.listOf(S.Finding),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listFindings(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.query.state,
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

const findingParams = changeParams.extend({
  finding: z
    .string()
    .describe('The finding `fnd_` id, or its label such as F-2'),
})

export const raiseFinding = defineOp({
  ...write,
  id: 'findings.create',
  summary: 'Raise a finding on a line',
  description:
    'For a reviewer, person or bot: a problem on a line of the newest patch set, with an optional suggestion to apply in one step and the same fix as a prompt for an agent. It gets the next label (F-1, F-2, …). An open high finding holds the change back. Automations listening for `finding.raised` wake up. Send an `Idempotency-Key` to retry safely.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/findings',
  params: changeParams,
  scopes: ['pulls:comment'],
  body: z.strictObject({
    severity: z.enum(['high', 'medium', 'low']),
    file: z.string().min(1).max(1000),
    line: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(65536).optional(),
    suggestion: z
      .strictObject({
        summary: z.string().max(200),
        file: z.string(),
        replace: z.array(z.string()).max(500),
        after: z.string().nullable().default(null),
        lines: z.array(z.string()).max(500),
      })
      .optional(),
    prompt: z.string().max(10000).optional(),
  }),
  response: S.Finding,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = yield* run((d) =>
        d.raiseFinding(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(f, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const resolveFinding = defineOp({
  ...write,
  id: 'findings.resolve',
  summary: 'Mark a finding resolved',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/findings/{finding}/resolve',
  params: findingParams,
  scopes: ['pulls:comment'],
  idempotent: true,
  response: S.Finding,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.setFinding(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.finding,
          ctx.principal,
          'resolved',
          null,
          ctx.dryRun,
        ),
      )
    }),
})

export const dismissFinding = defineOp({
  ...write,
  id: 'findings.dismiss',
  summary: 'Dismiss a finding with a reason',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/findings/{finding}/dismiss',
  params: findingParams,
  scopes: ['pulls:comment'],
  idempotent: true,
  body: bodies['findings.dismiss'],
  response: S.Finding,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.setFinding(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.finding,
          ctx.principal,
          'dismissed',
          ctx.body.reason,
          ctx.dryRun,
        ),
      )
    }),
})

export const listChecks = defineOp({
  ...read,
  id: 'checks.list',
  summary: 'Check runs reported on a change',
  tags: ['changes', 'ci'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/checks',
  params: changeParams,
  response: S.listOf(S.CheckRun),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listChecks(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const reportCheck = defineOp({
  ...write,
  id: 'checks.report',
  summary: 'Report a check run',
  description:
    'CI and runners report here with the `tree` they ran on. The same `key` on the same tree updates one run; `Sx-Outcome` says created, updated or unchanged. A result for an older tree is stored but does not count for the head.',
  tags: ['changes', 'ci'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/checks',
  params: changeParams,
  scopes: ['pulls:write'],
  idempotent: true,
  body: z.strictObject({
    key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/),
    state: z.enum(['pending', 'pass', 'fail']),
    tree: z.string().regex(/^[0-9a-f]{7,40}$/),
    name: z.string().max(200).optional(),
    details_url: z
      .url()
      .refine((v) => /^https?:\/\//i.test(v), {
        message: 'Use an http or https URL.',
      })
      .optional(),
    cases: z
      .array(S.TestCase)
      .max(5000)
      .optional()
      .describe('Test results case by case, to show beside the check'),
  }),
  response: S.CheckRun,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.reportCheck(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r.check, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: { 'sx-outcome': r.outcome },
      })
    }),
})

export const getPolicy = defineOp({
  ...read,
  id: 'policy.get',
  summary: 'Each policy requirement for a change',
  description:
    'Every requirement, its state, and what would satisfy it. The same answer as `sx policy explain`.',
  tags: ['policy'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/policy',
  params: changeParams,
  response: S.PolicyEvaluation,
  errors: ['not_found', 'moved'],
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.changeVersion(
      ctx.params.owner,
      ctx.params.repo,
      String(ctx.params.number),
      ctx.principal,
    ),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.policy(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
    }),
})

export const simulatePolicy = defineOp({
  ...read,
  id: 'policy.simulate',
  summary: 'Ask what policy would say if something were true',
  description:
    'Plan before acting: “if hollis approves and ci/test passes, can this land?” Nothing is written. `assumed` in the answer repeats what was assumed.',
  tags: ['policy', 'agents'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/policy/simulate',
  params: changeParams,
  auth: 'required',
  scopes: ['pulls:read'],
  body: z.strictObject({
    approve: z.array(z.string()).max(20).optional(),
    checks: z
      .record(z.string(), z.enum(['pending', 'pass', 'fail']))
      .optional(),
    resolve: z.array(z.string()).max(100).optional(),
  }),
  response: S.PolicyEvaluation,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.policy(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
        ),
      )
    }),
})

export const landChange = defineOp({
  ...write,
  id: 'changes.land',
  summary: 'Land a change',
  description:
    'Lands exactly the tree you name. If the change moved, it is stale_head. If policy blocks, it is policy_blocked with every requirement; `retryable` is true only when nothing has failed and the rest is waiting. When the policy file has landing steps after the change lands, it answers `202` with the operation that lands it and runs them.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/land',
  params: changeParams,
  scopes: ['pulls:merge'],
  safety: 'destructive',
  body: z.strictObject({ expected_tree: z.string().regex(/^[0-9a-f]{7,40}$/) }),
  response: S.Change,
  accepted: {
    response: S.Operation,
    description:
      'When the policy file has landing steps after the change lands (`run_pipeline`, `webhook`): the operation that lands it and runs them, one step at a time. Poll its `url`',
  },
  errors: [
    'not_found',
    'forbidden',
    'stale_head',
    'policy_blocked',
    'parent_not_landed',
    'invalid_state',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run((d) =>
        d.land(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      if (!('operation' in out)) return out
      // The operation's other answer (`accepted`), not its usual response.
      return reply(out.operation, {
        status: 202,
        headers: { location: out.operation.url },
      }) as unknown as Reply<never>
    }),
})

const transitionOp = (
  action: 'ready' | 'abandon' | 'restore',
  summary: string,
  safety: 'write' | 'destructive',
) =>
  defineOp({
    ...write,
    id: `changes.${action === 'ready' ? 'mark_ready' : action}`,
    summary,
    tags: ['changes'],
    method: 'POST',
    path: `/repos/{owner}/{repo}/changes/{number}/${action === 'ready' ? 'ready' : action}`,
    params: changeParams,
    scopes: ['pulls:write'],
    safety,
    idempotent: false,
    response: S.Change,
    errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
    handler: (ctx) =>
      Effect.gen(function* () {
        const { run } = yield* Domain
        return yield* run((d) =>
          d.transition(
            ctx.params.owner,
            ctx.params.repo,
            ctx.params.number,
            ctx.principal,
            action,
            ctx.dryRun,
          ),
        )
      }),
  })

export const markReady = transitionOp(
  'ready',
  'Take a draft out of draft',
  'write',
)
export const abandonChange = transitionOp(
  'abandon',
  'Abandon a change',
  'destructive',
)
export const restoreChange = transitionOp(
  'restore',
  'Reopen an abandoned change',
  'write',
)

export const landStack = defineOp({
  ...write,
  id: 'stacks.land',
  summary: 'Land a stack, bottom first',
  description:
    'Returns 202 and an operation. Children are rebased onto what landed and keep their approvals because their trees do not change. Send the tree you expect for each change, by number.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/stacks/{stack}/land',
  params: repoParams.extend({
    stack: z
      .string()
      .describe('The stack `stk_` id, from the `stack` member of a change'),
  }),
  scopes: ['pulls:merge'],
  safety: 'destructive',
  mayBeAsync: true,
  body: z.strictObject({ expected_trees: z.record(z.string(), z.string()) }),
  response: S.Operation,
  status: 202,
  errors: [
    'not_found',
    'forbidden',
    'stale_head',
    'parent_not_landed',
    'policy_blocked',
    'invalid_state',
    'invalid_request',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const op = yield* run((d) =>
        d.landStack(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.stack,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(op, {
        status: 202,
        headers: { location: op.url, 'retry-after': '1' },
      })
    }),
})

const reviewCommentParams = changeParams.extend({
  comment: z.string().describe('The comment `cmt_` id'),
})

export const listReviewComments = defineOp({
  ...read,
  id: 'change_comments.list',
  summary: 'Review comments on a change',
  description:
    'Oldest first: comments on a line, on a file and on the whole change, with replies after the comment that starts their thread. `unresolved=true` keeps the threads still open.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/comments',
  params: changeParams,
  query: z.strictObject({
    file: z.string().optional().describe('Only comments on this file'),
    unresolved: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional()
      .describe('Only threads that are still open'),
  }),
  response: S.listOf(S.ChangeComment),
  errors: ['not_found', 'moved'],
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.reviewCommentsVersion(
      ctx.params.owner,
      ctx.params.repo,
      ctx.params.number,
      ctx.principal,
    ),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listReviewComments(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.query,
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const createReviewComment = defineOp({
  ...write,
  id: 'change_comments.create',
  summary: 'Comment on a line, a file or a change',
  description:
    'Give `file` and `line` for a line, `file` alone for a file, neither for the whole change; it is written against `patch_set`, the newest by default. `reply_to` answers a comment in its thread and takes its place, and reopens the thread if it was settled. Anyone who can read the repository may comment. Not idempotent by nature: send an `Idempotency-Key` to retry safely.',
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/comments',
  scopes: ['pulls:write'],
  params: changeParams,
  body: bodies['change_comments.create'],
  response: S.ChangeComment,
  status: 201,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const c = yield* run((d) =>
        d.createReviewComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(c, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const addressReviewComment = defineOp({
  ...write,
  idempotent: true,
  id: 'change_comments.address',
  summary: 'Say which patch set answers a review thread',
  description:
    "Links a fix to the comment it answers. The thread's author is told, and the change page can show what changed in that comment's file between the patch set it was written on and the fix. It does not resolve the thread. Send `addresses` with a new patch set to push a fix and mark its threads in one write.",
  tags: ['changes'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/comments/{comment}/address',
  scopes: ['pulls:write'],
  params: reviewCommentParams,
  body: z.strictObject({
    patch_set: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The patch set with the fix. Default: the newest'),
    note: z.string().max(2000).optional().describe('What changed'),
  }),
  response: S.ChangeComment,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.addressReviewComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.comment,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const updateReviewComment = defineOp({
  ...write,
  idempotent: true,
  id: 'change_comments.update',
  summary: 'Edit a review comment, or settle its thread',
  description:
    "`body` is its author's to change. `resolved` goes on the comment that starts a thread, from the person who started it, the change's author or anyone who can change the repository.",
  tags: ['changes'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/changes/{number}/comments/{comment}',
  scopes: ['pulls:write'],
  params: reviewCommentParams,
  body: bodies['change_comments.update'],
  response: S.ChangeComment,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateReviewComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.comment,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const deleteReviewComment = defineOp({
  ...write,
  idempotent: true,
  safety: 'destructive',
  id: 'change_comments.delete',
  summary: 'Delete a review comment',
  description:
    'Its author, or anyone who can change the repository. Deleting the comment that starts a thread deletes its replies.',
  tags: ['changes'],
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/changes/{number}/comments/{comment}',
  scopes: ['pulls:write'],
  params: reviewCommentParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.deleteReviewComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.params.comment,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const getGuide = defineOp({
  ...read,
  id: 'changes.guide.get',
  summary: "A change's guide",
  description:
    'What the change does and the order to read its files in, each with why and how risky. `current` is false when it was written for an older patch set.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/guide',
  params: changeParams,
  response: S.ChangeGuide,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getGuide(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
    }),
})

export const putGuide = defineOp({
  ...write,
  idempotent: true,
  id: 'changes.guide.put',
  summary: 'Write the guide for a change',
  description:
    "For the agent or person who knows the change best: a summary and every file worth reading, in order, with why and how risky. It replaces the guide there was, and says which run wrote it when a run token wrote it. The change page's files follow its order.",
  tags: ['changes'],
  method: 'PUT',
  path: '/repos/{owner}/{repo}/changes/{number}/guide',
  scopes: ['pulls:write'],
  params: changeParams,
  body: bodies['changes.guide.put'],
  response: S.ChangeGuide,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.putGuide(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

const seenBase = {
  auth: 'required' as const,
  scopes: ['pulls:read' as const],
  tags: ['changes'],
  params: changeParams,
  response: S.ChangeSeen,
}

export const getSeen = defineOp({
  ...seenBase,
  id: 'changes.seen.get',
  summary: 'Which files of a change you have seen',
  description:
    'Yours alone. A file counts as seen while it is the same as when you marked it; a newer patch set that changes it says `changed_since` instead.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/seen',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run((d) =>
        d.changeSeen(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal!,
        ),
      )
      return reply(out, { headers: { 'cache-control': 'private, no-store' } })
    }),
})

export const putSeen = defineOp({
  ...seenBase,
  id: 'changes.seen.put',
  summary: 'Mark files of a change as seen',
  description:
    'For a reviewer working through a change file by file, and for an agent or the CLI keeping track the same way. The mark is yours alone and changes nothing anyone else sees. It holds for the files as they are at the newest patch set.',
  method: 'PUT',
  path: '/repos/{owner}/{repo}/changes/{number}/seen',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: bodies['changes.seen.put'],
  errors: ['not_found', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.setSeen(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal!,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const changeOps = [
  getGuide,
  putGuide,
  getSeen,
  putSeen,
  patchSetFiles,
  listChanges,
  getChange,
  createChange,
  updateChange,
  listPatchSets,
  getPatchSet,
  createPatchSet,
  comparePatchSets,
  createReview,
  listReviewComments,
  createReviewComment,
  addressReviewComment,
  updateReviewComment,
  deleteReviewComment,
  listFindings,
  raiseFinding,
  resolveFinding,
  dismissFinding,
  listChecks,
  reportCheck,
  getPolicy,
  simulatePolicy,
  landChange,
  markReady,
  abandonChange,
  restoreChange,
  landStack,
]
