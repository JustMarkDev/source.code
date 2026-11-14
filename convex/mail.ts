import { v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { sendMail } from './lib/mail'
import type { MutationCtx } from './_generated/server'

/**
 * Mail a write sends. It is queued in the same transaction as the write, so
 * it goes out only if the write committed, and sent right after by `deliver`.
 */
export async function queueMail(
  ctx: MutationCtx,
  m: { to: string; subject: string; text: string },
) {
  const id = await ctx.db.insert('outbox', { ...m, created: Date.now() })
  await ctx.scheduler.runAfter(0, internal.mail.deliver, { id })
}

export const take = internalMutation({
  args: { id: v.id('outbox') },
  returns: v.union(
    v.null(),
    v.object({ to: v.string(), subject: v.string(), text: v.string() }),
  ),
  handler: async (ctx, { id }) => {
    const m = await ctx.db.get('outbox', id)
    if (!m) return null
    await ctx.db.delete('outbox', id)
    return { to: m.to, subject: m.subject, text: m.text }
  },
})

export const deliver = internalAction({
  args: { id: v.id('outbox') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const m = await ctx.runMutation(internal.mail.take, { id })
    if (m) await sendMail(m.to, m.subject, m.text)
    return null
  },
})

/** What is waiting, oldest first. Tests read it to see what was sent. */
export const pending = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('outbox'),
      to: v.string(),
      subject: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx) =>
    (await ctx.db.query('outbox').take(100)).map((m) => ({
      id: m._id,
      to: m.to,
      subject: m.subject,
      text: m.text,
    })),
})
