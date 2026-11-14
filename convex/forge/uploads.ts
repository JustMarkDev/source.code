import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { out } from '../lib/errors'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * Upload records. The API checks who may do what and keeps the bytes in the
 * bucket; this keeps what it knows about each file, so any server can
 * finish an upload another one started.
 */

const TTL = 3_600_000
const purpose = v.union(v.literal('evidence'), v.literal('release'))

const rec = (u: Doc<'uploads'>) => ({
  id: u.publicId,
  owner: u.owner,
  filename: u.filename,
  contentType: u.contentType,
  size: u.size,
  purpose: u.purpose,
  state: u.state,
  sha256: u.sha256,
  expires: u.expires,
  created: u.created,
  attachedTo: u.attachedTo,
  attachedRepoId: u.attachedRepoId,
})

const byId = (ctx: QueryCtx, id: string) =>
  ctx.db
    .query('uploads')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()

export const create = mutation({
  args: {
    owner: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    purpose,
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const t = Date.now()
    const id = await ctx.db.insert('uploads', {
      publicId: newId('upload', t),
      owner: a.owner,
      filename: a.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200),
      contentType: a.contentType,
      size: a.size,
      purpose: a.purpose,
      state: 'pending',
      sha256: null,
      expires: t + TTL,
      created: t,
      attachedTo: null,
      attachedRepoId: null,
    })
    return out(rec((await ctx.db.get('uploads', id))!))
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    await system(ctx)
    const u = await byId(ctx, id)
    return out(u ? rec(u) : null)
  },
})

/** Saves what a request changed: the file arrived, or it was attached somewhere. */
export const save = mutation({
  args: {
    id: v.string(),
    state: v.union(v.literal('pending'), v.literal('uploaded')),
    sha256: v.union(v.null(), v.string()),
    attachedTo: v.union(v.null(), v.string()),
    attachedRepoId: v.union(v.null(), v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { id, ...fields }) => {
    await system(ctx)
    const u = await byId(ctx, id)
    if (u) await ctx.db.patch('uploads', u._id, fields)
    return out(null)
  },
})

export const countPending = query({
  args: { owner: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const pending = await ctx.db
      .query('uploads')
      .withIndex('by_owner_and_state', (q) =>
        q.eq('owner', a.owner).eq('state', 'pending'),
      )
      .take(1000)
    return out(pending.filter((u) => u.expires > a.at).length)
  },
})

/** A deleted repository takes its attached files with it. Answers the ids, for the bucket. */
export const dropRepo = mutation({
  args: { repoId: v.string() },
  returns: v.string(),
  handler: async (ctx, { repoId }) => {
    await system(ctx)
    const gone = []
    for (const u of await ctx.db
      .query('uploads')
      .withIndex('by_attachedRepoId', (q) => q.eq('attachedRepoId', repoId))
      .take(5000)) {
      gone.push(u.publicId)
      await ctx.db.delete('uploads', u._id)
    }
    return out(gone)
  },
})

/**
 * Forgets announced uploads whose time ran out without a file, and files
 * never attached a day after that. Answers the ids whose bytes to drop.
 */
export const sweep = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await system(ctx)
    const t = Date.now()
    for (const u of await ctx.db
      .query('uploads')
      .withIndex('by_state_and_expires', (q) =>
        q.eq('state', 'pending').lte('expires', t),
      )
      .take(500))
      await ctx.db.delete('uploads', u._id)
    const gone = []
    for (const u of await ctx.db
      .query('uploads')
      .withIndex('by_state_and_expires', (q) =>
        q.eq('state', 'uploaded').lte('expires', t - 86_400_000),
      )
      .take(500))
      if (u.attachedTo === null) {
        gone.push(u.publicId)
        await ctx.db.delete('uploads', u._id)
      }
    return out(gone)
  },
})
