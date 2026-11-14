import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { apiError } from '../problem'
import { redactTranscript, transcriptUpload } from '../transcripts'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const runParams = repoParams.extend({
  id: z.string().describe('The run `run_` id'),
})

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
  body: bodies['runs.start'],
  response: S.Run,
  status: 201,
  errors: [
    'not_found',
    'forbidden',
    'insufficient_scope',
    'limit_reached',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.startRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal!,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r.run, {
        status: 201,
        headers: { location: r.run.url, 'cache-control': 'no-store' },
      })
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
    state: z
      .enum(['running', 'succeeded', 'failed', 'cancelled', 'expired'])
      .optional(),
    actor: z
      .string()
      .optional()
      .describe('Only runs of this agent or bot, such as the one asking'),
  }),
  response: S.listOf(S.Run),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp(
        'runs.list',
        ctx.params.owner,
        ctx.params.repo,
        ctx.query.state,
        ctx.query.actor,
      )
      const page = yield* run((d) =>
        d.listRuns(ctx.params.owner, ctx.params.repo, ctx.principal, {
          state: ctx.query.state,
          actor: ctx.query.actor,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
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
      return yield* run((d) =>
        d.getRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal,
        ),
      )
    }),
})

export const claimRun = defineOp({
  ...report,
  dryRun: false,
  idempotent: false,
  id: 'runs.claim',
  summary: 'Pick up a run started for you',
  description:
    "For a bot or agent that an automation woke up: call it with the bot's own token to get the run's token, which is in this answer only. Claiming again hands out a new token and the old one stops working.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs/{id}/claim',
  params: runParams,
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.claimRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal!,
        ),
      )
      return reply(r, { headers: { 'cache-control': 'no-store' } })
    }),
})

export const noteRun = defineOp({
  ...report,
  id: 'runs.note',
  summary: 'Say what the run is doing',
  description:
    'A line of progress for whoever is watching. The last 50 are kept. Not idempotent: sending a line twice adds it twice.',
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
      return yield* run((d) =>
        d.noteRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal!,
          ctx.body.text,
          ctx.dryRun,
        ),
      )
    }),
})

export const finishRun = defineOp({
  ...report,
  id: 'runs.finish',
  summary: 'End a run with its outcome',
  description:
    "The run's token stops working. Repeating it with the same outcome returns the run unchanged, so a retry is safe. Ending a run that already ended some other way answers `invalid_state`.",
  method: 'POST',
  path: '/repos/{owner}/{repo}/runs/{id}/finish',
  idempotent: true,
  params: runParams,
  body: z.strictObject({
    state: z.enum(['succeeded', 'failed']),
    summary: z.string().max(2000).optional(),
  }),
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.endRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal!,
          ctx.body.state,
          ctx.body.summary,
          ctx.dryRun,
        ),
      )
    }),
})

export const cancelRun = defineOp({
  ...report,
  id: 'runs.cancel',
  summary: 'Stop a run',
  description:
    'The person who started it, or an admin of the account, can stop a run at any moment. Its token stops working at once.',
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
      return yield* run((d) =>
        d.endRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal!,
          'cancelled',
          undefined,
          ctx.dryRun,
        ),
      )
    }),
})

const webAddress = z
  .string()
  .max(500)
  .regex(/^https?:\/\/[^\s<>"']+$/, 'An http or https address')

export const updateRun = defineOp({
  ...report,
  id: 'runs.update',
  summary: 'Say what a run belongs to',
  description:
    "Link the run to an issue, say what drove the agent (`harness`), and list conversations about it elsewhere (`links`), such as a Delta thread. The run's own token, the person who started it, or an admin can do it, while the run is going or after it ended. A field you leave out keeps its value; `links` replaces the whole list.",
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/runs/{id}',
  idempotent: true,
  params: runParams,
  body: z.strictObject({
    issue: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .describe('The issue the run works on; null to unlink it'),
    harness: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9._-]{0,49}$/,
        'Lowercase letters, digits, dot, dash and underscore; up to 50',
      )
      .nullable()
      .optional()
      .describe('Such as claude-code, delta or sx'),
    links: z.array(webAddress).max(20).optional(),
  }),
  response: S.Run,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateRun(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.id,
          ctx.principal!,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const putRunTranscript = defineOp({
  ...report,
  id: 'runs.transcript.put',
  summary: "Attach a run's transcript",
  description:
    'Upload the transcript first (`uploads.create`, text/plain or application/json), then name it here. It is checked for secrets before anyone can read it: known token formats, and long random values next to words like key, secret or token. With `mode=mask`, the default, each is replaced with `[redacted:<kind>]` and the response counts them. With `mode=block` a transcript with secrets is refused with `transcript_has_secrets`, which names the kinds. Either way the upload as sent is deleted. Only for repositories that keep transcripts (`transcripts: on`); others answer `transcripts_disabled`. A second transcript replaces the first.',
  method: 'PUT',
  path: '/repos/{owner}/{repo}/runs/{id}/transcript',
  idempotent: true,
  params: runParams,
  body: z.strictObject({
    upload: z.string().describe('The `upl_` id'),
    mode: z
      .enum(['mask', 'block'])
      .default('mask')
      .describe('What to do with secrets: mask them, or refuse the transcript'),
  }),
  response: S.Run,
  errors: [
    'not_found',
    'forbidden',
    'transcripts_disabled',
    'transcript_has_secrets',
    'upload_incomplete',
    'invalid_state',
    'invalid_request',
    'limit_reached',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const p = ctx.principal!
        const { owner, repo, id } = ctx.params
        const target = await d.transcriptTarget(owner, repo, id, p)
        const u = transcriptUpload(
          await d.svc.uploads.get(ctx.body.upload),
          p.handle,
        )
        const t = await redactTranscript(
          d.svc.uploads,
          u,
          ctx.body.mode,
          target,
          ctx.dryRun,
        )
        const out = await d.attachTranscript(owner, repo, id, p, t, ctx.dryRun)
        if (!ctx.dryRun && target.previous)
          await d.svc.uploads.remove(target.previous)
        return out
      })
    }),
})

export const getRunTranscript = defineOp({
  id: 'runs.transcript.get',
  summary: "Read a run's transcript",
  description:
    'What the agent saw and said, with secrets masked. Anyone who can read the repository can read it, with a token that has the runs:transcripts scope. Repositories that stopped keeping transcripts answer `transcripts_disabled`.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/runs/{id}/transcript',
  auth: 'required',
  scopes: ['repo:read', 'runs:transcripts'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  tags: ['runs'],
  params: runParams,
  response: S.RunTranscript,
  errors: ['not_found', 'transcripts_disabled', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const { owner, repo, id } = ctx.params
        const t = await d.runTranscript(owner, repo, id, ctx.principal)
        const u = await d.svc.uploads.get(t.uploadId)
        const bytes = await d.svc.uploads.blobs.get(t.uploadId)
        if (!u || !bytes)
          throw apiError('not_found', `Run ${id} has no transcript.`)
        return {
          object: 'run_transcript' as const,
          run: id,
          content_type:
            u.contentType === 'application/json'
              ? ('application/json' as const)
              : ('text/plain' as const),
          size: t.size,
          sha256: t.sha256,
          redactions: t.redactions,
          content: new TextDecoder().decode(bytes),
        }
      })
      return reply(out, { headers: { 'cache-control': 'private, no-store' } })
    }),
})

export const runOps = [
  startRun,
  listRuns,
  getRun,
  claimRun,
  noteRun,
  finishRun,
  cancelRun,
  updateRun,
  putRunTranscript,
  getRunTranscript,
]
