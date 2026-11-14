import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { mintToken, record, revokeToken } from '../lib/tokens'
import { out } from '../lib/errors'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * Tokens and OAuth authorizations. Only the hash of a secret is kept; the
 * secret is made here and handed back once, when the token is created.
 *
 * Only the API server calls these (its own JWT says so): it checks bearer
 * tokens before anyone is known, and the rules about who may create what
 * live in its operations. A token limited to repositories keeps their ids,
 * not their names, so a rename never needs every token rewritten and a new
 * repository at an old name is never the one a token was given.
 */

const audience = v.array(v.union(v.literal('api'), v.literal('mcp')))
const tokenKind = v.union(
  v.literal('personal'),
  v.literal('bot'),
  v.literal('run'),
  v.literal('oauth'),
)
const cls = v.union(v.literal('human'), v.literal('agent'), v.literal('bot'))

const byPublicId = (ctx: QueryCtx, id: string) =>
  ctx.db
    .query('tokens')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()

/** Looks a token up by its hash and checks it may be used now, here. */
export const find = query({
  args: {
    hash: v.string(),
    audience: v.union(v.literal('api'), v.literal('mcp')),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await system(ctx)
    const t = await ctx.db
      .query('tokens')
      .withIndex('by_hash', (q) => q.eq('hash', args.hash))
      .unique()
    if (!t) return out({ ok: false, reason: 'unknown' })
    if (t.revokedAt !== null) return out({ ok: false, reason: 'revoked' })
    if (t.expiresAt <= args.at) return out({ ok: false, reason: 'expired' })
    if (!t.audience.includes(args.audience))
      return out({ ok: false, reason: 'audience' })
    return out({ ok: true, record: await record(ctx, t) })
  },
})

/** Notes the token was used: at most once a minute, never a write per request. */
export const touch = mutation({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const t = await byPublicId(ctx, id)
    const at = Date.now()
    if (t && (t.lastUsedAt === null || at - t.lastUsedAt > 60_000))
      await ctx.db.patch('tokens', t._id, { lastUsedAt: at })
    return out(null)
  },
})

export const create = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    kind: tokenKind,
    handle: v.string(),
    actingAs: v.optional(v.string()),
    class: cls,
    scopes: v.array(v.string()),
    repos: v.optional(v.union(v.null(), v.array(v.string()))),
    audience: v.optional(audience),
    ttlMs: v.number(),
    authorizationId: v.optional(v.string()),
    limitKey: v.optional(v.string()),
    // A secret that already exists (sample data); otherwise one is made here.
    secret: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await system(ctx)
    return out(await mintToken(ctx, args))
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const t = await byPublicId(ctx, id)
    return out(t ? await record(ctx, t) : null)
  },
})

export const list = query({
  args: { handle: v.string(), kinds: v.array(tokenKind) },
  returns: v.string(),
  handler: async (ctx, { handle, kinds }) => {
    await system(ctx)
    const rows = await ctx.db
      .query('tokens')
      .withIndex('by_handle_and_createdAt', (q) => q.eq('handle', handle))
      .order('desc')
      .take(2000)
    const live = rows.filter(
      (t) => kinds.includes(t.kind) && t.revokedAt === null,
    )
    return out(await Promise.all(live.map((t) => record(ctx, t))))
  },
})

export const countActive = query({
  args: { handle: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, { handle, at }) => {
    await system(ctx)
    const rows = await ctx.db
      .query('tokens')
      .withIndex('by_handle_and_createdAt', (q) => q.eq('handle', handle))
      .take(2000)
    return out(
      rows.filter(
        (t) => t.revokedAt === null && t.kind !== 'oauth' && t.expiresAt > at,
      ).length,
    )
  },
})

export const revoke = mutation({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    return out(await revokeToken(ctx, id))
  },
})

// ---- OAuth authorizations ----------------------------------------------------

function authorization(a: Doc<'authorizations'>) {
  return {
    id: a.publicId,
    clientId: a.clientId,
    clientName: a.clientName,
    handle: a.handle,
    scopes: a.scopes,
    audience: a.audience,
    createdAt: a.createdAt,
    lastUsedAt: a.lastUsedAt,
    revokedAt: a.revokedAt,
  }
}

const authById = (ctx: QueryCtx, id: string) =>
  ctx.db
    .query('authorizations')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()

export const getAuthorization = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const a = await authById(ctx, id)
    return out(a ? authorization(a) : null)
  },
})

export const createAuthorization = mutation({
  args: {
    clientId: v.string(),
    clientName: v.string(),
    handle: v.string(),
    scopes: v.array(v.string()),
    audience,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await system(ctx)
    const at = Date.now()
    const id = await ctx.db.insert('authorizations', {
      ...args,
      publicId: newId('authorization', at),
      createdAt: at,
      lastUsedAt: null,
      revokedAt: null,
    })
    return out(authorization((await ctx.db.get('authorizations', id))!))
  },
})

/** Revoking an authorization stops every token made under it, on the next request. */
export const revokeAuthorization = mutation({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const a = await authById(ctx, id)
    if (!a || a.revokedAt !== null) return out(false)
    const at = Date.now()
    await ctx.db.patch('authorizations', a._id, { revokedAt: at })
    for (const t of await ctx.db
      .query('tokens')
      .withIndex('by_authorizationId', (q) => q.eq('authorizationId', id))
      .take(5000))
      if (t.revokedAt === null)
        await ctx.db.patch('tokens', t._id, { revokedAt: at })
    return out(true)
  },
})

export const listAuthorizations = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    await system(ctx)
    const rows = await ctx.db
      .query('authorizations')
      .withIndex('by_handle_and_createdAt', (q) => q.eq('handle', handle))
      .order('desc')
      .take(1000)
    return out(rows.filter((a) => a.revokedAt === null).map(authorization))
  },
})

const DAY = 86_400_000

/** Drops tokens a day past expiry or revocation, a batch at a time. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const at = Date.now()
    const old = await ctx.db
      .query('tokens')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', at - DAY))
      .take(500)
    for (const t of old) await ctx.db.delete('tokens', t._id)
    return null
  },
})
