import { createHash } from 'node:crypto'

/**
 * Idempotency keys. A POST with `Idempotency-Key` runs at most once. The store
 * remembers the key, a hash of the request and, when it finishes, the response.
 *
 * In memory here. With Convex, `begin` and the write happen in one mutation,
 * so a crash between them cannot leave a key without its effect or the other
 * way round. The interface is the same.
 */
export type StoredResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export type Begin =
  | { state: 'new' }
  | { state: 'replay'; response: StoredResponse }
  | { state: 'conflict' }
  | { state: 'in_progress' }

export interface IdempotencyStore {
  begin: (scope: string, key: string, fingerprint: string) => Promise<Begin>
  complete: (scope: string, key: string, response: StoredResponse) => Promise<void>
  /** The request failed before it had an effect we can replay; allow a retry. */
  abort: (scope: string, key: string) => Promise<void>
}

type Entry = {
  fingerprint: string
  response?: StoredResponse
  expires: number
  /** Rough size in characters: the key, the fingerprint, the headers and the body. */
  chars: number
}

/** What a stored response costs, near enough: its text plus a fixed overhead per entry. */
function sizeOf(id: string, fingerprint: string, response?: StoredResponse): number {
  let n = 160 + id.length + fingerprint.length
  if (response) {
    n += response.body.length
    for (const k in response.headers) n += k.length + response.headers[k].length + 24
  }
  return n
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>()
  constructor(
    private readonly ttlMs = 24 * 3_600_000,
    private readonly now: () => number = Date.now,
    /**
     * The most keys kept. Every key holds its response for 24 hours, so a busy
     * writer would otherwise fill memory. The oldest go first, which only costs a
     * retry that arrives a very long time after the original.
     */
    private readonly max = 100_000,
    /** And the most text kept, so large responses cannot fill memory under the key cap. */
    private readonly maxChars = 24_000_000,
  ) {}

  private held = 0

  private evict(protect?: string) {
    while ((this.entries.size > this.max || this.held > this.maxChars) && this.entries.size > 1) {
      let victim: string | undefined
      for (const [id, entry] of this.entries)
        if (id !== protect && entry.response) {
          victim = id
          break
        }
      // An in-progress key has no response yet. Never drop it: a retry would
      // repeat a write that may already be running or done.
      if (victim === undefined) break
      this.held -= this.entries.get(victim)!.chars
      this.entries.delete(victim)
    }
  }

  begin(scope: string, key: string, fingerprint: string): Promise<Begin> {
    const id = `${scope}\u0000${key}`
    const now = this.now()
    const found = this.entries.get(id)
    if (found && found.expires > now) {
      if (found.fingerprint !== fingerprint)
        return Promise.resolve({ state: 'conflict' })
      return Promise.resolve(
        found.response
          ? { state: 'replay', response: found.response }
          : { state: 'in_progress' },
      )
    }
    if (found) this.held -= found.chars
    const chars = sizeOf(id, fingerprint)
    this.held += chars
    this.entries.set(id, { fingerprint, expires: now + this.ttlMs, chars })
    this.evict()
    return Promise.resolve({ state: 'new' })
  }

  complete(scope: string, key: string, response: StoredResponse) {
    const id = `${scope}\u0000${key}`
    const entry = this.entries.get(id)
    if (entry) {
      const chars = entry.chars + sizeOf('', '', response) - 160
      this.held += chars - entry.chars
      entry.chars = chars
      entry.response = response
      this.evict(id)
    }
    return Promise.resolve()
  }

  abort(scope: string, key: string) {
    const id = `${scope}\u0000${key}`
    const entry = this.entries.get(id)
    if (entry) this.held -= entry.chars
    this.entries.delete(id)
    return Promise.resolve()
  }

  get size() {
    return this.entries.size
  }

  sweep() {
    const now = this.now()
    for (const [id, e] of this.entries)
      if (e.expires <= now) {
        this.held -= e.chars
        this.entries.delete(id)
      }
  }
}

export function requestFingerprint(
  method: string,
  path: string,
  query: string,
  body: string,
  ifMatch: string = '',
  contentType: string = '',
  replayStamp: string = '',
): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${query}\n${body}\n${ifMatch}\n${contentType}\n${replayStamp}`)
    .digest('base64url')
}
