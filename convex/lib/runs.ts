import { newId } from '@source-code/api/ids'
import { iso, repoRef, urls } from './present'
import { actorFor, emit } from './events'
import { mintToken } from './tokens'
import type { ActorRef } from './events'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Agent runs: what they show, and starting one for a bot something woke. */

export const RUN_NOTES = 50
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
    url: `${urls().api}/repos/${repo ? `${repo.owner}/${repo.name}` : r.repo}/runs/${r.publicId}`,
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
