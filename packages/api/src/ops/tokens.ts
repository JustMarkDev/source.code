import { Effect } from 'effect'
import { z } from 'zod'
import { allScopes } from '../auth'
import { ApiError, apiError } from '../problem'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { iso } from '../domain'
import type { DomainPort } from '../domain'
import type { Authorization, Principal, TokenRecord } from '../auth'

const MAX_TOKENS = 100

function present(
  d: DomainPort,
  t: TokenRecord,
  secret: string | null,
): z.infer<typeof S.Token> {
  return {
    object: 'token',
    id: t.id,
    name: t.name,
    kind: t.kind === 'oauth' ? 'personal' : t.kind,
    class: t.class,
    scopes: [...t.scopes],
    repos: t.repos ? [...t.repos] : null,
    prefix: t.prefix,
    secret,
    url: `${d.urls.api}/tokens/${t.id}`,
    expires_at: iso(t.expiresAt),
    created_at: iso(t.createdAt),
    last_used_at: t.lastUsedAt ? iso(t.lastUsedAt) : null,
  }
}

async function own(
  d: DomainPort,
  p: Principal,
  id: string,
): Promise<TokenRecord> {
  const t = await d.svc.auth.get(id)
  // Someone else's token answers like one that does not exist.
  if (!t || t.handle !== p.handle || t.revokedAt !== null || t.kind === 'oauth')
    throw apiError('not_found', `No token ${id}.`)
  return t
}

const base = {
  auth: 'required' as const,
  scopes: ['tokens:manage' as const],
  tags: ['tokens'],
}

export const listTokens = defineOp({
  ...base,
  id: 'tokens.list',
  summary: 'Your tokens',
  description:
    'Personal, bot and run tokens that belong to you, newest first. Never includes the secret.',
  method: 'GET',
  path: '/tokens',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.listOf(S.Token),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) =>
        (
          await d.svc.auth.list(ctx.principal!.handle, [
            'personal',
            'bot',
            'run',
          ])
        ).map((t) => present(d, t, null)),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const createToken = defineOp({
  ...base,
  id: 'tokens.create',
  secretResponse: true,
  summary: 'Create a token',
  description:
    'The response is the only time the secret is shown. A token can never have a scope its creator lacks, never outlives a year, and a token limited to repositories can only create tokens limited to the same ones.',
  method: 'POST',
  path: '/tokens',
  pool: 'write',
  safety: 'write',
  idempotent: false,
  body: z.strictObject({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(allScopes)).min(1).max(allScopes.length),
    expires_in_days: z
      .union([z.literal(30), z.literal(60), z.literal(90), z.literal(365)])
      .default(90),
    repos: z
      .array(z.string().regex(/^[^/\s]+\/[^/\s]+$/))
      .max(50)
      .optional()
      .describe('`owner/name`. Limits the token to these repositories'),
  }),
  response: S.Token,
  status: 201,
  errors: ['forbidden', 'insufficient_scope', 'limit_reached', 'not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const p = ctx.principal!
      const body = ctx.body
      const t = yield* run(async (d) => {
        const canonical = new Map<string, string>()
        for (const r of body.repos ?? [])
          canonical.set(r, (await d.canonicalRepoName(r)).toLowerCase())
        const repos = body.repos
          ? [...new Set(body.repos.map((r) => canonical.get(r)!))]
          : null
        const requestedName = new Map<string, string>()
        for (const r of body.repos ?? [])
          requestedName.set(canonical.get(r)!, r)
        const missing = body.scopes.filter((s) => !p.scopes.has(s))
        if (missing.length)
          throw apiError(
            'insufficient_scope',
            `You cannot give a token scopes you do not have: ${missing.join(', ')}.`,
            {
              extra: { required_scopes: missing, token_scopes: [...p.scopes] },
            },
          )
        if (p.repos && (!repos || repos.some((r) => !p.repos!.includes(r))))
          throw apiError(
            'forbidden',
            'Your token is limited to repositories, so a token you create must be limited to some of them.',
          )
        for (const r of repos ?? []) {
          try {
            await d.getRepo(...(r.split('/') as [string, string]), p)
          } catch (e) {
            // Do not reveal the new name of a private repository through an old alias.
            if (e instanceof ApiError && e.code === 'not_found')
              throw apiError(
                'not_found',
                `No repository ${requestedName.get(r) ?? r}.`,
              )
            throw e
          }
        }
        if ((await d.svc.auth.countActive(p.handle, ctx.now())) >= MAX_TOKENS)
          throw apiError(
            'limit_reached',
            `You can have ${MAX_TOKENS} active tokens.`,
          )
        if (ctx.dryRun)
          return present(
            d,
            {
              id: 'tok_dryrun',
              name: body.name,
              kind: 'personal',
              handle: p.handle,
              actingAs: p.handle,
              class: p.class,
              scopes: body.scopes,
              repos,
              audience: ['api', 'mcp'],
              prefix: 'sxp_',
              createdAt: ctx.now(),
              expiresAt: ctx.now() + body.expires_in_days * 86_400_000,
              lastUsedAt: null,
              revokedAt: null,
            },
            null,
          )
        const { record, secret } = await d.svc.auth.create({
          name: body.name,
          kind: p.class === 'human' ? 'personal' : 'bot',
          handle: p.handle,
          class: p.class,
          scopes: body.scopes,
          repos,
          ttlMs: body.expires_in_days * 86_400_000,
        })
        return present(d, record, secret)
      })
      return reply(t, {
        status: 201,
        headers: { location: t.url, 'cache-control': 'no-store' },
      })
    }),
  dryRun: true,
})

export const getToken = defineOp({
  ...base,
  id: 'tokens.get',
  summary: 'One of your tokens',
  method: 'GET',
  path: '/tokens/{id}',
  params: z.object({ id: z.string().describe('The token `tok_` id') }),
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.Token,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) =>
        present(d, await own(d, ctx.principal!, ctx.params.id), null),
      )
    }),
})

export const revokeToken = defineOp({
  ...base,
  id: 'tokens.revoke',
  summary: 'Revoke a token',
  description:
    'It stops working at once. Revoking a token that is already revoked answers 404.',
  method: 'DELETE',
  path: '/tokens/{id}',
  params: z.object({ id: z.string().describe('The token `tok_` id') }),
  pool: 'write',
  safety: 'destructive',
  idempotent: false,
  response: z.null(),
  status: 204,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run(async (d) => {
        const t = await own(d, ctx.principal!, ctx.params.id)
        if (!ctx.dryRun) await d.svc.auth.revoke(t.id)
      })
      return reply(null, { status: 204 })
    }),
  dryRun: true,
})

function presentAuthz(
  d: DomainPort,
  a: Authorization,
): z.infer<typeof S.Authorization> {
  return {
    object: 'authorization',
    id: a.id,
    client: { id: a.clientId, name: a.clientName },
    scopes: [...a.scopes],
    audience: [...a.audience],
    url: `${d.urls.api}/authorizations/${a.id}`,
    created_at: iso(a.createdAt),
    last_used_at: a.lastUsedAt ? iso(a.lastUsedAt) : null,
  }
}

export const listAuthorizations = defineOp({
  id: 'authorizations.list',
  summary: 'Applications you have authorized',
  description:
    'The OAuth grants on your account: which application, what it may do, when it was last used.',
  tags: ['tokens'],
  method: 'GET',
  path: '/authorizations',
  auth: 'required',
  scopes: ['tokens:manage'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.listOf(S.Authorization),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) =>
        (await d.svc.auth.listAuthorizations(ctx.principal!.handle)).map((a) =>
          presentAuthz(d, a),
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const revokeAuthorization = defineOp({
  id: 'authorizations.revoke',
  summary: 'Revoke an application',
  description:
    'Every access and refresh token the application holds stops working at once.',
  tags: ['tokens'],
  method: 'DELETE',
  path: '/authorizations/{id}',
  params: z.object({ id: z.string().describe('The authorization `atz_` id') }),
  auth: 'required',
  scopes: ['tokens:manage'],
  pool: 'write',
  safety: 'destructive',
  idempotent: false,
  dryRun: true,
  response: z.null(),
  status: 204,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run(async (d) => {
        const a = await d.svc.auth.getAuthorization(ctx.params.id)
        if (!a || a.handle !== ctx.principal!.handle || a.revokedAt !== null)
          throw apiError('not_found', `No authorization ${ctx.params.id}.`)
        if (!ctx.dryRun) await d.svc.auth.revokeAuthorization(a.id)
      })
      return reply(null, { status: 204 })
    }),
})

export const tokenOps = [
  listTokens,
  createToken,
  getToken,
  revokeToken,
  listAuthorizations,
  revokeAuthorization,
]
