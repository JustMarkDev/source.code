/**
 * Rate limiting that works with many API nodes and many clients.
 *
 * The shared store holds one counter per (key, window). A node does not ask it
 * on every request. It leases a block of units, spends them locally, and asks
 * again when the block is gone. The store therefore sees one write per
 * `lease` requests instead of one per request, and the total admitted can never
 * pass the limit, because the store never grants more than is left. The price
 * is that units leased and not spent are lost until the window ends, so a
 * token spread over N nodes can be under-admitted by at most N * lease.
 *
 * `LimitStore` is the only thing that has to be shared. The memory one is for
 * tests and a single node; production points it at a shared store.
 */
export type Policy = { readonly limit: number; readonly windowMs: number }

export type Grant = {
  /** Units handed out, 0..want. */
  granted: number
  /** Units left in the window after this grant, across every node. */
  remaining: number
  /** Milliseconds until the window resets. */
  resetMs: number
}

export interface LimitStore {
  take: (
    key: string,
    want: number,
    policy: Policy,
    now: number,
  ) => Promise<Grant>
}

export class MemoryLimitStore implements LimitStore {
  private readonly windows = new Map<string, { start: number; used: number }>()
  /** How many times the store was asked. Tests use this to prove leasing works. */
  calls = 0

  take(key: string, want: number, policy: Policy, now: number) {
    this.calls++
    const start = now - (now % policy.windowMs)
    let w = this.windows.get(key)
    if (!w || w.start !== start) {
      w = { start, used: 0 }
      this.windows.set(key, w)
    }
    const granted = Math.max(0, Math.min(want, policy.limit - w.used))
    w.used += granted
    return Promise.resolve({
      granted,
      remaining: policy.limit - w.used,
      resetMs: start + policy.windowMs - now,
    })
  }

  /** Drop windows that ended. Called now and then by whoever owns the store. */
  sweep(now: number) {
    for (const [key, w] of this.windows)
      if (w.start + 3_600_000 < now) this.windows.delete(key)
  }
}

export type Decision = {
  allowed: boolean
  limit: number
  /** Units this client can still spend, counting what this node holds. */
  remaining: number
  /** Seconds until the window resets (and until a denied client may retry). */
  resetSeconds: number
}

type Lease = {
  start: number
  left: number
  storeRemaining: number
  /** The store had nothing left for us this window; deny locally until it resets. */
  exhausted: boolean
  resetMs: number
}

export class Limiter {
  private readonly leases = new Map<string, Lease>()

  constructor(
    private readonly store: LimitStore,
    private readonly options: {
      /** Share of the limit leased at once. 0.05 means a twentieth. */
      leaseShare?: number
      maxLease?: number
      now?: () => number
    } = {},
  ) {}

  private now() {
    return (this.options.now ?? Date.now)()
  }

  /**
   * The common case, with no promise: the node already holds a lease with enough
   * units. Returns null when the shared store has to be asked.
   */
  tryLocal(key: string, policy: Policy, cost: number): Decision | null {
    const lease = this.leases.get(`${key}@${policy.windowMs}`)
    if (!lease || lease.left < cost) return null
    const now = this.now()
    const start = now - (now % policy.windowMs)
    if (lease.start !== start) return null
    lease.left -= cost
    return {
      allowed: true,
      limit: policy.limit,
      remaining: lease.left + lease.storeRemaining,
      resetSeconds: Math.ceil((start + policy.windowMs - now) / 1000),
    }
  }

  async check(key: string, policy: Policy, cost: number): Promise<Decision> {
    const now = this.now()
    const start = now - (now % policy.windowMs)
    const id = `${key}@${policy.windowMs}`
    let lease = this.leases.get(id)
    if (!lease || lease.start !== start) {
      lease = {
        start,
        left: 0,
        storeRemaining: policy.limit,
        exhausted: false,
        resetMs: 0,
      }
      this.leases.set(id, lease)
    }
    const resetSeconds = Math.ceil((start + policy.windowMs - now) / 1000)
    if (cost === 0)
      return {
        allowed: true,
        limit: policy.limit,
        remaining: lease.left + lease.storeRemaining,
        resetSeconds,
      }
    if (lease.left < cost && lease.exhausted)
      // Under abuse the shared store must not see one write per denied request.
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetSeconds,
      }
    if (lease.left < cost) {
      const share = this.options.leaseShare ?? 0.05
      const size = Math.max(
        cost,
        Math.min(this.options.maxLease ?? 50, Math.ceil(policy.limit * share)),
      )
      const g = await this.store.take(`${key}@${start}`, size, policy, now)
      lease.left += g.granted
      lease.storeRemaining = g.remaining
      // The store had less than a whole lease; take what is there for this call.
      if (lease.left < cost) {
        if (g.granted === 0) lease.exhausted = true
        return {
          allowed: false,
          limit: policy.limit,
          remaining: lease.left,
          resetSeconds: Math.max(1, Math.ceil(g.resetMs / 1000)),
        }
      }
    }
    lease.left -= cost
    return {
      allowed: true,
      limit: policy.limit,
      remaining: lease.left + lease.storeRemaining,
      resetSeconds,
    }
  }

  /** Give units back, for a request that turned out to cost nothing (a 304). */
  refund(key: string, policy: Policy, cost: number) {
    const lease = this.leases.get(`${key}@${policy.windowMs}`)
    const now = this.now()
    // Never refund into a window that has already rolled over: those units
    // belong to the old window and would inflate the new one.
    if (lease && lease.start === now - (now % policy.windowMs))
      lease.left += cost
  }

  /** Forget leases from finished windows. */
  sweep() {
    const now = this.now()
    for (const [id, lease] of this.leases)
      if (lease.start + 3_600_000 < now) this.leases.delete(id)
  }
}

/**
 * Requests in flight, per token, on this node. Exact global concurrency would
 * cost a shared write on every request and every response, so it is a node-local
 * guard against a client that opens hundreds of connections at once. The pools
 * above bound the total work across nodes.
 */
export class Concurrency {
  private readonly active = new Map<string, number>()
  constructor(private readonly max: number) {}

  enter(key: string): boolean {
    const n = this.active.get(key) ?? 0
    if (n >= this.max) return false
    this.active.set(key, n + 1)
    return true
  }

  leave(key: string) {
    const n = (this.active.get(key) ?? 1) - 1
    if (n <= 0) this.active.delete(key)
    else this.active.set(key, n)
  }
}

export const pools = {
  read: { limit: 1200, windowMs: 60_000 },
  write: { limit: 120, windowMs: 60_000 },
  heavy: { limit: 120, windowMs: 60_000 },
  search: { limit: 60, windowMs: 60_000 },
  anonymous: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, Policy>

export type PoolName = keyof typeof pools
