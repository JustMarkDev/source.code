import { v } from 'convex/values'
import { query } from './_generated/server'

/**
 * What a profile page shows from the account itself, live: the name, the
 * bio and the line about what they are working on now.
 */
export const get = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const account = await ctx.db
      .query('accounts')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (!account) return null
    return {
      account: {
        kind: account.kind,
        handle: account.handle,
        name: account.name,
        bio: account.bio,
        now: account.now ?? null,
      },
    }
  },
})
