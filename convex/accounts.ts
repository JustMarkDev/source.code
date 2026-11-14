import { v } from 'convex/values'
import { internalQuery } from './_generated/server'

/**
 * Who holds an address, if anyone. People and organizations share one
 * namespace, and an old address that still redirects counts as held by the
 * account it leads to. `authId` is the sign-in user behind a person's
 * account; organizations and seeded sample accounts have none.
 */
export const handleHolder = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const account = await ctx.db
      .query('accounts')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (account)
      return {
        kind: account.kind,
        authId: account.authId ?? null,
        alias: false,
      }
    const alias = await ctx.db
      .query('handleAliases')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (!alias) return null
    const target = await ctx.db.get('accounts', alias.accountId)
    return target
      ? { kind: target.kind, authId: target.authId ?? null, alias: true }
      : null
  },
})
