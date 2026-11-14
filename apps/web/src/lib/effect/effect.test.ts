import { expect, test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { settleWithin } from './index'

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
  const { InvalidInput } = await import('./errors')
  await expect(
    runServer(Effect.fail(new InvalidInput({ field: 'sha' }))),
  ).rejects.toThrow('sha is not valid')
})
