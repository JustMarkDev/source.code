import { z } from 'zod'
import { errorCatalog } from './problem'
import { API_VERSION, PAGE, WAIT_MAX } from './pipeline'
import { Problem } from './schemas'
import { pools } from './limiter'
import type { Op } from './registry'

/**
 * OpenAPI 3.1 generated from the operations. Nothing here is written by hand
 * per endpoint: the schemas the server validates with are the ones it
 * publishes, so the document cannot say something the server does not do.
 */
type Json = Record<string, unknown>

function jsonSchema(schema: z.ZodType, io: 'input' | 'output', defs: Json): Json {
  const out = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
    reused: 'inline',
  }) as Json
  const found = (out.$defs ?? {}) as Json
  Object.assign(defs, relax(found))
  delete out.$defs
  delete out.$schema
  return relax(out) as Json
}

/** Clients must ignore unknown members, so the document does not forbid them. */
function relax(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(relax)
  if (value && typeof value === 'object') {
    const o: Json = {}
    for (const [k, v] of Object.entries(value as Json)) {
      if (k === 'additionalProperties' && v === false) continue
      o[k] = relax(v)
    }
    return o
  }
  return value
}

const rewriteRefs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewriteRefs)
  if (value && typeof value === 'object') {
    const o: Json = {}
    for (const [k, v] of Object.entries(value as Json))
      o[k] = k === '$ref' && typeof v === 'string' ? v.replace('#/$defs/', '#/components/schemas/') : rewriteRefs(v)
    return o
  }
  return value
}

function parameters(op: Op, defs: Json): Array<Json> {
  const out: Array<Json> = []
  for (const m of op.path.matchAll(/\{(\w+)\}/g)) {
    const prop = op.params
      ? (jsonSchema(op.params, 'input', defs).properties as Json | undefined)?.[m[1]]
      : undefined
    out.push({ name: m[1], in: 'path', required: true, schema: prop ?? { type: 'string' } })
  }
  if (op.query) {
    const js = jsonSchema(op.query, 'input', defs)
    const required = new Set((js.required as Array<string> | undefined) ?? [])
    for (const [name, schema] of Object.entries((js.properties ?? {}) as Json))
      out.push({ name, in: 'query', required: required.has(name), schema })
  }
  if (op.shapeable)
    out.push({
      name: 'fields',
      in: 'query',
      required: false,
      description: 'Comma list of fields to return, dotted for nested. `object` and `id` always stay.',
      schema: { type: 'string' },
    })
  if (op.waitOn)
    out.push({
      name: 'wait',
      in: 'query',
      required: false,
      description: `With If-None-Match: hold the request up to this many seconds until the ETag would change. 0 to ${WAIT_MAX}.`,
      schema: { type: 'integer', minimum: 0, maximum: WAIT_MAX },
    })
  if (op.dryRun)
    out.push({
      name: 'dry_run',
      in: 'query',
      required: false,
      description: 'Run every check and change nothing. The answer is what would have been returned, with Sx-Dry-Run: true.',
      schema: { type: 'boolean' },
    })
  return out
}

export function buildOpenApi(ops: ReadonlyArray<Op>, base = 'https://api.source.code/v1'): Json {
  const defs: Json = {}
  const paths: Json = {}
  const problemRef = { $ref: '#/components/schemas/Problem' }
  for (const op of [...ops].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))) {
    const entry: Json = {
      operationId: op.id,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      tags: op.tags,
      parameters: parameters(op, defs),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(op.body, 'input', defs) } },
            },
          }
        : {}),
      responses: {
        [String(op.status ?? 200)]: {
          description: 'Success',
          headers: {
            'Sx-Request-Id': { schema: { type: 'string' } },
            ...(op.method === 'GET' ? { ETag: { schema: { type: 'string' } } } : {}),
          },
          content: {
            [op.id === 'events.stream' ? 'text/event-stream' : 'application/json']: {
              schema: jsonSchema(op.response, 'output', defs),
            },
            ...(op.markdown ? { 'text/markdown': { schema: { type: 'string' } } } : {}),
          },
        },
        ...(op.probe || op.waitOn ? { '304': { description: 'Not modified. Costs no rate-limit units.' } } : {}),
        default: {
          description: 'An error',
          content: { 'application/problem+json': { schema: problemRef } },
        },
      },
      security: op.auth === 'required' ? [{ bearer: op.scopes ?? [] }] : op.auth === 'optional' ? [{}, { bearer: op.scopes ?? [] }] : [],
      'x-sx-safety': op.safety,
      'x-sx-idempotent': op.idempotent,
      'x-sx-dry-run': !!op.dryRun,
      'x-sx-pool': op.pool,
      'x-sx-cost': op.pool === 'none' ? 0 : (op.cost ?? 1),
      'x-sx-scopes': op.scopes ?? [],
      'x-sx-errors': [...new Set([...(op.errors ?? []), 'rate_limited', 'internal', ...(op.auth === 'required' ? ['unauthenticated', 'insufficient_scope'] : []), ...(op.query || op.body ? ['invalid_request'] : [])])].sort(),
      'x-sx-async': !!op.mayBeAsync,
    }
    const item = (paths[op.path] ??= {}) as Json
    item[op.method.toLowerCase()] = entry
  }
  const schemas: Json = { ...(defs), Problem: jsonSchema(Problem, 'output', defs) }
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'source.code API',
      version: API_VERSION,
      summary: 'The source.code API',
      description:
        'Everything the web app does, over HTTP. Within v1 we only add fields and endpoints. Clients must ignore members they do not know. Errors are application/problem+json with a stable `code`.',
      license: { name: 'Business Source License 1.1', url: 'https://source.code/legal/terms' },
    },
    servers: [{ url: base }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'A token starting sxp_ (person), sxb_ (bot), sxr_ (run) or sxo_ (OAuth). Tokens always expire.',
        },
      },
    },
    'x-sx-errors': Object.fromEntries(
      Object.entries(errorCatalog).map(([code, e]) => [code, { status: e.status, retryable: e.retryable, exit_code: e.exit }]),
    ),
    'x-sx-pools': Object.fromEntries(
      Object.entries(pools).map(([n, p]) => [n, { limit: p.limit, window_seconds: p.windowMs / 1000 }]),
    ),
    'x-sx-page': PAGE,
  }
  return rewriteRefs(doc) as Json
}
