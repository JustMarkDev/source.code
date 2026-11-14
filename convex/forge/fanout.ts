import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { fanOutEvent } from './notifications'
import { wakeAutomations } from './automations'
import { contributionsFrom } from './people'
import { deliverEvent } from './webhooks'

/**
 * What follows from events once they are numbered: inboxes, and the bots
 * an event wakes. It runs after the write that caused it, in batches, so a
 * write never waits on everyone it tells.
 */
export const process = internalMutation({
  args: { from: v.number(), to: v.number() },
  returns: v.null(),
  handler: async (ctx, { from, to }) => {
    for (const row of await ctx.db
      .query('forgeEvents')
      .withIndex('by_sequence', (q) =>
        q.gte('sequence', from).lte('sequence', to),
      )
      .take(1000)) {
      const e = JSON.parse(row.json)
      await deliverEvent(ctx, e, row.json)
      await fanOutEvent(ctx, e)
      await wakeAutomations(ctx, e)
      await contributionsFrom(ctx, e)
    }
    return null
  },
})
