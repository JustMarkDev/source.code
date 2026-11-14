import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { system } from '../lib/actor'
import { out } from '../lib/errors'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * What the status page adds up, kept so that reading it costs little.
 *
 * Health: each API server sends its requests a minute at a time (counts and
 * latency buckets per area). Minutes are kept two hours, for the last hour's
 * percentiles; days are kept 91, for the uptime bars. Every server reads the
 * same totals, so the page says the same thing whichever one answers.
 *
 * Counts: how many accounts, repositories, changes and issues there are. A
 * background pass counts a page at a time and keeps the result; the page
 * reads one document.
 */

const DAY_MINUTES = 1_440
const KEEP_MINUTES = 120
const KEEP_DAYS = 91

const bucket = v.object({
  area: v.string(),
  minute: v.number(),
  requests: v.number(),
  errors: v.number(),
  hist: v.array(v.number()),
})

export const record = mutation({
  args: { buckets: v.array(bucket) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await system(ctx)
    const days = new Map<
      string,
      { area: string; day: number; requests: number; errors: number }
    >()
    for (const b of args.buckets.slice(0, 2_000)) {
      const have = await ctx.db
        .query('healthMinutes')
        .withIndex('by_area_and_minute', (q) =>
          q.eq('area', b.area).eq('minute', b.minute),
        )
        .unique()
      if (have)
        await ctx.db.patch('healthMinutes', have._id, {
          requests: have.requests + b.requests,
          errors: have.errors + b.errors,
          hist: b.hist.map((n, i) => n + (have.hist[i] ?? 0)),
        })
      else await ctx.db.insert('healthMinutes', b)
      const day = Math.floor(b.minute / DAY_MINUTES)
      const k = `${b.area}:${day}`
      const d = days.get(k) ?? { area: b.area, day, requests: 0, errors: 0 }
      d.requests += b.requests
      d.errors += b.errors
      days.set(k, d)
    }
    for (const d of days.values()) {
      const have = await ctx.db
        .query('healthDays')
        .withIndex('by_area_and_day', (q) =>
          q.eq('area', d.area).eq('day', d.day),
        )
        .unique()
      if (have)
        await ctx.db.patch('healthDays', have._id, {
          requests: have.requests + d.requests,
          errors: have.errors + d.errors,
        })
      else await ctx.db.insert('healthDays', d)
    }
    return null
  },
})

/** Per area: the days and the last hour's minutes. The API does the arithmetic. */
export const report = query({
  args: { areas: v.array(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    await system(ctx)
    const now = Date.now()
    const minute = Math.floor(now / 60_000)
    const today = Math.floor(minute / DAY_MINUTES)
    const areas: Record<
      string,
      {
        days: Array<{ day: number; requests: number; errors: number }>
        minutes: Array<{
          minute: number
          requests: number
          errors: number
          hist: Array<number>
        }>
      }
    > = {}
    for (const area of args.areas.slice(0, 20)) {
      const days = await ctx.db
        .query('healthDays')
        .withIndex('by_area_and_day', (q) =>
          q.eq('area', area).gt('day', today - KEEP_DAYS),
        )
        .take(KEEP_DAYS)
      const minutes = await ctx.db
        .query('healthMinutes')
        .withIndex('by_area_and_minute', (q) =>
          q.eq('area', area).gt('minute', minute - 60),
        )
        .take(61)
      areas[area] = {
        days: days.map((d) => ({
          day: d.day,
          requests: d.requests,
          errors: d.errors,
        })),
        minutes: minutes.map((m) => ({
          minute: m.minute,
          requests: m.requests,
          errors: m.errors,
          hist: m.hist,
        })),
      }
    }
    return out({ areas })
  },
})

/** Minutes past two hours and days past 91 go, a batch at a time. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const minute = Math.floor(Date.now() / 60_000)
    const oldMinutes = await ctx.db
      .query('healthMinutes')
      .withIndex('by_minute', (q) => q.lt('minute', minute - KEEP_MINUTES))
      .take(500)
    for (const m of oldMinutes) await ctx.db.delete('healthMinutes', m._id)
    const oldDays = await ctx.db
      .query('healthDays')
      .withIndex('by_day', (q) =>
        q.lt('day', Math.floor(minute / DAY_MINUTES) - KEEP_DAYS),
      )
      .take(500)
    for (const d of oldDays) await ctx.db.delete('healthDays', d._id)
    if (oldMinutes.length === 500 || oldDays.length === 500)
      await ctx.scheduler.runAfter(0, internal.forge.health.sweep, {})
    return null
  },
})

// ----- counts ---------------------------------------------------------------

const COUNTED = ['accounts', 'repos', 'changes', 'issues'] as const
type Counts = {
  accounts: number
  repositories: number
  changes: number
  issues: number
}
const zero = (): Counts => ({
  accounts: 0,
  repositories: 0,
  changes: 0,
  issues: 0,
})
const field = {
  accounts: 'accounts',
  repos: 'repositories',
  changes: 'changes',
  issues: 'issues',
} as const

async function snapshot(ctx: QueryCtx) {
  return await ctx.db.query('statusCounts').first()
}

/** Starts a counting pass, unless one is running. */
export const startCount = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await snapshot(ctx)
    const now = Date.now()
    // A pass that has not moved in five minutes died; start over.
    if (row?.pass && now - row.pass.moved < 5 * 60_000) return null
    const pass = { table: 0, cursor: null, counts: zero(), moved: now }
    if (row) await ctx.db.patch('statusCounts', row._id, { pass })
    else await ctx.db.insert('statusCounts', { ...zero(), at: 0, pass })
    await ctx.scheduler.runAfter(0, internal.forge.health.countStep, {})
    return null
  },
})

/** Counts one page of one table, then hands on to the next step. */
export const countStep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await snapshot(ctx)
    if (!row?.pass) return null
    const pass = row.pass
    const table = COUNTED[pass.table]
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: pass.cursor, numItems: 4_000 })
    const counts = { ...pass.counts }
    counts[field[table]] += page.page.length
    const done = page.isDone && pass.table === COUNTED.length - 1
    if (done) {
      await ctx.db.patch('statusCounts', row._id, {
        ...counts,
        at: Date.now(),
        pass: undefined,
      })
      return null
    }
    await ctx.db.patch('statusCounts', row._id, {
      pass: {
        table: page.isDone ? pass.table + 1 : pass.table,
        cursor: page.isDone ? null : page.continueCursor,
        counts,
        moved: Date.now(),
      },
    })
    await ctx.scheduler.runAfter(0, internal.forge.health.countStep, {})
    return null
  },
})

/**
 * The counts. From the last pass when there has been one; a deployment that
 * has not counted yet counts now, up to a bound, so a new one is right too.
 */
export async function countsOf(ctx: QueryCtx | MutationCtx): Promise<Counts> {
  const row = await snapshot(ctx)
  if (row && row.at > 0)
    return {
      accounts: row.accounts,
      repositories: row.repositories,
      changes: row.changes,
      issues: row.issues,
    }
  const counts = zero()
  for (const table of COUNTED)
    counts[field[table]] = (await ctx.db.query(table).take(10_000)).length
  return counts
}
