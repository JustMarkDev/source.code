import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { signedIn, system } from '../lib/actor'
import { accountByHandle, repoByPublicId, resolve, roleIn } from '../lib/access'
import { bumpAccess } from '../lib/acl'
import { fail, finish, out } from '../lib/errors'
import { counters } from '../lib/events'
import { iso } from '../lib/present'
import { presentRun, startRunFor } from '../lib/runs'
import { mintToken } from '../lib/tokens'
import { syncGrants } from '../lib/grants'
import type { Actor } from '../lib/actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Bots a person or organization owns, where they are installed, and the
 * automations that wake one when something happens in a repository. An
 * installed bot acts with its token's scopes; an automation is counted each
 * time its trigger fires, and starts a run its bot picks up.
 */

const INTERVAL: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
}

/** Event types, as an automation names them. */
const triggerOf: Record<string, string> = {
  'issue.created': 'issue.created',
  'change.opened': 'change.opened',
  'change.updated': 'change.updated',
  'ci.failed': 'ci.failed',
  'finding.raised': 'finding.raised',
}

const nextRunOf = (a: {
  triggers: Array<string>
  every?: string
  lastScheduled?: number
  created: number
}) =>
  a.triggers.includes('schedule')
    ? (a.lastScheduled ?? a.created) + INTERVAL[a.every ?? 'week']
    : null

async function bumpRev(ctx: MutationCtx, repo: Doc<'repos'>) {
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, {
    automationRev: (c.automationRev ?? 0) + 1,
  })
}

async function botBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query('bots')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
}

/** Count a trigger and start a run its bot picks up with its own token. */
async function wake(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  a: Doc<'automations'>,
  why: string,
  change: number | null,
) {
  const at = Date.now()
  const patch: Partial<Doc<'automations'>> = {
    triggered: a.triggered + 1,
    lastTriggered: at,
    version: a.version + 1,
  }
  await bumpRev(ctx, repo)
  const bot = await botBySlug(ctx, a.bot)
  if (!bot || !repo.installs.includes(a.bot)) {
    await ctx.db.patch('automations', a._id, patch)
    return null
  }
  const run = await startRunFor(
    ctx,
    repo,
    a.bot,
    bot.scopes,
    `${a.name}: ${why}.\n\n${a.instructions}`,
    change,
  )
  await ctx.db.patch('automations', a._id, { ...patch, lastRun: run.publicId })
  return run
}

/** What an event wakes, run after the event is numbered (`fanout.ts`). */
export async function wakeAutomations(
  ctx: MutationCtx,
  e: {
    type: string
    repo_id: string | null
    actor: { handle: string }
    subject: { object: string; number: number | null }
    data: Record<string, unknown> | null
  },
) {
  if (!e.repo_id) return
  const repo = await repoByPublicId(ctx, e.repo_id)
  if (!repo) return
  const list = await ctx.db
    .query('automations')
    .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
    .take(500)
  if (!list.length) return
  const body =
    e.type === 'issue.commented' || e.type === 'change.commented'
      ? String((e.data as { body?: string } | null)?.body ?? '').toLowerCase()
      : ''
  for (const a of list) {
    // A comment that names the bot wakes it, as `bot.mentioned`.
    const t =
      triggerOf[e.type] ??
      (body && new RegExp(`(^|[^\\w@/])@${a.bot}\\b`).test(body)
        ? 'bot.mentioned'
        : undefined)
    if (t && a.enabled && a.triggers.includes(t) && a.bot !== e.actor.handle) {
      const what =
        e.subject.number !== null
          ? `${e.subject.object} #${e.subject.number}`
          : e.subject.object
      await wake(
        ctx,
        (await ctx.db.get('repos', repo._id))!,
        (await ctx.db.get('automations', a._id))!,
        `${e.type} on ${what} by ${e.actor.handle}`,
        e.subject.object === 'change' ? e.subject.number : null,
      )
    }
  }
}

/**
 * Fire every scheduled automation that is due. A schedule missed while
 * nothing was running fires once, not once per interval it missed.
 */
async function tick(ctx: MutationCtx) {
  const at = Date.now()
  let fired = 0
  for (const a of await ctx.db
    .query('automations')
    .withIndex('by_nextRun', (q) => q.gt('nextRun', 0).lte('nextRun', at))
    .take(500)) {
    if (!a.enabled) continue
    const repo = await ctx.db.get('repos', a.repoId)
    if (!repo) continue
    await ctx.db.patch('automations', a._id, {
      lastScheduled: at,
      nextRun: nextRunOf({ ...a, lastScheduled: at }),
    })
    await wake(
      ctx,
      repo,
      (await ctx.db.get('automations', a._id))!,
      `its ${a.every ?? 'week'}ly schedule`,
      null,
    )
    fired++
  }
  return fired
}

export const tickSchedules = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await tick(ctx),
})

/** The same, for an API server's own timer. */
export const tickNow = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await system(ctx)
    return out(await tick(ctx))
  },
})

function presentAutomation(
  a: Doc<'automations'>,
  shown: Partial<Doc<'automations'>> = {},
) {
  const x = { ...a, ...shown }
  const next = nextRunOf(x)
  return {
    object: 'automation' as const,
    id: x.publicId,
    name: x.name,
    bot: x.bot,
    triggers: x.triggers,
    runtime: x.runtime,
    target: x.target,
    instructions: x.instructions,
    enabled: x.enabled,
    triggered: x.triggered,
    last_triggered_at: x.lastTriggered === null ? null : iso(x.lastTriggered),
    last_run: x.lastRun ?? null,
    every: x.triggers.includes('schedule') ? (x.every ?? 'week') : null,
    next_run_at: next === null ? null : iso(next),
    created_at: iso(x.created),
    version: x.version,
  }
}

async function automationOf(ctx: QueryCtx, repo: Doc<'repos'>, id: string) {
  const a = await ctx.db
    .query('automations')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()
  if (!a || a.repoId !== repo._id) fail('not_found', `No automation ${id}.`)
  return a
}

export const run = mutation({
  args: { owner: v.string(), name: v.string(), id: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const auto = await automationOf(ctx, repo, a.id)
    const r = await wake(ctx, repo, auto, `started by ${p.handle}`, null)
    if (!r)
      fail(
        'invalid_state',
        `${auto.bot} is not installed on ${repo.owner}/${repo.name}.`,
      )
    return out(await presentRun(ctx, r, Date.now()))
  },
})

export const list = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(
      ctx,
      a.owner,
      a.name,
      await signedIn(ctx),
      'write',
    )
    const all = await ctx.db
      .query('automations')
      .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
      .take(500)
    return out(all.map((x) => presentAutomation(x)))
  },
})

export const version = query({
  args: { owner: v.string(), name: v.string(), access: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(
      ctx,
      a.owner,
      a.name,
      await signedIn(ctx),
      'write',
    )
    const c = await counters(ctx, repo)
    return out(`${repo.publicId}.aut${c.automationRev ?? 0}.${a.access}`)
  },
})

export const create = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    body: v.object({
      name: v.string(),
      bot: v.string(),
      triggers: v.array(v.string()),
      runtime: v.string(),
      target: v.string(),
      instructions: v.string(),
      enabled: v.optional(v.boolean()),
      every: v.optional(v.string()),
    }),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { owner, name, body: given, dry }) => {
    const body = await bodyOf(ctx, 'automations.create', given)
    const repo = await resolve(ctx, owner, name, await signedIn(ctx), 'write')
    if (!repo.installs.includes(body.bot))
      fail(
        'invalid_state',
        `${body.bot} is not installed on ${repo.owner}/${repo.name}. Install it first.`,
      )
    const at = Date.now()
    const fields = {
      repoId: repo._id,
      publicId: newId('automation', at),
      name: body.name,
      bot: body.bot,
      triggers: [...new Set(body.triggers)],
      runtime: body.runtime,
      target: body.target,
      instructions: body.instructions,
      enabled: body.enabled ?? true,
      ...(body.every ? { every: body.every } : {}),
      triggered: 0,
      lastTriggered: null,
      lastRun: null,
      created: at,
      version: 1,
    }
    const id = await ctx.db.insert('automations', {
      ...fields,
      nextRun: nextRunOf(fields),
    })
    await bumpRev(ctx, repo)
    return finish(
      dry,
      presentAutomation((await ctx.db.get('automations', id))!),
    )
  },
})

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    body: v.object({
      name: v.optional(v.string()),
      triggers: v.optional(v.array(v.string())),
      runtime: v.optional(v.string()),
      target: v.optional(v.string()),
      instructions: v.optional(v.string()),
      enabled: v.optional(v.boolean()),
      every: v.optional(v.string()),
    }),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { owner, name, id, body: given, dry }) => {
    const body = await bodyOf(ctx, 'automations.update', given)
    const repo = await resolve(ctx, owner, name, await signedIn(ctx), 'write')
    const a = await automationOf(ctx, repo, id)
    const next = { ...a, ...body }
    await ctx.db.patch('automations', a._id, {
      ...body,
      version: a.version + 1,
      nextRun: nextRunOf(next),
    })
    await bumpRev(ctx, repo)
    return finish(
      dry,
      presentAutomation((await ctx.db.get('automations', a._id))!),
    )
  },
})

export const remove = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(
      ctx,
      a.owner,
      a.name,
      await signedIn(ctx),
      'write',
    )
    const auto = await automationOf(ctx, repo, a.id)
    await ctx.db.delete('automations', auto._id)
    await bumpRev(ctx, repo)
    return finish(a.dry, null)
  },
})

// ---- bots -----------------------------------------------------------------------

/** The account, if the viewer manages it: themself, or an org they own or administer. */
async function ownedAccount(ctx: QueryCtx, handle: string, p: Actor | null) {
  const a = await accountByHandle(ctx, handle)
  if (!a || !p) fail('not_found', `No account ${handle}.`)
  const ok =
    a.kind === 'person'
      ? a.handle === p.handle
      : ['owner', 'admin'].includes((await roleIn(ctx, a, p.handle)) ?? '')
  if (!ok)
    fail(
      a.kind === 'person' ? 'not_found' : 'forbidden',
      a.kind === 'person'
        ? `No account ${handle}.`
        : 'Only owners and admins manage bots for an organization.',
    )
  return a
}

async function presentBot(
  ctx: QueryCtx,
  b: Doc<'bots'>,
  shown: Partial<Doc<'bots'>> = {},
) {
  const x = { ...b, ...shown }
  const installs: Array<string> = []
  for (const id of x.installs) {
    const r = await ctx.db.get('repos', id)
    if (r && r.installs.includes(x.slug)) installs.push(`${r.owner}/${r.name}`)
  }
  const tokens = (
    await ctx.db
      .query('tokens')
      .withIndex('by_handle_and_createdAt', (q) => q.eq('handle', x.slug))
      .take(500)
  ).filter((t) => t.kind === 'bot' && t.revokedAt === null).length
  return {
    object: 'bot' as const,
    slug: x.slug,
    name: x.name,
    description: x.description,
    owner: x.owner,
    class: x.class,
    scopes: x.scopes,
    installs: installs.sort(),
    tokens,
    created_at: iso(x.created),
  }
}

async function botOf(ctx: QueryCtx, slug: string, p: Actor | null) {
  const b = await botBySlug(ctx, slug)
  if (!b) fail('not_found', `No bot ${slug}.`)
  await ownedAccount(ctx, b.owner, p)
  return b
}

export const listBots = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    await ownedAccount(ctx, handle, await signedIn(ctx))
    const all = await ctx.db
      .query('bots')
      .withIndex('by_owner', (q) => q.eq('owner', handle))
      .take(500)
    return out(await Promise.all(all.map((b) => presentBot(ctx, b))))
  },
})

export const createBot = mutation({
  args: {
    handle: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    class: v.union(v.literal('bot'), v.literal('agent')),
    scopes: v.array(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await ownedAccount(ctx, a.handle, await signedIn(ctx))
    const taken = () =>
      fail('invalid_request', `${a.slug} is taken.`, {
        errors: [
          {
            pointer: '/body/slug',
            code: 'taken',
            message: `${a.slug} is taken.`,
          },
        ],
      })
    const have = await botBySlug(ctx, a.slug)
    if (have) {
      if (have.owner !== a.handle) taken()
      return out({ bot: await presentBot(ctx, have), created: false })
    }
    const actor = await ctx.db
      .query('actors')
      .withIndex('by_key', (q) => q.eq('key', a.slug))
      .unique()
    if ((await accountByHandle(ctx, a.slug)) || actor) taken()
    const at = Date.now()
    const id = await ctx.db.insert('bots', {
      slug: a.slug,
      name: a.name,
      description: a.description ?? '',
      owner: a.handle,
      class: a.class,
      scopes: a.scopes,
      installs: [],
      created: at,
    })
    await ctx.db.insert('actors', {
      key: a.slug,
      publicId: newId('account', at),
      handle: a.slug,
      class: a.class,
    })
    return finish(a.dry, {
      bot: await presentBot(ctx, (await ctx.db.get('bots', id))!),
      created: true,
    })
  },
})

export const install = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    slug: v.string(),
    on: v.boolean(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const b = await botBySlug(ctx, a.slug)
    if (!b) fail('not_found', `No bot ${a.slug}.`)
    // A bot goes where its owner's repositories are, or where its owner can write.
    if (b.owner !== repo.owner) await ownedAccount(ctx, b.owner, p)
    const installs = new Set(repo.installs)
    if (a.on) installs.add(a.slug)
    else installs.delete(a.slug)
    await ctx.db.patch('repos', repo._id, {
      installs: [...installs],
      aclRev: repo.aclRev + 1,
    })
    await syncGrants(ctx, repo._id)
    const ids = new Set(b.installs)
    if (a.on) ids.add(repo._id)
    else ids.delete(repo._id)
    await ctx.db.patch('bots', b._id, { installs: [...ids] })
    await bumpAccess(ctx)
    return finish(
      a.dry,
      await presentBot(ctx, (await ctx.db.get('bots', b._id))!),
    )
  },
})

export const updateBot = mutation({
  args: {
    slug: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'bots.update', {
      name: a.name,
      description: a.description,
      scopes: a.scopes,
    })
    const b = await botOf(ctx, a.slug, await signedIn(ctx))
    if (a.scopes) {
      const shown = await presentBot(ctx, b)
      const added = a.scopes.filter((s) => !b.scopes.includes(s))
      if (shown.installs.length && added.length)
        fail(
          'invalid_state',
          `${a.slug} is installed, so its scopes can shrink but not grow. Remove every install to add ${added.join(', ')}.`,
        )
    }
    const { slug: _slug, dry, ...body } = a
    await ctx.db.patch('bots', b._id, body)
    return finish(
      dry,
      await presentBot(ctx, (await ctx.db.get('bots', b._id))!),
    )
  },
})

export const mintBotToken = mutation({
  args: { slug: v.string(), days: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const b = await botOf(ctx, a.slug, await signedIn(ctx))
    const shown = await presentBot(ctx, b)
    const { record, secret } = await mintToken(ctx, {
      name: `${b.name} token`,
      kind: 'bot',
      handle: a.slug,
      class: b.class,
      scopes: b.scopes,
      repos: shown.installs,
      ttlMs: a.days * 86_400_000,
    })
    return out({
      object: 'bot_token',
      id: record.id,
      bot: a.slug,
      token: secret,
      scopes: [...record.scopes],
      repos: shown.installs,
      expires_at: iso(record.expiresAt),
    })
  },
})
