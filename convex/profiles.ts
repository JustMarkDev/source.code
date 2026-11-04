import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Id } from './_generated/dataModel'

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('users').take(20)
  },
})

export const get = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (!user) return null
    // Independent reads run together instead of one after the other.
    const [repos, events] = await Promise.all([
      ctx.db
        .query('repos')
        .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', user._id))
        .take(12),
      ctx.db
        .query('events')
        .withIndex('by_actorId', (q) => q.eq('actorId', user._id))
        .order('desc')
        .take(20),
    ])
    // Events can point at repos beyond the first 12. Look each of those up
    // once, however many events mention it.
    const repoNames = new Map<Id<'repos'>, string | null>(
      repos.map((r) => [r._id, r.name]),
    )
    const missing = [
      ...new Set(
        events.map((e) => e.repoId).filter((id) => !repoNames.has(id)),
      ),
    ]
    const found = await Promise.all(
      missing.map((id) => ctx.db.get('repos', id)),
    )
    missing.forEach((id, i) => repoNames.set(id, found[i]?.name ?? null))
    const activity = events.map((e) => ({
      ...e,
      repo: repoNames.get(e.repoId) ?? null,
    }))
    return { user, repos, activity }
  },
})

export const repo = query({
  args: { handle: v.string(), name: v.string() },
  handler: async (ctx, { handle, name }) => {
    const owner = await ctx.db
      .query('users')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (!owner) return null
    const found = await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) =>
        q.eq('ownerId', owner._id).eq('name', name),
      )
      .unique()
    return (
      found && { ...found, owner: { handle: owner.handle, name: owner.name } }
    )
  },
})
