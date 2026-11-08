import { createHmac } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { newId, randomSource } from './ids'
import { matchesType, parseEvent  } from './events'
import type { EventLog, EventRecord } from './events'

const randomBytes = (n: number) => Buffer.from(randomSource.bytes(n))

/**
 * Webhooks. An endpoint receives the events of one repository.
 *
 *  - The payload is the event object, the same one `GET /events` returns.
 *  - Deliveries are signed with the Standard Webhooks scheme: `webhook-id`,
 *    `webhook-timestamp`, `webhook-signature` (HMAC-SHA256 over
 *    `id.timestamp.body`), so existing verification libraries work.
 *  - At least once. A delivery is retried on any failure, with growing delays,
 *    for about 28 hours. `webhook-id` is the event id and stays the same across
 *    retries and redeliveries, so a receiver can deduplicate.
 *  - Order is not promised. Each event has a `sequence`.
 *  - An endpoint that keeps failing is disabled, and says why.
 *  - Any range of the event log can be replayed with a call.
 *  - A delivery never reaches a private, loopback, link-local or metadata
 *    address, checked when the endpoint is saved and again, on the resolved
 *    address the connection is pinned to, at every attempt.
 */
export const RETRY_DELAYS_MS = [5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
export const DISABLE_AFTER = 5
export const MAX_HOOKS_PER_REPO = 10
const MAX_DELIVERIES_PER_HOOK = 1000
const SECRET_OVERLAP_MS = 24 * 3_600_000
const TIMEOUT_MS = 10_000
const MAX_IN_FLIGHT = 64

export type Scheduler = { after: (ms: number, fn: () => void) => () => void }

export const realScheduler: Scheduler = {
  after(ms, fn) {
    const t = setTimeout(fn, ms)
    ;(t as { unref?: () => void }).unref?.()
    return () => clearTimeout(t)
  },
}

export type SendResult = { status: number | null; error: string | null; ms: number }
export type Transport = {
  send: (req: { url: string; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<SendResult>
}

// ---------------------------------------------------------------------------
// Where a delivery may go.

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const [a, b, c] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (kind === 6) {
    const v = ip.toLowerCase()
    const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return isBlockedAddress(mapped[1])
    const hex = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v)
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
      return isBlockedAddress(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`)
    }
    // 6to4 embeds an IPv4 address in the first two groups after 2002::.
    if (v.startsWith('2002:')) {
      const groups = v.split(':')
      const g1 = parseInt(groups[1] ?? '', 16)
      const g2 = parseInt(groups[2] ?? '', 16)
      if (Number.isFinite(g1) && Number.isFinite(g2)) {
        const embedded = `${(g1 >>> 8) & 255}.${g1 & 255}.${(g2 >>> 8) & 255}.${g2 & 255}`
        if (isBlockedAddress(embedded)) return true
      }
    }
    return (
      v === '::' || v === '::1' ||
      /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) ||
      v.startsWith('64:ff9b:') || v.startsWith('2001:db8') ||
      // Teredo tunnels carry an obfuscated client IPv4 address; treat the
      // whole 2001:0000::/32 range as private.
      v === '2001::' || v.startsWith('2001::') || v.startsWith('2001:0:')
    )
  }
  return false
}

/** Why a URL may not be used as an endpoint, or null if it may. Checked when it is saved. */
export function endpointProblem(raw: string, allowPrivate: boolean): string | null {
  if (raw.length > 2000) return 'The URL is too long.'
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'Not a URL.'
  }
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:'))
    return 'Use https.'
  if (u.username || u.password) return 'Put credentials in a header, not in the URL.'
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!allowPrivate) {
    if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || host === 'metadata.google.internal')
      return 'That host is private.'
    if (isIP(host) && isBlockedAddress(host)) return 'That address is private.'
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return 'Use a host name or a dotted address.'
  }
  return null
}

/** Sends with the connection pinned to an address that was checked, so DNS cannot be flipped between check and use. */
export class HttpTransport implements Transport {
  constructor(private readonly allowPrivate = false) {}

  async send(req: { url: string; headers: Record<string, string>; body: string; timeoutMs: number }): Promise<SendResult> {
    const started = performance.now()
    const done = (status: number | null, error: string | null): SendResult => ({
      status,
      error,
      ms: Math.round(performance.now() - started),
    })
    const u = new URL(req.url)
    const host = u.hostname.replace(/^\[|\]$/g, '')
    let address: string
    let family: 4 | 6
    try {
      if (isIP(host)) {
        address = host
        family = isIP(host) as 4 | 6
      } else {
        const all = await lookup(host, { all: true })
        if (all.length === 0) return done(null, 'The host did not resolve.')
        address = all[0].address
        family = all[0].family as 4 | 6
        if (!this.allowPrivate && all.some((a) => isBlockedAddress(a.address)))
          return done(null, 'The host resolves to a private address.')
      }
      if (!this.allowPrivate && isBlockedAddress(address)) return done(null, 'The address is private.')
    } catch {
      return done(null, 'The host did not resolve.')
    }
    return new Promise<SendResult>((resolve) => {
      const request = u.protocol === 'https:' ? httpsRequest : httpRequest
      const r = request(
        u,
        {
          method: 'POST',
          headers: { ...req.headers, 'content-length': String(Buffer.byteLength(req.body)) },
          // The pin: connect to the address we checked, whatever DNS says now.
          lookup: (_h, _o, cb) => (cb as (e: null, a: string, f: number) => void)(null, address, family),
          servername: isIP(host) ? undefined : host,
          timeout: req.timeoutMs,
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(done(res.statusCode ?? null, null)))
          res.on('error', () => resolve(done(res.statusCode ?? null, null)))
        },
      )
      r.on('timeout', () => {
        r.destroy()
        resolve(done(null, 'The endpoint took too long to answer.'))
      })
      r.on('error', (e) => resolve(done(null, e.message.slice(0, 200))))
      r.end(req.body)
    })
  }
}

// ---------------------------------------------------------------------------

export type Attempt = { number: number; at: number; status: number | null; error: string | null; ms: number }

export type Delivery = {
  id: string
  hookId: string
  event: EventRecord
  state: 'pending' | 'succeeded' | 'failed'
  attempts: Array<Attempt>
  nextAt: number | null
  redeliveryOf: string | null
  createdAt: number
}

export type Hook = {
  id: string
  repo: string
  /** Stable id, so a reused repository name cannot deliver another repository's events. */
  repoId: string
  url: string
  description: string
  events: Array<string>
  active: boolean
  disabledReason: string | null
  secrets: Array<{ value: string; createdAt: number; expiresAt: number | null }>
  failures: number
  createdAt: number
  updatedAt: number
  version: number
  deliveries: Array<Delivery>
  lastDelivery: string | null
}

export const newSecret = () => `whsec_${randomBytes(24).toString('base64')}`

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

export class WebhookService {
  private readonly hooks = new Map<string, Hook>()
  private readonly byRepo = new Map<string, Set<string>>()
  private readonly deliveries = new Map<string, Delivery>()
  private readonly cancel = new Map<string, () => void>()
  private inFlight = 0
  private readonly queue: Array<() => void> = []
  private off: (() => void) | null = null

  constructor(
    private readonly o: {
      events: EventLog
      transport: Transport
      scheduler?: Scheduler
      now?: () => number
      /** Tests and local development. Never in production. */
      allowPrivate?: boolean
    },
  ) {
    this.off = o.events.subscribe((e) => this.onEvent(e))
  }

  private get now() {
    return this.o.now ?? Date.now
  }

  private get scheduler() {
    return this.o.scheduler ?? realScheduler
  }

  get allowPrivate() {
    return this.o.allowPrivate ?? false
  }

  dispose() {
    this.off?.()
    for (const c of this.cancel.values()) c()
  }

  // ----- endpoints ---------------------------------------------------------

  list(repo: string) {
    return [...(this.byRepo.get(repo) ?? [])].map((id) => this.hooks.get(id)!).sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string) {
    return this.hooks.get(id) ?? null
  }

  create(repo: string, repoId: string, input: { url: string; events: Array<string>; description?: string }) {
    const t = this.now()
    const secret = newSecret()
    const hook: Hook = {
      id: newId('webhook', t),
      repo,
      repoId,
      url: input.url,
      description: input.description ?? '',
      events: input.events,
      active: true,
      disabledReason: null,
      secrets: [{ value: secret, createdAt: t, expiresAt: null }],
      failures: 0,
      createdAt: t,
      updatedAt: t,
      version: 1,
      deliveries: [],
      lastDelivery: null,
    }
    this.hooks.set(hook.id, hook)
    const set = this.byRepo.get(repo) ?? new Set()
    set.add(hook.id)
    this.byRepo.set(repo, set)
    return { hook, secret }
  }

  update(hook: Hook, patch: { url?: string; events?: Array<string>; description?: string; active?: boolean }) {
    if (patch.url !== undefined) hook.url = patch.url
    if (patch.events !== undefined) hook.events = patch.events
    if (patch.description !== undefined) hook.description = patch.description
    if (patch.active !== undefined) {
      hook.active = patch.active
      // Turning it back on clears the reason it was turned off.
      if (patch.active) {
        hook.disabledReason = null
        hook.failures = 0
      }
    }
    hook.updatedAt = this.now()
    hook.version++
  }

  /** A renamed repository keeps its webhooks. */
  rename(from: string, to: string) {
    const ids = this.byRepo.get(from)
    if (!ids) return
    this.byRepo.delete(from)
    this.byRepo.set(to, ids)
    for (const id of ids) {
      const h = this.hooks.get(id)
      if (h) h.repo = to
    }
  }

  /** A deleted repository takes its webhooks with it. */
  dropRepo(repo: string) {
    for (const id of [...(this.byRepo.get(repo) ?? [])]) {
      const h = this.hooks.get(id)
      if (h) this.remove(h)
    }
    this.byRepo.delete(repo)
  }

  remove(hook: Hook) {
    this.hooks.delete(hook.id)
    this.byRepo.get(hook.repo)?.delete(hook.id)
    for (const d of hook.deliveries) {
      this.deliveries.delete(d.id)
      this.cancel.get(d.id)?.()
      this.cancel.delete(d.id)
    }
  }

  /** A new secret signs from now on; the old one keeps signing for a day so receivers can switch. */
  rotate(hook: Hook) {
    const t = this.now()
    for (const s of hook.secrets) s.expiresAt ??= t + SECRET_OVERLAP_MS
    const secret = newSecret()
    hook.secrets.push({ value: secret, createdAt: t, expiresAt: null })
    hook.secrets = hook.secrets.filter((s) => s.expiresAt === null || s.expiresAt > t)
    hook.updatedAt = t
    hook.version++
    return secret
  }

  getDelivery(id: string) {
    return this.deliveries.get(id) ?? null
  }

  // ----- delivering --------------------------------------------------------

  private onEvent(e: EventRecord) {
    if (!e.repo || !e.repo_id) return
    const ids = this.byRepo.get(e.repo)
    if (!ids) return
    for (const id of ids) {
      const hook = this.hooks.get(id)
      if (hook?.active && hook.repoId === e.repo_id && matchesType(hook.events, e.type)) this.enqueue(hook, e, null)
    }
  }

  enqueue(hook: Hook, event: EventRecord, redeliveryOf: string | null): Delivery {
    const d: Delivery = {
      id: newId('delivery', this.now()),
      hookId: hook.id,
      event,
      state: 'pending',
      attempts: [],
      nextAt: this.now(),
      redeliveryOf,
      createdAt: this.now(),
    }
    hook.deliveries.unshift(d)
    if (hook.deliveries.length > MAX_DELIVERIES_PER_HOOK)
      for (const old of hook.deliveries.splice(MAX_DELIVERIES_PER_HOOK)) {
        this.deliveries.delete(old.id)
        // Stop a retry that would otherwise outlive the delivery it belongs to.
        this.cancel.get(old.id)?.()
        this.cancel.delete(old.id)
        old.state = 'failed'
        old.nextAt = null
      }
    hook.lastDelivery = d.id
    this.deliveries.set(d.id, d)
    queueMicrotask(() => void this.attempt(hook, d))
    return d
  }

  ping(hook: Hook): Delivery {
    const t = this.now()
    const event: EventRecord = {
      object: 'event',
      id: newId('event', t),
      sequence: 0,
      type: 'webhook.ping',
      created_at: new Date(t).toISOString(),
      repo: hook.repo,
      repo_id: hook.repoId,
      actor: { object: 'actor', id: 'acc_webhooks000000000', handle: 'webhooks', class: 'bot' },
      subject: { object: 'webhook', id: hook.id, number: null },
      changes: [],
      data: null,
    }
    return this.enqueue(hook, event, null)
  }

  redeliver(hook: Hook, d: Delivery) {
    return this.enqueue(hook, d.event, d.id)
  }

  /** Re-send every matching event after a sequence, for a receiver that was down. */
  replay(hook: Hook, after: number, limit: number) {
    const { events, scannedTo } = this.o.events.since(after, limit, (e) => e.repoId === hook.repoId && matchesType(hook.events, e.type))
    for (const e of events) this.enqueue(hook, parseEvent(e), null)
    // Report how far the scan got, so a page with no matching events still
    // advances the caller instead of replaying the same window forever.
    return { count: events.length, last: scannedTo }
  }

  private async slot() {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight++
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.inFlight++
  }

  private release() {
    this.inFlight--
    this.queue.shift()?.()
  }

  private async attempt(hook: Hook, d: Delivery) {
    this.cancel.delete(d.id)
    if (!this.hooks.has(hook.id)) return
    // An evicted delivery must not keep sending or count failures.
    if (this.deliveries.get(d.id) !== d) return
    if (!hook.active && d.event.type !== 'webhook.ping') {
      d.state = 'failed'
      d.nextAt = null
      d.attempts.push({ number: d.attempts.length + 1, at: this.now(), status: null, error: 'The endpoint is disabled.', ms: 0 })
      return
    }
    const t = this.now()
    const body = JSON.stringify(d.event)
    const ts = Math.floor(t / 1000)
    const live = hook.secrets.filter((s) => s.expiresAt === null || s.expiresAt > t)
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'source.code-webhooks/1',
      'webhook-id': d.event.id,
      'webhook-timestamp': String(ts),
      'webhook-signature': live.map((s) => sign(s.value, d.event.id, ts, body)).join(' '),
      'sx-delivery': d.id,
      'sx-event': d.event.type,
    }
    await this.slot()
    // The delivery may have been evicted, or the endpoint deleted, while it
    // waited for a slot.
    if (!this.hooks.has(hook.id) || this.deliveries.get(d.id) !== d) {
      this.release()
      return
    }
    const sentAt = performance.now()
    let result: SendResult
    try {
      result = await this.o.transport.send({ url: hook.url, headers, body, timeoutMs: TIMEOUT_MS })
    } catch (e) {
      // A transport that rejects is a failed attempt, not a delivery that
      // stays pending forever and not an unhandled rejection.
      result = {
        status: null,
        error: e instanceof Error ? e.message.slice(0, 200) : 'The send failed.',
        ms: Math.round(performance.now() - sentAt),
      }
    } finally {
      this.release()
    }
    // Evicted during the send: do not count the result on a record no one keeps.
    if (this.deliveries.get(d.id) !== d) return
    const attempt: Attempt = { number: d.attempts.length + 1, at: t, status: result.status, error: result.error, ms: result.ms }
    d.attempts.push(attempt)
    if (result.status !== null && result.status >= 200 && result.status < 300) {
      d.state = 'succeeded'
      d.nextAt = null
      hook.failures = 0
      return
    }
    // 410 Gone is the receiver saying it no longer wants these.
    if (result.status === 410) return this.fail(hook, d, 'The endpoint answered 410 Gone.')
    if (d.attempts.length >= MAX_ATTEMPTS) return this.fail(hook, d, null)
    const delay = RETRY_DELAYS_MS[d.attempts.length - 1]
    d.nextAt = this.now() + delay
    this.cancel.set(d.id, this.scheduler.after(delay, () => void this.attempt(hook, d)))
  }

  private fail(hook: Hook, d: Delivery, reason: string | null) {
    d.state = 'failed'
    d.nextAt = null
    if (d.event.type === 'webhook.ping') return
    hook.failures++
    if (reason || hook.failures >= DISABLE_AFTER) {
      hook.active = false
      hook.disabledReason = reason ?? `${DISABLE_AFTER} deliveries in a row failed.`
      hook.updatedAt = this.now()
      hook.version++
      this.o.events.append({
        type: 'webhook.disabled',
        repo: hook.repo,
        repo_id: hook.repoId,
        actor: { object: 'actor', id: 'acc_webhooks000000000', handle: 'webhooks', class: 'bot' },
        subject: { object: 'webhook', id: hook.id, number: null },
        changes: ['active'],
        data: null,
      })
    }
  }

  /** For tests: wait until nothing is being sent. */
  async idle() {
    for (let i = 0; i < 50 && (this.inFlight > 0 || this.queue.length > 0); i++) await new Promise((r) => setTimeout(r, 2))
    await new Promise((r) => setTimeout(r, 2))
  }
}
