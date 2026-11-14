import { v } from 'convex/values'
import { query } from '../_generated/server'
import { actorOf } from '../lib/actor'
import { canRead, repoByPublicId } from '../lib/access'
import { fail, out } from '../lib/errors'
import { presentRepo } from '../lib/present'
import { presentIssue } from '../lib/issues'
import { hydrate, viewFor } from '../lib/changes'
import { historyId, repoKey } from './repos'
import type { Actor } from '../lib/actor'
import type { QueryCtx } from '../_generated/server'

/** Sync accepts an old name and the current name; it resolves the stable id. */
async function forSync(ctx: QueryCtx, full: string, p: Actor | null) {
  const id = await historyId(ctx, full)
  const r = id ? await repoByPublicId(ctx, id) : null
  if (!r || !(await canRead(ctx, r, p)))
    fail('not_found', `No repository ${full}.`, {
      hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
    })
  return r
}

export const version = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) =>
    out(await repoKey(ctx, await forSync(ctx, full, await actorOf(ctx)))),
})

/**
 * Everything in a repository as it is now: the repository, its changes and
 * its issues, as their events show them. The API slices it into pages.
 */
export const snapshot = query({
  args: { full: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, { full, at }) => {
    const p = await actorOf(ctx)
    const repo = await forSync(ctx, full, p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const objects: Array<unknown> = [await presentRepo(ctx, repo, at)]
    if (canPull) {
      const docs = await ctx.db
        .query('changes')
        .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id))
        .take(5000)
      const loaded = await Promise.all(docs.map((d) => hydrate(ctx, d)))
      const view = await viewFor(
        ctx,
        repo,
        null,
        at,
        loaded.map((l) => l.rec),
      )
      for (const l of loaded) objects.push(view.presentChange(l.rec, 'event'))
    }
    if (canIssue)
      for (const i of await ctx.db
        .query('issues')
        .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id))
        .take(10_000))
        objects.push(presentIssue(repo, i))
    return out({ id: repo.publicId, objects })
  },
})
