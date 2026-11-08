import { Context } from 'effect'
import type { Effect } from 'effect'
import type { z } from 'zod'
import type { Principal, Scope } from './auth'
import type { ApiError, ErrorCode } from './problem'
import type { PoolName } from './limiter'
import type { DomainCore } from './domain'

/**
 * An operation is the unit the whole API is built from. One definition gives
 * the route, the validation, the OpenAPI entry, the rate-limit cost, the safety
 * metadata an agent reads before calling, and the documentation. Adding an
 * endpoint is adding one of these.
 */
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export class Domain extends Context.Service<
  Domain,
  {
    /** Run a data access function. Failures become `ApiError`. */
    readonly run: <TValue>(
      f: (core: DomainCore) => Promise<TValue>,
    ) => Effect.Effect<TValue, ApiError>
  }
>()('api/Domain') {}

export type Services = Domain

export class Reply<T> {
  constructor(
    readonly body: T,
    readonly init: {
      status?: number
      headers?: Record<string, string>
      /** Version key for the ETag, when it is not on the object. */
      etag?: string
    } = {},
  ) {}
}
export const reply = <T>(body: T, init: Reply<T>['init'] = {}) =>
  new Reply(body, init)

/**
 * An object already turned into JSON. Handlers that return one let the pipeline
 * skip serializing it, and lists of them are joined as text. `key` names
 * everything the text depends on, so it also stands in for the content when an
 * ETag is needed. `toJSON` keeps it working anywhere a plain object would.
 */
export class Pre {
  private made: unknown
  private done = false

  /** `obj` may be a function, for items built from text that rarely need the object. */
  constructor(
    readonly json: string,
    obj: unknown,
    readonly key: string,
  ) {
    if (typeof obj === 'function') this.make = obj as () => unknown
    else {
      this.made = obj
      this.done = true
    }
  }

  private make: (() => unknown) | undefined

  get obj(): unknown {
    if (!this.done) {
      this.made = this.make!()
      this.done = true
    }
    return this.made
  }

  private cached: string | undefined

  /** A short, stable digest of `key`, for building the ETag of a list. */
  get tag(): string {
    return (this.cached ??= cyrb53(this.key).toString(36))
  }

  toJSON() {
    return this.obj
  }
}

/** A fast non-cryptographic 53-bit hash. Good enough to tell one version from another. */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** A response the handler built itself, such as an event stream. */
export class Raw {
  constructor(readonly response: Response) {}
}

type Infer<TSchema> = TSchema extends z.ZodType
  ? z.output<TSchema>
  : Record<string, never>

export type Ctx<TParams, TQuery, TBody> = {
  readonly params: TParams
  readonly query: TQuery
  readonly body: TBody
  /** The HTTP method. HEAD reaches a GET handler, so it can answer without a body. */
  readonly method: string
  readonly principal: Principal | null
  readonly requestId: string
  readonly dryRun: boolean
  readonly ifMatch: string | null
  readonly url: URL
  /** The request body as bytes, for operations that declare `rawBody`. */
  readonly bytes: Uint8Array | null
  readonly signal: AbortSignal
  readonly header: (name: string) => string | null
  /** `https://api.source.code/v1`, or wherever this API is mounted. */
  readonly base: string
  readonly htmlBase: string
  readonly now: () => number
  /** Run another request through the whole pipeline. Used by batch. */
  readonly dispatch: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<Response>
}

export type OpSpec<
  TParams extends z.ZodType | undefined,
  TQuery extends z.ZodType | undefined,
  TBody extends z.ZodType | undefined,
  TResponse extends z.ZodType,
> = {
  /** `changes.land`: group, then verb. The same name is the MCP tool and CLI command. */
  id: string
  summary: string
  description?: string
  tags: Array<string>
  method: Method
  /** Relative to the mount, with `{name}` parameters. */
  path: string
  auth: 'none' | 'optional' | 'required'
  scopes?: Array<Scope>
  pool: PoolName | 'none'
  /** Rate-limit units. */
  cost?: number
  safety: 'read' | 'write' | 'destructive'
  /** Repeating it with the same input is harmless. */
  idempotent: boolean
  /** Accepts `?dry_run=true`. */
  dryRun?: boolean
  params?: TParams
  query?: TQuery
  body?: TBody
  /** Takes the body as raw bytes instead of JSON, up to this many. */
  rawBody?: { maxBytes: number }
  response: TResponse
  status?: number
  /** The response contains a secret or a one-time capability, so it is not stored for idempotency. */
  secretResponse?: boolean
  /** Default true. False turns off ETags, conditional reads and the body cache. */
  conditional?: boolean
  /** The response is not JSON: the media type it is served as. */ responseContentType?: string
  /** The response stays open, so it cannot be run inside a batch. */
  streaming?: boolean
  /** Enforces `If-Match` on writes, so an idempotent retry must re-check the precondition. */
  ifMatch?: boolean
  /** Codes beyond the ones every operation can return. */
  errors?: Array<ErrorCode>
  /** Honours `?fields=`. */
  shapeable?: boolean
  /** Honours `?wait=` with `If-None-Match`; names the topic to wait on. */
  waitOn?: (
    params: Infer<TParams>,
    query?: unknown,
    domain?: DomainCore,
  ) => string
  /**
   * The version of what is being read, found without building it. With it a
   * conditional read can answer 304 and a repeat read can come from the body
   * cache, with no effect run at all.
   */
  probe?: (
    ctx: Ctx<Infer<TParams>, Infer<TQuery>, Infer<TBody>>,
    domain: DomainCore,
  ) => Promise<string | null>
  /**
   * A readable form for `Accept: text/markdown`, built from the JSON object. Reads
   * only. The ETag and the cache differ from the JSON's, so a client can ask for either.
   */
  markdown?: (object: Record<string, unknown>) => string
  /** Name of a state-changing result the operation may return as 202. */
  mayBeAsync?: boolean
  handler: (
    ctx: Ctx<Infer<TParams>, Infer<TQuery>, Infer<TBody>>,
  ) => Effect.Effect<
    z.output<TResponse> | Reply<z.output<TResponse>> | Raw | Pre,
    ApiError,
    Services
  >
}

export type Op = OpSpec<
  z.ZodType | undefined,
  z.ZodType | undefined,
  z.ZodType | undefined,
  z.ZodType
>

export function defineOp<
  TParams extends z.ZodType | undefined = undefined,
  TQuery extends z.ZodType | undefined = undefined,
  TBody extends z.ZodType | undefined = undefined,
  TResponse extends z.ZodType = z.ZodType,
>(spec: OpSpec<TParams, TQuery, TBody, TResponse>): Op {
  return spec as unknown as Op
}

// ---------------------------------------------------------------------------
// Router

type Node = {
  statics: Map<string, Node>
  param: Node | null
  ops: Map<Method, { op: Op; names: Array<string> }>
}

const node = (): Node => ({ statics: new Map(), param: null, ops: new Map() })

export type Match =
  | { kind: 'hit'; op: Op; params: Record<string, string> }
  | { kind: 'method'; allow: Array<Method> }
  | { kind: 'miss' }

export class Router {
  private readonly root = node()

  constructor(ops: ReadonlyArray<Op>) {
    for (const op of ops) {
      let at = this.root
      // Two operations may call the same position by different names, so the
      // names belong to the operation, not to the trie.
      const names: Array<string> = []
      for (const seg of op.path.split('/').filter(Boolean)) {
        if (seg.startsWith('{')) {
          names.push(seg.slice(1, -1))
          at.param ??= node()
          at = at.param
        } else {
          let next = at.statics.get(seg)
          if (!next) at.statics.set(seg, (next = node()))
          at = next
        }
      }
      if (at.ops.has(op.method))
        throw new Error(`duplicate operation ${op.method} ${op.path}`)
      at.ops.set(op.method, { op, names })
    }
  }

  match(method: string, path: string): Match {
    const values: Array<string> = []
    let at: Node = this.root
    for (const seg of path.split('/').filter(Boolean)) {
      const next = at.statics.get(seg)
      if (next) at = next
      else if (at.param) {
        let value: string
        try {
          value = decodeURIComponent(seg)
        } catch {
          // A malformed escape is a request that names no endpoint, not a crash.
          return { kind: 'miss' }
        }
        values.push(value)
        at = at.param
      } else return { kind: 'miss' }
    }
    const hit = at.ops.get(method as Method)
    if (hit) {
      const params: Record<string, string> = {}
      for (let i = 0; i < hit.names.length; i++)
        params[hit.names[i]] = values[i]
      return { kind: 'hit', op: hit.op, params }
    }
    if (at.ops.size) return { kind: 'method', allow: [...at.ops.keys()] }
    return { kind: 'miss' }
  }
}
