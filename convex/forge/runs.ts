import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn, system } from '../lib/actor'
import { assertAdmin, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, emit } from '../lib/events'
import { keysetPage } from '../lib/paginate'
import { mintToken, revokeToken } from '../lib/tokens'
import {
  RUNS_RUNNING,
  RUN_NOTES,
  RUN_SCOPES,
  presentRun,
  runState,
} from '../lib/runs'
import type { Actor } from '../lib/actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Agent runs: started by a person or woken by an automation, each with its own short token. */

async function runRec(ctx: QueryCtx, repo: Doc<'repos'>, id: string) {
  const r = await ctx.db
    .query('runs')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()
  if (!r || r.repoId !== repo._id)
    fail('not_found', `No run ${id} in ${repo.owner}/${repo.name}.`)
  return r
}

export const start = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    task: v.string(),
    change: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
    ttl_minutes: v.number(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const a = {
      ...given,
      ...(await bodyOf(ctx, 'runs.start', {
        task: given.task,
        change: given.change,
        scopes: given.scopes,
        ttl_minutes: given.ttl_minutes,
      })),
    }
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const full = `${repo.owner}/${repo.name}`
    if (a.change !== undefined) {
      const c = await ctx.db
        .query('changes')
        .withIndex('by_repoId_and_number', (q) =>
          q.eq('repoId', repo._id).eq('number', a.change!),
        )
        .unique()
      if (!c) fail('not_found', `No change #${a.change} in ${full}.`)
    }
    // A run token can never do more than the one that started it.
    if (!p.scopes.has('repo:read'))
      fail(
        'insufficient_scope',
        'A run token needs repo:read to report on itself.',
        {
          extra: {
            required_scopes: ['repo:read'],
            token_scopes: [...p.scopes],
          },
        },
      )
    const wanted = [
      ...new Set([
        ...(a.scopes ?? RUN_SCOPES.filter((s) => p.scopes.has(s))),
        'repo:read',
      ]),
    ]
    const missing = wanted.filter((s) => !p.scopes.has(s))
    if (missing.length)
      fail(
        'insufficient_scope',
        `A run cannot have scopes you do not have: ${missing.join(', ')}.`,
        {
          extra: { required_scopes: missing, token_scopes: [...p.scopes] },
        },
      )
    if (wanted.includes('tokens:manage'))
      fail('forbidden', 'A run cannot be given tokens:manage.', {
        hint: 'A run token that could mint tokens would outlive its run.',
      })
    if (wanted.includes('secrets:write'))
      fail('forbidden', 'A run cannot be given secrets:write.', {
        hint: 'Setting secrets is a person-only action.',
      })
    const at = Date.now()
    const mine = await ctx.db
      .query('runs')
      .withIndex('by_handle_and_state', (q) =>
        q.eq('handle', p.handle).eq('state', 'running'),
      )
      .take(RUNS_RUNNING * 5)
    if (
      mine.filter((r) => runState(r, at) === 'running').length >= RUNS_RUNNING
    )
      fail(
        'limit_reached',
        `You can have ${RUNS_RUNNING} runs going at once.`,
        { hint: 'Finish or cancel one first.' },
      )
    const publicId = newId('run', at)
    const { record, secret } = await mintToken(ctx, {
      name: `run ${publicId}`,
      kind: 'run',
      handle: p.handle,
      class: 'agent',
      scopes: wanted,
      repos: [full],
      ttlMs: a.ttl_minutes * 60_000,
    })
    const id = await ctx.db.insert('runs', {
      publicId,
      repoId: repo._id,
      repo: full,
      task: a.task,
      state: 'running',
      handle: p.handle,
      change: a.change ?? null,
      scopes: wanted,
      tokenId: a.dry ? 'tok_dryrun' : record.id,
      notes: [],
      summary: null,
      started: at,
      expires: at + a.ttl_minutes * 60_000,
      finished: null,
      version: 1,
    })
    const run = (await ctx.db.get('runs', id))!
    const agent = await actorFor(ctx, p.handle, 'agent')
    await emit(
      ctx,
      repo,
      'run.started',
      await actorFor(ctx, p.handle, p.class),
      { object: 'run', id: publicId, number: null },
      ['state'],
      await presentRun(ctx, run, at, null, agent),
    )
    return finish(a.dry, {
      run: await presentRun(ctx, run, at, a.dry ? null : secret, agent),
    })
  },
})

export const list = query({
  args: {
    owner: v.string(),
    name: v.string(),
    state: v.optional(v.string()),
    actor: v.optional(v.string()),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, q) => {
    const repo = await resolve(ctx, q.owner, q.name, await actorOf(ctx))
    const page = await keysetPage<Doc<'runs'>>(
      {
        sameKey: (key, id) =>
          ctx.db
            .query('runs')
            .withIndex('by_repoId_and_started_and_publicId', (x) =>
              x
                .eq('repoId', repo._id)
                .eq('started', key as number)
                .lt('publicId', id),
            )
            .order('desc'),
        beyond: (key) =>
          ctx.db
            .query('runs')
            .withIndex('by_repoId_and_started_and_publicId', (x) =>
              key === null
                ? x.eq('repoId', repo._id)
                : x.eq('repoId', repo._id).lt('started', key as number),
            )
            .order('desc'),
      },
      (r) => r.started,
      {
        after: q.after,
        limit: q.limit,
        match: (r) =>
          (!q.state || runState(r, q.at) === q.state) &&
          (!q.actor || r.handle === q.actor),
      },
    )
    return out({
      items: await Promise.all(page.items.map((r) => presentRun(ctx, r, q.at))),
      next: page.next,
    })
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), id: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    return out(await presentRun(ctx, await runRec(ctx, repo, a.id), a.at))
  },
})

/** The bot or agent a run belongs to picks it up: it gets the run's token, and any earlier one stops working. */
export const claim = mutation({
  args: { owner: v.string(), name: v.string(), id: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const r = await runRec(ctx, repo, a.id)
    const at = Date.now()
    if (p.handle !== r.handle)
      fail('forbidden', `Only ${r.handle} can pick up this run.`, {
        hint: `Call this with a token of ${r.handle}.`,
      })
    if (runState(r, at) !== 'running')
      fail('invalid_state', `This run is ${runState(r, at)}.`)
    await revokeToken(ctx, r.tokenId)
    const { record, secret } = await mintToken(ctx, {
      name: `run ${a.id}`,
      kind: 'run',
      handle: r.handle,
      class: 'agent',
      scopes: r.scopes,
      repos: [r.repo],
      ttlMs: r.expires - at,
    })
    await ctx.db.patch('runs', r._id, {
      tokenId: record.id,
      notes: [...r.notes, { at, text: `Picked up by ${p.handle}.` }].slice(
        -RUN_NOTES,
      ),
      version: r.version + 1,
    })
    return out(
      await presentRun(ctx, (await ctx.db.get('runs', r._id))!, at, secret),
    )
  },
})

/** The run's own token, the person who started it, or an admin of the account may act on it. */
async function assertRunOwner(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  r: Doc<'runs'>,
  p: Actor,
) {
  if (p.repos && !p.repos.includes(`${repo.owner}/${repo.name}`.toLowerCase()))
    fail('forbidden', 'This token is not granted for this repository.')
  if (p.tokenId === r.tokenId) return
  if (p.class === 'human' && r.handle === p.handle) return
  if (p.class === 'human') return await assertAdmin(ctx, repo, p)
  fail('forbidden', 'A run token can only control its own run.')
}

export const note = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    text: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'read')
    const r = await runRec(ctx, repo, a.id)
    await assertRunOwner(ctx, repo, r, p)
    const at = Date.now()
    if (runState(r, at) !== 'running')
      fail('invalid_state', `Run ${a.id} is ${runState(r, at)}.`, {
        hint: 'Start another run.',
      })
    await ctx.db.patch('runs', r._id, {
      notes: [...r.notes, { at, text: a.text }].slice(-RUN_NOTES),
      version: r.version + 1,
    })
    return finish(
      a.dry,
      await presentRun(ctx, (await ctx.db.get('runs', r._id))!, at),
    )
  },
})

export const end = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    state: v.union(
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    summary: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'read')
    const r = await runRec(ctx, repo, a.id)
    await assertRunOwner(ctx, repo, r, p)
    const at = Date.now()
    const now = runState(r, at)
    // Finishing twice with the same outcome is a no-op, so a retry is safe.
    if (now === a.state) return out(await presentRun(ctx, r, at))
    if (now !== 'running')
      fail('invalid_state', `Run ${a.id} is already ${now}.`)
    await ctx.db.patch('runs', r._id, {
      state: a.state,
      finished: at,
      ...(a.summary !== undefined ? { summary: a.summary } : {}),
      version: r.version + 1,
    })
    await revokeToken(ctx, r.tokenId)
    const shown = await presentRun(ctx, (await ctx.db.get('runs', r._id))!, at)
    await emit(
      ctx,
      repo,
      'run.finished',
      await actorFor(ctx, p.handle, p.class),
      { object: 'run', id: a.id, number: null },
      ['state'],
      shown,
    )
    return finish(a.dry, shown)
  },
})

/** Runs and operations over for more than a week, a batch at a time. */
async function sweepOld(ctx: MutationCtx) {
  const cutoff = Date.now() - 7 * 86_400_000
  for (const r of await ctx.db
    .query('runs')
    .withIndex('by_finished', (q) => q.gt('finished', 0).lt('finished', cutoff))
    .take(500))
    await ctx.db.delete('runs', r._id)
  // A run whose token ran out without anyone finishing it is over too.
  for (const r of await ctx.db
    .query('runs')
    .withIndex('by_state_and_expires', (q) =>
      q.eq('state', 'running').lt('expires', cutoff),
    )
    .take(500))
    await ctx.db.delete('runs', r._id)
  for (const o of await ctx.db
    .query('operations')
    .withIndex('by_finished', (q) => q.gt('finished', 0).lt('finished', cutoff))
    .take(500))
    await ctx.db.delete('operations', o._id)
}

export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await sweepOld(ctx)
    return null
  },
})

/** The same, now, for the API server's housekeeping call. */
export const sweepNow = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await system(ctx)
    await sweepOld(ctx)
    return out(null)
  },
})

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    issue: v.optional(v.union(v.null(), v.number())),
    harness: v.optional(v.union(v.null(), v.string())),
    links: v.optional(v.array(v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'read')
    const r = await runRec(ctx, repo, a.id)
    await assertRunOwner(ctx, repo, r, p)
    const issue = a.issue
    if (issue !== undefined && issue !== null) {
      const found = await ctx.db
        .query('issues')
        .withIndex('by_repoId_and_number', (q) =>
          q.eq('repoId', repo._id).eq('number', issue),
        )
        .unique()
      if (!found)
        fail(
          'invalid_request',
          `No issue #${issue} in ${repo.owner}/${repo.name}.`,
          {
            errors: [
              {
                pointer: '/body/issue',
                code: 'unknown',
                message: 'Name an issue in this repository.',
              },
            ],
          },
        )
    }
    const next = {
      issue: issue === undefined ? (r.issue ?? null) : issue,
      harness: a.harness === undefined ? (r.harness ?? null) : a.harness,
      links: a.links === undefined ? (r.links ?? []) : [...new Set(a.links)],
    }
    const at = Date.now()
    const same =
      next.issue === (r.issue ?? null) &&
      next.harness === (r.harness ?? null) &&
      JSON.stringify(next.links) === JSON.stringify(r.links ?? [])
    if (same) return out(await presentRun(ctx, r, at))
    await ctx.db.patch('runs', r._id, { ...next, version: r.version + 1 })
    return finish(
      a.dry,
      await presentRun(ctx, (await ctx.db.get('runs', r._id))!, at),
    )
  },
})

async function transcriptAllowed(
  ctx: QueryCtx,
  a: { owner: string; name: string; id: string },
) {
  const p = await signedIn(ctx)
  const repo = await resolve(ctx, a.owner, a.name, p, 'read')
  const r = await runRec(ctx, repo, a.id)
  await assertRunOwner(ctx, repo, r, p)
  if ((repo.transcripts ?? 'off') !== 'on')
    fail(
      'transcripts_disabled',
      `${repo.owner}/${repo.name} does not keep agent transcripts.`,
    )
  return { repo, r }
}

/** Where a run's transcript may go, and the one it replaces. */
export const transcriptTarget = query({
  args: { owner: v.string(), name: v.string(), id: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const { repo, r } = await transcriptAllowed(ctx, a)
    return out({
      full: `${repo.owner}/${repo.name}`,
      repoId: repo.publicId,
      previous: r.transcript?.uploadId ?? null,
    })
  },
})

/** Attaches a transcript the API already scanned and stored. */
export const attachTranscript = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    transcript: v.object({
      uploadId: v.string(),
      size: v.number(),
      sha256: v.string(),
      redactions: v.number(),
    }),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const { r } = await transcriptAllowed(ctx, a)
    await ctx.db.patch('runs', r._id, {
      transcript: a.transcript,
      version: r.version + 1,
    })
    return finish(
      a.dry,
      await presentRun(ctx, (await ctx.db.get('runs', r._id))!, Date.now()),
    )
  },
})

/** A run's transcript record, for someone who may read the repository. */
export const transcript = query({
  args: { owner: v.string(), name: v.string(), id: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const r = await runRec(ctx, repo, a.id)
    if ((repo.transcripts ?? 'off') !== 'on')
      fail(
        'transcripts_disabled',
        `${repo.owner}/${repo.name} does not keep agent transcripts.`,
      )
    if (!r.transcript) fail('not_found', `Run ${a.id} has no transcript.`)
    return out(r.transcript)
  },
})
