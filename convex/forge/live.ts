import { v } from 'convex/values'
import { query } from '../_generated/server'
import { actorOf } from '../lib/actor'
import { canRead, isMember, repoByKey } from '../lib/access'
import type { QueryCtx } from '../_generated/server'

/**
 * What a page watches to stay current. A page names the repositories and
 * accounts it shows; this answers a number for each that moves when
 * something in it changes, and one for the viewer's own things. The page
 * reads again only what moved, so a write in one repository does not make
 * every open page in the world read everything again.
 *
 * A repository the viewer cannot read, or that does not exist, answers 0,
 * which never moves: the answer says nothing about it.
 */
export const watch = query({
  args: {
    repos: v.array(v.string()),
    accounts: v.array(v.string()),
  },
  returns: v.object({
    repos: v.record(v.string(), v.number()),
    accounts: v.record(v.string(), v.number()),
    me: v.string(),
  }),
  handler: async (ctx, args) => {
    const a = await actorOf(ctx)
    const repos: Record<string, number> = {}
    for (const key of args.repos.slice(0, 40)) {
      const r = await repoByKey(ctx, key)
      if (!r || !(await canRead(ctx, r, a))) {
        repos[key] = 0
        continue
      }
      const c = await ctx.db
        .query('repoCounters')
        .withIndex('by_repoId', (q) => q.eq('repoId', r._id))
        .unique()
      // The repository's own fields change without an event too (a rename,
      // a visibility change); its ACL revision covers those.
      repos[key] = (c?.rev ?? 0) * 1_000 + (r.aclRev % 1_000)
    }
    const accounts: Record<string, number> = {}
    for (const handle of args.accounts.slice(0, 20))
      accounts[handle] =
        a && (await isMember(ctx, handle, a.handle))
          ? await streamHead(ctx, `~${handle}`)
          : 0
    let me = ''
    if (a && !a.system) {
      const latest = await ctx.db
        .query('notifications')
        .withIndex('by_handle_and_created', (q) => q.eq('handle', a.handle))
        .order('desc')
        .first()
      const unread = await ctx.db
        .query('notifications')
        .withIndex('by_handle_and_unread', (q) =>
          q.eq('handle', a.handle).eq('unread', true),
        )
        .take(100)
      const access = await ctx.db.query('accessRevision').first()
      me = [
        a.handle,
        await streamHead(ctx, `~${a.handle}`),
        latest?._id ?? '',
        unread.length,
        access?.rev ?? 0,
      ].join(':')
    }
    return { repos, accounts, me }
  },
})

async function streamHead(ctx: QueryCtx, stream: string) {
  const last = await ctx.db
    .query('forgeEvents')
    .withIndex('by_stream_and_seq', (q) => q.eq('stream', stream))
    .order('desc')
    .first()
  return last?.seq ?? 0
}
