import { Duration, Effect } from 'effect'

/**
 * Wait for a promise, but give up after `within`. Resolves to `null` on a
 * timeout or a rejection instead of throwing.
 *
 * Use it in loaders where a backend may be offline and must not block
 * navigation. (A Convex client that cannot connect never settles.)
 */
export function settleWithin<TValue>(
  start: () => PromiseLike<TValue>,
  within: Duration.Input,
): Promise<TValue | null> {
  return Effect.runPromise(
    Effect.tryPromise(start).pipe(
      Effect.timeout(within),
      Effect.match({ onSuccess: (value) => value, onFailure: () => null }),
    ),
  )
}

export { Duration }
