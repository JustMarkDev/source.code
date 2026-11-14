import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, Raw, defineOp } from '../registry'
import * as S from '../schemas'
import { ApiError, apiError, errorCatalog } from '../problem'
import { pools } from '../limiter'
import {
  API_VERSION,
  BATCH_LIMIT,
  BODY_LIMIT,
  PAGE,
  SUPPORTED_VERSIONS,
  WAIT_MAX,
} from '../pipeline'
import type { Op } from '../registry'

const open = {
  auth: 'none' as const,
  pool: 'none' as const,
  safety: 'read' as const,
  idempotent: true,
}

export const rootOp = defineOp({
  ...open,
  id: 'api.root',
  summary: 'Where to start',
  description:
    'Links to every top-level collection, the OpenAPI document and the limits.',
  tags: ['meta'],
  method: 'GET',
  path: '/',
  response: S.Root,
  handler: (ctx) =>
    Effect.succeed({
      object: 'api' as const,
      name: 'source.code',
      version: API_VERSION,
      versions: SUPPORTED_VERSIONS,
      links: {
        self: ctx.base,
        openapi: `${ctx.base}/openapi.json`,
        errors: `${ctx.base}/errors`,
        limits: `${ctx.base}/limits`,
        principal: `${ctx.base}/auth/principal`,
        accounts: `${ctx.base}/accounts`,
        repos: `${ctx.base}/repos`,
        events: `${ctx.base}/events`,
        sync: `${ctx.base}/sync{?repo,cursor}`,
        batch: `${ctx.base}/batch`,
        docs: `${ctx.htmlBase}/docs/api`,
        mcp: `${ctx.htmlBase}/mcp`,
        llms: `${ctx.htmlBase}/llms.txt`,
      },
    }),
})

export const errorsOp = defineOp({
  ...open,
  id: 'api.errors',
  summary: 'Every error code',
  description: 'The whole table, so a client or an agent can read it once.',
  tags: ['meta'],
  method: 'GET',
  path: '/errors',
  response: S.ErrorCatalog,
  handler: () =>
    Effect.succeed({
      object: 'list' as const,
      data: Object.entries(errorCatalog).map(([code, e]) => ({
        code,
        status: e.status,
        title: e.title,
        retryable: e.retryable,
        exit_code: e.exit,
        hint: e.hint,
      })),
      has_more: false as const,
      next_cursor: null,
    }),
})

export const limitsOp = defineOp({
  ...open,
  id: 'api.limits',
  summary: 'Rate, page and body limits',
  description:
    'Rate-limit pools, page sizes and request-body limits for this API. Object caps are in the guide for each resource.',
  tags: ['meta'],
  method: 'GET',
  path: '/limits',
  response: S.Limits,
  handler: () =>
    Effect.succeed({
      object: 'limits' as const,
      pools: Object.entries(pools).map(([name, p]) => ({
        name,
        limit: p.limit,
        window_seconds: p.windowMs / 1000,
      })),
      page: PAGE,
      concurrency: { per_token_per_node: 20 },
      body_bytes: BODY_LIMIT,
      batch_size: BATCH_LIMIT,
      wait_seconds: WAIT_MAX,
      idempotency_key_hours: 24,
    }),
})

export const principalOp = defineOp({
  ...open,
  id: 'auth.principal',
  summary: 'Who this token is',
  description:
    'The account, actor class, scopes, repositories and expiry of the token. Never rate limited.',
  tags: ['auth'],
  method: 'GET',
  path: '/auth/principal',
  auth: 'required',
  response: S.Principal,
  handler: (ctx) => {
    const p = ctx.principal!
    return Effect.succeed({
      object: 'principal' as const,
      token: p.tokenId,
      login: p.handle,
      acting_as: p.actingAs,
      class: p.class,
      scopes: [...p.scopes].sort(),
      repos: p.repos ? [...p.repos] : null,
      expires_at: new Date(p.expiresAt).toISOString(),
      pools: Object.entries(pools).map(([name, q]) => ({
        name,
        limit: q.limit,
        window_seconds: q.windowMs / 1000,
      })),
    })
  },
})

export function openapiOp(spec: () => unknown): Op {
  let built: { body: string; etag: string } | null = null
  return defineOp({
    ...open,
    id: 'api.openapi',
    summary: 'This API as OpenAPI 3.1',
    description:
      'Generated from the same definitions the server runs. Every operation carries x-sx-* metadata: safety, idempotency, scopes, rate-limit pool and cost, and error codes.',
    tags: ['meta'],
    method: 'GET',
    path: '/openapi.json',
    response: z.record(z.string(), z.unknown()),
    // The document is large and changes only when the code does. Keep the
    // bytes, and answer a conditional request without touching them.
    handler: (ctx) =>
      Effect.sync(() => {
        if (built === null) {
          const body = JSON.stringify(spec())
          built = {
            body,
            etag: `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`,
          }
        }
        const headers = {
          etag: built.etag,
          'cache-control': 'public, max-age=300, must-revalidate',
        }
        const sent = ctx.header('if-none-match')
        if (
          sent !== null &&
          sent.split(',').some((t) => t.trim() === built!.etag)
        )
          return new Raw(new Response(null, { status: 304, headers }))
        return new Raw(
          new Response(built.body, {
            headers: {
              ...headers,
              'content-type': 'application/json; charset=utf-8',
            },
          }),
        )
      }),
  })
}

export const batchOp = defineOp({
  id: 'api.batch',
  secretResponse: true,
  summary: 'Several requests in one',
  description: `Up to ${BATCH_LIMIT} requests. They run in parallel, each is authorised, rate limited and metered as if it had been sent alone, and each answer carries its own status. Batches do not nest. Use it to read a change, its policy and its checks in one round trip.`,
  tags: ['meta'],
  method: 'POST',
  path: '/batch',
  auth: 'required',
  pool: 'read',
  safety: 'write',
  idempotent: false,
  body: z.strictObject({
    requests: z
      .array(
        z.strictObject({
          id: z.string().max(64),
          method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
          path: z.string().startsWith('/'),
          body: z.unknown().optional(),
        }),
      )
      .min(1)
      .max(BATCH_LIMIT),
  }),
  response: S.BatchResult,
  handler: (ctx) =>
    Effect.tryPromise({
      try: async () => {
        const results: Array<{
          id: string
          status: number
          headers: Record<string, string>
          body: unknown
        }> = []
        // A batch holds one concurrency slot; run a few at a time so a full
        // batch of 25 does not collide with the per-token cap.
        for (let i = 0; i < ctx.body.requests.length; i += 5) {
          const part = await Promise.all(
            ctx.body.requests.slice(i, i + 5).map(async (r) => {
              const res = await ctx.dispatch(r.method, r.path, r.body)
              const text = await res.text()
              let body: unknown = null
              if (text) {
                try {
                  body = JSON.parse(text)
                } catch {
                  body = text
                }
              }
              const headers: Record<string, string> = {}
              for (const k of [
                'etag',
                'location',
                'sx-outcome',
                'ratelimit',
                'retry-after',
              ])
                if (res.headers.has(k)) headers[k] = res.headers.get(k)!
              return { id: r.id, status: res.status, headers, body }
            }),
          )
          results.push(...part)
        }
        return { object: 'batch' as const, results }
      },
      catch: (e) =>
        e instanceof ApiError ? e : apiError('internal', 'The batch failed.'),
    }),
})

export const statusOp = defineOp({
  id: 'status.get',
  summary: 'How the service is doing',
  description:
    'Each area as this server measured its own answers: state, uptime over 90 days by day, and median and 95th-percentile time in the last hour. Mirror sync and pipelines come from their own state. Incidents are the days an area failed more than 5% of at least 20 requests, and mirrors failing now. Public, and not rate limited.',
  tags: ['meta'],
  method: 'GET',
  path: '/status',
  auth: 'none',
  pool: 'none',
  safety: 'read',
  idempotent: true,
  response: S.Status,
  handler: () =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.status())
    }),
})

export const metaOps = [
  rootOp,
  errorsOp,
  limitsOp,
  principalOp,
  batchOp,
  statusOp,
]
