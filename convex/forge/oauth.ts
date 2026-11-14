import { v } from 'convex/values'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { out } from '../lib/errors'
import type { QueryCtx } from '../_generated/server'

/**
 * The OAuth server's memory between requests (`packages/api/src/oauth.ts`).
 * Only the API server calls these. `use` is one transaction, so of two
 * requests redeeming the same code at once exactly one sees it unused.
 */

const entry = (ctx: QueryCtx, kind: string, key: string) =>
  ctx.db
    .query('oauthState')
    .withIndex('by_kind_and_key', (q) => q.eq('kind', kind).eq('key', key))
    .unique()

export const get = query({
  args: { kind: v.string(), key: v.string() },
  returns: v.string(),
  handler: async (ctx, { kind, key }) => {
    await system(ctx)
    const e = await entry(ctx, kind, key)
    return e ? e.value : out(null)
  },
})

export const set = mutation({
  args: {
    kind: v.string(),
    key: v.string(),
    value: v.string(),
    expires: v.union(v.null(), v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await system(ctx)
    const e = await entry(ctx, args.kind, args.key)
    if (e)
      await ctx.db.patch('oauthState', e._id, {
        value: args.value,
        expires: args.expires,
      })
    else await ctx.db.insert('oauthState', args)
    return out(null)
  },
})

export const remove = mutation({
  args: { kind: v.string(), key: v.string() },
  returns: v.string(),
  handler: async (ctx, { kind, key }) => {
    await system(ctx)
    const e = await entry(ctx, kind, key)
    if (e) await ctx.db.delete('oauthState', e._id)
    return out(null)
  },
})

export const use = mutation({
  args: { kind: v.string(), key: v.string() },
  returns: v.string(),
  handler: async (ctx, { kind, key }) => {
    await system(ctx)
    const e = await entry(ctx, kind, key)
    if (!e) return out(null)
    const value = JSON.parse(e.value) as Record<string, unknown>
    await ctx.db.patch('oauthState', e._id, {
      value: JSON.stringify({ ...value, used: true }),
    })
    return e.value
  },
})

export const count = query({
  args: { kind: v.string(), upTo: v.number() },
  returns: v.string(),
  handler: async (ctx, { kind, upTo }) => {
    await system(ctx)
    const rows = await ctx.db
      .query('oauthState')
      .withIndex('by_kind_and_key', (q) => q.eq('kind', kind))
      .take(upTo)
    return out(rows.length)
  },
})

/** Forgets what expired, a batch at a time. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query('oauthState')
      .withIndex('by_expires', (q) =>
        q.gt('expires', 0).lt('expires', Date.now()),
      )
      .take(500)
    for (const e of old) await ctx.db.delete('oauthState', e._id)
    return null
  },
})
