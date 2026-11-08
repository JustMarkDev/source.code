import { newId } from './ids'

/**
 * The event log is the source of truth for change. Webhooks, the stream, the
 * `sync` endpoint and `?wait=` are all read from it. Events are kept in order
 * with a gapless sequence per log.
 *
 * Waiters are kept per topic (a repository, say), so an event wakes only the
 * clients that care about it, not every long-poll in the process.
 */
export type ActorLike = { id: string; handle: string; class: 'human' | 'agent' | 'bot' }

export type EventRecord = {
  object: 'event'
  id: string
  sequence: number
  type: string
  created_at: string
  repo: string | null
  /** The stable repository id, so a reused name cannot inherit another repository's history. */
  repo_id: string | null
  actor: { object: 'actor'; id: string; handle: string; class: ActorLike['class'] }
  subject: { object: string; id: string; number: number | null }
  changes: Array<string>
  data: Record<string, unknown> | null
}

/** `change.*` matches every change event; `*` matches everything. */
export function matchesType(patterns: ReadonlyArray<string>, type: string): boolean {
  return patterns.some((p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))))
}

/**
 * What the log keeps of an event. The full record is a nested object of a dozen
 * values, about 1.7 KB on the heap; the same event as text is about a third of
 * that, and text is what almost every reader wants anyway (the stream and the
 * list copy it into a response). The fields a reader filters on stay as plain
 * values, and anything that needs the rest calls `parseEvent`.
 */
export type StoredEvent = {
  readonly sequence: number
  readonly type: string
  readonly repo: string | null
  readonly repoId: string | null
  readonly json: string
}

export function parseEvent(s: StoredEvent): EventRecord {
  return JSON.parse(s.json) as EventRecord
}

let stampMs = Number.NaN
let stampText = ''
function stamp(ms: number) {
  if (ms !== stampMs) {
    stampText = new Date(ms).toISOString()
    stampMs = ms
  }
  return stampText
}

export class EventLog {
  private events: Array<StoredEvent> = []
  /** The same events, one list per repository id, for reading one repository's history. */
  private byRepo = new Map<string, Array<StoredEvent>>()
  private firstSequence = 1
  private next = 1
  /** Characters held in `events`, for the memory budget. */
  private held = 0
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly listeners = new Set<(e: EventRecord) => void>()

  constructor(
    private readonly now: () => number = Date.now,
    // In memory the log is a window. The hosted version keeps 30 days in the database.
    private readonly keep = 50_000,
    // The window is also bounded by size, so large events cannot make it large.
    private readonly maxChars = 24_000_000,
  ) {}

  get head() {
    return this.next - 1
  }

  /** The oldest sequence still held. A cursor older than this has to resync. */
  get oldest() {
    return this.firstSequence
  }

  /** Characters of event text held, which is about the bytes. */
  get size() {
    return this.held
  }

  append(
    event: Omit<EventRecord, 'object' | 'id' | 'sequence' | 'created_at'>,
  ): EventRecord {
    const at = this.now()
    const record: EventRecord = {
      object: 'event',
      id: newId('event', at),
      sequence: this.next++,
      created_at: stamp(at),
      ...event,
    }
    const stored: StoredEvent = {
      sequence: record.sequence,
      type: record.type,
      repo: record.repo,
      repoId: record.repo_id,
      json: JSON.stringify(record),
    }
    this.held += stored.json.length
    this.events.push(stored)
    if (stored.repoId) {
      let list = this.byRepo.get(stored.repoId)
      if (!list) this.byRepo.set(stored.repoId, (list = []))
      list.push(stored)
    }
    for (const l of this.listeners) l(record)
    if (this.events.length > this.keep * 1.1 || this.held > this.maxChars * 1.1) this.trim()
    this.wake('*')
    if (record.repo) this.wake(`repo:${record.repo.toLowerCase()}`)
    return record
  }

  /** Drops the oldest events until the window and the size budget both hold. */
  private trim() {
    let drop = 0
    let held = this.held
    while (drop < this.events.length - 1 && (this.events.length - drop > this.keep || held > this.maxChars)) {
      held -= this.events[drop].json.length
      drop++
    }
    if (drop === 0) return
    this.events = this.events.slice(drop)
    this.held = held
    this.firstSequence += drop
    for (const [repo, list] of this.byRepo) {
      // Lists are in sequence order, so the dropped events are a prefix.
      let n = 0
      while (n < list.length && list[n].sequence < this.firstSequence) n++
      if (n === list.length) this.byRepo.delete(repo)
      else if (n > 0) this.byRepo.set(repo, list.slice(n))
    }
  }

  /** Called for every event as it is appended. Returns a function that stops it. */
  subscribe(fn: (e: EventRecord) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Events with a sequence greater than `after`, oldest first. */
  since(after: number, limit: number, keep?: (e: StoredEvent) => boolean) {
    const out: Array<StoredEvent> = []
    let i = Math.max(0, after + 1 - this.firstSequence)
    // The last sequence actually looked at, not just the last one that
    // matched. A reader can move its cursor past events it filtered out.
    let scannedTo = after
    for (; i < this.events.length && out.length < limit; i++) {
      const e = this.events[i]
      scannedTo = e.sequence
      if (!keep || keep(e)) out.push(e)
    }
    return { events: out, exhausted: i >= this.events.length, scannedTo }
  }

  all() {
    return this.events
  }

  repoEvents(repoId: string): ReadonlyArray<StoredEvent> {
    return this.byRepo.get(repoId) ?? []
  }

  /** Resolves when something happens on the topic, or after `ms`. */
  wait(topic: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let set = this.waiters.get(topic)
      if (!set) this.waiters.set(topic, (set = new Set()))
      const done = () => {
        clearTimeout(timer)
        set.delete(done)
        if (set.size === 0 && this.waiters.get(topic) === set)
          this.waiters.delete(topic)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      set.add(done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }

  private wake(topic: string) {
    const set = this.waiters.get(topic)
    if (!set) return
    for (const done of [...set]) done()
  }

  get waiting() {
    let n = 0
    for (const s of this.waiters.values()) n += s.size
    return n
  }
}
