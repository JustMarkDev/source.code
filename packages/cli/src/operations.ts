/**
 * Every API operation, for an agent. The MCP server's hand-picked tools cover
 * the daily work; these two reach the rest: `search` finds an operation in the
 * API's own OpenAPI document and `call` runs it through the caller's client,
 * so the token's scopes, the rate limits and the error codes are the API's.
 */
import { SxError, exit } from './output'
import type { ApiClient } from './client'

type Json = Record<string, unknown>

type Param = {
  name: string
  in: 'path' | 'query'
  required?: boolean
  description?: string
  schema?: Json
}

export type Operation = {
  id: string
  method: string
  path: string
  summary: string
  description: string
  tags: Array<string>
  params: Array<Param>
  body: Json | null
  bodyType: string | null
  safety: 'read' | 'write' | 'destructive'
  idempotent: boolean
  dryRun: boolean
  scopes: Array<string>
  errors: Array<string>
  secretResponse: boolean
  auth: 'none' | 'optional' | 'required'
}

type Spec = { paths: Record<string, Record<string, Json>>; components?: Json }

const catalogues = new WeakMap<ApiClient, Promise<Catalogue>>()

/** The operations the API this client talks to offers, read once. */
export function catalogue(client: ApiClient): Promise<Catalogue> {
  let c = catalogues.get(client)
  if (!c) {
    c = client.get('/openapi.json').then((r) => new Catalogue(r.json as Spec))
    // A failed read is not kept: the next call tries again.
    c.catch(() => catalogues.delete(client))
    catalogues.set(client, c)
  }
  return c
}

export class Catalogue {
  readonly ops: Array<Operation> = []
  private readonly schemas: Record<string, Json>

  constructor(spec: Spec) {
    this.schemas = (spec.components?.schemas ?? {}) as Record<string, Json>
    for (const [path, item] of Object.entries(spec.paths))
      for (const [method, o] of Object.entries(item)) {
        const security = (o.security ?? []) as Array<Json>
        const content = ((o.requestBody as Json | undefined)?.content ??
          {}) as Record<string, { schema?: Json }>
        const bodyType = Object.keys(content)[0] ?? null
        this.ops.push({
          id: String(o.operationId),
          method: method.toUpperCase(),
          path,
          summary: typeof o.summary === 'string' ? o.summary : '',
          description: typeof o.description === 'string' ? o.description : '',
          tags: (o.tags ?? []) as Array<string>,
          params: ((o.parameters ?? []) as Array<Param>).filter(
            (p) => p.name !== 'dry_run',
          ),
          body: bodyType ? (content[bodyType].schema ?? null) : null,
          bodyType,
          safety: o['x-sx-safety'] as Operation['safety'],
          idempotent: !!o['x-sx-idempotent'],
          dryRun: !!o['x-sx-dry-run'],
          scopes: (o['x-sx-scopes'] ?? []) as Array<string>,
          errors: (o['x-sx-errors'] ?? []) as Array<string>,
          secretResponse: !!o['x-sx-secret-response'],
          auth:
            security.length === 0
              ? 'none'
              : security.some((s) => Object.keys(s).length === 0)
                ? 'optional'
                : 'required',
        })
      }
    this.ops.sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string) {
    return this.ops.find((o) => o.id === id)
  }

  /**
   * Operations that match every word, best first: a word in the id counts
   * most, then the summary and tags, then the path and description.
   */
  search(query: string, opts: { safety?: string; limit?: number } = {}) {
    const words = query
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
    const scored: Array<{ op: Operation; score: number }> = []
    for (const op of this.ops) {
      if (opts.safety && op.safety !== opts.safety) continue
      const fields: Array<[string, number]> = [
        [op.id.toLowerCase(), 4],
        [`${op.summary} ${op.tags.join(' ')}`.toLowerCase(), 2],
        [`${op.path} ${op.description}`.toLowerCase(), 1],
      ]
      let score = 0
      let all = true
      for (const w of words) {
        const hit = fields.reduce((s, [f, n]) => (f.includes(w) ? s + n : s), 0)
        if (hit === 0) all = false
        score += hit
      }
      if (all) scored.push({ op, score })
    }
    scored.sort((a, b) => b.score - a.score || a.op.id.localeCompare(b.op.id))
    return scored.slice(0, opts.limit ?? 20).map((s) => s.op)
  }

  /** What an agent needs to call it: parameters and the body's schema, with references filled in. */
  describe(op: Operation) {
    return {
      id: op.id,
      method: op.method,
      path: op.path,
      summary: op.summary,
      description: op.description,
      safety: op.safety,
      idempotent: op.idempotent,
      dry_run: op.dryRun,
      scopes: op.scopes,
      auth: op.auth,
      errors: op.errors,
      params: op.params.map((p) => ({
        name: p.name,
        in: p.in,
        required: !!p.required,
        description: p.description ?? p.schema?.description,
        schema: this.inline(p.schema ?? {}),
      })),
      body: op.body ? this.inline(op.body) : null,
      ...(this.unreachable(op)
        ? { callable: false, why: this.unreachable(op) }
        : {}),
    }
  }

  /** A short line per operation, for a list. */
  brief(op: Operation) {
    return {
      id: op.id,
      method: op.method,
      path: op.path,
      summary: op.summary,
      safety: op.safety,
      ...(this.unreachable(op) ? { callable: false } : {}),
    }
  }

  /** Why `call` will not run it, if it will not. */
  unreachable(op: Operation): string | null {
    if (op.secretResponse)
      return 'Its answer carries a secret, and MCP never returns one. Run it with sx or the API directly.'
    if (op.bodyType && op.bodyType !== 'application/json')
      return 'It takes raw bytes. Use sx or the API directly.'
    if (op.id === 'api.openapi') return 'Use search_operations instead.'
    return null
  }

  private inline(schema: Json, depth = 0, seen = new Set<string>()): Json {
    const ref = schema.$ref
    if (typeof ref === 'string') {
      const name = ref.split('/').pop() ?? ref
      const target = this.schemas[name] as Json | undefined
      if (!target || seen.has(name) || depth > 6) return { $ref: name }
      return this.inline(target, depth + 1, new Set([...seen, name]))
    }
    const out: Json = {}
    for (const [k, v] of Object.entries(schema))
      out[k] = Array.isArray(v)
        ? v.map((x) =>
            x && typeof x === 'object'
              ? this.inline(x as Json, depth, seen)
              : x,
          )
        : v && typeof v === 'object'
          ? this.inline(v as Json, depth, seen)
          : v
    return out
  }
}

export type CallInput = {
  id: string
  params?: Record<string, string | number | boolean>
  body?: unknown
  dry_run?: boolean
  confirm?: boolean
}

const refuse = (code: string, message: string, hint: string) =>
  new SxError(code, message, hint, exit.usage)

/**
 * Runs one operation. A destructive one needs `confirm`, unless it is a dry
 * run: an agent says what it means to destroy before it does.
 */
export async function callOperation(client: ApiClient, input: CallInput) {
  const cat = await catalogue(client)
  const op = cat.get(input.id)
  if (!op)
    throw refuse(
      'unknown_operation',
      `There is no operation ${input.id}.`,
      'Find it with search_operations; ids look like issues.create.',
    )
  const why = cat.unreachable(op)
  if (why) throw refuse('not_callable', `${op.id} cannot be called here.`, why)
  if (input.dry_run && !op.dryRun)
    throw refuse(
      'dry_run_unsupported',
      `${op.id} has no dry run.`,
      op.safety === 'read'
        ? 'It changes nothing; call it without dry_run.'
        : 'Call it without dry_run once you are sure.',
    )
  if (op.safety === 'destructive' && !input.dry_run && input.confirm !== true)
    throw refuse(
      'confirmation_required',
      `${op.id} destroys something and cannot be undone.`,
      op.dryRun
        ? 'Run it with dry_run first, then again with confirm: true.'
        : 'Call it again with confirm: true once you are sure.',
    )

  const params: Record<string, string | number | boolean | undefined> = {
    ...input.params,
  }
  const missing: Array<string> = []
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name]
    delete params[name]
    if (v === undefined || v === '') {
      missing.push(name)
      return ''
    }
    return encodeURIComponent(String(v))
  })
  const known = new Set(
    op.params.filter((p) => p.in === 'query').map((p) => p.name),
  )
  for (const p of op.params)
    if (p.in === 'query' && p.required && params[p.name] === undefined)
      missing.push(p.name)
  if (missing.length)
    throw refuse(
      'missing_parameter',
      `${op.id} needs ${missing.join(', ')}.`,
      `Parameters: ${op.params.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ') || 'none'}.`,
    )
  const extra = Object.keys(params).filter((k) => !known.has(k))
  if (extra.length)
    throw refuse(
      'unknown_parameter',
      `${op.id} does not take ${extra.join(', ')}.`,
      op.body
        ? 'Fields of the request go in body, not params.'
        : `Parameters: ${op.params.map((p) => p.name).join(', ') || 'none'}.`,
    )
  if (input.body !== undefined && !op.body)
    throw refuse(
      'unexpected_body',
      `${op.id} takes no body.`,
      'Put its inputs in params.',
    )

  const r = await client.call(op.method, path, {
    query: params,
    body: input.body,
    dryRun: input.dry_run,
  })
  return {
    status: r.status,
    ...(r.headers.get('sx-dry-run') === 'true' ? { dry_run: true } : {}),
    data: r.json,
  }
}
