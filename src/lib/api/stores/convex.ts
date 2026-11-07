import { apiError } from '../problem'
import type { Begin, IdempotencyStore, StoredResponse } from '../idempotency'
import type { Grant, LimitStore, Policy } from '../limiter'

/**
 * The shared stores on Convex (`convex/apiStores.ts`), for running more than one
 * API node. Each takes a `call` so it does not care how Convex is reached: the
 * hosted service passes `convexCaller(url)`, a test passes a function that runs
 * the Convex functions in memory.
 */
export type ConvexCall = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** Reaches the deployment over HTTP. The client is loaded when first used, so tests and the preview do not need it. */
export function convexCaller(url: string): ConvexCall {
  let client: Promise<{ mutation: (ref: never, args: Record<string, unknown>) => Promise<unknown> }> | null = null
  return async (name, args) => {
    client ??= (async () => {
      const [{ ConvexHttpClient }, { makeFunctionReference }] = await Promise.all([import('convex/browser'), import('convex/server')])
      const http = new ConvexHttpClient(url)
      return {
        mutation: (ref: never, a: Record<string, unknown>) => http.mutation(makeFunctionReference<'mutation'>(ref as string) as never, a as never),
      }
    })()
    return (await client).mutation(name as never, args)
  }
}

/** The deployment answered, and said no. */
const refused = (e: unknown) => e instanceof Error && /not allowed/.test(e.message)

export class ConvexLimitStore implements LimitStore {
  constructor(
    private readonly call: ConvexCall,
    private readonly secret: string,
  ) {}

  /** `now` is ignored: the window is cut by the database's clock, so every node agrees where it starts. */
  async take(key: string, want: number, policy: Policy, _now?: number): Promise<Grant> {
    try {
      return (await this.call('apiStores:takeLimit', { secret: this.secret, key, want, limit: policy.limit, windowMs: policy.windowMs })) as Grant
    } catch (e) {
      // A refused secret is a mistake in the setup, not an outage. Say so loudly.
      if (refused(e)) throw e
      // Rate limits protect the service; they must not take it down. When the
      // shared store cannot be reached, each node admits a small block on its own
      // (1% of the limit) until it can. That is a few units per node, not a hole.
      console.error('rate limit store unavailable, admitting a small block', e)
      const granted = Math.min(want, Math.max(1, Math.floor(policy.limit * 0.01)))
      return { granted, remaining: 0, resetMs: Math.min(policy.windowMs, 5_000) }
    }
  }
}

export class ConvexIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly call: ConvexCall,
    private readonly secret: string,
    private readonly ttlMs = 24 * 3_600_000,
  ) {}

  /** Without the store a write cannot be made safe to repeat, so it is refused rather than risked. */
  private async guarded<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      return (await this.call(name, { secret: this.secret, ...args })) as T
    } catch (e) {
      if (refused(e)) throw apiError('internal', 'The API is misconfigured: the shared store refused its secret.')
      console.error('idempotency store unavailable', e)
      throw apiError('backend_unavailable', 'The store that makes repeated writes safe is not reachable.')
    }
  }

  async begin(scope: string, key: string, fingerprint: string): Promise<Begin> {
    const r = await this.guarded<
      { state: 'new' | 'conflict' | 'in_progress' } | { state: 'replay'; response: { status: number; headers: string; body: string } }
    >('apiStores:beginIdempotency', { scope, key, fingerprint, ttlMs: this.ttlMs })
    if (r.state !== 'replay') return r
    return { state: 'replay', response: { status: r.response.status, headers: JSON.parse(r.response.headers) as Record<string, string>, body: r.response.body } }
  }

  async complete(scope: string, key: string, response: StoredResponse): Promise<void> {
    // The write already happened. If this fails the key stays "in progress", which makes a retry wait instead of repeat.
    await this.guarded('apiStores:completeIdempotency', { scope, key, status: response.status, headers: JSON.stringify(response.headers), body: response.body })
  }

  async abort(scope: string, key: string): Promise<void> {
    await this.guarded('apiStores:abortIdempotency', { scope, key })
  }
}
