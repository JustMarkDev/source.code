import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const runParams = repoParams.extend({
  run: z.coerce.number().int().min(1).describe('The run number'),
})
const read = {
  tags: ['pipelines'],
  auth: 'optional' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
}
const write = {
  tags: ['pipelines'],
  auth: 'required' as const,
  scopes: ['repo:write' as const],
  pool: 'write' as const,
  safety: 'write' as const,
  dryRun: true,
}

export const listPipelineRuns = defineOp({
  ...read,
  id: 'pipelines.list',
  summary: 'Pipeline runs in a repository',
  description:
    'Newest first. Each is a workflow run; a check on a change is the result of one.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/pipelines',
  params: repoParams,
  query: z.strictObject({
    ...pageShape,
    status: z
      .enum(['queued', 'running', 'success', 'failure', 'canceled'])
      .optional(),
    workflow: z.string().max(100).optional(),
  }),
  response: S.listOf(S.PipelineRun),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  probe: (ctx, d) =>
    d.pipelinesVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp(
        'pipelines.list',
        ctx.params.owner,
        ctx.params.repo,
        ctx.query.status,
        ctx.query.workflow,
      )
      const page = yield* run((d) =>
        d.listPipelineRuns(ctx.params.owner, ctx.params.repo, ctx.principal, {
          status: ctx.query.status,
          workflow: ctx.query.workflow,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const getPipelineRun = defineOp({
  ...read,
  id: 'pipelines.get',
  summary: 'One pipeline run, with its jobs and steps',
  description: 'Each step links to its log.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/pipelines/{run}',
  params: runParams,
  response: S.PipelineRun,
  errors: ['not_found', 'moved'],
  probe: (ctx, d) =>
    d.pipelinesVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getPipelineRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.run,
          ctx.principal,
        ),
      )
    }),
})

export const getPipelineLog = defineOp({
  ...read,
  id: 'pipelines.log',
  summary: 'The log of one step',
  description:
    'Jobs and steps are numbered from 1, in the order the run lists them.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/pipelines/{run}/jobs/{job}/steps/{step}/log',
  params: runParams.extend({
    job: z.coerce.number().int().min(1),
    step: z.coerce.number().int().min(1),
  }),
  pool: 'heavy',
  response: S.PipelineLog,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getPipelineLog(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.run,
          ctx.params.job,
          ctx.params.step,
          ctx.principal,
        ),
      )
    }),
})

export const startPipeline = defineOp({
  ...write,
  id: 'pipelines.start',
  summary: 'Start a workflow',
  description:
    'Queues a run of a workflow that has run before, on the newest commit of `branch` (the default branch if left out), for a runner to claim. Not idempotent by nature: send an `Idempotency-Key` to retry safely.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/pipelines',
  idempotent: false,
  params: repoParams,
  body: z.strictObject({
    workflow: z.string().min(1).max(100),
    branch: z.string().min(1).max(200).optional(),
  }),
  response: S.PipelineRun,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.startPipeline(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const claimPipelineJob = defineOp({
  ...write,
  dryRun: false,
  id: 'pipelines.claim',
  summary: 'Take the next queued job, as a runner',
  description:
    "The oldest queued job in the repository, now running on `runner`. Answers `204` when nothing is waiting. The runner reads the workflow file at `sha`, runs the job's steps, and reports each one.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/pipelines/claim',
  idempotent: false,
  params: repoParams,
  body: z.strictObject({
    runner: z
      .string()
      .min(1)
      .max(100)
      .describe("The runner's name, shown on the job"),
  }),
  response: S.PipelineJob,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const j = yield* run((d) =>
        d.claimPipelineJob(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
        ),
      )
      return j ?? reply(null as never, { status: 204 })
    }),
})

export const reportPipelineStep = defineOp({
  ...write,
  dryRun: false,
  id: 'pipelines.report',
  summary: 'Report how a step went, as a runner',
  description:
    'Send `running` when it starts, then `success`, `failure` or `skipped`, with the log lines it wrote (5,000 kept a step). A failure skips the rest of the job. When every step of a job is done the job is, and when every job is done the run is.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/pipelines/{run}/jobs/{job}/steps/{step}',
  idempotent: false,
  params: runParams.extend({
    job: z.coerce.number().int().min(1),
    step: z.coerce.number().int().min(1),
  }),
  body: z.strictObject({
    status: z.enum(['running', 'success', 'failure', 'skipped']),
    lines: z
      .array(
        z.strictObject({
          text: z.string().max(4000),
          level: z
            .enum(['cmd', 'info', 'ok', 'warn', 'error'])
            .nullable()
            .optional(),
        }),
      )
      .max(1000)
      .optional(),
    duration_ms: z.number().int().min(0).optional(),
  }),
  response: S.PipelineRun,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.reportPipelineStep(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.run,
          ctx.params.job,
          ctx.params.step,
          ctx.principal,
          ctx.body,
        ),
      )
    }),
})

export const rerunPipeline = defineOp({
  ...write,
  id: 'pipelines.rerun',
  summary: 'Run a workflow again',
  description:
    'A new run of the same workflow on the same commit, queued for a runner. Not idempotent by nature: send an `Idempotency-Key` to retry safely.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/pipelines/{run}/rerun',
  idempotent: false,
  params: runParams,
  response: S.PipelineRun,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.rerunPipeline(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.run,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(r, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const cancelPipeline = defineOp({
  ...write,
  id: 'pipelines.cancel',
  summary: 'Cancel a run',
  description:
    'Only a queued or running one. Steps not yet finished are canceled.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/pipelines/{run}/cancel',
  idempotent: true,
  params: runParams,
  response: S.PipelineRun,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.cancelPipeline(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.run,
          ctx.principal,
          ctx.dryRun,
        ),
      )
    }),
})

export const pipelineOps = [
  listPipelineRuns,
  startPipeline,
  claimPipelineJob,
  reportPipelineStep,
  getPipelineRun,
  getPipelineLog,
  rerunPipeline,
  cancelPipeline,
]
