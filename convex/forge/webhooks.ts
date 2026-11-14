import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { matchesType } from '@source-code/api/events'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { repoByKey, repoByPublicId } from '../lib/access'
import { fail, out } from '../lib/errors'
import { emit } from '../lib/events'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Webhooks and their deliveries. The API checks who may manage them; this
 * keeps them, makes one delivery per matching event (`deliverEvent`, from
 * the fan-out), and decides what each attempt means: done, try again later,
 * or turn the endpoint off. API servers do the sending.
 */

export const RETRY_DELAYS_MS = [
  5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000,
]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
const DISABLE_AFTER = 5
const MAX_DELIVERIES = 1000
const SECRET_OVERLAP_MS = 24 * 3_600_000
const CLAIM_MS = 60_000
const WEBHOOKS_ACTOR = {
  id: 'acc_webhooks000000000',
  handle: 'webhooks',
  class: 'bot' as const,
}

async function hookView(ctx: QueryCtx, h: Doc<'webhooks'>) {
  const repo = await ctx.db.get('repos', h.repoId)
  return {
    id: h.publicId,
    repo: repo ? `${repo.owner}/${repo.name}` : '',
    repoId: repo?.publicId ?? '',
    url: h.url,
    description: h.description,
    events: h.events,
    active: h.active,
    disabledReason: h.disabledReason,
    secrets: h.secrets,
    failures: h.failures,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    version: h.version,
    deliveries: [],
    lastDelivery: h.lastDelivery,
  }
}

const deliveryView = (d: Doc<'webhookDeliveries'>, hookPublicId: string) => ({
  id: d.publicId,
  hookId: hookPublicId,
  sequence: d.sequence,
  event: JSON.parse(d.event),
  state: d.state,
  attempts: d.attempts,
  nextAt: d.nextAt,
  redeliveryOf: d.redeliveryOf,
  createdAt: d.createdAt,
})

const hookById = (ctx: QueryCtx, id: string) =>
  ctx.db
    .query('webhooks')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()

async function mustHook(ctx: QueryCtx, id: string) {
  const h = await hookById(ctx, id)
  if (!h) fail('not_found', `No webhook ${id}.`)
  return h
}

export const list = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) => {
    await system(ctx)
    const repo = await repoByKey(ctx, full)
    if (!repo) return out([])
    const hooks = await ctx.db
      .query('webhooks')
      .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
      .take(100)
    hooks.sort((a, b) => b.createdAt - a.createdAt)
    return out(await Promise.all(hooks.map((h) => hookView(ctx, h))))
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const h = await hookById(ctx, id)
    return out(h ? await hookView(ctx, h) : null)
  },
})

export const create = mutation({
  args: {
    full: v.string(),
    url: v.string(),
    events: v.array(v.string()),
    description: v.optional(v.string()),
    secret: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const repo = await repoByKey(ctx, a.full)
    if (!repo) fail('not_found', `No repository ${a.full}.`)
    const t = Date.now()
    const id = await ctx.db.insert('webhooks', {
      publicId: newId('webhook', t),
      repoId: repo._id,
      url: a.url,
      description: a.description ?? '',
      events: a.events,
      active: true,
      disabledReason: null,
      secrets: [{ value: a.secret, createdAt: t, expiresAt: null }],
      failures: 0,
      createdAt: t,
      updatedAt: t,
      version: 1,
      lastDelivery: null,
      nextSequence: 1,
    })
    return out(await hookView(ctx, (await ctx.db.get('webhooks', id))!))
  },
})

export const update = mutation({
  args: {
    id: v.string(),
    url: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { id, ...p }) => {
    await system(ctx)
    const h = await mustHook(ctx, id)
    const changed =
      (p.url !== undefined && p.url !== h.url) ||
      (p.events !== undefined &&
        JSON.stringify(p.events) !== JSON.stringify(h.events)) ||
      (p.description !== undefined && p.description !== h.description) ||
      (p.active !== undefined && p.active !== h.active)
    if (!changed) return out(null)
    await ctx.db.patch('webhooks', h._id, {
      ...p,
      // Turning it back on clears the reason it was turned off.
      ...(p.active ? { disabledReason: null, failures: 0 } : {}),
      updatedAt: Date.now(),
      version: h.version + 1,
    })
    return out(null)
  },
})

async function removeHook(ctx: MutationCtx, h: Doc<'webhooks'>) {
  for (const d of await ctx.db
    .query('webhookDeliveries')
    .withIndex('by_hookId_and_sequence', (q) => q.eq('hookId', h._id))
    .take(MAX_DELIVERIES + 10))
    await ctx.db.delete('webhookDeliveries', d._id)
  await ctx.db.delete('webhooks', h._id)
}

export const remove = mutation({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const h = await hookById(ctx, id)
    if (h) await removeHook(ctx, h)
    return out(null)
  },
})

/** A deleted repository's webhooks go with it. */
export async function dropRepoHooks(ctx: MutationCtx, repoId: Id<'repos'>) {
  for (const h of await ctx.db
    .query('webhooks')
    .withIndex('by_repoId', (q) => q.eq('repoId', repoId))
    .take(100))
    await removeHook(ctx, h)
}

/** A new secret signs from now on; the old one keeps signing for a day so receivers can switch. */
export const rotate = mutation({
  args: { id: v.string(), secret: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const h = await mustHook(ctx, a.id)
    const t = Date.now()
    const secrets: Doc<'webhooks'>['secrets'] = [
      ...h.secrets.map((s) => ({
        ...s,
        expiresAt: s.expiresAt ?? t + SECRET_OVERLAP_MS,
      })),
      { value: a.secret, createdAt: t, expiresAt: null },
    ].filter((s) => s.expiresAt === null || s.expiresAt > t)
    await ctx.db.patch('webhooks', h._id, {
      secrets,
      updatedAt: t,
      version: h.version + 1,
    })
    return out(null)
  },
})

export const getDelivery = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const d = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_publicId', (q) => q.eq('publicId', id))
      .unique()
    const h = d && (await ctx.db.get('webhooks', d.hookId))
    return out(d && h ? deliveryView(d, h.publicId) : null)
  },
})

/** Newest first, below a sequence. */
export const deliveries = query({
  args: {
    id: v.string(),
    state: v.optional(v.string()),
    before: v.number(),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const h = await mustHook(ctx, a.id)
    const rows = []
    for await (const d of ctx.db
      .query('webhookDeliveries')
      .withIndex('by_hookId_and_sequence', (q) =>
        q.eq('hookId', h._id).lt('sequence', a.before),
      )
      .order('desc')) {
      if (a.state && d.state !== a.state) continue
      rows.push(deliveryView(d, h.publicId))
      if (rows.length > a.limit) break
    }
    return out(rows)
  },
})

/** Queue one event for one webhook. Keeps the newest thousand. */
export async function enqueue(
  ctx: MutationCtx,
  h: Doc<'webhooks'>,
  event: string,
  redeliveryOf: string | null,
) {
  const t = Date.now()
  const publicId = newId('delivery', t)
  await ctx.db.insert('webhookDeliveries', {
    publicId,
    hookId: h._id,
    sequence: h.nextSequence,
    event,
    state: 'pending',
    attempts: [],
    nextAt: t,
    claimedUntil: 0,
    redeliveryOf,
    createdAt: t,
  })
  await ctx.db.patch('webhooks', h._id, {
    nextSequence: h.nextSequence + 1,
    lastDelivery: publicId,
  })
  const old = await ctx.db
    .query('webhookDeliveries')
    .withIndex('by_hookId_and_sequence', (q) =>
      q.eq('hookId', h._id).lte('sequence', h.nextSequence - MAX_DELIVERIES),
    )
    .take(100)
  for (const d of old) await ctx.db.delete('webhookDeliveries', d._id)
  return publicId
}

/** Deliveries for an event, for every active webhook of its repository that wants it. */
export async function deliverEvent(
  ctx: MutationCtx,
  e: { type: string; repo_id: string | null },
  json: string,
) {
  if (!e.repo_id || e.type === 'webhook.disabled') return
  const repo = await repoByPublicId(ctx, e.repo_id)
  if (!repo) return
  for (const h of await ctx.db
    .query('webhooks')
    .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
    .take(100))
    if (h.active && matchesType(h.events, e.type))
      await enqueue(ctx, h, json, null)
}

/** A delivery the API made: a ping, a redelivery, a replayed event. */
export const enqueueOne = mutation({
  args: {
    id: v.string(),
    event: v.string(),
    redeliveryOf: v.union(v.null(), v.string()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const h = await mustHook(ctx, a.id)
    const id = await enqueue(ctx, h, a.event, a.redeliveryOf)
    const d = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_publicId', (q) => q.eq('publicId', id))
      .unique()
    return out(deliveryView(d!, h.publicId))
  },
})

/**
 * Due deliveries, now this server's to send for a minute. A delivery for an
 * endpoint that was turned off fails here, without a send.
 */
export const claim = mutation({
  args: { limit: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const t = Date.now()
    const due = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_state_and_nextAt', (q) =>
        q.eq('state', 'pending').lte('nextAt', t),
      )
      .take(a.limit * 2)
    const claimed = []
    for (const d of due) {
      if (claimed.length >= a.limit) break
      if (d.claimedUntil > t) continue
      const h = await ctx.db.get('webhooks', d.hookId)
      if (!h) continue
      const event = JSON.parse(d.event) as { type: string; id: string }
      if (!h.active && event.type !== 'webhook.ping') {
        await ctx.db.patch('webhookDeliveries', d._id, {
          state: 'failed',
          nextAt: null,
          attempts: [
            ...d.attempts,
            {
              number: d.attempts.length + 1,
              at: t,
              status: null,
              error: 'The endpoint is disabled.',
              ms: 0,
            },
          ],
        })
        continue
      }
      await ctx.db.patch('webhookDeliveries', d._id, {
        claimedUntil: t + CLAIM_MS,
      })
      claimed.push({
        id: d.publicId,
        hookId: h.publicId,
        url: h.url,
        secrets: h.secrets
          .filter((s) => s.expiresAt === null || s.expiresAt > t)
          .map((s) => s.value),
        event: d.event,
        at: t,
      })
    }
    return out(claimed)
  },
})

/** How a send went. Answers when to try again, if it will be tried again. */
export const report = mutation({
  args: {
    id: v.string(),
    at: v.number(),
    status: v.union(v.null(), v.number()),
    error: v.union(v.null(), v.string()),
    ms: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const d = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_publicId', (q) => q.eq('publicId', a.id))
      .unique()
    const h = d && (await ctx.db.get('webhooks', d.hookId))
    // Gone while it was being sent: nothing to count it on.
    if (!d || !h) return out({ retryAt: null })
    const attempts = [
      ...d.attempts,
      {
        number: d.attempts.length + 1,
        at: a.at,
        status: a.status,
        error: a.error,
        ms: a.ms,
      },
    ]
    const event = JSON.parse(d.event) as { type: string }
    const done = async (reason: string | null) => {
      await ctx.db.patch('webhookDeliveries', d._id, {
        attempts,
        state: 'failed',
        nextAt: null,
        claimedUntil: 0,
      })
      if (event.type === 'webhook.ping') return
      const failures = h.failures + 1
      if (reason || failures >= DISABLE_AFTER) {
        await ctx.db.patch('webhooks', h._id, {
          failures,
          active: false,
          disabledReason:
            reason ?? `${DISABLE_AFTER} deliveries in a row failed.`,
          updatedAt: Date.now(),
          version: h.version + 1,
        })
        const repo = await ctx.db.get('repos', h.repoId)
        if (repo)
          await emit(
            ctx,
            repo,
            'webhook.disabled',
            WEBHOOKS_ACTOR,
            { object: 'webhook', id: h.publicId, number: null },
            ['active'],
            null,
            [],
            false,
          )
      } else await ctx.db.patch('webhooks', h._id, { failures })
    }
    if (a.status !== null && a.status >= 200 && a.status < 300) {
      await ctx.db.patch('webhookDeliveries', d._id, {
        attempts,
        state: 'succeeded',
        nextAt: null,
        claimedUntil: 0,
      })
      await ctx.db.patch('webhooks', h._id, { failures: 0 })
      return out({ retryAt: null })
    }
    // 410 Gone is the receiver saying it no longer wants these.
    if (a.status === 410) {
      await done('The endpoint answered 410 Gone.')
      return out({ retryAt: null })
    }
    if (attempts.length >= MAX_ATTEMPTS) {
      await done(null)
      return out({ retryAt: null })
    }
    const retryAt = Date.now() + RETRY_DELAYS_MS[attempts.length - 1]
    await ctx.db.patch('webhookDeliveries', d._id, {
      attempts,
      nextAt: retryAt,
      claimedUntil: 0,
    })
    return out({ retryAt })
  },
})
