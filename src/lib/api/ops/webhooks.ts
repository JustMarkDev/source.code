import { Effect } from 'effect'
import { z } from 'zod'
import { MAX_HOOKS_PER_REPO, endpointProblem } from '../webhooks'
import { apiError } from '../problem'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { iso } from '../domain'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'
import type { Delivery, Hook } from '../webhooks'
import type { MemoryDomain } from '../domain'

const hookParams = repoParams.extend({ webhook: z.string().describe('The webhook `whk_` id') })
const deliveryParams = hookParams.extend({ delivery: z.string().describe('The delivery `dlv_` id') })

const eventPatterns = z
  .array(z.string().regex(/^(\*|[a-z_]+(\.[a-z_]+)*(\.\*)?)$/))
  .min(1)
  .max(50)
  .describe('Event types, such as `change.landed`. `change.*` matches the family, `*` everything')

function presentHook(d: MemoryDomain, h: Hook, secret: string | null): z.infer<typeof S.Webhook> {
  const last = h.lastDelivery ? d.svc.hooks.getDelivery(h.lastDelivery) : null
  const url = `${d.urls.api}/repos/${h.repo}/webhooks/${h.id}`
  return {
    object: 'webhook',
    id: h.id,
    repo: h.repo,
    endpoint: h.url,
    description: h.description,
    events: h.events,
    active: h.active,
    disabled_reason: h.disabledReason,
    secret,
    last_delivery: last ? { id: last.id, state: last.state, at: iso(last.createdAt) } : null,
    html_url: `${d.urls.html}/${h.repo}/settings`,
    url,
    created_at: iso(h.createdAt),
    updated_at: iso(h.updatedAt),
    version: h.version,
  }
}

function presentDelivery(d: MemoryDomain, h: Hook, x: Delivery, full: boolean): z.infer<typeof S.Delivery> {
  return {
    object: 'delivery',
    id: x.id,
    webhook: h.id,
    event: { id: x.event.id, type: x.event.type, sequence: x.event.sequence },
    state: x.state,
    attempt_count: x.attempts.length,
    attempts: full
      ? x.attempts.map((a) => ({ number: a.number, at: iso(a.at), status: a.status, error: a.error, duration_ms: a.ms }))
      : null,
    payload: full ? (x.event) : null,
    next_attempt_at: x.nextAt ? iso(x.nextAt) : null,
    redelivery_of: x.redeliveryOf,
    url: `${d.urls.api}/repos/${h.repo}/webhooks/${h.id}/deliveries/${x.id}`,
    created_at: iso(x.createdAt),
  }
}

async function hookOf(d: MemoryDomain, owner: string, repo: string, id: string, p: Parameters<MemoryDomain['repoAccess']>[2], need: 'read' | 'write' = 'write') {
  const full = need === 'read'
    ? await d.repoAccessStrict(owner, repo, p, 'read')
    : await d.repoAccess(owner, repo, p, 'write')
  const h = d.svc.hooks.get(id)
  if (!h || h.repo !== full) throw apiError('not_found', `No webhook ${id} on ${full}.`)
  return h
}

const read = { auth: 'required' as const, scopes: ['webhooks:read' as const], pool: 'read' as const, safety: 'read' as const, idempotent: true, tags: ['webhooks'] }
const write = { auth: 'required' as const, scopes: ['webhooks:write' as const], pool: 'write' as const, safety: 'write' as const, tags: ['webhooks'] }

export const listWebhooks = defineOp({
  ...read,
  id: 'webhooks.list',
  summary: 'Webhooks on a repository',
  method: 'GET',
  path: '/repos/{owner}/{repo}/webhooks',
  params: repoParams,
  response: S.listOf(S.Webhook),
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccessStrict(ctx.params.owner, ctx.params.repo, ctx.principal, 'read')
        return d.svc.hooks.list(full).map((h) => presentHook(d, h, null))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const createWebhook = defineOp({
  ...write,
  id: 'webhooks.create',
  secretResponse: true,
  summary: 'Create a webhook',
  description:
    'The URL must be https and must not point at a private, loopback or link-local address. The response is the only time the signing secret is shown. A repository can have 10.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/webhooks',
  params: repoParams,
  idempotent: false,
  dryRun: true,
  body: z.strictObject({
    endpoint: z.string().max(2000),
    events: eventPatterns,
    description: z.string().max(200).optional(),
  }),
  response: S.Webhook,
  status: 201,
  errors: ['not_found', 'forbidden', 'limit_reached', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const h = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const repoId = await d.repoIdOf(ctx.params.owner, ctx.params.repo, ctx.principal)
        const problem = endpointProblem(ctx.body.endpoint, d.svc.hooks.allowPrivate)
        if (problem)
          throw apiError('invalid_request', 'That URL cannot be a webhook endpoint.', {
            errors: [{ pointer: '/body/endpoint', code: 'url_not_allowed', message: problem }],
          })
        if (d.svc.hooks.list(full).length >= MAX_HOOKS_PER_REPO)
          throw apiError('limit_reached', `A repository can have ${MAX_HOOKS_PER_REPO} webhooks.`)
        if (ctx.dryRun) return presentHook(d, { id: 'whk_dryrun', repo: full, repoId, url: ctx.body.endpoint, description: ctx.body.description ?? '', events: ctx.body.events, active: true, disabledReason: null, secrets: [], failures: 0, createdAt: ctx.now(), updatedAt: ctx.now(), version: 1, deliveries: [], lastDelivery: null }, null)
        const { hook, secret } = d.svc.hooks.create(full, repoId, { url: ctx.body.endpoint, events: ctx.body.events, description: ctx.body.description })
        return presentHook(d, hook, secret)
      })
      return reply(h, { status: 201, headers: { location: h.url, 'cache-control': 'no-store' } })
    }),
})

export const getWebhook = defineOp({
  ...read,
  id: 'webhooks.get',
  summary: 'One webhook',
  method: 'GET',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}',
  params: hookParams,
  response: S.Webhook,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => presentHook(d, await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal, 'read'), null))
    }),
})

export const updateWebhook = defineOp({
  ...write,
  id: 'webhooks.update',
  summary: 'Change a webhook',
  description: 'Set `active: true` to turn a disabled endpoint back on. That also clears the failure count.',
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}',
  params: hookParams,
  idempotent: true,
  dryRun: true,
  body: z.strictObject({
    endpoint: z.string().max(2000).optional(),
    events: eventPatterns.optional(),
    description: z.string().max(200).optional(),
    active: z.boolean().optional(),
  }),
  response: S.Webhook,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        if (ctx.body.endpoint !== undefined) {
          const problem = endpointProblem(ctx.body.endpoint, d.svc.hooks.allowPrivate)
          if (problem)
            throw apiError('invalid_request', 'That URL cannot be a webhook endpoint.', {
              errors: [{ pointer: '/body/endpoint', code: 'url_not_allowed', message: problem }],
            })
        }
        if (!ctx.dryRun) d.svc.hooks.update(h, { url: ctx.body.endpoint, events: ctx.body.events, description: ctx.body.description, active: ctx.body.active })
        const shown = ctx.dryRun
          ? { ...h, url: ctx.body.endpoint ?? h.url, events: ctx.body.events ?? h.events, description: ctx.body.description ?? h.description, active: ctx.body.active ?? h.active, ...(ctx.body.active ? { disabledReason: null, failures: 0 } : {}) }
          : h
        return presentHook(d, shown, null)
      })
    }),
})

export const deleteWebhook = defineOp({
  ...write,
  id: 'webhooks.delete',
  summary: 'Delete a webhook',
  description: 'Pending deliveries are dropped.',
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}',
  params: hookParams,
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        if (!ctx.dryRun) d.svc.hooks.remove(h)
      })
      return reply(null, { status: 204 })
    }),
})

export const rotateSecret = defineOp({
  ...write,
  id: 'webhooks.rotate_secret',
  secretResponse: true,
  summary: 'Rotate the signing secret',
  description:
    'Returns the new secret once. Deliveries are signed with both the new and the old secret for 24 hours, so a receiver can switch without dropping events.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/rotate-secret',
  params: hookParams,
  idempotent: false,
  response: S.Webhook,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const h = yield* run(async (d) => {
        const hook = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        return presentHook(d, hook, d.svc.hooks.rotate(hook))
      })
      return reply(h, { headers: { 'cache-control': 'no-store' } })
    }),
})

export const pingWebhook = defineOp({
  ...write,
  id: 'webhooks.ping',
  summary: 'Send a test delivery',
  description: 'Sends a `webhook.ping` event so you can check the endpoint and your signature check. Answers 202 with the delivery.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/ping',
  params: hookParams,
  idempotent: false,
  response: S.Delivery,
  status: 202,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const x = yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        return presentDelivery(d, h, d.svc.hooks.ping(h), false)
      })
      return reply(x, { status: 202, headers: { location: x.url } })
    }),
})

export const listDeliveries = defineOp({
  ...read,
  id: 'webhooks.deliveries.list',
  summary: 'Deliveries, newest first',
  description: 'Kept for 30 days, up to 1,000 per webhook.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/deliveries',
  params: hookParams,
  query: z.strictObject({
    ...pageShape,
    state: z.enum(['pending', 'succeeded', 'failed']).optional(),
  }),
  response: S.listOf(S.Delivery),
  errors: ['not_found', 'forbidden', 'moved', 'cursor_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      const f = fp('webhooks.deliveries', ctx.params.webhook, q.state)
      const out = yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal, 'read')
        const after = afterOf(q.cursor, f)
        const afterSequence = after ? Number(after.id) : Number.POSITIVE_INFINITY
        // Newest first: the monotonic sequence is the stable order when ids share a millisecond.
        const rows = h.deliveries.filter((x) => (!q.state || x.state === q.state) && x.sequence < afterSequence)
        const page = rows.slice(0, q.limit)
        const more = rows.length > q.limit
        return {
          items: page.map((x) => presentDelivery(d, h, x, false)),
          next: more ? { key: 0, id: String(page[page.length - 1].sequence) } : null,
        }
      })
      return listOf(out.items, out.next, f)
    }),
})

export const getDelivery = defineOp({
  ...read,
  id: 'webhooks.deliveries.get',
  summary: 'One delivery, with every attempt and the payload',
  method: 'GET',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/deliveries/{delivery}',
  params: deliveryParams,
  response: S.Delivery,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal, 'read')
        const x = d.svc.hooks.getDelivery(ctx.params.delivery)
        if (!x || x.hookId !== h.id) throw apiError('not_found', `No delivery ${ctx.params.delivery}.`)
        return presentDelivery(d, h, x, true)
      })
    }),
})

export const redeliver = defineOp({
  ...write,
  id: 'webhooks.deliveries.redeliver',
  summary: 'Send a delivery again',
  description: 'Creates a new delivery of the same event. `webhook-id` is unchanged, so a receiver that deduplicates by it sees the same event.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/deliveries/{delivery}/redeliver',
  params: deliveryParams,
  idempotent: false,
  response: S.Delivery,
  status: 202,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const x = yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        const old = d.svc.hooks.getDelivery(ctx.params.delivery)
        if (!old || old.hookId !== h.id) throw apiError('not_found', `No delivery ${ctx.params.delivery}.`)
        return presentDelivery(d, h, d.svc.hooks.redeliver(h, old), false)
      })
      return reply(x, { status: 202, headers: { location: x.url } })
    }),
})

export const replayWebhook = defineOp({
  ...write,
  id: 'webhooks.replay',
  summary: 'Replay events the endpoint missed',
  description:
    'Sends every event after `after_sequence` that this webhook subscribes to, oldest first, up to `limit`. Use the `last_sequence` it returns to continue. A lost delivery is never a manual job.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/webhooks/{webhook}/replay',
  params: hookParams,
  idempotent: false,
  body: z.strictObject({
    after_sequence: z.number().int().min(0),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  response: z.strictObject({
    object: z.literal('replay'),
    queued: z.number().int(),
    last_sequence: z.number().int(),
  }),
  status: 202,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run(async (d) => {
        const h = await hookOf(d, ctx.params.owner, ctx.params.repo, ctx.params.webhook, ctx.principal)
        return d.svc.hooks.replay(h, ctx.body.after_sequence, ctx.body.limit)
      })
      return reply({ object: 'replay' as const, queued: r.count, last_sequence: r.last }, { status: 202 })
    }),
})

export const webhookOps = [
  listWebhooks, createWebhook, getWebhook, updateWebhook, deleteWebhook,
  rotateSecret, pingWebhook, listDeliveries, getDelivery, redeliver, replayWebhook,
]
