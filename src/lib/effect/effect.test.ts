import { expect, test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { ApiError } from '@pierre/storage'
import { git } from './services/git-store'
import { BackendUnavailable, NotFound, settleWithin } from './index'

test('settleWithin resolves to the value when the promise is fast', async () => {
  expect(await settleWithin(() => Promise.resolve(42), '1 second')).toBe(42)
})

test('settleWithin resolves to null when the promise never settles', async () => {
  const started = performance.now()
  expect(
    await settleWithin(() => new Promise<never>(() => {}), '50 millis'),
  ).toBe(null)
  expect(performance.now() - started).toBeLessThan(500)
})

test('settleWithin resolves to null when the promise rejects', async () => {
  expect(
    await settleWithin(() => Promise.reject(new Error('no')), '1 second'),
  ).toBe(null)
})

test('git() maps a 404 from the store to NotFound and anything else to BackendUnavailable', async () => {
  const missing = new ApiError({
    message: 'x',
    status: 404,
    statusText: 'Not Found',
    method: 'GET',
    url: 'fake://',
  })
  const a = await Effect.runPromise(
    git('thing', () => Promise.reject(missing)).pipe(Effect.flip),
  )
  const b = await Effect.runPromise(
    git('thing', () => Promise.reject(new Error('boom'))).pipe(Effect.flip),
  )
  expect(a).toBeInstanceOf(NotFound)
  expect(b).toBeInstanceOf(BackendUnavailable)
})

test('a service is replaced in tests by providing another layer', async () => {
  class Clock extends Context.Service<Clock, { readonly now: () => number }>()(
    'test/Clock',
  ) {}
  const program = Effect.gen(function* () {
    const clock = yield* Clock
    return clock.now()
  })
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.succeed(Clock)(Clock.of({ now: () => 7 }))),
    ),
  )
  expect(result).toBe(7)
})

test('runServer turns a typed failure into a plain error at the boundary', async () => {
  const { runServer } = await import('./runtime')
  const { GitStore } = await import('./services/git-store')
  // No VITE_CONVEX_URL under test, so the directory reports the backend as down.
  const program = Effect.gen(function* () {
    const store = yield* GitStore
    return yield* store.open('dana', 'gitfs')
  })
  await expect(runServer(program)).rejects.toThrow('convex is unavailable')
})

test('the repo lookup cache keeps hits, shares in-flight work and never keeps a miss', async () => {
  const { Cache } = await import('effect')
  const { lookupTtl } = await import('./services/repo-directory')
  let calls = 0
  const program = Effect.gen(function* () {
    const cache = yield* Cache.makeWith(
      (key: string) =>
        Effect.promise(() => Promise.resolve(++calls)).pipe(
          Effect.flatMap((n) =>
            key === 'missing'
              ? Effect.fail(new NotFound({ what: key }))
              : Effect.succeed(n),
          ),
        ),
      { capacity: 10, timeToLive: lookupTtl },
    )
    // Two simultaneous lookups of one repo are one call, and the result stays.
    yield* Effect.all([Cache.get(cache, 'a/b'), Cache.get(cache, 'a/b')], {
      concurrency: 'unbounded',
    })
    yield* Cache.get(cache, 'a/b')
    const hits = calls
    // A miss is asked again each time.
    yield* Effect.flip(Cache.get(cache, 'missing'))
    yield* Effect.flip(Cache.get(cache, 'missing'))
    return { hits, total: calls }
  })
  expect(await Effect.runPromise(program)).toEqual({ hits: 1, total: 3 })
})
