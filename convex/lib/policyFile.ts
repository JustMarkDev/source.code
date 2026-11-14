import { POLICY_FILE, parsePolicy } from '@source-code/api/policy-file'
import { counters, emit } from './events'
import { loadPolicy, policyRules, savePolicy } from './changes'
import type { ActorRef } from './events'
import type { ChangeRec } from './changeTypes'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * A change that edits the policy file landed: the file on the default branch
 * is now its text. When it reads, its rules become the repository's; when it
 * does not, the last valid rules stay and the errors are shown. On
 * code.storage this runs from the push that lands it; until the store gives
 * the push's files, it runs from the landed patch set's contents.
 */
export async function readLandedPolicy(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  c: ChangeRec,
  by: ActorRef,
) {
  const head = c.patchSets[c.patchSets.length - 1]
  const text = head.contents?.[POLICY_FILE]
  if (typeof text !== 'string') return
  const pol = await loadPolicy(ctx, repo)
  const { content, errors } = parsePolicy(text, policyRules)
  pol.file = { text, sha: head.sha, errors }
  if (content) {
    const had = new Map(pol.customRules.map((r) => [r.id, r]))
    pol.ruleModes = new Map(Object.entries(content.modes))
    pol.customRules = content.custom.map((r) => ({
      ...r,
      createdBy: had.get(r.id)?.createdBy ?? by.handle,
      created: had.get(r.id)?.created ?? Date.now(),
    }))
    pol.exceptions = content.exceptions
    pol.landing = content.landing
  }
  await savePolicy(ctx, repo, pol)
  // Every change's requirements are worked out again.
  for (const x of await ctx.db
    .query('changes')
    .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id))
    .take(5000))
    await ctx.db.patch('changes', x._id, { version: x.version + 1 })
  const n = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', n._id, { changeRev: n.changeRev + 1 })
  await emit(
    ctx,
    repo,
    'repo.policy_changed',
    by,
    { object: 'repo', id: repo.publicId, number: null },
    [errors.length ? 'source.errors' : 'source'],
    null,
  )
}
