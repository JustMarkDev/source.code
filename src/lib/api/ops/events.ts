/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/require-await */
import { Effect } from 'effect'
import { z } from 'zod'
import { hashToken, principalOf } from '../auth'
import { Domain, Raw, defineOp } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape } from './common'

const repoWaitTopic = (repo: string | undefined) => {
  if (!repo) return '*'
  const lower = repo.toLowerCase()
  return lower.startsWith('rep_') ? `repo-id:${lower}` : `repo:${lower}`
}

export const listEvents = defineOp({
  id: 'events.list',
  summary: 'The event log, oldest first',
  description:
    'Everything that happened in repositories you can see. Pass the last `next_cursor` to continue. Events are kept for 30 days. `type` takes a comma list; `change.*` matches every change event.',
  tags: ['events'],
  method: 'GET',
  path: '/events',
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    ...pageShape,
    repo: z.string().optional().describe('Only this repository, `owner/name`'),
    type: z
      .string()
      .optional()
      .describe('Comma list of event types. `change.*` matches every change event'),
  }),
  response: S.listOf(S.Event),
  errors: ['not_found', 'cursor_mismatch'],
  shapeable: true,
  waitOn: (_p, q) => repoWaitTopic((q as { repo?: string } | undefined)?.repo),
  probe: async (ctx, d) => ctx.query.repo ? d.repoHistoryVersion(ctx.query.repo, ctx.principal) : d.eventVersion(),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      const f = fp('events.list', q.repo, q.type)
      const page = yield* run((d) =>
        d.listEvents(ctx.principal, { repo: q.repo, type: q.type, after: afterOf(q.cursor, f), limit: q.limit }),
      )
      return listOf(page.items as unknown as Array<z.infer<typeof S.Event>>, page.next, f)
    }),
})

export const syncRepo = defineOp({
  id: 'sync.get',
  summary: 'Keep a local copy of a repository up to date',
  description:
    'Call without a cursor for a snapshot of the repository, its changes and its issues. Then call with the returned cursor to get only what changed, newest state of each object. When `reset` is true the cursor was too old and `objects` is a fresh snapshot. One request replaces polling every list.',
  tags: ['events', 'agents'],
  method: 'GET',
  path: '/sync',
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    repo: z
      .string()
      .regex(/^[^/]+\/[^/]+$/)
      .describe('`owner/name`'),
    cursor: z
      .string()
      .optional()
      .describe('The `cursor` of the previous response. Omit for a snapshot.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .describe('Objects per response, 1 to 200'),
  }),
  response: S.Sync,
  errors: ['not_found', 'cursor_mismatch', 'moved'],
  waitOn: (_p, q) => repoWaitTopic((q as { repo?: string } | undefined)?.repo),
  probe: (ctx, d) => {
    const [owner, name] = ctx.query.repo.split('/')
    return d.syncVersion(owner, name ?? '', ctx.principal)
  },
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.sync(ctx.principal, ctx.query))
    }),
})

export const streamEvents = defineOp({
  id: 'events.stream',
  summary: 'Events as they happen (Server-Sent Events)',
  description:
    'A text/event-stream. Each event carries its sequence as the SSE id, so a reconnect with Last-Event-ID continues without a gap inside the retention window. A comment line is sent every 15 seconds to keep the connection open.',
  tags: ['events'],
  method: 'GET',
  path: '/events/stream',
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    repo: z.string().optional().describe('Only this repository, `owner/name`'),
    type: z.string().optional().describe('Comma list of event types'),
  }),
  response: z.string(),
  responseContentType: 'text/event-stream',
  streaming: true,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const { events, domain, repoId } = yield* run(async (d) => ({
        events: d.events,
        domain: d,
        repoId: ctx.query.repo ? d.repoIdForHistory(ctx.query.repo) : null,
      }))
      const last = ctx.header('last-event-id')
      let after = last && /^\d+$/.test(last) ? Number(last) : events.head
      const types = ctx.query.type?.split(',') ?? null
      const repo = ctx.query.repo
      const encoder = new TextEncoder()
      let open = true
      const send = (text: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
        if (!open || ctx.signal.aborted) return false
        try {
          controller.enqueue(encoder.encode(text))
          return true
        } catch {
          // The client went away between the check and the enqueue.
          open = false
          return false
        }
      }
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          if (!send(': connected\n\n', controller)) {
            try {
              controller.close()
            } catch {}
            return
          }
          while (open && !ctx.signal.aborted) {
            // A stream is long-lived; a token revoked or expired mid-stream stops it.
            const bearer = /^Bearer\s+(.+)$/i.exec(ctx.header('authorization') ?? '')?.[1]
            const found = bearer ? await domain.svc.auth.find(hashToken(bearer), 'api', ctx.now()) : null
            if (!found?.ok) break
            const current = principalOf(found.record)
            // Re-read access for every batch: a repository may become private,
            // or a membership may be removed, while the stream stays open.
            const can = domain.canSeeId(current)
            const canPull = current.scopes.has('pulls:read')
            const canIssue = current.scopes.has('issues:read')
            const scopeOk = (t: string) =>
              t.startsWith('issue.') ? canIssue : /^(change|finding|check|ci|operation)\./.test(t) ? canPull : true
            const { events: batch, scannedTo } = events.since(after, 100, (e) => {
              if (repo && e.repoId !== repoId) return false
              if (!can(e.repoId)) return false
              if (!scopeOk(e.type)) return false
              return (
                !types ||
                types.some((t) => (t.endsWith('.*') ? e.type.startsWith(t.slice(0, -1)) : t === e.type))
              )
            })
            for (const e of batch) {
              if (!send(`id: ${e.sequence}\nevent: ${e.type}\ndata: ${e.json}\n\n`, controller)) break
            }
            if (!open) break
            // Move past events that did not match, so they are not scanned again.
            after = Math.max(after, scannedTo)
            if (batch.length === 0) after = Math.max(after, events.head)
            if (batch.length === 100) continue
            const before = events.head
            await events.wait(repoWaitTopic(repo), 15_000, ctx.signal)
            if (events.head === before && open && !ctx.signal.aborted) send(': keepalive\n\n', controller)
          }
          try {
            controller.close()
          } catch {}
        },
        cancel() {
          open = false
        },
      })
      return new Raw(
        new Response(body, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
          },
        }),
      )
    }),
})

export const getOperation = defineOp({
  id: 'operations.get',
  summary: 'A long-running operation',
  description:
    'Poll it, or add ?wait=20 with If-None-Match to hold the request until it changes. `result` is a stub of what it produced; `error` is a full problem object.',
  tags: ['operations'],
  method: 'GET',
  path: '/operations/{id}',
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: z.object({ id: z.string().describe('The operation `op_` id') }),
  response: S.Operation,
  errors: ['not_found'],
  waitOn: (p, _q, d) => {
    const repoId = d?.operationRepoId(p.id)
    return repoId ? `repo-id:${repoId}` : '*'
  },
  probe: (ctx, d) =>
      d.operationVersion(ctx.params.id, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getOperation(ctx.params.id, ctx.principal))
    }),
})

export const eventOps = [listEvents, syncRepo, streamEvents, getOperation]
