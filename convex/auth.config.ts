import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import { env } from './_generated/server'
import type { AuthConfig } from 'convex/server'

/**
 * Two doors, two issuers, one `Actor` behind them (`lib/actor.ts`):
 *  - sign-in (Better Auth): a person in the browser;
 *  - the HTTP API: after it checked a bearer token, it calls the forge with
 *    a 60-second JWT of its own that carries the principal.
 *
 * The API's public key comes from `bun scripts/api-keys.ts`, which prints
 * the two values to set: `npx convex env set API_JWT_ISSUER ...` and
 * `npx convex env set API_JWT_JWKS ...`. Without them only sign-in works.
 */
const apiIssuer = env.API_JWT_ISSUER
const apiJwks = env.API_JWT_JWKS

export default {
  providers: [
    getAuthConfigProvider(),
    ...(apiIssuer && apiJwks
      ? [
          {
            type: 'customJwt' as const,
            applicationID: 'convex-forge',
            issuer: apiIssuer,
            jwks: apiJwks,
            algorithm: 'ES256' as const,
          },
        ]
      : []),
  ],
} satisfies AuthConfig
