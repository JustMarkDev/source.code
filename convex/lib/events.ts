import { newId, seededId } from '@source-code/api/ids'
import type { EventRecord } from '@source-code/api/events'
import { accountByHandle } from './access'
import { now } from './time'
import { internal } from '../_generated/api'
import type { ActorClass } from './actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export type ActorRef = { id: string; handle: string; class: ActorClass }

/**
 * Who an action is recorded as. A person and an agent acting for them share a
 * handle but are not the same actor: policy counts approvals from people, and
 * a run token must never be mistaken for the person who started the run.
 */
export async function actorFor(
  ctx: MutationCtx,
  handle: string,
  cls: ActorClass,
): Promise<ActorRef> {
  const account = await accountByHandle(ctx, handle)
  if (account && cls === 'human')
    return { id: account.publicId, handle, class: cls }
  const own = await actorRow(ctx, handle)
  if (!account && !own) {
    const publicId = seededId('account', now(), handle)
    await ctx.db.insert('actors', { key: handle, publicId, handle, class: cls })
    return { id: publicId, handle, class: cls }
  }
  if (own && own.class === cls) return { id: own.publicId, handle, class: cls }
  const key = `${handle}~${cls}`
  const other = await actorRow(ctx, key)
  if (other) return { id: other.publicId, handle, class: cls }
  const publicId = seededId('account', now(), key)
  await ctx.db.insert('actors', { key, publicId, handle, class: cls })
  return { id: publicId, handle, class: cls }
}

function actorRow(ctx: QueryCtx, key: string) {
  return ctx.db
    .query('actors')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
}

export async function counters(ctx: QueryCtx, repo: Doc<'repos'>) {
  const c = await ctx.db
    .query('repoCounters')
    .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
    .unique()
  if (!c) throw new Error(`repository ${repo.publicId} has no counters`)
  return c
}

export type CounterField = 'changeRev' | 'issueRev' | 'labelRev' | 'policyRev'

/**
 * Every mutation writes exactly one event. It gets the repository's next
 * sequence number, bumps the repository's revision (and a collection's, when
 * named), and stamps the repository as updated.
 */
export async function emit(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  type: string,
  by: ActorRef,
  subject: { object: string; id: string; number: number | null },
  changes: Array<string>,
  data: unknown,
  bump: Array<CounterField> = [],
  /** Whether the repository counts as updated. A webhook turning itself off does not. */
  touch = true,
): Promise<EventRecord> {
  const at = now()
  const c = await counters(ctx, repo)
  const patch: Partial<Doc<'repoCounters'>> = { seq: c.seq + 1, rev: c.rev + 1 }
  for (const f of bump) patch[f] = c[f] + 1
  await ctx.db.patch('repoCounters', c._id, patch)
  if (touch) await ctx.db.patch('repos', repo._id, { updated: at })
  const full = `${repo.owner}/${repo.name}`
  const record: EventRecord = {
    object: 'event',
    id: newId('event', at),
    // Numbered in the whole feed by the sequencer.
    sequence: 0,
    type,
    created_at: new Date(at).toISOString(),
    repo: full,
    repo_id: repo.publicId,
    actor: { object: 'actor', id: by.id, handle: by.handle, class: by.class },
    subject,
    changes,
    data: (data ?? null) as EventRecord['data'],
  }
  await ctx.db.insert('forgeEvents', {
    stream: repo.publicId,
    seq: c.seq + 1,
    type,
    repo: full,
    repoId: repo.publicId,
    created: at,
    json: JSON.stringify(record),
    sequence: null,
  })
  await ctx.scheduler.runAfter(0, internal.forge.events.sequence, {})
  return record
}
