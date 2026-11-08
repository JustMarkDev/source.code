import { v } from 'convex/values'
import { internal } from './_generated/api'
import { env, internalMutation, mutation } from './_generated/server'

/**
 * The shared stores behind the HTTP API: rate-limit counters and idempotency
 * keys. Each function is one transaction, so two API nodes asking at the same
 * moment are ordered by the database and cannot both be told yes to the last
 * unit, or both be told they are first.
 *
 * They are public mutations because the API servers are not signed-in users.
 * Every one needs `secret`, which must equal the deployment's
 * `API_STORE_SECRET`. Without that variable set they all refuse.
 */

const stateValidator = v.union(
  v.object({ state: v.literal('new') }),
  v.object({ state: v.literal('conflict') }),
  v.object({ state: v.literal('in_progress') }),
  v.object({
    state: v.literal('replay'),
    response: v.object({
      status: v.number(),
      headers: v.string(),
      body: v.string(),
    }),
  }),
)

function assertSecret(secret: string) {
  const want = env.API_STORE_SECRET
  // Compared in full whatever the length, so the answer does not leak how much matched.
  let diff = want === undefined || want.length < 16 ? 1 : 0
  const a = want ?? ''
  const n = Math.max(a.length, secret.length)
  diff |= a.length ^ secret.length
  for (let i = 0; i < n; i++)
    diff |= (a.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0)
  if (diff !== 0) throw new Error('not allowed')
}

// ----- rate limits -----------------------------------------------------------

/**
 * Takes up to `want` units from the window that contains now, for `key`. The
 * grant is `min(want, limit - used)`, so the total handed out in a window can
 * never pass the limit however many nodes ask.
 */
export const takeLimit = mutation({
  args: {
    secret: v.string(),
    key: v.string(),
    want: v.number(),
    limit: v.number(),
    windowMs: v.number(),
  },
  returns: v.object({
    granted: v.number(),
    remaining: v.number(),
    resetMs: v.number(),
  }),
  handler: async (ctx, args) => {
    assertSecret(args.secret)
    if (args.windowMs <= 0 || args.want < 0 || args.limit < 0)
      throw new Error('bad policy')
    const now = Date.now()
    const start = now - (now % args.windowMs)
    const row = await ctx.db
      .query('apiLimits')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique()
    const used = row && row.start === start ? row.used : 0
    const granted = Math.max(0, Math.min(args.want, args.limit - used))
    if (!row)
      await ctx.db.insert('apiLimits', {
        key: args.key,
        start,
        used: used + granted,
      })
    else if (granted > 0 || row.start !== start)
      await ctx.db.patch('apiLimits', row._id, { start, used: used + granted })
    return {
      granted,
      remaining: args.limit - used - granted,
      resetMs: start + args.windowMs - now,
    }
  },
})

// ----- idempotency -----------------------------------------------------------

/** First sight of a key claims it; later sights learn what became of it. */
export const beginIdempotency = mutation({
  args: {
    secret: v.string(),
    scope: v.string(),
    key: v.string(),
    fingerprint: v.string(),
    ttlMs: v.number(),
  },
  returns: stateValidator,
  handler: async (ctx, args) => {
    assertSecret(args.secret)
    const now = Date.now()
    const row = await ctx.db
      .query('apiIdempotency')
      .withIndex('by_scope_and_key', (q) =>
        q.eq('scope', args.scope).eq('key', args.key),
      )
      .unique()
    if (row && row.expires > now) {
      if (row.fingerprint !== args.fingerprint)
        return { state: 'conflict' as const }
      return row.response
        ? { state: 'replay' as const, response: row.response }
        : { state: 'in_progress' as const }
    }
    if (row) await ctx.db.delete('apiIdempotency', row._id)
    await ctx.db.insert('apiIdempotency', {
      scope: args.scope,
      key: args.key,
      fingerprint: args.fingerprint,
      expires: now + args.ttlMs,
    })
    return { state: 'new' as const }
  },
})

// A Convex document holds about 1 MiB. A response that cannot fit is replaced by
// a short one that says so, which still stops a retry from doing the work twice.
const MAX_BODY = 900_000

export const completeIdempotency = mutation({
  args: {
    secret: v.string(),
    scope: v.string(),
    key: v.string(),
    status: v.number(),
    headers: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertSecret(args.secret)
    const row = await ctx.db
      .query('apiIdempotency')
      .withIndex('by_scope_and_key', (q) =>
        q.eq('scope', args.scope).eq('key', args.key),
      )
      .unique()
    if (!row) return null
    const tooBig = args.body.length + args.headers.length > MAX_BODY
    await ctx.db.patch('apiIdempotency', row._id, {
      response: tooBig
        ? {
            status: 500,
            headers: JSON.stringify({
              'content-type': 'application/problem+json',
            }),
            body: JSON.stringify({
              status: 500,
              code: 'internal',
              detail:
                'The first request finished, but its response was too large to keep for replay.',
            }),
          }
        : { status: args.status, headers: args.headers, body: args.body },
    })
    return null
  },
})

export const abortIdempotency = mutation({
  args: { secret: v.string(), scope: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertSecret(args.secret)
    const row = await ctx.db
      .query('apiIdempotency')
      .withIndex('by_scope_and_key', (q) =>
        q.eq('scope', args.scope).eq('key', args.key),
      )
      .unique()
    if (row) await ctx.db.delete('apiIdempotency', row._id)
    return null
  },
})

// ----- housekeeping ----------------------------------------------------------

const SWEEP_BATCH = 500

/** Deletes finished windows and expired keys, a batch at a time, and schedules itself again if there is more. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    // A window that ended an hour ago cannot matter to any node.
    const windows = await ctx.db
      .query('apiLimits')
      .withIndex('by_start', (q) => q.lt('start', now - 3_600_000))
      .take(SWEEP_BATCH)
    for (const w of windows) await ctx.db.delete('apiLimits', w._id)
    const keys = await ctx.db
      .query('apiIdempotency')
      .withIndex('by_expires', (q) => q.lt('expires', now))
      .take(SWEEP_BATCH)
    for (const k of keys) await ctx.db.delete('apiIdempotency', k._id)
    // A full batch means there may be more; go again rather than hold one transaction open.
    if (windows.length === SWEEP_BATCH || keys.length === SWEEP_BATCH)
      await ctx.scheduler.runAfter(0, internal.apiStores.sweep, {})
    return null
  },
})
