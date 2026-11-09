import { createHash } from 'node:crypto'
import { Duration, Effect, Layer, ManagedRuntime } from 'effect'
import {
  Concurrency,
  Limiter,
  MemoryLimitStore,
  pools as defaultPools,
} from './limiter'
import { MemoryIdempotencyStore, requestFingerprint } from './idempotency'
import { hashToken, internCapability, principalOf, tokenShape } from './auth'
import { Moved } from './domain'
import { ApiError, apiError, errorCatalog, toProblem } from './problem'
import { newId } from './ids'
import { Domain, Pre, Raw, Reply, Router, cyrb53 } from './registry'
import type { OAuthServer } from './oauth'
import type { Audience, Principal, TokenStore } from './auth'
import type { z } from 'zod'
import type { LimitStore, Policy } from './limiter'
import type { DomainCore } from './domain'
import type { MemoryDomain } from './domain'
import type { EventLog } from './events'
import type { Ctx, Op } from './registry'
import type { IdempotencyStore } from './idempotency'

/**
 * The request pipeline. Everything that is the same for every operation lives
 * here, so no handler has to remember it: request id, version, authentication,
 * rate limits, validation, idempotency, conditional requests, field selection,
 * waiting, the headers and the error shape.
 */
export const API_VERSION = '2026-11-07'
export const SUPPORTED_VERSIONS = [API_VERSION]
export const PAGE = { default: 50, max: 200 }
export const BODY_LIMIT = 1_048_576
export const BATCH_LIMIT = 25
export const WAIT_MAX = 30
const SERVER_BUDGET_MS = 5_000
// Parsed once. Parsing '5000 millis' on every request showed up in the profile.
const BUDGET = Duration.millis(SERVER_BUDGET_MS)

export type ApiOptions = {
  ops: ReadonlyArray<Op>
  domain: MemoryDomain
  events: EventLog
  tokens: TokenStore
  /** The OAuth server, when this API runs one. Its routes live under `{mount}/oauth`. */
  oauth?: OAuthServer
  /** Where `WWW-Authenticate` points clients to find the authorization server (RFC 9728). */
  resourceMetadataUrl?: string
  /** Where the API is mounted: `/v1` on its own host, `/api/v1` inside the app. */
  mount?: string
  base?: string
  htmlBase?: string
  limitStore?: LimitStore
  idempotency?: IdempotencyStore
  now?: () => number
  concurrencyPerToken?: number
  /**
   * How many proxies in front of this node append to X-Forwarded-For. The
   * client address is the entry that many from the end, because a client can
   * put anything at the start. Default 1.
   */
  trustedProxyHops?: number
  /** Entries in the body cache. 0 turns it off. */
  bodyCache?: number
  /** Replace the rate-limit pools. Tests use it to hit a limit quickly. */
  pools?: Record<string, Policy>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, content-type, idempotency-key, if-match, if-none-match, sx-version, sx-account, sx-agent',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers':
    'etag, location, link, retry-after, ratelimit, ratelimit-policy, allow, sx-request-id, sx-version, sx-outcome, sx-replayed, sx-limit-applied, sx-dry-run, sx-renamed-from, www-authenticate, server-timing',
  'access-control-max-age': '86400',
}

const hash = (text: string) =>
  createHash('sha1').update(text).digest('base64url').slice(0, 16)

/** Read a request body while enforcing a byte limit, so a chunked body is stopped as it arrives. */
async function readLimited(
  req: Request,
  max: number,
): Promise<Uint8Array | null> {
  const body = req.body
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/** A small least-recently-used cache of serialized bodies, bounded by count and size. */
class BodyCache {
  private readonly map = new Map<string, string>()
  private held = 0
  constructor(
    private readonly max: number,
    private readonly maxChars = 24_000_000,
  ) {}
  get(key: string) {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }
  set(key: string, value: string) {
    if (this.max <= 0) return
    const old = this.map.get(key)
    if (old !== undefined) this.held -= old.length
    this.map.delete(key)
    this.map.set(key, value)
    this.held += value.length
    while (
      (this.map.size > this.max || this.held > this.maxChars) &&
      this.map.size > 1
    ) {
      const oldest = this.map.keys().next().value as string
      const gone = this.map.get(oldest)!
      this.held -= gone.length
      this.map.delete(oldest)
    }
  }
  get size() {
    return this.map.size
  }
}

function pointerIssues(where: 'params' | 'query' | 'body', error: z.ZodError) {
  return error.issues.map((i) => ({
    pointer: `/${where}${i.path.map((p) => `/${String(p)}`).join('')}`,
    code: i.code,
    message:
      i.code === 'unrecognized_keys' && where === 'query'
        ? `Unknown query parameter ${i.keys.join(', ')}.`
        : i.message,
  }))
}

function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema
  for (let i = 0; i < 5; i++) {
    const next = (s as { unwrap?: () => z.ZodType }).unwrap
    if (typeof next !== 'function') break
    s = next.call(s)
  }
  return s
}

/** Whether a dotted path names a real member, all the way down. */
function hasSchemaPath(schema: z.ZodType | undefined, path: string): boolean {
  if (!schema) return false
  const [head, ...rest] = path.split('.')
  const s = unwrap(schema)
  const options = (s as { options?: ReadonlyArray<z.ZodType> }).options
  if (options) return options.some((option) => hasSchemaPath(option, path))
  const shape = (s as { shape?: Record<string, z.ZodType> }).shape
  if (!shape || !(head in shape)) return false
  return rest.length === 0 || hasSchemaPath(shape[head], rest.join('.'))
}

/** Keeps only the listed dotted paths of an object. */
function project(value: unknown, paths: ReadonlyArray<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => project(v, paths))
  if (value === null || typeof value !== 'object') return value
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const byHead = new Map<string, Array<string>>()
  for (const p of paths) {
    const [head, ...rest] = p.split('.')
    const list = byHead.get(head) ?? []
    if (rest.length) list.push(rest.join('.'))
    byHead.set(head, list)
  }
  // Identity always stays, so a projected object can still be recognised.
  for (const k of ['object', 'id']) if (k in src) out[k] = src[k]
  for (const [head, rest] of byHead)
    if (head in src)
      out[head] = rest.length ? project(src[head], rest) : src[head]
  return out
}

export function createApi(options: ApiOptions) {
  const mount = options.mount ?? '/v1'
  const base = options.base ?? 'https://api.source.code/v1'
  const htmlBase = options.htmlBase ?? 'https://source.code'
  const now = options.now ?? Date.now
  const pools: Record<string, Policy | undefined> =
    options.pools ?? defaultPools
  const router = new Router(options.ops)
  const limitStore = options.limitStore ?? new MemoryLimitStore()
  const limiter = new Limiter(limitStore, { now })
  const concurrency = new Concurrency(options.concurrencyPerToken ?? 20)
  const idem = options.idempotency ?? new MemoryIdempotencyStore(undefined, now)
  const cache = new BodyCache(options.bodyCache ?? 5_000)
  // Leases, windows and idempotency records all expire. Nothing else calls
  // these sweeps in the running app, so without this the maps only grow.
  const sweeper = setInterval(() => {
    limiter.sweep()
    if (limitStore instanceof MemoryLimitStore) limitStore.sweep(now())
    if (idem instanceof MemoryIdempotencyStore) idem.sweep()
    options.tokens.sweep?.(now())
    options.oauth?.sweepNow()
    domain.svc.uploads.sweepNow()
    domain.sweepRunsOperations()
  }, 5 * 60_000)
  sweeper.unref()
  const domain = options.domain
  const policyHeaders: Record<string, string> = {}
  const variants = new Map<string, string>()
  const hops = options.trustedProxyHops ?? 1
  /** The caller's address as our own proxy saw it, never as the caller claims it. */
  const clientAddress = (req: Request) => {
    const chain = (req.headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    // A chain shorter than the trusted proxies cannot name a client: the
    // entries present may all be client-supplied. Refuse to trust any of them.
    if (chain.length === 0 || chain.length < hops) return 'unknown'
    return chain[chain.length - hops] ?? 'unknown'
  }

  const runtime = ManagedRuntime.make(
    Layer.succeed(Domain)(
      Domain.of({
        run: <TValue>(f: (core: DomainCore) => PromiseLike<TValue> | TValue) =>
          Effect.tryPromise({
            // A throw before the first await is a failure too, not an escape.
            try: () => new Promise<TValue>((resolve) => resolve(f(domain))),
            catch: (e) => {
              if (e instanceof ApiError) return e
              if (e instanceof Moved)
                return apiError('moved', `${e.from} is now ${e.to}.`, {
                  extra: { from: e.from, to: e.to },
                })
              if (e instanceof Error && e.name === 'ApiError')
                return e as ApiError
              // An unexpected failure is a bug. Its message may name internals,
              // so it goes to the log, never into the client's problem body.
              console.error('[api] domain failure', e)
              return apiError('internal', 'Unexpected failure.')
            },
          }),
      }),
    ),
  )

  const problemResponse = (
    error: ApiError,
    requestId: string,
    extra: Record<string, string> = {},
  ) => {
    const problem = toProblem(error, requestId)
    const headers: Record<string, string> = {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store',
      ...error.headers,
      ...extra,
    }
    if (error.retryAfter !== undefined)
      headers['retry-after'] = String(error.retryAfter)
    return new Response(JSON.stringify(problem), {
      status: problem.status,
      headers,
    })
  }

  const authChallenge = (extra = '') =>
    `Bearer realm="source.code"${options.resourceMetadataUrl ? `, resource_metadata="${options.resourceMetadataUrl}"` : ''}${extra}`

  /** Checks a bearer token for an audience. Used by the API itself and by the MCP endpoint. */
  async function verifyToken(token: string, audience: Audience) {
    if (!tokenShape.test(token))
      return { ok: false as const, reason: 'unknown' as const }
    const t = now()
    const store = options.tokens
    const looked = store.findToken
      ? store.findToken(token, audience, t)
      : store.find(hashToken(token), audience, t)
    const found = looked instanceof Promise ? await looked : looked
    if (found.ok) options.tokens.touch?.(found.record, now())
    return found
  }

  async function authenticate(
    req: Request,
    requestId: string,
  ): Promise<{ principal: Principal | null; error?: Response }> {
    const header = req.headers.get('authorization')
    if (!header) return { principal: null }
    const [scheme = '', token = ''] = header.split(' ')
    const refuse = (
      code: 'token_invalid' | 'token_expired' | 'token_revoked',
      detail: string,
    ) => ({
      principal: null,
      error: problemResponse(apiError(code, detail), requestId, {
        'www-authenticate': authChallenge(', error="invalid_token"'),
      }),
    })
    if (scheme.toLowerCase() !== 'bearer' || !token)
      return refuse(
        'token_invalid',
        'The Authorization header is not a bearer token.',
      )
    const found = await verifyToken(token, 'api')
    if (!found.ok)
      return found.reason === 'expired'
        ? refuse('token_expired', 'This token expired.')
        : found.reason === 'revoked'
          ? refuse('token_revoked', 'This token was revoked.')
          : found.reason === 'audience'
            ? refuse('token_invalid', 'This token is not valid for the API.')
            : refuse('token_invalid', 'No such token.')
    let principal = principalOf(found.record)
    const as = req.headers.get('sx-account')
    if (as && as !== principal.actingAs) {
      if (!(await domain.canActAs(principal.handle, as)))
        return {
          principal,
          error: problemResponse(
            apiError('forbidden', `You cannot act as ${as}.`),
            requestId,
          ),
        }
      const key = `${principal.capabilityKey}@${as}`
      principal = {
        ...principal,
        actingAs: as,
        capabilityKey: key,
        capId: internCapability(key),
      }
    }
    return { principal }
  }

  async function handle(req: Request, depth = 0): Promise<Response> {
    const started = performance.now()
    const requestId = newId('request', now())
    const url = new URL(req.url)
    // CORS headers are for browsers. Scripts and agents send no Origin and do not need them.
    const common: Record<string, string> = req.headers.has('origin')
      ? { 'sx-request-id': requestId, 'sx-version': API_VERSION, ...CORS }
      : { 'sx-request-id': requestId, 'sx-version': API_VERSION }
    const finish = (
      res: Response,
      timing: Record<string, string | number> = {},
    ) => {
      const t = [`total;dur=${(performance.now() - started).toFixed(2)}`]
      for (const [k, v] of Object.entries(timing))
        t.push(
          typeof v === 'number'
            ? `${k};dur=${v.toFixed(2)}`
            : `${k};desc="${v}"`,
        )
      res.headers.set('server-timing', t.join(', '))
      return res
    }
    const fail = (e: ApiError, extra?: Record<string, string>) => {
      const res = problemResponse(e, requestId, { ...common, ...extra })
      return finish(res)
    }

    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'sx-request-id': requestId },
      })

    // The path under the mount. `/v1/repos/rep_x/changes` is the id form of a
    // repository address, read as owner `rep_x` and name `~`.
    // The mount is a path segment, not a prefix: /v1batch is outside /v1.
    const prefix =
      mount === '/' ? '/' : mount.endsWith('/') ? mount : `${mount}/`
    if (url.pathname !== mount && !url.pathname.startsWith(prefix))
      return fail(apiError('not_found', `This API lives under ${mount}.`))
    let path = url.pathname.slice(mount.length) || '/'
    path = path.replace(
      /^\/repos\/(rep_[0-9a-z]{18})(?!\/~)(?=\/|$)/,
      '/repos/$1/~',
    )

    const version = req.headers.get('sx-version')
    if (version && !SUPPORTED_VERSIONS.includes(version))
      return fail(
        apiError(
          'unsupported_version',
          `Version ${version} is not supported.`,
          { extra: { supported: SUPPORTED_VERSIONS } },
        ),
      )

    const match = router.match(req.method === 'HEAD' ? 'GET' : req.method, path)
    if (match.kind === 'miss')
      return fail(
        apiError('not_found', `No endpoint at ${req.method} ${path}.`, {
          hint: `GET ${mount} lists the collections. GET ${mount}/openapi.json describes every operation.`,
        }),
      )
    if (match.kind === 'method')
      return fail(
        apiError(
          'method_not_allowed',
          `${req.method} is not allowed on ${path}.`,
        ),
        { allow: match.allow.join(', ') },
      )
    const { op, params } = match
    if (
      depth > 0 &&
      (op.streaming ||
        op.rawBody ||
        (op.responseContentType && !op.responseContentType.includes('json')))
    )
      return fail(
        apiError(
          'invalid_request',
          'This operation cannot run inside a batch.',
        ),
      )

    const auth = await authenticate(req, requestId)
    if (auth.error) {
      for (const [k, v] of Object.entries(common))
        if (!auth.error.headers.has(k)) auth.error.headers.set(k, v)
      return finish(auth.error)
    }
    const principal = auth.principal
    if (op.auth === 'required' && !principal)
      return fail(apiError('unauthenticated', 'This needs a token.'), {
        'www-authenticate': authChallenge(),
      })
    // Anonymous callers may read public things; what they can see is decided by the data.
    if (principal || op.auth === 'required')
      for (const scope of op.scopes ?? [])
        if (!principal?.scopes.has(scope))
          return fail(
            apiError('insufficient_scope', `This needs the ${scope} scope.`, {
              extra: {
                required_scopes: op.scopes,
                token_scopes: principal ? [...principal.scopes] : [],
              },
            }),
            {
              'www-authenticate': authChallenge(
                `, error="insufficient_scope", scope="${(op.scopes ?? []).join(' ')}"`,
              ),
            },
          )

    // Rate limit. The key is the token, or the client address when anonymous.
    const poolName = principal
      ? op.pool === 'none'
        ? 'none'
        : op.pool
      : op.pool === 'none'
        ? 'none'
        : 'anonymous'
    const budgetKey = principal
      ? principal.budgetKey
      : `ip:${clientAddress(req)}`
    const cost = op.cost ?? 1
    let rate: { header: string; policy: string } | null = null
    let refund: (() => void) | null = null
    if (poolName !== 'none') {
      const policy = pools[poolName] ?? defaultPools[poolName]
      const lk = `${poolName}:${budgetKey}`
      // Almost always the node already holds units for this token: no promise, no store.
      const d =
        limiter.tryLocal(lk, policy, cost) ??
        (await limiter.check(lk, policy, cost))
      rate = {
        policy: (policyHeaders[poolName] ??=
          `"${poolName}";q=${policy.limit};w=${policy.windowMs / 1000}`),
        header: `"${poolName}";r=${d.remaining};t=${d.resetSeconds}`,
      }
      if (!d.allowed)
        return fail(
          apiError('rate_limited', `The ${poolName} pool is used up.`, {
            retryAfter: d.resetSeconds,
            extra: {
              pool: poolName,
              limit: policy.limit,
              window_seconds: policy.windowMs / 1000,
              retry_after_seconds: d.resetSeconds,
            },
          }),
          { ratelimit: rate.header, 'ratelimit-policy': rate.policy },
        )
      refund = () => limiter.refund(`${poolName}:${budgetKey}`, policy, cost)
    }
    if (!concurrency.enter(budgetKey))
      return fail(
        apiError(
          'concurrency_limited',
          'Too many requests are running for this token.',
          { retryAfter: 1 },
        ),
        rate ? { ratelimit: rate.header, 'ratelimit-policy': rate.policy } : {},
      )

    let held = false
    try {
      let res = await run(
        req,
        url,
        path,
        op,
        params,
        principal,
        requestId,
        depth,
        refund,
        started,
      )
      for (const [k, v] of Object.entries(common))
        if (!res.headers.has(k)) res.headers.set(k, v)
      if (rate) {
        res.headers.set('ratelimit-policy', rate.policy)
        res.headers.set('ratelimit', rate.header)
      }
      if (!res.headers.has('server-timing'))
        res.headers.set(
          'server-timing',
          `total;dur=${(performance.now() - started).toFixed(2)}`,
        )
      // A streaming response keeps its concurrency slot until the body closes.
      if (op.streaming && res.body && req.method !== 'HEAD') {
        const reader = res.body.getReader()
        let released = false
        const release = () => {
          if (released) return
          released = true
          concurrency.leave(budgetKey)
        }
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await reader.read()
              if (next.done) {
                release()
                controller.close()
              } else controller.enqueue(next.value)
            } catch (e) {
              release()
              controller.error(e)
            }
          },
          cancel(reason) {
            release()
            return reader.cancel(reason)
          },
        })
        res = new Response(stream, { status: res.status, headers: res.headers })
        held = true
      }
      return res
    } catch (e) {
      const error =
        e instanceof ApiError ? e : apiError('internal', 'Unexpected failure.')
      if (!(e instanceof ApiError)) console.error(`[api] ${requestId}`, e)
      return fail(
        error,
        rate ? { ratelimit: rate.header, 'ratelimit-policy': rate.policy } : {},
      )
    } finally {
      if (!held) concurrency.leave(budgetKey)
    }
  }

  async function run(
    req: Request,
    url: URL,
    path: string,
    op: Op,
    params: Record<string, string>,
    principal: Principal | null,
    requestId: string,
    depth: number,
    refund: (() => void) | null,
    started: number,
  ): Promise<Response> {
    const fail = (e: ApiError, extra?: Record<string, string>) =>
      problemResponse(e, requestId, extra)
    const timing: Record<string, string | number> = {}

    // Query: the parameters every operation shares come off first.
    const raw: Record<string, string | undefined> = {}
    for (const [k, v] of url.searchParams) raw[k] = v
    const fields = raw.fields
    const wait = raw.wait
    const dryRunRaw = raw.dry_run
    delete raw.fields
    delete raw.wait
    delete raw.dry_run
    const queryErrors: Array<{
      pointer: string
      code: string
      message: string
    }> = []
    if (fields !== undefined && !op.shapeable)
      queryErrors.push({
        pointer: '/query/fields',
        code: 'unsupported',
        message: 'This operation does not support fields.',
      })
    if (dryRunRaw !== undefined && !op.dryRun)
      queryErrors.push({
        pointer: '/query/dry_run',
        code: 'unsupported',
        message: 'This operation has no dry run.',
      })
    if (wait !== undefined && !op.waitOn)
      queryErrors.push({
        pointer: '/query/wait',
        code: 'unsupported',
        message: 'This operation cannot wait.',
      })
    if (
      wait !== undefined &&
      op.waitOn &&
      req.headers.get('if-none-match') === null
    )
      queryErrors.push({
        pointer: '/query/wait',
        code: 'needs_if_none_match',
        message:
          'wait holds the request until the ETag changes. Send If-None-Match with the ETag you have.',
      })
    const waitSeconds = wait === undefined ? 0 : Number(wait)
    if (
      wait !== undefined &&
      !(
        Number.isInteger(waitSeconds) &&
        waitSeconds >= 0 &&
        waitSeconds <= WAIT_MAX
      )
    )
      queryErrors.push({
        pointer: '/query/wait',
        code: 'out_of_range',
        message: `A whole number of seconds, 0 to ${WAIT_MAX}.`,
      })
    if (
      dryRunRaw !== undefined &&
      dryRunRaw !== 'true' &&
      dryRunRaw !== 'false'
    )
      queryErrors.push({
        pointer: '/query/dry_run',
        code: 'invalid_value',
        message: 'true or false.',
      })
    const dryRun = dryRunRaw === 'true'

    const extraHeaders: Record<string, string> = {}
    if (raw.limit !== undefined && Number(raw.limit) > PAGE.max) {
      raw.limit = String(PAGE.max)
      extraHeaders['sx-limit-applied'] = String(PAGE.max)
    }
    let query: unknown = {}
    if (op.query) {
      const parsed = op.query.safeParse(raw)
      if (!parsed.success)
        queryErrors.push(...pointerIssues('query', parsed.error))
      else query = parsed.data
    } else if (Object.keys(raw).length)
      for (const k of Object.keys(raw))
        queryErrors.push({
          pointer: `/query/${k}`,
          code: 'unrecognized_keys',
          message: `Unknown query parameter ${k}.`,
        })

    let parsedParams: unknown = params
    if (op.params) {
      const p = op.params.safeParse(params)
      if (!p.success) queryErrors.push(...pointerIssues('params', p.error))
      else parsedParams = p.data
    }

    // Body.
    let body: unknown = undefined
    let bodyText = ''
    if (op.body) {
      const type = req.headers.get('content-type') ?? ''
      if (!type.includes('application/json'))
        return fail(
          apiError(
            'unsupported_media_type',
            'Send Content-Type: application/json.',
          ),
        )
      const declared = Number(req.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > BODY_LIMIT)
        return fail(apiError('payload_too_large', 'The body is over 1 MiB.'))
      const read = await readLimited(req, BODY_LIMIT)
      if (read === null)
        return fail(apiError('payload_too_large', 'The body is over 1 MiB.'))
      bodyText = new TextDecoder().decode(read)
      let json: unknown = {}
      if (bodyText.trim() !== '')
        try {
          json = JSON.parse(bodyText)
        } catch {
          return fail(
            apiError('invalid_request', 'The body is not valid JSON.', {
              errors: [
                {
                  pointer: '/body',
                  code: 'invalid_json',
                  message: 'Not valid JSON.',
                },
              ],
            }),
          )
        }
      const parsed = op.body.safeParse(json)
      if (!parsed.success)
        queryErrors.push(...pointerIssues('body', parsed.error))
      else body = parsed.data
    }
    let bytes: Uint8Array | null = null
    if (op.rawBody) {
      const declared = Number(req.headers.get('content-length') ?? '0')
      if (declared > op.rawBody.maxBytes)
        return fail(
          apiError(
            'payload_too_large',
            `The body is over ${op.rawBody.maxBytes} bytes.`,
            {
              hint: 'The file is larger than this upload accepts. Start an upload with the size you need.',
            },
          ),
        )
      const buf = await readLimited(req, op.rawBody.maxBytes)
      if (buf === null)
        return fail(
          apiError(
            'payload_too_large',
            `The body is over ${op.rawBody.maxBytes} bytes.`,
            {
              hint: 'The file is larger than this upload accepts. Start an upload with the size you need.',
            },
          ),
        )
      bytes = buf
    }

    if (queryErrors.length)
      return fail(
        apiError(
          'invalid_request',
          `${queryErrors.length} problem${queryErrors.length === 1 ? '' : 's'} with the request.`,
          { errors: queryErrors },
        ),
      )

    // Unknown `fields` names are an error, not a silently empty answer.
    const fieldPaths = fields
      ? fields
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null
    if (fieldPaths) {
      const root =
        (op.response as { shape?: { data?: { element?: z.ZodType } } }).shape
          ?.data?.element ?? op.response
      const bad = fieldPaths.filter((f) => !hasSchemaPath(root, f))
      if (bad.length)
        return fail(
          apiError('invalid_request', `Unknown field ${bad.join(', ')}.`, {
            errors: bad.map((f) => ({
              pointer: '/query/fields',
              code: 'unknown_field',
              message: `${f} is not a field.`,
            })),
          }),
        )
    }

    const ifMatch = req.headers.get('if-match')
    const ifNoneMatch = req.headers.get('if-none-match')
    const ctx: Ctx<unknown, unknown, unknown> = {
      params: parsedParams,
      query,
      body,
      method: req.method,
      principal,
      requestId,
      dryRun,
      ifMatch,
      url,
      bytes,
      signal: req.signal,
      header: (name) => req.headers.get(name),
      base,
      htmlBase,
      now,
      dispatch: (method, p, b) => {
        if (depth > 0)
          return Promise.reject(
            apiError('invalid_request', 'Batches cannot nest.'),
          )
        // A sub-request runs with the same identity, including the account the
        // caller acts as. Dropping Sx-Account would silently change its view.
        const inherited: Record<string, string> = {}
        for (const name of ['authorization', 'sx-account', 'sx-version']) {
          const value = req.headers.get(name)
          if (value) inherited[name] = value
        }
        return handle(
          new Request(new URL(`${mount}${p}`, url.origin), {
            method,
            headers: {
              ...inherited,
              ...(b !== undefined
                ? { 'content-type': 'application/json' }
                : {}),
            },
            body: b === undefined ? undefined : JSON.stringify(b),
          }),
          depth + 1,
        )
      },
    }

    const exec = async <TValue>(
      program: Effect.Effect<TValue, ApiError, Domain>,
    ) => {
      const t0 = performance.now()
      const settled = await runtime.runPromise(
        program.pipe(
          Effect.timeout(BUDGET),
          Effect.catchTag('TimeoutError', () =>
            Effect.fail(
              apiError('backend_unavailable', 'The request took too long.', {
                retryAfter: 1,
              }),
            ),
          ),
          Effect.match({
            onSuccess: (value) => ({ ok: true as const, value }),
            onFailure: (error) => ({ ok: false as const, error }),
          }),
        ),
      )
      timing.handler =
        ((timing.handler as number | undefined) ?? 0) + (performance.now() - t0)
      if (!settled.ok) throw settled.error
      return settled.value
    }

    const isRead = op.method === 'GET'
    // What the body depends on. `wait` and `dry_run` do not change it.
    const canonical = [
      ...Object.entries(raw),
      ...(fields ? [['fields', fields]] : []),
    ]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    const wantsMarkdown =
      isRead &&
      !!op.markdown &&
      (req.headers.get('accept') ?? '').includes('text/markdown')
    const wantsNdjson =
      isRead &&
      (req.headers.get('accept') ?? '').includes('application/x-ndjson')
    const variantKey = `${canonical}|${principal?.capId ?? 'anonymous'}|${domain.accessRevision}${wantsMarkdown ? '|md' : ''}${wantsNdjson ? '|ndjson' : ''}`
    let variant = variants.get(variantKey)
    if (variant === undefined) {
      variant = hash(variantKey)
      if (variants.size > 20_000) variants.clear()
      variants.set(variantKey, variant)
    }
    const cacheKey = (v: string) => `${op.id}|${url.pathname}|${variant}|${v}`

    // Idempotency for writes.
    const key = req.headers.get('idempotency-key')
    let scope = ''
    let wasReplay = false
    // `If-Match: *` accepts any version, so it is not a concrete precondition:
    // a retry must replay rather than run again and overwrite a newer edit.
    const wildcardIfMatch =
      ifMatch !== null &&
      ifMatch
        .split(',')
        .some((t) => t.trim().replace(/^W\//, '').replace(/"/g, '') === '*')
    const checkIfMatch =
      op.ifMatch === true && ifMatch !== null && !wildcardIfMatch
    if (!isRead && key && op.secretResponse)
      return fail(
        apiError(
          'invalid_request',
          'This operation cannot use Idempotency-Key because its response contains a secret.',
        ),
      )
    if (!isRead && key) {
      if (key.length > 64)
        return fail(
          apiError('invalid_request', 'Idempotency-Key is over 64 characters.'),
        )
      scope = principal
        ? `${principal.handle}@${principal.actingAs}:${principal.limitKey}`
        : `ip:${clientAddress(req)}`
      const fingerprintBody = bytes
        ? createHash('sha256').update(bytes).digest('base64url')
        : bodyText
      const replayKey = principal
        ? domain.replayKey(op.id, params, principal)
        : { id: '', stamp: '' }
      const stable = { ...params }
      if (replayKey.id) {
        delete stable.owner
        delete stable.repo
        stable.repo_id = replayKey.id
      }
      const identity = `${op.method} ${op.id} ${JSON.stringify(stable, Object.keys(stable).sort())}`
      const begun = await idem.begin(
        scope,
        key,
        requestFingerprint(
          op.method,
          identity,
          url.search,
          fingerprintBody,
          checkIfMatch ? ifMatch : '',
          op.rawBody ? (req.headers.get('content-type') ?? '') : '',
          replayKey.stamp,
        ),
      )
      wasReplay = begun.state === 'replay'
      if (begun.state === 'conflict')
        return fail(
          apiError(
            'idempotency_key_reused',
            'This key was used for a different request.',
          ),
        )
      if (begun.state === 'in_progress')
        return fail(
          apiError(
            'request_in_progress',
            'A request with this key is still running.',
            { retryAfter: 1 },
          ),
        )
      // A concrete If-Match must be checked against the current version, not
      // answered from the version it saw the first time.
      if (begun.state === 'replay' && !checkIfMatch) {
        const replayBody =
          begun.response.status === 204 ||
          begun.response.status === 304 ||
          begun.response.body === ''
            ? null
            : begun.response.body
        return new Response(replayBody, {
          status: begun.response.status,
          headers: { ...begun.response.headers, 'sx-replayed': 'true' },
        })
      }
    }

    let applied = false
    try {
      // Conditional reads and the body cache, before any body is built.
      let versionKey: string | null = null
      const etagOf = (v: string) => `W/"${v}-${variant}"`
      const wantsWait =
        waitSeconds > 0 &&
        op.waitOn &&
        ifNoneMatch !== null &&
        op.conditional !== false

      type Step =
        | { kind: 'not_modified'; etag: string }
        | { kind: 'hit'; json: string; etag: string; status: number }
        | { kind: 'built'; out: unknown; versionKey: string | null }
      const compute = async (): Promise<Step> => {
        if (isRead && op.probe && op.conditional !== false) {
          const t0 = performance.now()
          try {
            versionKey = await op.probe(ctx, domain)
          } catch (e) {
            // A renamed repository answers at its old address with a redirect, on reads too.
            if (e instanceof Moved)
              throw apiError('moved', `${e.from} is now ${e.to}.`, {
                extra: { from: e.from, to: e.to },
              })
            throw e
          }
          timing.handler =
            ((timing.handler as number | undefined) ?? 0) +
            (performance.now() - t0)
        }
        if (versionKey !== null && op.conditional !== false) {
          const etag = etagOf(versionKey)
          if (ifNoneMatch && matches(ifNoneMatch, etag))
            return { kind: 'not_modified', etag }
          const hit = cache.get(cacheKey(versionKey))
          if (hit !== undefined)
            return { kind: 'hit', json: hit, etag, status: op.status ?? 200 }
        }
        const out = await exec(op.handler(ctx as never))
        return { kind: 'built', out, versionKey }
      }

      let step = await compute()
      if (wantsWait && step.kind === 'not_modified') {
        // Real elapsed time, not the injectable clock: waiting is physical.
        const deadline = performance.now() + waitSeconds * 1000
        const topic = op.waitOn!(parsedParams, query, domain)
        while (step.kind === 'not_modified' && performance.now() < deadline) {
          await options.events.wait(
            topic,
            deadline - performance.now(),
            req.signal,
          )
          if (req.signal.aborted) break
          step = await compute()
        }
      }
      const notModified = (
        etag: string,
        source: Record<string, string> = {},
      ) => {
        const headers: Record<string, string> = { etag, ...extraHeaders }
        if (isRead) {
          headers.vary = 'accept, authorization'
          headers['cache-control'] =
            source['cache-control'] ??
            (principal
              ? 'private, no-cache'
              : 'public, max-age=0, must-revalidate')
        }
        return new Response(null, { status: 304, headers })
      }
      if (step.kind === 'not_modified') {
        refund?.()
        return notModified(step.etag)
      }

      let status = op.status ?? 200
      const headers: Record<string, string> = { ...extraHeaders }
      let json: string
      let etag = ''
      if (step.kind === 'hit') {
        json = step.json
        etag = step.etag
        timing.cache = 'hit'
        status = step.status
      } else {
        let out = step.out
        if (out instanceof Raw) {
          if (out.response.status === 304) refund?.()
          if (req.method === 'HEAD') {
            await out.response.body?.cancel().catch(() => {})
            return new Response(null, {
              status: out.response.status,
              headers: out.response.headers,
            })
          }
          return out.response
        }
        if (out instanceof Reply) {
          status = out.init.status ?? status
          Object.assign(headers, out.init.headers)
          out = out.body
        }
        const wantsNdjsonList =
          wantsNdjson && (out as { object?: string } | null)?.object === 'list'
        // Objects that arrive already serialized are sent as they are, unless the
        // caller wants a shape that needs the object. `seed` stands in for the
        // body when an ETag is made, so a long body is not hashed.
        let ready: string | null = null
        let seed: string | null = null
        let markdown: string | null = null
        if (out instanceof Pre) {
          if (!fieldPaths) {
            ready = out.json
            seed = out.key
          }
          out = out.obj
        } else {
          const list = out as {
            object?: string
            data?: Array<unknown>
            has_more?: boolean
            next_cursor?: string | null
          } | null
          if (
            list?.object === 'list' &&
            Array.isArray(list.data) &&
            list.data[0] instanceof Pre
          ) {
            if (!fieldPaths && !wantsNdjsonList) {
              const items = list.data as Array<Pre>
              ready = `{"object":"list","data":[${items.map((i) => i.json).join(',')}],"has_more":${list.has_more === true},"next_cursor":${JSON.stringify(list.next_cursor ?? null)}}`
              seed = `${items.map((i) => i.tag).join('')}|${list.has_more === true}|${list.next_cursor ?? ''}`
            } else
              out = {
                ...list,
                data: list.data.map((d) => (d instanceof Pre ? d.obj : d)),
              }
          }
        }
        if (fieldPaths) {
          // Build the readable form from the full object before projecting it:
          // a markdown builder reads members that `fields` may have removed.
          if (wantsMarkdown && status < 300)
            markdown = op.markdown!(out as Record<string, unknown>)
          const list = out as { object?: string; data?: Array<unknown> } | null
          out =
            list?.object === 'list' && Array.isArray(list.data)
              ? { ...list, data: list.data.map((d) => project(d, fieldPaths)) }
              : project(out, fieldPaths)
        }
        if (wantsNdjsonList) {
          const list = out as {
            data: Array<unknown>
            has_more: boolean
            next_cursor: string | null
          }
          const lines = list.data.map((d) => JSON.stringify(d))
          lines.push(
            JSON.stringify({
              object: 'page',
              has_more: list.has_more,
              next_cursor: list.next_cursor,
            }),
          )
          const text = `${lines.join('\n')}\n`
          const ndEtag =
            step.versionKey !== null
              ? etagOf(step.versionKey)
              : `W/"${hash(text)}"`
          const ndHeaders: Record<string, string> = {
            'content-type': 'application/x-ndjson; charset=utf-8',
            ...headers,
            etag: ndEtag,
            vary: 'accept, authorization',
            'cache-control': principal
              ? 'private, no-cache'
              : 'public, max-age=0, must-revalidate',
          }
          if (ifNoneMatch && matches(ifNoneMatch, ndEtag)) {
            refund?.()
            return notModified(ndEtag, ndHeaders)
          }
          return new Response(req.method === 'HEAD' ? null : text, {
            status,
            headers: ndHeaders,
          })
        }
        json = ready ?? JSON.stringify(out)
        // The readable form is made from the JSON, so the two cannot disagree.
        if (markdown !== null) json = markdown
        else if (wantsMarkdown && status < 300)
          json = op.markdown!(JSON.parse(json) as Record<string, unknown>)
        if (isRead && op.conditional !== false) {
          etag =
            step.versionKey !== null
              ? etagOf(step.versionKey)
              : `W/"${seed === null ? hash(json) : cyrb53(`${seed}|${variant}`).toString(36)}"`
          if (step.versionKey !== null)
            cache.set(cacheKey(step.versionKey), json)
          if (ifNoneMatch && matches(ifNoneMatch, etag)) {
            refund?.()
            return notModified(etag, headers)
          }
        }
      }
      headers['content-type'] =
        wantsMarkdown && status < 300
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8'
      if (op.secretResponse && !headers['cache-control'])
        headers['cache-control'] = 'no-store'
      if (isRead) headers.vary = 'accept, authorization'
      if (dryRun) {
        headers['sx-dry-run'] = 'true'
        delete headers.location
        if (status === 201 || status === 202) {
          if (status === 202) delete headers['retry-after']
          status = 200
        }
      }
      if (etag !== '') headers.etag = etag
      if (isRead && !headers['cache-control'])
        headers['cache-control'] = principal
          ? 'private, no-cache'
          : 'public, max-age=0, must-revalidate'
      if (status === 202 && !('location' in headers)) {
        const loc = (JSON.parse(json) as { url?: string }).url
        if (loc) headers.location = loc
      }
      const res = new Response(
        req.method === 'HEAD' || status === 204 ? null : json,
        { status, headers },
      )
      if (!isRead && key) {
        if (dryRun) await idem.abort(scope, key)
        else {
          applied = true
          try {
            await idem.complete(scope, key, {
              status,
              headers,
              body: status === 204 ? '' : json,
            })
          } catch (e) {
            // The write already happened. Do not turn success into a 500; the key
            // stays in progress, so a retry waits instead of writing again.
            console.error(`[api] ${requestId} idempotency completion failed`, e)
          }
        }
      }
      const t = [
        `handler;dur=${((timing.handler as number | undefined) ?? 0).toFixed(2)}`,
      ]
      if (timing.cache) t.push(`cache;desc="hit"`)
      t.push(`total;dur=${(performance.now() - started).toFixed(2)}`)
      res.headers.set('server-timing', t.join(', '))
      return res
    } catch (e) {
      if (!isRead && key && !applied && !(wasReplay && checkIfMatch))
        await idem.abort(scope, key)
      if (e instanceof ApiError && e.code === 'moved') {
        const to = (e.extra as { to: string }).to
        const from = (e.extra as { from: string }).from
        // Rebuild the address from its segments, so empty or percent-encoded
        // segments in the request cannot make the redirect point at itself.
        const parts = path.split('/').filter(Boolean)
        const at = op.path.split('/').filter(Boolean).indexOf('repos')
        if (at >= 0 && parts.length > at + 2)
          parts.splice(at + 1, 2, ...to.split('/'))
        const target =
          at >= 0
            ? `/${parts.join('/')}`
            : path.replace(
                new RegExp(
                  `/repos/${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                  'i',
                ),
                `/repos/${to}`,
              )
        const configured =
          options.base && !/placeholder/i.test(options.base)
            ? options.base
            : `${url.origin}${mount}`
        const search = new URLSearchParams(url.search)
        const confirm = search.get('confirm')
        if (confirm && confirm.toLowerCase() === from.toLowerCase())
          search.set('confirm', to)
        const queryString = search.size ? `?${search}` : ''
        const location = `${configured}${target}${queryString}`
        return problemResponse(e, requestId, {
          location,
          'sx-renamed-from': from,
        })
      }
      throw e
    }
  }

  const oauth = options.oauth
  const guardOf = async (
    req: Request,
    bucket: string,
    limit: number,
    windowMs: number,
  ) => {
    const d = await limiter.check(
      `${bucket}:${clientAddress(req)}`,
      { limit, windowMs },
      1,
    )
    return d.allowed
      ? null
      : new Response(
          JSON.stringify({
            error: 'rate_limited',
            error_description: `Try again in ${d.resetSeconds} seconds.`,
          }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'retry-after': String(d.resetSeconds),
              'cache-control': 'no-store',
            },
          },
        )
  }

  if (oauth) oauth.guardWith = guardOf

  async function fetchAll(req: Request): Promise<Response> {
    if (oauth) {
      const path = new URL(req.url).pathname
      if (path.startsWith(`${mount}/oauth/`)) {
        if (req.method === 'OPTIONS')
          return new Response(null, { status: 204, headers: CORS })
        const res = await oauth.handle(req, path.slice(`${mount}/oauth`.length))
        if (res) {
          res.headers.set('access-control-allow-origin', '*')
          return res
        }
      }
    }
    return handle(req)
  }

  return {
    fetch: fetchAll,
    oauth,
    verifyToken,
    guard: guardOf,
    ops: options.ops,
    router,
    cache,
    limiter,
    idempotency: idem,
    domain,
    events: options.events,
    dispose: () => {
      clearInterval(sweeper)
      return runtime.dispose()
    },
    errorCatalog,
  }
}

function matches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true
  const weak = (t: string) => t.trim().replace(/^W\//, '')
  const want = weak(etag)
  return ifNoneMatch.split(',').some((t) => weak(t) === want)
}

export type Api = ReturnType<typeof createApi>
