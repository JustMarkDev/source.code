import { Effect } from 'effect'
import { z } from 'zod'
import { allScopes } from '../auth'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const runParams = repoParams.extend({ id: z.string().describe('The run `run_` id') })

const read = {
  auth: 'optional' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
  tags: ['runs'],
}
// The run's own token carries repo:read, so it can report on itself.
const report = {
  auth: 'required' as const,
  scopes: ['repo:read' as const],
  pool: 'write' as const,
  safety: 'write' as const,
  dryRun: true,
  tags: ['runs'],
}

export const startRun = defineOp({
  id: 'runs.start',
  secretResponse: true,
  summary: 'Start a run and get a token for it',
  description:
    'A run is one bounded piece of work by an agent. Starting one mints a token limited to this repository, with only the scopes asked for (never more than yours, never `tokens:manage`), that stops working when the run ends or after `ttl_minutes`. The token is in the response once. Give it to the agent and keep your own. Everything the agent does is attributed to you as an agent. At most 20 runs may be going at once.',
  tags: ['runs'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs',
  auth: 'required',
  scopes: ['repo:write', 'tokens:manage'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  dryRun: true,
  params: repoParams,
  body: z.strictObject({
    task: z.string().min(1).max(500).describe('What the run is for, in a sentence'),
    change: z.number().int().min(1).optional().describe('The change it works on'),
    scopes: z.array(z.enum(allScopes)).max(allScopes.length).optional().describe('Default: read, comment on issues and changes, read the env schema'),
    ttl_minutes: z.number().int().min(1).max(240).default(60),
  }),
  response: S.Run,
  status: 201,
  errors: ['not_found', 'forbidden', 'insufficient_scope', 'limit_reached', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) => d.startRun(ctx.params.owner, ctx.params.repo, ctx.principal!, ctx.body, ctx.dryRun))
      return reply(r.run, { status: 201, headers: { location: r.run.url, 'cache-control': 'no-store' } })
    }),
})

export const listRuns = defineOp({
  ...read,
  id: 'runs.list',
  summary: "A repository's runs, newest first",
  method: 'GET',
  path: '/repos/{owner}/{repo}/runs',
  params: repoParams,
  query: z.strictObject({
    ...pageShape,
    state: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'expired']).optional(),
  }),
  response: S.listOf(S.Run),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp('runs.list', ctx.params.owner, ctx.params.repo, ctx.query.state)
      const page = yield* run((d) =>
        d.listRuns(ctx.params.owner, ctx.params.repo, ctx.principal, { state: ctx.query.state, after: afterOf(ctx.query.cursor, f), limit: ctx.query.limit }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const getRun = defineOp({
  ...read,
  id: 'runs.get',
  summary: 'One run',
  method: 'GET',
  path: '/repos/{owner}/{repo}/runs/{id}',
  params: runParams,
  response: S.Run,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getRun(ctx.params.owner, ctx.params.repo, ctx.params.id, ctx.principal))
    }),
})

export const noteRun = defineOp({
  ...report,
  id: 'runs.note',
  summary: 'Say what the run is doing',
  description: 'A line of progress for whoever is watching. The last 50 are kept. Not idempotent: sending a line twice adds it twice.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs/{id}/notes',
  idempotent: false,
  params: runParams,
  body: z.strictObject({ text: z.string().min(1).max(500) }),
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.noteRun(ctx.params.owner, ctx.params.repo, ctx.params.id, ctx.principal!, ctx.body.text, ctx.dryRun))
    }),
})

export const finishRun = defineOp({
  ...report,
  id: 'runs.finish',
  summary: 'End a run with its outcome',
  description: "The run's token stops working. Repeating it with the same outcome returns the run unchanged, so a retry is safe. Ending a run that already ended some other way answers `invalid_state`.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs/{id}/finish',
  idempotent: true,
  params: runParams,
  body: z.strictObject({ state: z.enum(['succeeded', 'failed']), summary: z.string().max(2000).optional() }),
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.endRun(ctx.params.owner, ctx.params.repo, ctx.params.id, ctx.principal!, ctx.body.state, ctx.body.summary, ctx.dryRun),
      )
    }),
})

export const cancelRun = defineOp({
  ...report,
  id: 'runs.cancel',
  summary: 'Stop a run',
  description: 'The person who started it, or an admin of the account, can stop a run at any moment. Its token stops working at once.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs/{id}/cancel',
  safety: 'destructive',
  idempotent: true,
  params: runParams,
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.endRun(ctx.params.owner, ctx.params.repo, ctx.params.id, ctx.principal!, 'cancelled', undefined, ctx.dryRun))
    }),
})

export const runOps = [startRun, listRuns, getRun, noteRun, finishRun, cancelRun]
