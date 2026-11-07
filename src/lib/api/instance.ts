import { MemoryTokenStore } from './auth'
import { ConvexIdempotencyStore, ConvexLimitStore, convexCaller } from './stores/convex'
import { createSampleApi } from './index'

/**
 * The one API the running app serves, shared by `/api/v1`, `/mcp` and the
 * OAuth discovery documents so a token works on all of them.
 *
 * The sample tokens are documented, so they only work when you run the app
 * yourself (`bun run dev`) or set SX_API_SAMPLE_TOKENS=1. A deployed preview
 * answers anonymous reads of the public sample repositories and nothing else,
 * so nobody can write into its shared sample data. Sign-in on the OAuth page
 * follows the same rule.
 *
 * Rate limits and idempotency keys are kept in memory, which is right for one
 * node. To run several, set CONVEX_URL and API_STORE_SECRET (the same value as
 * on the deployment: `npx convex env set API_STORE_SECRET ...`). Both are then
 * shared through Convex, and the limit is enforced across every node.
 */
export const API_MOUNT = '/api/v1'

let current: ReturnType<typeof createSampleApi> | undefined

export function getApi(requestUrl: string) {
  if (current) return current
  // Links in responses point at the public address. SX_PUBLIC_URL overrides the
  // address the first request arrived on, for deployments behind a proxy.
  const origin = process.env.SX_PUBLIC_URL ?? new URL(requestUrl).origin
  const live = import.meta.env.DEV || process.env.SX_API_SAMPLE_TOKENS === '1'
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  const secret = process.env.API_STORE_SECRET
  const shared = url && secret && secret.length >= 16 ? convexCaller(url) : null
  current = createSampleApi({
    mount: API_MOUNT,
    base: `${origin}${API_MOUNT}`,
    htmlBase: origin,
    sampleLogins: live,
    ...(live ? {} : { tokens: new MemoryTokenStore() }),
    ...(shared && secret ? { limitStore: new ConvexLimitStore(shared, secret), idempotency: new ConvexIdempotencyStore(shared, secret) } : {}),
  })
  return current
}
