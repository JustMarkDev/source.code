import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'
import { convexTest } from 'convex-test'
import { api as forge } from '../../../../convex/_generated/api'
import schema from '../../../../convex/schema'
import { load } from '../../../../convex/seed'
import { claimsOf } from '../domain/convex'
import { heldKey } from '../idempotency'
import { createSampleApi } from '../index'
import { exportWorld } from '../seed-export'
import { sampleTokens } from '../sample'

/**
 * A write and its Idempotency-Key commit together. A request that crashed is
 * then told apart by what it did: one that wrote nothing runs again once its
 * lease ends, one that wrote never runs twice.
 */
const dir = new URL('../../../../convex/', import.meta.url).pathname
const modules: Record<string, () => Promise<never>> = {}
for (const f of new Bun.Glob('**/*.{ts,js}').scanSync(dir))
  if (!f.endsWith('.d.ts') && !f.includes('.test.'))
    modules[`./${f}`] = () => import(`${dir}${f}`) as Promise<never>

const SECRET = 'test-secret-0123456789'
const START = new Date('2026-11-08T12:00:00Z').getTime()
const LEASE = 10 * 60_000

beforeEach(() => setSystemTime(new Date(START)))
afterEach(() => setSystemTime())

async function setup() {
  process.env.API_STORE_SECRET = SECRET
  const sample = createSampleApi({})
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    load(ctx, exportWorld(sample.domain, sample.domain.svc.auth as never)),
  )
  const begin = (key: string) =>
    t.mutation(forge.apiStores.beginIdempotency, {
      secret: SECRET,
      scope: 'dana@dana:tok',
      key,
      fingerprint: 'f',
      ttlMs: 24 * 3_600_000,
    })
  const abort = (key: string) =>
    t.mutation(forge.apiStores.abortIdempotency, {
      secret: SECRET,
      scope: 'dana@dana:tok',
      key,
    })
  // Dana, as the API signs her: the principal, and the key her request holds.
  const dana = (key: string | null) =>
    t.withIdentity({
      subject: 'dana',
      sx_tok: 'tok',
      sx_cls: 'human',
      sx_act: 'dana',
      sx_scp: 'repo:read repo:write issues:read issues:write',
      ...(key ? { sx_idem: JSON.stringify(['dana@dana:tok', key]) } : {}),
    })
  const openIssue = (key: string | null, title: string, name = 'gitfs') =>
    dana(key).mutation(forge.forge.issues.create, {
      owner: 'dana',
      name,
      title,
    })
  const later = () => setSystemTime(new Date(Date.now() + LEASE + 1_000))
  return { t, begin, abort, dana, openIssue, later }
}

test('a request that wrote and then crashed never runs again', async () => {
  const { begin, openIssue, later } = await setup()
  expect((await begin('k1')).state).toBe('new')
  await openIssue('k1', 'Written, then the server died')
  // No complete: the server crashed after the write.
  expect((await begin('k1')).state).toBe('in_progress')
  later()
  const after = await begin('k1')
  expect(after.state).toBe('replay')
  expect(after.response?.status).toBe(409)
  expect(JSON.parse(after.response!.body).code).toBe('request_outcome_unknown')
  // And it stays that way.
  expect((await begin('k1')).state).toBe('replay')
})

test('a request that crashed before writing runs again once its lease ends', async () => {
  const { begin, later } = await setup()
  expect((await begin('k2')).state).toBe('new')
  expect((await begin('k2')).state).toBe('in_progress')
  later()
  expect((await begin('k2')).state).toBe('new')
  // The retry holds a fresh lease.
  expect((await begin('k2')).state).toBe('in_progress')
})

test('a refused write leaves no mark; a failure after a write keeps its key', async () => {
  const { begin, abort, openIssue, later } = await setup()
  expect((await begin('k3')).state).toBe('new')
  await expect(openIssue('k3', 'Nowhere', 'no-such-repo')).rejects.toThrow()
  later()
  expect((await begin('k3')).state).toBe('new')

  expect((await begin('k4')).state).toBe('new')
  await openIssue('k4', 'Written, then the request failed')
  await abort('k4')
  const again = await begin('k4')
  expect(again.state).toBe('replay')
  expect(JSON.parse(again.response!.body).code).toBe('request_outcome_unknown')
})

test('only the API can mark a key: a sign-in token carrying the claim marks nothing', async () => {
  const { t, begin, later } = await setup()
  expect((await begin('k5')).state).toBe('new')
  const authId = await t.run(async (ctx) => {
    const a = await ctx.db
      .query('accounts')
      .withIndex('by_handle', (q) => q.eq('handle', 'dana'))
      .unique()
    await ctx.db.patch('accounts', a!._id, { authId: 'auth_dana' })
    return 'auth_dana'
  })
  await t
    .withIdentity({
      subject: authId,
      sx_idem: JSON.stringify(['dana@dana:tok', 'k5']),
    })
    .mutation(forge.forge.issues.create, {
      owner: 'dana',
      name: 'gitfs',
      title: 'From the browser',
    })
  later()
  expect((await begin('k5')).state).toBe('new')
})

test('the API signs the held key into each call, and only while the request holds it', async () => {
  const principal = {
    handle: 'dana',
    tokenId: 'tok',
    class: 'human',
    actingAs: 'dana',
    scopes: new Set(['repo:read']),
    repos: null,
  } as never
  expect(claimsOf(principal).sx_idem).toBeUndefined()
  const inside = heldKey.run({ scope: 's', key: 'k' }, () =>
    Promise.resolve().then(() => claimsOf(principal)),
  )
  expect((await inside).sx_idem).toBe('["s","k"]')

  // Through the pipeline: the domain sees the key only for a keyed write.
  const api = createSampleApi({})
  const seen: Array<unknown> = []
  const original = api.domain.createIssue.bind(api.domain)
  api.domain.createIssue = (...args: Parameters<typeof original>) => {
    seen.push(heldKey.getStore() ?? null)
    return original(...args)
  }
  const post = (headers: Record<string, string>) =>
    api.fetch(
      new Request('http://localhost/v1/repos/dana/gitfs/issues', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sampleTokens.dana}`,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ title: `Keyed ${seen.length}` }),
      }),
    )
  expect((await post({ 'idempotency-key': 'abc' })).status).toBe(201)
  expect((await post({})).status).toBe(201)
  expect(seen[0]).toMatchObject({ key: 'abc' })
  expect(seen[1]).toBeNull()
})
