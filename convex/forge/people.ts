import { v } from 'convex/values'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { actorOf, signedIn } from '../lib/actor'
import {
  accountByHandle,
  canRead,
  repoByKey,
  repoByPublicId,
} from '../lib/access'
import { fail, out } from '../lib/errors'
import { urls } from '../lib/present'
import type { Actor } from '../lib/actor'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * People: their preferences, who follows whom, a profile worked out from
 * what they did, and the directory that Discover and search list. A profile
 * reads the person's own contributions, recorded as they happened.
 */

const DAY = 86_400_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const defaultAccountPrefs = {
  combined_total: true,
  private_totals: true,
  show_activity: true,
  show_agents: true,
  searchable: true,
  download_target: null as null | { os: string; arch: string },
}
type Prefs = typeof defaultAccountPrefs

async function prefsOf(ctx: QueryCtx, handle: string): Promise<Prefs> {
  const row = await ctx.db
    .query('accountPrefs')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
  return row
    ? { ...defaultAccountPrefs, ...(JSON.parse(row.prefs) as Partial<Prefs>) }
    : defaultAccountPrefs
}

async function stats(ctx: QueryCtx, handle: string) {
  return await ctx.db
    .query('peopleStats')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
}

async function bumpStats(
  ctx: MutationCtx,
  handle: string,
  d: { followers?: number; following?: number; rev?: number },
) {
  const s = await stats(ctx, handle)
  if (s)
    await ctx.db.patch('peopleStats', s._id, {
      followers: s.followers + (d.followers ?? 0),
      following: s.following + (d.following ?? 0),
      rev: s.rev + (d.rev ?? 0),
    })
  else
    await ctx.db.insert('peopleStats', {
      handle,
      followers: d.followers ?? 0,
      following: d.following ?? 0,
      rev: d.rev ?? 0,
    })
}

async function bumpPeople(ctx: MutationCtx) {
  const doc = await ctx.db.query('peopleRev').first()
  if (doc) await ctx.db.patch('peopleRev', doc._id, { rev: doc.rev + 1 })
  else await ctx.db.insert('peopleRev', { rev: 1 })
}

async function person(ctx: QueryCtx, handle: string) {
  const a =
    (await accountByHandle(ctx, handle)) ??
    (await accountByHandle(ctx, handle.toLowerCase()))
  if (!a) fail('not_found', `No account ${handle}.`)
  return a
}

/** Record a contribution, from an event (`fanout.ts`) or the seed. */
export async function contributed(
  ctx: MutationCtx,
  c: {
    handle: string
    kind: Doc<'contributions'>['kind']
    at: number
    title: string
    repoId: Id<'repos'>
    agent: boolean
  },
) {
  await ctx.db.insert('contributions', c)
  await bumpStats(ctx, c.handle, { rev: 1 })
}

/** What an event says someone did. */
export async function contributionsFrom(
  ctx: MutationCtx,
  e: {
    type: string
    repo_id: string | null
    actor: { handle: string }
    created_at: string
    data: Record<string, unknown> | null
  },
) {
  if (!e.repo_id || !e.data) return
  const repo = await repoByPublicId(ctx, e.repo_id)
  if (!repo) return
  const at = Date.parse(e.created_at)
  const d = e.data as {
    number?: number
    title?: string
    tag?: string
    author?: { handle: string; class: string }
    reviewers?: Array<{ actor: { handle: string }; state: string }>
  }
  if (e.type === 'change.opened')
    await contributed(ctx, {
      handle: e.actor.handle,
      kind: 'change',
      at,
      title: `Opened #${d.number} ${d.title}`,
      repoId: repo._id,
      agent: false,
    })
  if (e.type === 'change.reviewed') {
    const mine = d.reviewers?.find((r) => r.actor.handle === e.actor.handle)
    await contributed(ctx, {
      handle: e.actor.handle,
      kind: 'review',
      at,
      title: `Reviewed #${d.number} ${d.title}`,
      repoId: repo._id,
      agent: d.author?.class !== 'human' && mine?.state === 'approved',
    })
  }
  if (e.type === 'issue.created')
    await contributed(ctx, {
      handle: e.actor.handle,
      kind: 'issue',
      at,
      title: `Opened issue #${d.number} ${d.title}`,
      repoId: repo._id,
      agent: false,
    })
  if (e.type === 'release.published')
    await contributed(ctx, {
      handle: d.author?.handle ?? e.actor.handle,
      kind: 'release',
      at,
      title: `Published ${d.tag}`,
      repoId: repo._id,
      agent: false,
    })
}

// ---- preferences -----------------------------------------------------------------

export const getPrefs = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const p = await signedIn(ctx)
    return out({
      object: 'account_preferences',
      ...(await prefsOf(ctx, p.handle)),
    })
  },
})

export const updatePrefs = mutation({
  args: { body: v.string() },
  returns: v.string(),
  handler: async (ctx, { body }) => {
    const p = await signedIn(ctx)
    const next: Record<string, unknown> = { ...(await prefsOf(ctx, p.handle)) }
    for (const [k, x] of Object.entries(
      JSON.parse(body) as Record<string, unknown>,
    ))
      if (x !== undefined && k in defaultAccountPrefs) next[k] = x
    const row = await ctx.db
      .query('accountPrefs')
      .withIndex('by_handle', (q) => q.eq('handle', p.handle))
      .unique()
    if (row)
      await ctx.db.patch('accountPrefs', row._id, {
        prefs: JSON.stringify(next),
      })
    else
      await ctx.db.insert('accountPrefs', {
        handle: p.handle,
        prefs: JSON.stringify(next),
      })
    await bumpPeople(ctx)
    return out({ object: 'account_preferences', ...next })
  },
})

// ---- follows -----------------------------------------------------------------------

export const follow = mutation({
  args: { handle: v.string(), on: v.boolean() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const target = await person(ctx, a.handle)
    if (target.handle === p.handle)
      fail('invalid_request', 'You cannot follow yourself.')
    if (p.class !== 'human') fail('forbidden', 'Only people follow accounts.')
    const row = await ctx.db
      .query('follows')
      .withIndex('by_who_and_whom', (q) =>
        q.eq('who', p.handle).eq('whom', target.handle),
      )
      .unique()
    if (a.on && !row) {
      await ctx.db.insert('follows', { who: p.handle, whom: target.handle })
      await bumpStats(ctx, target.handle, { followers: 1 })
      await bumpStats(ctx, p.handle, { following: 1 })
    }
    if (!a.on && row) {
      await ctx.db.delete('follows', row._id)
      await bumpStats(ctx, target.handle, { followers: -1 })
      await bumpStats(ctx, p.handle, { following: -1 })
    }
    await bumpPeople(ctx)
    return out(null)
  },
})

async function ref(ctx: QueryCtx, handle: string) {
  const a = await accountByHandle(ctx, handle)
  return {
    object: 'account_ref' as const,
    handle,
    name: a?.name ?? handle,
    kind: a?.kind ?? ('person' as const),
    html_url: `${urls().html}/${handle}`,
  }
}

export const listFollows = query({
  args: {
    handle: v.string(),
    which: v.union(v.literal('followers'), v.literal('following')),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const target = await person(ctx, a.handle)
    // In handle order, as the index keeps them; the cursor is the last handle.
    const rows =
      a.which === 'followers'
        ? await ctx.db
            .query('follows')
            .withIndex('by_whom_and_who', (q) =>
              a.after
                ? q.eq('whom', target.handle).gt('who', a.after.id)
                : q.eq('whom', target.handle),
            )
            .take(a.limit + 1)
        : await ctx.db
            .query('follows')
            .withIndex('by_who_and_whom', (q) =>
              a.after
                ? q.eq('who', target.handle).gt('whom', a.after.id)
                : q.eq('who', target.handle),
            )
            .take(a.limit + 1)
    const handles = rows.map((r) => (a.which === 'followers' ? r.who : r.whom))
    const page = handles.slice(0, a.limit)
    const start = a.after ? Number(a.after.key) : 0
    return out({
      items: await Promise.all(page.map((h) => ref(ctx, h))),
      next:
        handles.length > a.limit
          ? { key: start + a.limit, id: page.at(-1)! }
          : null,
    })
  },
})

export const peopleVersion = query({
  args: { access: v.number() },
  returns: v.string(),
  handler: async (ctx, { access }) => {
    const rev = (await ctx.db.query('peopleRev').first())?.rev ?? 0
    return out(`ppl${rev}.${access}`)
  },
})

// ---- profile --------------------------------------------------------------------------

/** The repositories whose commits count for a profile: the ones they own or worked in. */
export const profileRepos = query({
  args: { handle: v.string(), since: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const target = await person(ctx, a.handle)
    const ids = new Set<Id<'repos'>>()
    for (const r of await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', target._id))
      .take(1000))
      ids.add(r._id)
    for (const c of await ctx.db
      .query('contributions')
      .withIndex('by_handle_and_at', (q) =>
        q.eq('handle', target.handle).gte('at', a.since),
      )
      .take(10_000))
      ids.add(c.repoId)
    const names = []
    for (const id of ids) {
      const r = await ctx.db.get('repos', id)
      if (r) names.push(`${r.owner}/${r.name}`)
    }
    return out(names)
  },
})

type Push = { repo: string; at: number; title: string }

export const profile = query({
  args: {
    handle: v.string(),
    at: v.number(),
    pushes: v.array(
      v.object({ repo: v.string(), at: v.number(), title: v.string() }),
    ),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const target = await person(ctx, a.handle)
    const now = a.at
    const prefs = await prefsOf(ctx, target.handle)
    const own = p?.handle === target.handle
    const yearAgo = now - 365 * DAY
    type Shown = {
      kind: string
      at: number
      title: string
      repo: Doc<'repos'>
      agent: boolean
    }
    const shown: Array<Shown> = []
    let hidden = 0
    const repoCache = new Map<
      string,
      { r: Doc<'repos'> | null; readable: boolean }
    >()
    const repoOf = async (id: Id<'repos'>) => {
      let hit = repoCache.get(id)
      if (!hit) {
        const r = await ctx.db.get('repos', id)
        hit = { r, readable: !!r && (await canRead(ctx, r, p)) }
        repoCache.set(id, hit)
      }
      return hit
    }
    const add = async (repoId: Id<'repos'>, c: Omit<Shown, 'repo'>) => {
      const { r, readable } = await repoOf(repoId)
      if (!r) return
      // A private repository's work counts, as a number only, if they allow it.
      if (readable) shown.push({ ...c, repo: r })
      else if (own || prefs.private_totals) hidden++
    }
    if (target.kind === 'person') {
      for (const x of a.pushes as Array<Push>) {
        const r = await repoByKey(ctx, x.repo)
        if (r && x.at >= yearAgo)
          await add(r._id, {
            kind: 'push',
            at: x.at,
            title: x.title,
            agent: false,
          })
      }
      for (const c of await ctx.db
        .query('contributions')
        .withIndex('by_handle_and_at', (q) =>
          q.eq('handle', target.handle).gte('at', yearAgo),
        )
        .take(10_000))
        await add(c.repoId, {
          kind: c.kind,
          at: c.at,
          title: c.title,
          agent: c.agent,
        })
    }
    const all = shown.length + hidden
    const end = new Date(now)
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1),
      )
      return { month: d.toISOString().slice(0, 7), count: 0 }
    })
    const days = Array.from({ length: 26 * 7 }, () => 0)
    const today = Math.floor(now / DAY)
    const weekday = WEEKDAYS.map((day) => ({ day, commits: 0, reviews: 0 }))
    const kinds: Record<string, number> = {
      push: 0,
      review: 0,
      change: 0,
      issue: 0,
      release: 0,
    }
    for (const c of shown) {
      const m = months.find(
        (x) => x.month === new Date(c.at).toISOString().slice(0, 7),
      )
      if (m) m.count++
      const k = days.length - 1 - (today - Math.floor(c.at / DAY))
      if (k >= 0 && k < days.length) days[k]++
      const w = (new Date(c.at).getUTCDay() + 6) % 7
      if (c.kind === 'push') weekday[w].commits++
      if (c.kind === 'review') weekday[w].reviews++
      kinds[c.kind]++
    }
    const work = (
      [
        ['Commits', kinds.push],
        ['Reviews', kinds.review],
        ['Changes', kinds.change],
        ['Issues', kinds.issue],
        ['Releases', kinds.release],
      ] as const
    ).map(([axis, n]) => ({
      axis,
      value: shown.length ? Math.round((n / shown.length) * 100) : 0,
    }))
    const owned: Array<Doc<'repos'>> = []
    for (const r of await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', target._id))
      .take(1000))
      if (await canRead(ctx, r, p)) owned.push(r)
    const weight = new Map<string, { r: Doc<'repos'>; w: number }>()
    for (const c of shown) {
      const x = weight.get(c.repo._id) ?? { r: c.repo, w: 0 }
      x.w++
      weight.set(c.repo._id, x)
    }
    for (const r of owned)
      if (!weight.has(r._id)) weight.set(r._id, { r, w: 1 })
    const langs = new Map<string, number>()
    for (const { r, w } of weight.values())
      for (const [name, pct] of r.languages)
        langs.set(
          name as string,
          (langs.get(name as string) ?? 0) + (pct as number) * w,
        )
    const langTotal = [...langs.values()].reduce((x, y) => x + y, 0) || 1
    let releases = 0
    let downloads = 0
    for (const r of owned)
      for (const rel of await ctx.db
        .query('releases')
        .withIndex('by_repoId_and_published', (q) => q.eq('repoId', r._id))
        .take(1000)) {
        releases++
        const stored = JSON.parse(rel.json) as {
          assets: Array<{ downloads: number }>
        }
        downloads += stored.assets.reduce((n, x) => n + x.downloads, 0)
        for (const s of await ctx.db
          .query('downloads')
          .withIndex('by_releaseId_and_asset_and_shard', (q) =>
            q.eq('releaseId', rel._id),
          )
          .take(500))
          downloads += s.n
      }
    const reviewed = shown.filter((c) => c.kind === 'review')
    const showAgents = own || prefs.show_agents
    const showActivity = own || prefs.show_activity
    const st = await stats(ctx, target.handle)
    const viewerFollows =
      p && p.handle !== target.handle
        ? !!(await ctx.db
            .query('follows')
            .withIndex('by_who_and_whom', (q) =>
              q.eq('who', p.handle).eq('whom', target.handle),
            )
            .unique())
        : null
    return out({
      object: 'profile',
      handle: target.handle,
      name: target.name,
      kind: target.kind,
      bio: target.bio,
      followers: st?.followers ?? 0,
      following: st?.following ?? 0,
      viewer_follows: viewerFollows,
      contributions: {
        total: own || prefs.private_totals ? all : shown.length,
        private: own || prefs.private_totals ? hidden : 0,
        by_month: months,
        by_day: showActivity ? days : [],
        by_weekday: weekday,
      },
      work,
      languages: [...langs.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([name, x]) => ({
          name,
          percent: Math.round((x / langTotal) * 100),
        })),
      repositories: owned.length,
      releases,
      downloads,
      agent_share:
        showAgents && reviewed.length
          ? Math.round(
              (reviewed.filter((c) => c.agent).length / reviewed.length) * 100,
            )
          : null,
      activity: showActivity
        ? shown
            .sort((x, y) => y.at - x.at)
            .slice(0, 30)
            .map((c) => ({
              kind: c.kind,
              title: c.title,
              repo: `${c.repo.owner}/${c.repo.name}`,
              at: new Date(c.at).toISOString(),
            }))
        : [],
      activity_hidden: !showActivity,
    })
  },
})

export const profileVersion = query({
  args: { handle: v.string(), at: v.number(), access: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const target = await person(ctx, a.handle)
    const st = await stats(ctx, target.handle)
    const rev = (await ctx.db.query('peopleRev').first())?.rev ?? 0
    return out(
      `${target.publicId}.${target.version}.${st?.rev ?? 0}.${rev}.${a.access}.${Math.floor(a.at / DAY)}.${p?.handle ?? '-'}`,
    )
  },
})

// ---- directory ----------------------------------------------------------------------

async function viewerFollowsOf(ctx: QueryCtx, p: Actor | null, handle: string) {
  if (!p || p.handle === handle) return null
  return !!(await ctx.db
    .query('follows')
    .withIndex('by_who_and_whom', (q) =>
      q.eq('who', p.handle).eq('whom', handle),
    )
    .unique())
}

export const listPeople = query({
  args: {
    q: v.optional(v.string()),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const needle = a.q?.trim().toLowerCase() ?? ''
    const found: Array<{
      acc: Doc<'accounts'>
      followers: number
      repos: Array<Doc<'repos'>>
    }> = []
    for await (const acc of ctx.db.query('accounts').withIndex('by_handle')) {
      if (acc.kind !== 'person') continue
      if (
        !(
          (await prefsOf(ctx, acc.handle)).searchable ||
          acc.handle === p?.handle
        )
      )
        continue
      if (
        needle &&
        !acc.handle.toLowerCase().includes(needle) &&
        !acc.name.toLowerCase().includes(needle) &&
        !acc.bio.toLowerCase().includes(needle)
      )
        continue
      const repos = (
        await ctx.db
          .query('repos')
          .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', acc._id))
          .take(1000)
      ).filter((r) => r.visibility === 'public')
      found.push({
        acc,
        followers: (await stats(ctx, acc.handle))?.followers ?? 0,
        repos,
      })
      if (found.length >= 5000) break
    }
    // Most followed first, then by handle, so the order is stable.
    found.sort(
      (x, y) =>
        y.followers - x.followers || x.acc.handle.localeCompare(y.acc.handle),
    )
    let start = 0
    if (a.after) {
      const k = found.findIndex((x) => x.acc.handle === a.after!.id)
      start = k >= 0 ? k + 1 : found.length
    }
    const page = found.slice(start, start + a.limit)
    const last = page.at(-1)
    const items = []
    for (const { acc, followers, repos } of page) {
      const langs = new Map<string, number>()
      for (const r of repos)
        for (const [name, pct] of r.languages)
          langs.set(
            name as string,
            (langs.get(name as string) ?? 0) + (pct as number) * (r.stars + 1),
          )
      items.push({
        object: 'person',
        handle: acc.handle,
        name: acc.name,
        bio: acc.bio,
        followers,
        repositories: repos.length,
        stars: repos.reduce((n, r) => n + r.stars, 0),
        languages: [...langs.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([name]) => name),
        html_url: `${urls().html}/${acc.handle}`,
        viewer_follows: await viewerFollowsOf(ctx, p, acc.handle),
      })
    }
    return out({
      items,
      next:
        start + a.limit < found.length && last
          ? { key: start + a.limit, id: last.acc.handle }
          : null,
    })
  },
})
