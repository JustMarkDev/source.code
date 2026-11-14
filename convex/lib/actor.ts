import { fail } from './errors'
import type { QueryCtx } from '../_generated/server'

/**
 * Who is calling, from the token Convex verified, never from an argument.
 *
 * Two issuers sign tokens Convex accepts (`auth.config.ts`):
 *  - sign-in (Better Auth), for a person in the browser. They act as
 *    themself with every scope, as they would with a full personal token.
 *  - the HTTP API, after it checked a bearer token. Its short JWT carries
 *    the principal the API worked out: the login, the account it acts as,
 *    the class of actor, the scopes and the repositories it is limited to.
 *
 * The same `Actor` comes out of both, so a rule is written once.
 */
export type ActorClass = 'human' | 'agent' | 'bot'

export type Actor = {
  /** The login. */
  handle: string
  /** The account the request acts as. */
  actingAs: string
  class: ActorClass
  scopes: ReadonlySet<string>
  /** Lowercase `owner/name` list when limited to repositories. */
  repos: ReadonlyArray<string> | null
  /** The API token behind the request; null for a browser session. */
  tokenId: string | null
  /** The API server itself, for housekeeping no person asked for. */
  system: boolean
}

export const allScopes = [
  'repo:read',
  'repo:write',
  'issues:read',
  'issues:comment',
  'issues:write',
  'pulls:read',
  'pulls:comment',
  'pulls:write',
  'pulls:merge',
  'secrets:schema',
  'secrets:write',
  'secrets:decrypt',
  'webhooks:read',
  'webhooks:write',
  'tokens:manage',
  'runs:transcripts',
] as const

/** The claims the API puts in its JWT. Short names: they ride on every call. */
export const claim = {
  token: 'sx_tok',
  class: 'sx_cls',
  actingAs: 'sx_act',
  scopes: 'sx_scp',
  repos: 'sx_rep',
  system: 'sx_sys',
  /** `[scope, key]` of the request's Idempotency-Key, as JSON. */
  idempotency: 'sx_idem',
} as const

type Ctx = Pick<QueryCtx, 'auth' | 'db'>

export async function actorOf(ctx: Ctx): Promise<Actor | null> {
  const id = await ctx.auth.getUserIdentity()
  if (!id) return null
  const cls = id[claim.class]
  if (typeof cls === 'string') {
    const scopes = id[claim.scopes]
    const repos = id[claim.repos]
    const acting = id[claim.actingAs]
    const token = id[claim.token]
    return {
      handle: id.subject,
      actingAs: typeof acting === 'string' ? acting : id.subject,
      class: cls === 'agent' || cls === 'bot' ? cls : 'human',
      scopes: new Set(
        typeof scopes === 'string' ? scopes.split(' ').filter(Boolean) : [],
      ),
      repos:
        typeof repos === 'string'
          ? repos
              .split(',')
              .filter(Boolean)
              .map((r) => r.toLowerCase())
          : null,
      tokenId: typeof token === 'string' ? token : null,
      system: id[claim.system] === true || id[claim.system] === 'true',
    }
  }
  // A browser session: the person whose sign-in this is.
  const account = await ctx.db
    .query('accounts')
    .withIndex('by_authId', (q) => q.eq('authId', id.subject))
    .unique()
  if (!account || account.kind !== 'person') return null
  return {
    handle: account.handle,
    actingAs: account.handle,
    class: 'human',
    scopes: new Set(allScopes),
    repos: null,
    tokenId: null,
    system: false,
  }
}

/** The caller, who must be signed in. */
export async function signedIn(
  ctx: Ctx,
  why = 'Sign in first.',
): Promise<Actor> {
  const a = await actorOf(ctx)
  if (!a) fail('unauthenticated', why)
  return a
}

/** Only the API server, for housekeeping. */
export async function system(ctx: Ctx): Promise<Actor> {
  const a = await actorOf(ctx)
  if (!a?.system) fail('forbidden', 'Only the API server can do this.')
  return a
}
