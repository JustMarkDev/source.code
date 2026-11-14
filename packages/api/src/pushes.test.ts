import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { convexTest } from 'convex-test'
import schema from '../../../convex/schema'
import { load } from '../../../convex/seed'
import { createSampleApi } from './index'
import { exportWorld } from './seed-export'

/** code.storage telling us about a push: checked, recorded once, a patch set for an open change. */
const dir = new URL('../../../convex/', import.meta.url).pathname
const modules: Record<string, () => Promise<never>> = {}
for (const f of new Bun.Glob('**/*.{ts,js}').scanSync(dir))
  if (!f.endsWith('.d.ts') && !f.includes('.test.'))
    modules[`./${f}`] = () => import(`${dir}${f}`) as Promise<never>

const SECRET = 'whsec_test_0123456789abcdef'

beforeEach(() => setSystemTime(new Date('2026-11-08T12:00:00Z')))
afterEach(() => setSystemTime())

async function setup() {
  process.env.CODE_STORAGE_WEBHOOK_SECRET = SECRET
  const sample = createSampleApi({})
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    load(ctx, exportWorld(sample.domain, sample.domain.svc.auth as never)),
  )
  const repo = sample.domain.repos.get('dana/gitfs')!
  const change = [...repo.changes.values()].find((c) => c.state === 'open')!
  return { t, storeId: repo.storeId, change }
}

const signed = (
  body: string,
  at = Math.floor(Date.now() / 1000),
  secret = SECRET,
) =>
  `t=${at},sha256=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`

const push = (storeId: string, ref: string, after: string) =>
  JSON.stringify({
    repository: { id: storeId, url: 'https://git.code.storage/x' },
    ref,
    before: '1'.repeat(40),
    after,
    customer_id: 'cus_1',
    pushed_at: new Date().toISOString(),
  })

test('a signed push to an open change branch is its next patch set, once', async () => {
  const { t, storeId, change } = await setup()
  const body = push(storeId, `refs/heads/${change.branch}`, 'a'.repeat(40))
  const send = () =>
    t.fetch('/hooks/code-storage', {
      method: 'POST',
      headers: { 'x-pierre-signature': signed(body), 'x-pierre-event': 'push' },
      body,
    })
  const first = await send()
  expect(first.status).toBe(200)
  expect(await first.text()).toBe('patch_set_added')
  // The same webhook again: recorded once.
  expect(await (await send()).text()).toBe('duplicate')
  const sets = await t.run(async (ctx) => {
    const c = await ctx.db
      .query('changes')
      .withIndex('by_publicId', (q) => q.eq('publicId', change.id))
      .unique()
    return c!.headSha
  })
  expect(sets).toBe('a'.repeat(40))
})

test('a wrong, missing or stale signature is refused', async () => {
  const { t, storeId } = await setup()
  const body = push(storeId, 'refs/heads/main', 'b'.repeat(40))
  const post = (signature?: string) =>
    t.fetch('/hooks/code-storage', {
      method: 'POST',
      headers: {
        'x-pierre-event': 'push',
        ...(signature ? { 'x-pierre-signature': signature } : {}),
      },
      body,
    })
  expect((await post()).status).toBe(401)
  expect(
    (await post(signed(body, undefined, 'whsec_someone_else_000000'))).status,
  ).toBe(401)
  expect(
    (await post(signed(body, Math.floor(Date.now() / 1000) - 600))).status,
  ).toBe(401)
  expect((await post(signed(body))).status).toBe(200)
})

test("a push whose commit names a run in its Run-Id trailer is that run's", async () => {
  const { t, storeId, change } = await setup()
  const runId = await t.run(async (ctx) => {
    const repo = (await ctx.db
      .query('repos')
      .withIndex('by_storeId', (q) => q.eq('storeId', storeId))
      .unique())!
    await ctx.db.insert('runs', {
      publicId: 'run_trailer0001',
      repoId: repo._id,
      repo: `${repo.owner}/${repo.name}`,
      task: 'Push from a run',
      state: 'running',
      handle: 'dana',
      change: change.number,
      scopes: ['repo:read'],
      tokenId: 'tok_trailer0001',
      notes: [],
      summary: null,
      started: Date.now(),
      expires: Date.now() + 3_600_000,
      finished: null,
      version: 1,
    })
    return 'run_trailer0001'
  })
  const body = JSON.stringify({
    ...JSON.parse(push(storeId, `refs/heads/${change.branch}`, 'c'.repeat(40))),
    head_commit: {
      message: `Fix it\n\nChange-Id: I1234\nRun-Id: ${runId}\n`,
    },
  })
  const res = await t.fetch('/hooks/code-storage', {
    method: 'POST',
    headers: { 'x-pierre-signature': signed(body), 'x-pierre-event': 'push' },
    body,
  })
  expect(await res.text()).toBe('patch_set_added')
  const rows = await t.run(async (ctx) => {
    const run = (await ctx.db
      .query('runs')
      .withIndex('by_publicId', (q) => q.eq('publicId', runId))
      .unique())!
    return await ctx.db
      .query('runPatchSets')
      .withIndex('by_runId', (q) => q.eq('runId', run._id))
      .take(10)
  })
  expect(rows.map((r) => r.patchSet)).toEqual([change.patchSets.length + 1])
})
