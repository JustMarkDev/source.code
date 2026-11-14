import { newId } from '@source-code/api/ids'
import { runIdOf } from '@source-code/api/trailers'
import { iso, repoRef, urls } from './present'
import { actorFor, emit } from './events'
import { mintToken } from './tokens'
import type { ActorRef } from './events'
import type { Actor } from './actor'
import type { ViaRec } from './changeTypes'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Agent runs: what they show, and starting one for a bot something woke. */

export const RUN_NOTES = 50
/** A run lists at most this many of the patch sets it pushed. */
export const RUN_PATCH_SETS = 200
export const RUNS_RUNNING = 20
export const RUN_SCOPES = [
  'repo:read',
  'issues:read',
  'issues:comment',
  'pulls:read',
  'pulls:comment',
  'secrets:schema',
] as const

/** A run that outlived its token is over, whether or not anyone said so. */
export const runState = (r: Doc<'runs'>, at: number) =>
  r.state === 'running' && r.expires <= at ? ('expired' as const) : r.state

export async function presentRun(
  ctx: QueryCtx,
  r: Doc<'runs'>,
  at: number,
  secret: string | null = null,
  actor?: ActorRef,
) {
  const repo = await ctx.db.get('repos', r.repoId)
  const agent = actor ?? (await findAgent(ctx, r.handle))
  const full = repo ? `${repo.owner}/${repo.name}` : r.repo
  const patchSets = []
  for (const x of await ctx.db
    .query('runPatchSets')
    .withIndex('by_runId', (q) => q.eq('runId', r._id))
    .take(RUN_PATCH_SETS)) {
    const c = await ctx.db.get('changes', x.changeId)
    if (c) patchSets.push({ change: c.number, patch_set: x.patchSet })
  }
  return {
    object: 'run' as const,
    id: r.publicId,
    repo: repo
      ? repoRef(repo)
      : {
          object: 'repo' as const,
          id: 'rep_deleted',
          full_name: r.repo,
          url: `${urls().api}/repos/${r.repo}`,
        },
    task: r.task,
    state: runState(r, at),
    actor: { object: 'actor' as const, ...agent },
    change: r.change,
    scopes: r.scopes,
    token: secret,
    token_id: r.tokenId,
    notes: r.notes.map((n) => ({ at: iso(n.at), text: n.text })),
    summary: r.summary,
    issue: r.issue ?? null,
    harness: r.harness ?? null,
    links: r.links ?? [],
    transcript: r.transcript
      ? {
          size: r.transcript.size,
          sha256: r.transcript.sha256,
          redactions: r.transcript.redactions,
          url: `${urls().api}/repos/${full}/runs/${r.publicId}/transcript`,
        }
      : null,
    patch_sets: patchSets,
    url: `${urls().api}/repos/${full}/runs/${r.publicId}`,
    started_at: iso(r.started),
    expires_at: iso(r.expires),
    finished_at: r.finished ? iso(r.finished) : null,
    version: r.version,
  }
}

/** The actor a run acts as: its handle, as an agent. Read-only lookup. */
async function findAgent(ctx: QueryCtx, handle: string): Promise<ActorRef> {
  const own = await ctx.db
    .query('actors')
    .withIndex('by_key', (q) => q.eq('key', handle))
    .unique()
  if (own?.class === 'agent')
    return { id: own.publicId, handle, class: 'agent' }
  const other = await ctx.db
    .query('actors')
    .withIndex('by_key', (q) => q.eq('key', `${handle}~agent`))
    .unique()
  return { id: other?.publicId ?? 'acc_unknown', handle, class: 'agent' }
}

/**
 * Start a run for a bot or agent that something else woke (an automation).
 * Its token is made and thrown away: the bot picks the run up with
 * `claim`, which gives it a fresh one.
 */
export async function startRunFor(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  handle: string,
  scopes: ReadonlyArray<string>,
  task: string,
  change: number | null,
  ttlMinutes = 60,
) {
  const full = `${repo.owner}/${repo.name}`
  const at = Date.now()
  const publicId = newId('run', at)
  const wanted = [
    ...new Set([...RUN_SCOPES.filter((s) => scopes.includes(s)), 'repo:read']),
  ]
  const { record } = await mintToken(ctx, {
    name: `run ${publicId}`,
    kind: 'run',
    handle,
    class: 'agent',
    scopes: wanted,
    repos: [full],
    ttlMs: ttlMinutes * 60_000,
  })
  const id = await ctx.db.insert('runs', {
    publicId,
    repoId: repo._id,
    repo: full,
    task,
    state: 'running',
    handle,
    change,
    scopes: wanted,
    tokenId: record.id,
    notes: [],
    summary: null,
    started: at,
    expires: at + ttlMinutes * 60_000,
    finished: null,
    version: 1,
  })
  const run = (await ctx.db.get('runs', id))!
  const agent = await actorFor(ctx, handle, 'agent')
  await emit(
    ctx,
    repo,
    'run.started',
    agent,
    { object: 'run', id: publicId, number: null },
    ['state'],
    await presentRun(ctx, run, at, null, agent),
  )
  return run
}

/**
 * Which run a write comes from, and the kind of token it used. A run token
 * carries its run, so a client sends nothing for this.
 */
export async function viaOf(ctx: QueryCtx, p: Actor): Promise<ViaRec> {
  const tokenId = p.tokenId
  if (!tokenId) return { run: null, tokenKind: 'session' }
  const t = await ctx.db
    .query('tokens')
    .withIndex('by_publicId', (q) => q.eq('publicId', tokenId))
    .unique()
  const kind = t?.kind ?? 'session'
  if (kind !== 'run') return { run: null, tokenKind: kind }
  const r = await ctx.db
    .query('runs')
    .withIndex('by_tokenId', (q) => q.eq('tokenId', tokenId))
    .first()
  return { run: r?.publicId ?? null, tokenKind: 'run' }
}

/**
 * Remembers that a run pushed a patch set, in the same transaction as the
 * patch set, and bumps the run's version since its answer lists them.
 */
export async function recordRunPatchSet(
  ctx: MutationCtx,
  changeId: Id<'changes'>,
  patchSet: number,
  run: string | null,
) {
  if (!run) return
  const had = await ctx.db
    .query('runPatchSets')
    .withIndex('by_changeId_and_patchSet', (q) =>
      q.eq('changeId', changeId).eq('patchSet', patchSet),
    )
    .first()
  if (had) return
  const r = await ctx.db
    .query('runs')
    .withIndex('by_publicId', (q) => q.eq('publicId', run))
    .unique()
  if (!r) return
  await ctx.db.insert('runPatchSets', { runId: r._id, changeId, patchSet })
  await ctx.db.patch('runs', r._id, { version: r.version + 1 })
}

/**
 * The same, for a commit: a run token's run wins; otherwise a `Run-Id:`
 * trailer counts when it names a run of the caller's in this repository.
 */
export async function viaOfCommit(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  p: Actor,
  message: string | undefined,
): Promise<ViaRec> {
  const via = await viaOf(ctx, p)
  const named = via.run ? null : runIdOf(message ?? '')
  if (!named) return via
  const r = await ctx.db
    .query('runs')
    .withIndex('by_publicId', (q) => q.eq('publicId', named))
    .unique()
  return r && r.repoId === repo._id && r.handle === p.handle
    ? { ...via, run: r.publicId }
    : via
}
