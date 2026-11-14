import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'
import { convexTest } from 'convex-test'
import { api as forge, internal } from '../../../../convex/_generated/api'
import schema from '../../../../convex/schema'
import { load } from '../../../../convex/seed'
import { claimsOf } from '../domain/convex'
import { Health, reportFrom } from '../health'
import { createSampleApi } from '../index'
import { exportWorld } from '../seed-export'

/**
 * The status page says the same thing whichever server answers: each sends
 * its minutes to Convex and reads everyone's. Counts come from a background
 * pass, so reading the page costs one document.
 */
const dir = new URL('../../../../convex/', import.meta.url).pathname
const modules: Record<string, () => Promise<never>> = {}
for (const f of new Bun.Glob('**/*.{ts,js}').scanSync(dir))
  if (!f.endsWith('.d.ts') && !f.includes('.test.'))
    modules[`./${f}`] = () => import(`${dir}${f}`) as Promise<never>

const START = new Date('2026-11-08T12:00:00Z').getTime()
beforeEach(() => setSystemTime(new Date(START)))
afterEach(() => setSystemTime())

async function setup() {
  const sample = createSampleApi({})
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    load(ctx, exportWorld(sample.domain, sample.domain.svc.auth as never)),
  )
  return { t, asApi: t.withIdentity(claimsOf('system')) }
}

test('two servers’ requests add up on one page', async () => {
  const { asApi } = await setup()
  const clock = () => Date.now()
  const a = new Health(clock)
  const b = new Health(clock)
  for (let i = 0; i < 30; i++) a.record('api', 20, 200)
  for (let i = 0; i < 10; i++) b.record('api', 800, i < 5 ? 503 : 200)
  b.record('git', 3, 200)
  await asApi.mutation(forge.forge.health.record, { buckets: a.drain() })
  await asApi.mutation(forge.forge.health.record, { buckets: b.drain() })
  // Drained means sent: nothing goes twice.
  expect(a.drain()).toEqual([])

  const r = JSON.parse(
    await asApi.query(forge.forge.health.report, { areas: ['api', 'git'] }),
  ) as {
    areas: Record<string, { days: Array<never>; minutes: Array<never> }>
  }
  const api = reportFrom(Date.now(), r.areas.api.days, r.areas.api.minutes)
  expect(api.requests).toBe(40)
  expect(api.errors).toBe(5)
  expect(api.last_hour.requests).toBe(40)
  // 30 fast and 10 slow: the median is fast, the slowest 5% are not.
  expect(api.last_hour.p50_ms).toBe(25)
  expect(api.last_hour.p95_ms).toBe(1_000)
  expect(api.recent_error_rate).toBe(5 / 40)
  expect(api.days).toHaveLength(90)
  expect(api.days.at(-1)).toMatchObject({ requests: 40, errors: 5 })
  const git = reportFrom(Date.now(), r.areas.git.days, r.areas.git.minutes)
  expect(git.requests).toBe(1)
})

test('only the API server may write or read the shared health', async () => {
  const { t } = await setup()
  await expect(
    t
      .withIdentity({ subject: 'dana', sx_cls: 'human', sx_scp: '' })
      .mutation(forge.forge.health.record, { buckets: [] }),
  ).rejects.toThrow()
  await expect(
    t.query(forge.forge.health.report, { areas: ['api'] }),
  ).rejects.toThrow()
})

test('a minute that could not be sent goes with the next one', () => {
  const h = new Health(() => Date.now())
  h.record('api', 10, 200)
  const first = h.drain()
  h.restore(first)
  h.record('api', 10, 200)
  const both = h.drain()
  expect(both).toHaveLength(1)
  expect(both[0].requests).toBe(2)
})

test('the counting pass counts every table, a page at a time', async () => {
  const { t, asApi } = await setup()
  const live = JSON.parse(
    await asApi.query(forge.forge.insights.statusFacts, {}),
  ) as { counts: Record<string, number> }
  await t.mutation(internal.forge.health.startCount, {})
  await t.finishAllScheduledFunctions(() => {})
  const row = await t.run((ctx) => ctx.db.query('statusCounts').first())
  expect(row?.pass).toBeUndefined()
  expect(row?.at).toBeGreaterThan(0)
  const counted = JSON.parse(
    await asApi.query(forge.forge.insights.statusFacts, {}),
  ) as { counts: Record<string, number> }
  expect(counted.counts).toEqual(live.counts)
  expect(counted.counts.repositories).toBeGreaterThan(0)
  // A second start while one runs does not start another.
  await t.mutation(internal.forge.health.startCount, {})
  await t.mutation(internal.forge.health.startCount, {})
  const running = await t.run((ctx) => ctx.db.query('statusCounts').collect())
  expect(running).toHaveLength(1)
})
