import type { MutationCtx } from '../_generated/server'

/** Something about who may see what changed. See `accessRevision` in the schema. */
export async function bumpAccess(ctx: MutationCtx) {
  const doc = await ctx.db.query('accessRevision').first()
  if (doc) await ctx.db.patch('accessRevision', doc._id, { rev: doc.rev + 1 })
  else await ctx.db.insert('accessRevision', { rev: 1 })
}
