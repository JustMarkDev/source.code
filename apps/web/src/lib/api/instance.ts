import { MemoryTokenStore, oauthScopes } from '@source-code/api/auth'
import {
  ConvexIdempotencyStore,
  ConvexLimitStore,
  convexCaller,
} from '@source-code/api/stores/convex'
import { createSampleApi } from '@source-code/api'
import { createConvexApi } from '@source-code/api/convex-api'
import { exportWorld } from '@source-code/api/seed-export'
import { AppSessions } from './sessions'

/**
 * The one API the running app serves, shared by `/api/v1`, `/mcp` and the
 * OAuth discovery documents so a token works on all of them.
 *
 * The sample tokens are documented, so they only work when you run the app
 * yourself (`bun run dev`) or set SX_API_SAMPLE_TOKENS=1. A deployed preview
 * answers anonymous reads of the public sample repositories and nothing else,
 * so nobody can write into its shared sample data. The OAuth pages ask the
 * app's own sign-in who the visitor is (`sessions.ts`).
 *
 * Rate limits and idempotency keys are kept in memory, which is right for one
 * node. To run several, set CONVEX_URL and API_STORE_SECRET (the same value as
 * on the deployment: `npx convex env set API_STORE_SECRET ...`). Both are then
 * shared through Convex, and the limit is enforced across every node.
 */
export const API_MOUNT = '/api/v1'

type AppApi = Pick<
  ReturnType<typeof createSampleApi>,
  'fetch' | 'fetchAs' | 'ops' | 'port' | 'oauth' | 'verifyToken'
>

let current: AppApi | undefined

/**
 * The API on Convex: every record in the deployment, nothing kept here that a
 * restart would lose. It needs the deployment (`VITE_CONVEX_URL`) and the key
 * the API signs its Convex JWTs with (`bun scripts/api-keys.ts`).
 */
function convexApi(origin: string, sessions: AppSessions, live: boolean) {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  const key = process.env.API_JWT_PRIVATE_KEY
  if (!url || !key) return null
  return createConvexApi({
    convexUrl: url,
    jwt: {
      issuer: process.env.API_JWT_ISSUER ?? origin,
      privateJwk: JSON.parse(key),
    },
    storeSecret: process.env.API_STORE_SECRET,
    // Every server must share it; one server in development may make its own.
    uploadSecret: process.env.UPLOAD_SECRET ?? key,
    mount: API_MOUNT,
    base: `${origin}${API_MOUNT}`,
    htmlBase: origin,
    sessions,
    userScopes: () => oauthScopes,
    blobFolder: process.env.SX_BLOB_DIR ?? `${process.cwd()}/.data/blobs`,
    // A new development deployment starts from the sample.
    seedSample: live
      ? () => {
          const sample = createSampleApi({
            mount: API_MOUNT,
            base: `${origin}${API_MOUNT}`,
            htmlBase: origin,
          })
          return JSON.stringify(
            exportWorld(sample.domain, sample.domain.svc.auth as never),
          )
        }
      : undefined,
  })
}

/**
 * The shared Convex store caller, or null for one-node memory stores. A
 * deployment that names Convex but supplies a missing or short secret is a
 * configuration error: silently falling back would make retries duplicate
 * writes and rate limits per-node.
 */
export function sharedStore(
  url: string | undefined,
  secret: string | undefined,
) {
  if (!url) return null
  if (!secret || secret.length < 16)
    throw new Error(
      'CONVEX_URL is set, so API_STORE_SECRET must be at least 16 characters. Refusing to fall back to per-node memory stores.',
    )
  return convexCaller(url)
}

/**
 * The URL that turns on the shared store. VITE_CONVEX_URL belongs to the
 * frontend client and is present everywhere, so it only counts when a valid
 * secret was actually configured; an explicit CONVEX_URL is the API switch and
 * is validated by sharedStore even when the secret is missing.
 */
export function storeConfig(
  explicitUrl: string | undefined,
  frontendUrl: string | undefined,
  secret: string | undefined,
): string | undefined {
  if (explicitUrl) return explicitUrl
  return secret && secret.length >= 16 ? frontendUrl : undefined
}

export function getApi(requestUrl: string) {
  if (current) return current
  // Links in responses point at the public address. SX_PUBLIC_URL overrides the
  // address the first request arrived on, for deployments behind a proxy.
  const origin = process.env.SX_PUBLIC_URL ?? new URL(requestUrl).origin
  const live = import.meta.env.DEV || process.env.SX_API_SAMPLE_TOKENS === '1'
  const secret = process.env.API_STORE_SECRET
  const url = storeConfig(
    process.env.CONVEX_URL,
    process.env.VITE_CONVEX_URL,
    secret,
  )
  const shared = sharedStore(url, secret)
  // The OAuth pages use the app's own sign-in, and the domain is told about
  // each person it sees. A changed address is a new person to the domain
  // until it can rename an account.
  const sessions = new AppSessions((user) => {
    void current?.port.knowPerson(user.handle, user.name)
  })
  const onConvex = convexApi(origin, sessions, live)
  if (onConvex) {
    current = onConvex
    startSchedules()
    return current
  }
  console.warn(
    '[api] No Convex key (API_JWT_PRIVATE_KEY): serving the sample from memory. Nothing written is kept.',
  )
  const api = createSampleApi({
    mount: API_MOUNT,
    base: `${origin}${API_MOUNT}`,
    htmlBase: origin,
    sessions,
    // A person may delegate anything they can do themselves; what that is,
    // the domain decides per repository.
    userScopes: () => oauthScopes,
    ...(live ? {} : { tokens: new MemoryTokenStore() }),
    ...(shared && secret
      ? {
          limitStore: new ConvexLimitStore(shared, secret),
          idempotency: new ConvexIdempotencyStore(shared, secret),
        }
      : {}),
  })
  current = api
  startSchedules()
  return current
}

/**
 * Scheduled automations fire from this clock: one timer per process, also
 * across reloads in development. On Convex the deployment's own cron fires
 * them too; a tick that finds nothing due does nothing.
 */
function startSchedules() {
  const g = globalThis as { sxSchedules?: ReturnType<typeof setInterval> }
  if (g.sxSchedules) clearInterval(g.sxSchedules)
  // A schedule missed while the server was down fires once, at start.
  void Promise.resolve(current?.port.tickSchedules()).catch(() => {})
  g.sxSchedules = setInterval(
    () => void Promise.resolve(current?.port.tickSchedules()).catch(() => {}),
    60_000,
  )
  g.sxSchedules.unref()
}
