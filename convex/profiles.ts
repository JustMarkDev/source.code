import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

const byHandle = (ctx: QueryCtx, handle: string) =>
  ctx.db
    .query('accounts')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('accounts').take(20)
  },
})

/**
 * Where an address leads: the account that has it, the account it used to
 * belong to (so an old link redirects), or nothing. Never both.
 */
export const resolve = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const account = await byHandle(ctx, handle)
    if (account) return { kind: account.kind, handle: account.handle }
    const alias = await ctx.db
      .query('handleAliases')
      .withIndex('by_handle', (q) => q.eq('handle', handle))
      .unique()
    if (!alias) return null
    const current = await ctx.db.get('accounts', alias.accountId)
    return current && { kind: 'redirect' as const, handle: current.handle }
  },
})

async function activityFor(
  ctx: QueryCtx,
  account: Doc<'accounts'>,
  repos: Array<Doc<'repos'>>,
) {
  // A person's activity is what they did. An organization's is what happened
  // in its repositories, by whoever did it.
  const events =
    account.kind === 'person'
      ? await ctx.db
          .query('events')
          .withIndex('by_actorId', (q) => q.eq('actorId', account._id))
          .order('desc')
          .take(20)
      : (
          await Promise.all(
            repos.map((r) =>
              ctx.db
                .query('events')
                .withIndex('by_repoId', (q) => q.eq('repoId', r._id))
                .order('desc')
                .take(10),
            ),
          )
        )
          .flat()
          .sort((a, b) => b._creationTime - a._creationTime)
          .slice(0, 20)
  // Events can point at repos beyond the first 12. Look each of those up
  // once, however many events mention it.
  const repoNames = new Map<Id<'repos'>, string | null>(
    repos.map((r) => [r._id, r.name]),
  )
  const missing = [
    ...new Set(events.map((e) => e.repoId).filter((id) => !repoNames.has(id))),
  ]
  const found = await Promise.all(missing.map((id) => ctx.db.get('repos', id)))
  missing.forEach((id, i) => repoNames.set(id, found[i]?.name ?? null))
  return events.map((e) => ({ ...e, repo: repoNames.get(e.repoId) ?? null }))
}

export const get = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const account = await byHandle(ctx, handle)
    if (!account) return null
    const [repos, memberships] = await Promise.all([
      ctx.db
        .query('repos')
        .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', account._id))
        .take(12),
      account.kind === 'organization'
        ? ctx.db
            .query('memberships')
            .withIndex('by_organizationId_and_personId', (q) =>
              q.eq('organizationId', account._id),
            )
            .take(100)
        : Promise.resolve([]),
    ])
    const [activity, people] = await Promise.all([
      activityFor(ctx, account, repos),
      Promise.all(memberships.map((m) => ctx.db.get('accounts', m.personId))),
    ])
    const members = memberships.flatMap((m, i) => {
      const person = people[i]
      return person
        ? [{ handle: person.handle, name: person.name, role: m.role }]
        : []
    })
    return { account, repos, activity, members }
  },
})

export const repo = query({
  args: { handle: v.string(), name: v.string() },
  handler: async (ctx, { handle, name }) => {
    const owner = await byHandle(ctx, handle)
    if (!owner) return null
    const found = await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) =>
        q.eq('ownerId', owner._id).eq('name', name),
      )
      .unique()
    return (
      found && {
        ...found,
        owner: { handle: owner.handle, name: owner.name, kind: owner.kind },
      }
    )
  },
})
