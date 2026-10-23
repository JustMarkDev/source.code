import { v } from 'convex/values'
import { query } from './_generated/server'

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
    const repos = await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', user._id))
      .take(12)
    const events = await ctx.db
      .query('events')
      .withIndex('by_actorId', (q) => q.eq('actorId', user._id))
      .order('desc')
      .take(20)
    const repoNames = new Map(repos.map((r) => [r._id, r.name]))
    const activity = await Promise.all(
      events.map(async (e) => ({
        ...e,
        repo:
          repoNames.get(e.repoId) ??
          (await ctx.db.get('repos', e.repoId))?.name ??
          null,
      })),
    )
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
