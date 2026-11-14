import { mutation as plainMutation } from '../_generated/server'
import { claim } from './actor'
import type { MutationCtx } from '../_generated/server'

/**
 * The forge's public mutations. Each is Convex's own `mutation`, plus one
 * thing: when the API sent the request under an `Idempotency-Key`, the key is
 * marked as having changed something, in the same transaction as the change.
 * A write and its mark commit together or not at all, so a retry after a
 * crash can tell a request that wrote nothing (safe to run again) from one
 * that wrote (never run twice). See `apiStores.ts`.
 *
 * The key rides in the API's signed JWT, never in an argument: a page that
 * calls Convex directly cannot mark someone else's key.
 */
export const mutation = ((definition: {
  handler: (ctx: MutationCtx, args: unknown) => unknown
}) =>
  plainMutation({
    ...definition,
    handler: async (ctx: MutationCtx, args: unknown) => {
      const value = await definition.handler(ctx, args)
      await markEffect(ctx)
      return value
    },
  } as never)) as unknown as typeof plainMutation

async function markEffect(ctx: MutationCtx) {
  const id = await ctx.auth.getUserIdentity()
  const held = id?.[claim.idempotency]
  // Only the API's JWT carries the class claim; a sign-in token has none.
  if (typeof held !== 'string' || typeof id?.[claim.class] !== 'string') return
  let scope: unknown
  let key: unknown
  try {
    ;[scope, key] = JSON.parse(held) as Array<unknown>
  } catch {
    return
  }
  if (typeof scope !== 'string' || typeof key !== 'string') return
  const row = await ctx.db
    .query('apiIdempotency')
    .withIndex('by_scope_and_key', (q) => q.eq('scope', scope).eq('key', key))
    .unique()
  if (row && row.effect === undefined && !row.response)
    await ctx.db.patch('apiIdempotency', row._id, { effect: Date.now() })
}
