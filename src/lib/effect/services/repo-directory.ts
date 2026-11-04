import { ConvexHttpClient } from 'convex/browser'
import { Cache, Context, Effect, Exit, Layer } from 'effect'
import { api } from '../../../../convex/_generated/api'
import { BackendUnavailable, NotFound } from '../errors'

/**
 * Resolves `handle/name` to the id of its git store, through Convex.
 *
 * The id is resolved on the server and never taken from the client, so callers
 * can only reach repositories Convex knows about.
 *
 * This file is the pattern for every service in the app:
 *   1. a class-style key with its shape written as an interface,
 *   2. a `Live` layer that builds the implementation,
 *   3. methods that return Effects with their errors in the type.
 */
export class RepoDirectory extends Context.Service<
  RepoDirectory,
  {
    readonly find: (
      handle: string,
      name: string,
    ) => Effect.Effect<
      { readonly storeId: string },
      NotFound | BackendUnavailable
    >
  }
>()('app/RepoDirectory') {}

/** How long a resolved repository is trusted. A store id never changes once created. */
const FOUND_TTL = '2 minutes'

/** Only successes are cached. A miss or a failure is looked up again next time. */
export const lookupTtl = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? FOUND_TTL : 0

export const RepoDirectoryLive = Layer.effect(RepoDirectory)(
  Effect.gen(function* () {
    const url = import.meta.env.VITE_CONVEX_URL
    // One client for the process, built once when the layer is first used.
    const convex = url ? new ConvexHttpClient(url) : null

    const lookup = Effect.fn('RepoDirectory.lookup')(function* (key: string) {
      const [handle, name] = splitKey(key)
      if (!convex) return yield* new BackendUnavailable({ service: 'convex' })
      const repo = yield* Effect.tryPromise({
        try: () => convex.query(api.profiles.repo, { handle, name }),
        catch: (cause) => new BackendUnavailable({ service: 'convex', cause }),
      }).pipe(
        Effect.timeout('5 seconds'),
        Effect.catchTag('TimeoutError', () =>
          Effect.fail(new BackendUnavailable({ service: 'convex' })),
        ),
      )
      if (!repo) return yield* new NotFound({ what: key })
      return { storeId: repo.storeId }
    })

    // Every repo page asks for the store id, which is a round trip to Convex.
    // Cache hits for a couple of minutes, and share one in-flight lookup between
    // simultaneous requests. Misses and failures are never cached, so a repo that
    // was just created is found on the next request.
    const cache = yield* Cache.makeWith(lookup, {
      capacity: 500,
      timeToLive: lookupTtl,
    })

    return RepoDirectory.of({
      find: (handle, name) => Cache.get(cache, `${handle}/${name}`),
    })
  }),
)

const splitKey = (key: string): [string, string] => {
  const at = key.indexOf('/')
  return [key.slice(0, at), key.slice(at + 1)]
}
