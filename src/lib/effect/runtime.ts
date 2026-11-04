import { notFound } from '@tanstack/react-router'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { GitStoreLive } from './services/git-store'
import type { GitStore } from './services/git-store'
import type { AppError } from './errors'

/**
 * Server side only. The one place every service is wired together.
 *
 * To add a service: write it under `services/`, merge its `Live` layer into
 * `AppLayer`, and add its key to `AppServices`. A service another service
 * depends on (RepoDirectory) stays inside that service's layer; programs only
 * ask for what they use directly.
 */
export type AppServices = GitStore

const AppLayer = Layer.mergeAll(GitStoreLive)

// Built lazily and kept for the life of the process. Layers (and the Convex
// client inside them) are constructed once, not per request.
let runtime: ManagedRuntime.ManagedRuntime<AppServices, unknown> | undefined
const getRuntime = () => (runtime ??= ManagedRuntime.make(AppLayer))

/**
 * The boundary between Effect and the framework. Server functions and loaders
 * call this with a program and get a plain promise back.
 *
 * Expected failures (`AppError`) become what the router already understands:
 * `NotFound` is a 404, everything else is an error with a short message.
 * Defects (bugs) are thrown as they are.
 */
export async function runServer<TValue, TError extends AppError>(
  program: Effect.Effect<TValue, TError, AppServices>,
): Promise<TValue> {
  const settled = await getRuntime().runPromise(
    program.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error }),
      }),
    ),
  )
  if (settled.ok) return settled.value
  const error: AppError = settled.error
  switch (error._tag) {
    case 'NotFound':
      throw notFound()
    case 'InvalidInput':
      throw new Error(`${error.field} is not valid`)
    case 'BackendUnavailable':
      throw new Error(`${error.service} is unavailable`)
  }
}
