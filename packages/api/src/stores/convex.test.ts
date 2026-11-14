import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { internal } from '../../../../convex/_generated/api'
import schema from '../../../../convex/schema'
import { Limiter } from '../limiter'
import { ConvexIdempotencyStore, ConvexLimitStore } from './convex'
import type { ConvexCall } from './convex'

// The Convex functions, loaded the way Vite's `import.meta.glob` would load them.
const dir = new URL('../../../../convex/', import.meta.url).pathname
const modules: Record<string, () => Promise<never>> = {}
for (const f of new Bun.Glob('**/*.{ts,js}').scanSync(dir))
  if (!f.endsWith('.d.ts'))
    modules[`./${f}`] = () => import(`${dir}${f}`) as Promise<never>

const SECRET = 'test-secret-0123456789'

function deployment() {
  process.env.API_STORE_SECRET = SECRET
  const t = convexTest(schema, modules)
  const calls: Array<string> = []
  const call: ConvexCall = (name, args) => {
    calls.push(name)
    return (
      t.mutation as unknown as (ref: unknown, args: unknown) => Promise<unknown>
    )(makeFunctionReference<'mutation'>(name), args)
  }
  return { t, call, calls }
}

beforeEach(() => setSystemTime(new Date('2026-11-08T12:00:00Z')))
afterEach(() => setSystemTime())

describe('rate limits on Convex', () => {
  test('never hands out more than the limit, however the asks are split', async () => {
    const { call } = deployment()
    const store = new ConvexLimitStore(call, SECRET)
    const policy = { limit: 100, windowMs: 60_000 }
    let granted = 0
    for (const want of [30, 30, 30, 30, 30])
      granted += (await store.take('k', want, policy, 0)).granted
    expect(granted).toBe(100)
    const last = await store.take('k', 5, policy, 0)
    expect(last).toMatchObject({ granted: 0, remaining: 0 })
    expect(last.resetMs).toBeGreaterThan(0)
    expect(last.resetMs).toBeLessThanOrEqual(60_000)
  })

  test('asks that arrive together are ordered, so the last units go to one of them', async () => {
    const { call } = deployment()
    const store = new ConvexLimitStore(call, SECRET)
    const policy = { limit: 50, windowMs: 60_000 }
    const grants = await Promise.all(
      Array.from({ length: 20 }, () => store.take('hot', 10, policy, 0)),
    )
    expect(grants.reduce((n, g) => n + g.granted, 0)).toBe(50)
  })

  test('a new window starts again, and keys do not share units', async () => {
    const { call } = deployment()
    const store = new ConvexLimitStore(call, SECRET)
    const policy = { limit: 10, windowMs: 60_000 }
    expect((await store.take('a', 10, policy, 0)).granted).toBe(10)
    expect((await store.take('b', 10, policy, 0)).granted).toBe(10)
    expect((await store.take('a', 1, policy, 0)).granted).toBe(0)
    setSystemTime(new Date('2026-11-08T12:01:00Z'))
    expect((await store.take('a', 4, policy, 0)).granted).toBe(4)
  })

  test('a limiter on top of it admits exactly the limit across nodes and rarely asks the database', async () => {
    const { call, calls } = deployment()
    const store = new ConvexLimitStore(call, SECRET)
    const policy = { limit: 200, windowMs: 60_000 }
    const nodes = [new Limiter(store), new Limiter(store), new Limiter(store)]
    let admitted = 0
    for (let i = 0; i < 400; i++)
      if ((await nodes[i % 3].check('token', policy, 1)).allowed) admitted++
    expect(admitted).toBeLessThanOrEqual(200)
    expect(admitted).toBeGreaterThan(150)
    expect(calls.length).toBeLessThan(60)
  })

  test('a caller without the secret is refused', async () => {
    const { call } = deployment()
    await expect(
      new ConvexLimitStore(call, 'wrong-secret-0123456789').take(
        'k',
        1,
        { limit: 1, windowMs: 1000 },
        0,
      ),
    ).rejects.toThrow()
    await expect(
      new ConvexLimitStore(call, '').take(
        'k',
        1,
        { limit: 1, windowMs: 1000 },
        0,
      ),
    ).rejects.toThrow()
  })

  test('a deployment with no secret set refuses everyone', async () => {
    const { call } = deployment()
    delete process.env.API_STORE_SECRET
    await expect(
      new ConvexLimitStore(call, '').take(
        'k',
        1,
        { limit: 1, windowMs: 1000 },
        0,
      ),
    ).rejects.toThrow()
    await expect(
      new ConvexLimitStore(call, 'undefined').take(
        'k',
        1,
        { limit: 1, windowMs: 1000 },
        0,
      ),
    ).rejects.toThrow()
  })
})

describe('idempotency on Convex', () => {
  const response = {
    status: 201,
    headers: { 'content-type': 'application/json', location: '/issues/9' },
    body: '{"number":9}',
  }

  test('the first request runs, a repeat replays its answer, a different request with the same key is refused', async () => {
    const { call } = deployment()
    const store = new ConvexIdempotencyStore(call, SECRET)
    expect(await store.begin('tok', 'k1', 'fp-a')).toEqual({ state: 'new' })
    expect(await store.begin('tok', 'k1', 'fp-a')).toEqual({
      state: 'in_progress',
    })
    await store.complete('tok', 'k1', response)
    expect(await store.begin('tok', 'k1', 'fp-a')).toEqual({
      state: 'replay',
      response,
    })
    expect(await store.begin('tok', 'k1', 'fp-b')).toEqual({
      state: 'conflict',
    })
    // The same key under another scope is another key.
    expect(await store.begin('other', 'k1', 'fp-a')).toEqual({ state: 'new' })
  })

  test('two nodes starting the same request together: one runs, the other waits', async () => {
    const { call } = deployment()
    const a = new ConvexIdempotencyStore(call, SECRET)
    const b = new ConvexIdempotencyStore(call, SECRET)
    const results = await Promise.all([
      a.begin('tok', 'race', 'fp'),
      b.begin('tok', 'race', 'fp'),
      a.begin('tok', 'race', 'fp'),
    ])
    expect(results.filter((r) => r.state === 'new')).toHaveLength(1)
    expect(results.filter((r) => r.state === 'in_progress')).toHaveLength(2)
  })

  test('an aborted request can be tried again, and a key expires', async () => {
    const { call } = deployment()
    const store = new ConvexIdempotencyStore(call, SECRET, 60_000)
    await store.begin('tok', 'k', 'fp')
    await store.abort('tok', 'k')
    expect(await store.begin('tok', 'k', 'fp')).toEqual({ state: 'new' })
    await store.complete('tok', 'k', response)
    setSystemTime(new Date('2026-11-08T12:02:00Z'))
    expect(await store.begin('tok', 'k', 'fp')).toEqual({ state: 'new' })
  })

  test('a response too big for a document is replaced by a short one, so a retry still does not repeat the work', async () => {
    const { call } = deployment()
    const store = new ConvexIdempotencyStore(call, SECRET)
    await store.begin('tok', 'big', 'fp')
    await store.complete('tok', 'big', {
      status: 200,
      headers: {},
      body: 'x'.repeat(950_000),
    })
    const again = await store.begin('tok', 'big', 'fp')
    expect(again.state).toBe('replay')
    if (again.state === 'replay') {
      expect(again.response.status).toBe(500)
      expect(again.response.body.length).toBeLessThan(1000)
    }
  })

  test('the sweep removes finished windows and expired keys, and only those', async () => {
    const { t, call } = deployment()
    const limits = new ConvexLimitStore(call, SECRET)
    const keys = new ConvexIdempotencyStore(call, SECRET, 60_000)
    await limits.take('old', 1, { limit: 5, windowMs: 60_000 }, 0)
    await keys.begin('tok', 'old', 'fp')
    setSystemTime(new Date('2026-11-08T14:00:00Z'))
    await limits.take('fresh', 1, { limit: 5, windowMs: 60_000 }, 0)
    await keys.begin('tok', 'fresh', 'fp')
    await t.mutation(internal.apiStores.sweep, {})
    const left = await t.run(async (ctx) => ({
      windows: (await ctx.db.query('apiLimits').collect()).map((w) => w.key),
      keys: (await ctx.db.query('apiIdempotency').collect()).map((k) => k.key),
    }))
    expect(left).toEqual({ windows: ['fresh'], keys: ['fresh'] })
  })
})

describe('when Convex cannot be reached', () => {
  const down: ConvexCall = () => Promise.reject(new Error('network'))
  const quiet = (run: () => Promise<void>) => async () => {
    const was = console.error
    console.error = () => undefined
    try {
      await run()
    } finally {
      console.error = was
    }
  }

  test(
    'rate limits admit a small block on each node instead of failing the request',
    quiet(async () => {
      const g = await new ConvexLimitStore(down, SECRET).take(
        'k',
        50,
        { limit: 1000, windowMs: 60_000 },
        0,
      )
      expect(g.granted).toBe(10)
      const small = await new ConvexLimitStore(down, SECRET).take(
        'k',
        50,
        { limit: 20, windowMs: 60_000 },
        0,
      )
      expect(small.granted).toBe(1)
    }),
  )

  test(
    'a write with an Idempotency-Key is refused, not risked',
    quiet(async () => {
      const store = new ConvexIdempotencyStore(down, SECRET)
      await expect(store.begin('tok', 'k', 'fp')).rejects.toMatchObject({
        code: 'backend_unavailable',
      })
    }),
  )
})
