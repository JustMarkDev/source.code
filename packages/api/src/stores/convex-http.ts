import { ConvexHttpClient } from 'convex/browser'
import { SignJWT, importJWK } from 'jose'
import { makeFunctionReference } from 'convex/server'
import { claimsOf } from '../domain/convex'
import type { ConvexCall } from '../domain/convex'
import type { JWK } from 'jose'

/**
 * Calls the forge's Convex functions from the API server. The API already
 * checked the bearer token; it tells Convex who is calling with a JWT it
 * signs itself, good for 60 seconds, carrying the principal (handle, token,
 * class, scopes, the account it acts as and the repositories it is limited
 * to). Convex verifies it against the public key in `auth.config.ts`; no
 * function takes an identity as an argument.
 */
export type ApiSigner = {
  issuer: string
  /** The private key, as the JWK `scripts/api-keys.ts` prints. */
  privateJwk: JWK
}

const TTL = 60
type Key = Awaited<ReturnType<typeof importJWK>>

export function convexHttpCall(url: string, signer: ApiSigner): ConvexCall {
  let key: Promise<Key> | undefined
  // A token is reused while it has 15 seconds left, per caller.
  const minted = new Map<string, { jwt: string; until: number }>()
  const sign = async (who: Parameters<ConvexCall>[3]) => {
    if (who === null) return null
    const claims = claimsOf(who)
    const cacheKey = JSON.stringify(claims)
    const at = Math.floor(Date.now() / 1000)
    const have = minted.get(cacheKey)
    if (have && have.until - 15 > at) return have.jwt
    key ??= importJWK(signer.privateJwk, 'ES256')
    const { subject, ...rest } = claims
    const jwt = await new SignJWT(rest)
      .setProtectedHeader({ alg: 'ES256', kid: signer.privateJwk.kid })
      .setIssuer(signer.issuer)
      .setAudience('convex-forge')
      .setSubject(subject)
      .setIssuedAt(at)
      .setExpirationTime(at + TTL)
      .sign(await key)
    if (minted.size > 10_000) minted.clear()
    minted.set(cacheKey, { jwt, until: at + TTL })
    return jwt
  }
  return async (kind, name, args, who) => {
    const client = new ConvexHttpClient(url)
    const jwt = await sign(who)
    if (jwt) client.setAuth(jwt)
    const ref = makeFunctionReference(name as never) as never
    if (kind === 'query') return await client.query(ref, args as never)
    if (kind === 'mutation') return await client.mutation(ref, args as never)
    return await client.action(ref, args as never)
  }
}
