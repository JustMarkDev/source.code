import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { emit } from '../lib/events'
import { branchOwner, hydrate, saveChange } from '../lib/changes'
import { counters } from '../lib/events'

/**
 * A push code.storage told us about. Recorded once, however many times the
 * webhook arrives. A push to the branch of an open change is that change's
 * new patch set; every push is a `repository.pushed` event, which automations
 * can wake on.
 */
const STORAGE_ACTOR = {
  id: 'acc_codestorage000000',
  handle: 'code.storage',
  class: 'bot' as const,
}

export const recordPush = internalMutation({
  args: {
    storeId: v.string(),
    ref: v.string(),
    before: v.string(),
    after: v.string(),
    pushedAt: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const seen = await ctx.db
      .query('pushes')
      .withIndex('by_storeId_and_ref_and_after', (q) =>
        q.eq('storeId', a.storeId).eq('ref', a.ref).eq('after', a.after),
      )
      .first()
    if (seen) return 'duplicate'
    await ctx.db.insert('pushes', a)
    const repo = await ctx.db
      .query('repos')
      .withIndex('by_storeId', (q) => q.eq('storeId', a.storeId))
      .unique()
    if (!repo) return 'unknown_repository'
    const branch = a.ref.startsWith('refs/heads/')
      ? a.ref.slice('refs/heads/'.length)
      : null
    let result = 'recorded'
    if (branch && branch !== repo.defaultBranch && !/^0+$/.test(a.after)) {
      const doc = await branchOwner(ctx, repo, branch)
      if (doc) {
        const l = await hydrate(ctx, doc)
        const c = l.rec
        const prev = c.patchSets[c.patchSets.length - 1]
        if (prev.sha !== a.after) {
          c.patchSets.push({
            n: prev.n + 1,
            sha: a.after,
            tree: a.after.slice(0, 7),
            note: 'Pushed',
            author: c.author,
            created: a.pushedAt,
            files: prev.files,
            kind: 'update',
          })
          // An approval follows a rewrite only when the code did not change.
          for (const r of c.reviews) r.carries = false
          c.updated = Math.max(Date.now(), c.updated + 1)
          c.version++
          await saveChange(ctx, l)
          const k = await counters(ctx, repo)
          await ctx.db.patch('repoCounters', k._id, {
            changeRev: k.changeRev + 1,
          })
          await emit(
            ctx,
            repo,
            'change.updated',
            STORAGE_ACTOR,
            { object: 'change', id: c.id, number: c.number },
            ['head.patch_set', 'policy.state', 'checks.state'],
            null,
          )
          result = 'patch_set_added'
        }
      }
    }
    await emit(
      ctx,
      repo,
      'repository.pushed',
      STORAGE_ACTOR,
      { object: 'repo', id: repo.publicId, number: null },
      ['refs'],
      {
        ref: a.ref,
        before: a.before,
        after: a.after,
      },
    )
    return result
  },
})
