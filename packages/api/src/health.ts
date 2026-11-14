/**
 * What the API measures about itself, for the status page: every request it
 * answers, by area, with how long it took and whether it failed on our side.
 *
 * Kept small on purpose. Days hold two counters each, for 90 days. The last
 * hour keeps up to 2,000 durations per area, enough for a median and a 95th
 * percentile without holding every request.
 */
export const healthAreas = [
  'api',
  'git',
  'signin',
  'webhooks',
  'uploads',
] as const
export type HealthArea = (typeof healthAreas)[number]

const DAY = 86_400_000
const HOUR = 3_600_000
const KEEP_DAYS = 90
const KEEP_SAMPLES = 2_000

type Day = { requests: number; errors: number }
type Sample = { at: number; ms: number; error: boolean }

/**
 * Upper bounds, in milliseconds, of the latency buckets servers share. The
 * last bucket is everything slower. A percentile from shared buckets is the
 * bound of the bucket it falls in.
 */
export const LATENCY_BOUNDS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const

const bucketOf = (ms: number) => {
  const i = LATENCY_BOUNDS.findIndex((b) => ms <= b)
  return i === -1 ? LATENCY_BOUNDS.length : i
}

/** One area's requests in one minute, as a server hands them to the shared store. */
export type MinuteBucket = {
  area: HealthArea
  /** Minutes since the epoch. */
  minute: number
  requests: number
  errors: number
  /** Counts per latency bucket, `LATENCY_BOUNDS.length + 1` of them. */
  hist: Array<number>
}

export type AreaReport = ReturnType<Health['report']>

/** What the status page reads: one report per area. */
export interface HealthReader {
  report: (area: HealthArea) => AreaReport
  /** When measuring began. */
  since: number
}

/**
 * A report from the buckets every server shared: days with their two counts,
 * and the last hour's minutes with their latency buckets.
 */
export function reportFrom(
  now: number,
  days: ReadonlyArray<{ day: number; requests: number; errors: number }>,
  minutes: ReadonlyArray<Omit<MinuteBucket, 'area'>>,
): AreaReport {
  const today = Math.floor(now / DAY)
  const byDay = new Map(days.map((d) => [d.day, d]))
  const series = Array.from({ length: KEEP_DAYS }, (_, i) => {
    const k = today - (KEEP_DAYS - 1) + i
    const d = byDay.get(k)
    return {
      date: new Date(k * DAY).toISOString().slice(0, 10),
      requests: d?.requests ?? 0,
      errors: d?.errors ?? 0,
    }
  })
  const total = series.reduce((n, d) => n + d.requests, 0)
  const failed = series.reduce((n, d) => n + d.errors, 0)
  const minute = Math.floor(now / 60_000)
  const hour = minutes.filter((m) => m.minute > minute - 60)
  const hist = Array.from({ length: LATENCY_BOUNDS.length + 1 }, () => 0)
  for (const m of hour) m.hist.forEach((n, i) => (hist[i] += n))
  const counted = hist.reduce((a, b) => a + b, 0)
  const pct = (p: number) => {
    if (!counted) return null
    let seen = 0
    for (let i = 0; i < hist.length; i++) {
      seen += hist[i]
      if (seen > p * counted)
        return LATENCY_BOUNDS[Math.min(i, LATENCY_BOUNDS.length - 1)]
    }
    return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1]
  }
  const lastFive = hour.filter((m) => m.minute > minute - 5)
  const fiveRequests = lastFive.reduce((n, m) => n + m.requests, 0)
  const fiveErrors = lastFive.reduce((n, m) => n + m.errors, 0)
  return {
    requests: total,
    errors: failed,
    uptime: total
      ? Math.round(((total - failed) / total) * 10_000) / 100
      : null,
    last_hour: {
      requests: hour.reduce((n, m) => n + m.requests, 0),
      p50_ms: pct(0.5),
      p95_ms: pct(0.95),
    },
    recent_error_rate: fiveRequests ? fiveErrors / fiveRequests : 0,
    days: series,
  }
}

/** Which area a request belongs to, from its path under the mount. */
export function areaOf(path: string): HealthArea {
  if (path.includes('/oauth/') || path.endsWith('/auth/principal'))
    return 'signin'
  if (path.includes('/git/')) return 'git'
  if (path.includes('/webhooks')) return 'webhooks'
  if (path.includes('/uploads') || path.includes('/evidence')) return 'uploads'
  return 'api'
}

export class Health {
  /** When this process started measuring. */
  readonly since: number
  private readonly days = new Map<HealthArea, Map<number, Day>>()
  private readonly recent = new Map<HealthArea, Array<Sample>>()
  /** Buckets not yet handed to the shared store, by area and minute. */
  private pending = new Map<string, MinuteBucket>()

  constructor(private readonly now: () => number = Date.now) {
    this.since = now()
  }

  record(area: HealthArea, ms: number, status: number) {
    const at = this.now()
    const error = status >= 500
    const day = Math.floor(at / DAY)
    let days = this.days.get(area)
    if (!days) this.days.set(area, (days = new Map()))
    const d = days.get(day) ?? { requests: 0, errors: 0 }
    d.requests++
    if (error) d.errors++
    days.set(day, d)
    for (const k of days.keys()) if (k <= day - KEEP_DAYS) days.delete(k)
    let list = this.recent.get(area)
    if (!list) this.recent.set(area, (list = []))
    list.push({ at, ms, error })
    if (list.length > KEEP_SAMPLES) list.splice(0, list.length - KEEP_SAMPLES)
    const minute = Math.floor(at / 60_000)
    const k = `${area}:${minute}`
    let b = this.pending.get(k)
    if (!b) {
      // A store that stays unreachable must not fill memory: keep two hours.
      if (this.pending.size >= healthAreas.length * 120)
        this.pending.delete(this.pending.keys().next().value!)
      b = {
        area,
        minute,
        requests: 0,
        errors: 0,
        hist: Array.from({ length: LATENCY_BOUNDS.length + 1 }, () => 0),
      }
      this.pending.set(k, b)
    }
    b.requests++
    if (error) b.errors++
    b.hist[bucketOf(ms)]++
  }

  /** The buckets since the last call, for the shared store. */
  drain(): Array<MinuteBucket> {
    const out = [...this.pending.values()]
    this.pending = new Map()
    return out
  }

  /** Puts back buckets the store did not take, to send with the next ones. */
  restore(buckets: ReadonlyArray<MinuteBucket>) {
    for (const b of buckets) {
      const k = `${b.area}:${b.minute}`
      const have = this.pending.get(k)
      if (!have) this.pending.set(k, b)
      else {
        have.requests += b.requests
        have.errors += b.errors
        b.hist.forEach((n, i) => (have.hist[i] += n))
      }
    }
  }

  /** One area, as the status page shows it. */
  report(area: HealthArea) {
    const at = this.now()
    const today = Math.floor(at / DAY)
    const days = this.days.get(area) ?? new Map<number, Day>()
    const series = Array.from({ length: KEEP_DAYS }, (_, i) => {
      const k = today - (KEEP_DAYS - 1) + i
      const d = days.get(k)
      return {
        date: new Date(k * DAY).toISOString().slice(0, 10),
        requests: d?.requests ?? 0,
        errors: d?.errors ?? 0,
      }
    })
    const total = series.reduce((n, d) => n + d.requests, 0)
    const failed = series.reduce((n, d) => n + d.errors, 0)
    const hour = (this.recent.get(area) ?? []).filter((s) => s.at > at - HOUR)
    const sorted = hour.map((s) => s.ms).sort((a, b) => a - b)
    const pct = (p: number) =>
      sorted.length
        ? Math.round(
            sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))],
          )
        : null
    const lastFive = hour.filter((s) => s.at > at - 5 * 60_000)
    const recentErrors = lastFive.filter((s) => s.error).length
    return {
      requests: total,
      errors: failed,
      uptime: total
        ? Math.round(((total - failed) / total) * 10_000) / 100
        : null,
      last_hour: { requests: hour.length, p50_ms: pct(0.5), p95_ms: pct(0.95) },
      recent_error_rate: lastFive.length ? recentErrors / lastFive.length : 0,
      days: series,
    }
  }
}
