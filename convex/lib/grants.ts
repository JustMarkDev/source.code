import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/** Keeps `repoGrants` in step with a repository's collaborators and installs. */
export async function syncGrants(ctx: MutationCtx, repoId: Id<'repos'>) {
  const repo = await ctx.db.get('repos', repoId)
  const want = new Set(repo ? [...repo.collaborators, ...repo.installs] : [])
  const have = await ctx.db
    .query('repoGrants')
    .withIndex('by_repoId_and_handle', (q) => q.eq('repoId', repoId))
    .take(5000)
  for (const g of have)
    if (!want.has(g.handle)) await ctx.db.delete('repoGrants', g._id)
  const had = new Set(have.map((g) => g.handle))
  for (const h of want)
    if (!had.has(h)) await ctx.db.insert('repoGrants', { handle: h, repoId })
}

/** Keeps `issueAssignees` in step with an issue: open issues only. */
export async function syncAssignees(ctx: MutationCtx, issue: Doc<'issues'>) {
  const want = new Set(
    issue.state === 'open' ? issue.assignees.map((a) => a.handle) : [],
  )
  const have = await ctx.db
    .query('issueAssignees')
    .withIndex('by_issueId', (q) => q.eq('issueId', issue._id))
    .take(100)
  for (const g of have)
    if (!want.has(g.handle)) await ctx.db.delete('issueAssignees', g._id)
  const had = new Set(have.map((g) => g.handle))
  for (const h of want)
    if (!had.has(h))
      await ctx.db.insert('issueAssignees', {
        handle: h,
        issueId: issue._id,
        repoId: issue.repoId,
      })
}
