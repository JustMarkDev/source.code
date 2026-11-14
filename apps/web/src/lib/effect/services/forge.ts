import { SxError, createClient } from '@source-code/sdk'
import { personPrincipal } from '@source-code/api/auth'
import { Context, Effect, Layer } from 'effect'
import { BackendUnavailable, NotFound, Refused } from '../errors'
import type {
  Client,
  OperationId,
  Operations,
  RequestOptions,
} from '@source-code/sdk'
import type { getApi } from '~/lib/api/instance'
import type { CurrentUser } from '~/lib/auth/server'

/**
 * The forge's data, read and written through the public API as the person
 * who is signed in. A screen never reaches the domain or the git store
 * itself: it calls an operation, so it sees exactly what that person may see
 * and a client of the API can do everything a screen can.
 *
 * The call stays in this process (no network), and uses the generated client
 * in `packages/sdk`, so inputs and answers are typed by operation id.
 *
 * This file is the pattern for every service in the app:
 *   1. a class-style key with its shape written as an interface,
 *   2. a `Live` layer that builds the implementation,
 *   3. methods that return Effects with their errors in the type.
 */
export class Forge extends Context.Service<
  Forge,
  {
    /** Run one API operation as the signed-in person, or as a visitor. */
    readonly call: <TId extends OperationId>(
      id: TId,
      input: Operations[TId]['input'],
      options?: RequestOptions,
    ) => Effect.Effect<
      Operations[TId]['output'],
      NotFound | Refused | BackendUnavailable
    >
  }
>()('app/Forge') {}

type Api = Pick<ReturnType<typeof getApi>, 'fetch' | 'fetchAs' | 'port'>

/** Most people held at once. Past it the oldest is dropped and made again when needed. */
const HELD_MAX = 5000

/**
 * One API client per signed-in person, kept between requests so the client's
 * `ETag` cache turns a repeated read into a free `304`.
 *
 * No token stands behind it. The request goes to the API in this process as
 * the person the session cookie names, already signed in, so there is no
 * secret to mint, refresh, leak or let expire. What the person may do, the
 * domain decides, exactly as for their own tokens.
 */
export class Callers {
  private readonly held = new Map<string, Client>()
  private visitor: Client | undefined

  constructor(
    private readonly api: Api,
    private readonly base: string,
    private readonly now: () => number = Date.now,
  ) {}

  private client(handle?: string): Client {
    return createClient({
      baseUrl: this.base,
      // In process: nothing to retry that a second try would fix.
      retries: 0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        return handle
          ? this.api.fetchAs(personPrincipal(handle, this.now()), req)
          : this.api.fetch(req)
      }) as typeof fetch,
    })
  }

  // oxlint-disable-next-line require-await -- a promise, as callers have always awaited
  async for(user: CurrentUser | null): Promise<Client> {
    if (!user) return (this.visitor ??= this.client())
    const have = this.held.get(user.handle)
    if (have) return have
    void this.api.port.knowPerson(user.handle, user.name)
    if (this.held.size >= HELD_MAX)
      this.held.delete(this.held.keys().next().value as string)
    const made = this.client(user.handle)
    this.held.set(user.handle, made)
    return made
  }

  /**
   * One raw request to the API as the person, for answers that are not JSON
   * (a file). `path` is under the API's mount, such as `/uploads/upl_1/content`.
   */
  // oxlint-disable-next-line require-await -- a promise, as callers have always awaited
  async raw(user: CurrentUser | null, path: string, init: RequestInit = {}) {
    const req = new Request(`${this.base}${path}`, init)
    return user
      ? this.api.fetchAs(personPrincipal(user.handle, this.now()), req)
      : this.api.fetch(req)
  }

  /** Forget a person, for example when they sign out. */
  drop(handle: string) {
    this.held.delete(handle)
  }
}

/** An API answer that was not a success, as one of the app's expected failures. */
export const failureOf = (id: string, cause: unknown) => {
  if (!(cause instanceof SxError))
    return new BackendUnavailable({ service: 'api', cause })
  // The API answers 404 for what the caller may not see, so this is all a
  // screen needs to show "not found" for both.
  if (cause.status === 404) return new NotFound({ what: id })
  if (cause.status >= 500 || cause.status === 429)
    return new BackendUnavailable({ service: 'api', cause })
  return new Refused({
    code: cause.code,
    message: cause.message,
    hint: cause.hint,
    status: cause.status,
  })
}

/** A Forge over a way to find the caller's client. Tests pass their own. */
export const forgeOver = (
  client: () => Promise<{
    client: Pick<Client, 'call'>
    headers?: Record<string, string>
  }>,
) =>
  Forge.of({
    call: (id, input, options) =>
      Effect.tryPromise({
        try: async () => {
          const found = await client()
          return await found.client.call(id, input, {
            ...options,
            headers: { ...found.headers, ...options?.headers },
          })
        },
        catch: (cause) => failureOf(id, cause),
      }).pipe(Effect.withSpan(`Forge.${id}`)),
  })

let callers: Callers | undefined

export const ForgeLive = Layer.succeed(Forge)(
  forgeOver(async () => {
    // Loaded here so that importing this file does not need a request, or the
    // sign-in settings, to exist.
    const [{ getRequest }, { currentUser }, { API_MOUNT, getApi }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('~/lib/auth/server'),
        import('~/lib/api/instance'),
      ])
    const request = getRequest()
    const api = getApi(request.url)
    callers ??= new Callers(
      api,
      `${process.env.SX_PUBLIC_URL ?? new URL(request.url).origin}${API_MOUNT}`,
    )
    // A visitor is rate limited by address, so pass on the one the proxy saw.
    const forwarded = request.headers.get('x-forwarded-for')
    return {
      client: await callers.for(await currentUser()),
      headers: forwarded ? { 'x-forwarded-for': forwarded } : undefined,
    }
  }),
)

/** A raw API request as whoever this request's session names. Server only. */
export async function rawAsCaller(
  request: Request,
  path: string,
  init?: RequestInit,
) {
  const [{ currentUser }, { API_MOUNT, getApi }] = await Promise.all([
    import('~/lib/auth/server'),
    import('~/lib/api/instance'),
  ])
  const api = getApi(request.url)
  callers ??= new Callers(
    api,
    `${process.env.SX_PUBLIC_URL ?? new URL(request.url).origin}${API_MOUNT}`,
  )
  return callers.raw(await currentUser(), path, init)
}
