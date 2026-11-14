import { fail } from './errors'
import { accountByHandle, isMember, teamLevel } from './access'
import { actorOut, iso, repoRef, repoUrl, urls } from './present'
import type { ActorRef } from './events'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Issues, as the API shows them, and the bookkeeping every issue write does. */

export function presentIssue(
  repo: Doc<'repos'>,
  i: Doc<'issues'>,
  shown: Partial<Doc<'issues'>> = {},
) {
  const x = { ...i, ...shown }
  return {
    object: 'issue' as const,
    id: x.publicId,
    number: x.number,
    url: `${repoUrl(repo)}/issues/${x.number}`,
    html_url: `${urls().html}/${repo.owner}/${repo.name}/issues/${x.number}`,
    repo: repoRef(repo),
    title: x.title,
    body: x.body,
    state: x.state,
    author: actorOut(x.author),
    labels: x.labels,
    assignees: x.assignees.map(actorOut),
    comments: x.commentCount,
    closed_at: x.closed ? iso(x.closed) : null,
    created_at: iso(x.created),
    updated_at: iso(x.updated),
    version: x.version,
  }
}

export async function issueOf(ctx: QueryCtx, repo: Doc<'repos'>, n: number) {
  const i = await ctx.db
    .query('issues')
    .withIndex('by_repoId_and_number', (q) =>
      q.eq('repoId', repo._id).eq('number', n),
    )
    .unique()
  if (!i) fail('not_found', `No issue #${n} in ${repo.owner}/${repo.name}.`)
  return i
}

/** The actor a handle names, if it is anyone we know. */
export async function knownActor(
  ctx: QueryCtx,
  h: string,
): Promise<ActorRef | null> {
  const account = await accountByHandle(ctx, h)
  if (account) return { id: account.publicId, handle: h, class: 'human' }
  const row = await ctx.db
    .query('actors')
    .withIndex('by_key', (q) => q.eq('key', h))
    .unique()
  return row ? { id: row.publicId, handle: h, class: row.class } : null
}

/**
 * The actors named by handle, if each may be given the issue: someone who
 * can read the repository. Unknown and unable handles are a 400.
 */
export async function assignable(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  list: Array<string>,
) {
  const out: Array<ActorRef> = []
  for (const [k, h] of list.entries()) {
    const a = await knownActor(ctx, h)
    const can =
      a &&
      (repo.visibility === 'public' ||
        (await isMember(ctx, repo.owner, h)) ||
        repo.collaborators.includes(h) ||
        repo.installs.includes(h) ||
        (await teamLevel(ctx, repo, h)) !== null)
    if (!a || !can)
      fail('invalid_request', `${h} cannot be assigned here.`, {
        errors: [
          {
            pointer: `/body/assignees/${k}`,
            code: 'not_assignable',
            message: `${h} is not someone who can read this repository.`,
          },
        ],
      })
    if (!out.some((x) => x.id === a.id)) out.push(a)
  }
  return out
}

/**
 * Label counts follow issues: an open issue counts for each of its labels.
 * Called with the issue before and after a write.
 */
export async function recountLabels(
  ctx: MutationCtx,
  repoId: Id<'repos'>,
  before: { state: string; labels: Array<string> } | null,
  after: { state: string; labels: Array<string> } | null,
) {
  const delta = new Map<string, number>()
  if (before?.state === 'open')
    for (const l of before.labels) delta.set(l, (delta.get(l) ?? 0) - 1)
  if (after?.state === 'open')
    for (const l of after.labels) delta.set(l, (delta.get(l) ?? 0) + 1)
  for (const [name, d] of delta) {
    if (d === 0) continue
    const label = await ctx.db
      .query('labels')
      .withIndex('by_repoId_and_key', (q) =>
        q.eq('repoId', repoId).eq('key', name.toLowerCase()),
      )
      .unique()
    if (label)
      await ctx.db.patch('labels', label._id, {
        openIssues: Math.max(0, label.openIssues + d),
      })
  }
}

/** The labels every repository starts with. */
const DEFAULT_LABELS: Array<[string, string, string]> = [
  ['bug', 'red', 'Something does not work'],
  ['enhancement', 'blue', 'A new feature or a better one'],
  ['docs', 'purple', 'Documentation'],
  ['perf', 'yellow', 'Speed or memory'],
  ['good first issue', 'green', 'A good place to start'],
  ['help wanted', 'orange', 'The maintainers would welcome a hand'],
]

export async function seedLabels(
  ctx: MutationCtx,
  repoId: Id<'repos'>,
  repoPublicId: string,
  at: number,
  seededId: (kind: 'label', at: number, tag: string) => string,
) {
  for (const [name, color, description] of DEFAULT_LABELS)
    await ctx.db.insert('labels', {
      repoId,
      publicId: seededId('label', at, `${repoPublicId}/${name}`),
      name,
      key: name,
      color,
      description,
      created: at,
      openIssues: 0,
    })
}
