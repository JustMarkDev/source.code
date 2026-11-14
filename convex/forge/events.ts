import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, query } from '../_generated/server'
import { system } from '../lib/actor'
import { out } from '../lib/errors'
import type { MutationCtx } from '../_generated/server'

/**
 * The event feed. Writes add events without a number; `sequence` numbers
 * them, oldest first, a batch at a time. It is the only writer of the head,
 * so writes in different repositories never wait on each other.
 *
 * API servers read the feed (`since`) into a window of their own, which is
 * what their streams, long polls and webhooks are served from.
 */

const BATCH = 500

async function headDoc(ctx: MutationCtx) {
  const h = await ctx.db.query('eventHead').first()
  if (h) return h
  const id = await ctx.db.insert('eventHead', { head: 0 })
  return (await ctx.db.get('eventHead', id))!
}

export const sequence = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const waiting = await ctx.db
      .query('forgeEvents')
      .withIndex('by_sequence', (q) => q.eq('sequence', null))
      .take(BATCH)
    if (!waiting.length) return null
    const h = await headDoc(ctx)
    let head = h.head
    for (const e of waiting) {
      head++
      const record = JSON.parse(e.json) as { sequence: number }
      record.sequence = head
      await ctx.db.patch('forgeEvents', e._id, {
        sequence: head,
        json: JSON.stringify(record),
      })
    }
    await ctx.db.patch('eventHead', h._id, { head })
    await ctx.scheduler.runAfter(0, internal.forge.fanout.process, {
      from: h.head + 1,
      to: head,
    })
    if (waiting.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.forge.events.sequence, {})
    return null
  },
})

/** The newest sequence and the oldest still kept. API servers watch this. */
export const head = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const h = await ctx.db.query('eventHead').first()
    const first = await ctx.db
      .query('forgeEvents')
      .withIndex('by_sequence', (q) => q.gt('sequence', 0))
      .first()
    const access = await ctx.db.query('accessRevision').first()
    return out({
      head: h?.head ?? 0,
      oldest: first?.sequence ?? (h?.head ?? 0) + 1,
      access: access?.rev ?? 0,
    })
  },
})

/** Events after a sequence, oldest first, as JSON text. Only API servers read the whole feed. */
export const since = query({
  args: { after: v.number(), limit: v.number() },
  returns: v.string(),
  handler: async (ctx, { after, limit }) => {
    await system(ctx)
    const rows = await ctx.db
      .query('forgeEvents')
      .withIndex('by_sequence', (q) => q.gt('sequence', after))
      .take(Math.min(limit, 1000))
    return out(rows.map((r) => r.json))
  },
})
