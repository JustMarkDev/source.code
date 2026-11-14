import { v } from 'convex/values'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { repoByKey } from '../lib/access'
import { fail, out } from '../lib/errors'

/**
 * A repository's extras: mirrors, the environment schema with its sealed
 * values, recipients, grants and their audit log, as one document. Only the
 * API server reads and writes them, after its own access checks.
 */

async function docOf(ctx: Parameters<typeof repoByKey>[0], full: string) {
  const repo = await repoByKey(ctx, full)
  if (!repo) return { repo: null, doc: null }
  const doc = await ctx.db
    .query('repoExtras')
    .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
    .unique()
  return { repo, doc }
}

export const get = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) => {
    await system(ctx)
    const { doc } = await docOf(ctx, full)
    return out({ version: doc?.version ?? 0, json: doc?.json ?? null })
  },
})

export const put = mutation({
  args: { full: v.string(), version: v.number(), json: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const { repo, doc } = await docOf(ctx, a.full)
    if (!repo) fail('not_found', `No repository ${a.full}.`)
    if ((doc?.version ?? 0) !== a.version)
      fail(
        'version_mismatch',
        'Someone changed this at the same time. Try again.',
      )
    if (doc)
      await ctx.db.patch('repoExtras', doc._id, {
        json: a.json,
        version: doc.version + 1,
      })
    else
      await ctx.db.insert('repoExtras', {
        repoId: repo._id,
        json: a.json,
        version: 1,
      })
    return out(null)
  },
})

/** Every repository's mirrors, for the status page. */
export const mirrors = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await system(ctx)
    const found = []
    for (const d of await ctx.db.query('repoExtras').take(5000)) {
      const repo = await ctx.db.get('repos', d.repoId)
      if (!repo) continue
      for (const mirror of (JSON.parse(d.json) as { mirrors: Array<unknown> })
        .mirrors)
        found.push({ repo: `${repo.owner}/${repo.name}`, mirror })
    }
    return out(found)
  },
})
