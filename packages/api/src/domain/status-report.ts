import type { HealthArea, HealthReader } from '../health'

/** A wait in the unit a person reads it in: minutes, hours or days. */
const span = (ms: number) => {
  const m = Math.round(ms / 60_000)
  if (m < 120) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hours`
  return `${Math.round(h / 24)} days`
}

/**
 * The status page: each area as this server measured it, mirrors and
 * runners as the domain holds them, and the days something actually
 * failed. Shared by both domains, which only gather the facts.
 */
export function statusReport(o: {
  now: number
  health: HealthReader | undefined
  mirrors: Array<{
    repo: string
    host: string
    state: string
    paused?: boolean
  }>
  waiting: number
  oldest: number | null
  counts: {
    accounts: number
    repositories: number
    changes: number
    issues: number
  }
}) {
  const { now, health: h } = o
  type State = 'up' | 'degraded' | 'down'
  const services: Array<{
    id: string
    name: string
    note: string
    state: State
    detail: string | null
    uptime: number | null
    requests: number
    errors: number
    p50_ms: number | null
    p95_ms: number | null
    days: Array<{ date: string; requests: number; errors: number }>
  }> = []
  const incidents: Array<{
    service: string
    date: string
    title: string
    state: 'open' | 'resolved'
    detail: string
  }> = []
  const measured: Array<[HealthArea, string, string]> = [
    ['api', 'API', 'REST, MCP and the web app'],
    ['git', 'Git data', 'Files, history and diffs'],
    ['signin', 'Sign-in for apps', 'OAuth and tokens'],
    ['webhooks', 'Webhooks', 'Deliveries to your endpoints'],
    ['uploads', 'Uploads', 'Images, recordings and release files'],
  ]
  for (const [area, name, note] of measured) {
    const r = h?.report(area)
    const p95 = r?.last_hour.p95_ms ?? null
    const state: State = !r
      ? 'up'
      : r.recent_error_rate > 0.5
        ? 'down'
        : r.recent_error_rate > 0.05 || (p95 !== null && p95 > 2_000)
          ? 'degraded'
          : 'up'
    services.push({
      id: area,
      name,
      note,
      state,
      detail:
        state === 'down'
          ? 'Most requests in the last five minutes failed.'
          : state === 'degraded'
            ? r && r.recent_error_rate > 0.05
              ? `${Math.round(r.recent_error_rate * 100)}% of requests in the last five minutes failed.`
              : `Slow: the slowest 5% took over ${p95} ms.`
            : null,
      uptime: r?.uptime ?? null,
      requests: r?.requests ?? 0,
      errors: r?.errors ?? 0,
      p50_ms: r?.last_hour.p50_ms ?? null,
      p95_ms: p95,
      days: r?.days ?? [],
    })
    for (const d of r?.days ?? [])
      if (d.requests >= 20 && d.errors / d.requests > 0.05)
        incidents.push({
          service: name,
          date: d.date,
          title: `${name} failed ${Math.round((d.errors / d.requests) * 100)}% of requests`,
          state:
            d.date === new Date(now).toISOString().slice(0, 10) &&
            state !== 'up'
              ? 'open'
              : 'resolved',
          detail: `${d.errors} of ${d.requests} requests failed on our side that day.`,
        })
  }
  // Mirrors: their own state, kept with each repository.
  const failing: Array<string> = []
  let mirrors = 0
  for (const m of o.mirrors) {
    mirrors++
    if (m.state === 'failing' && !m.paused)
      failing.push(`${m.repo} to ${m.host}`)
  }
  services.push({
    id: 'mirrors',
    name: 'Mirror sync',
    note: 'Copies on other hosts',
    state: failing.length ? 'degraded' : 'up',
    detail: failing.length
      ? `${failing.length} of ${mirrors} mirrors are failing: ${failing.slice(0, 3).join(', ')}${failing.length > 3 ? '…' : ''}.`
      : null,
    uptime: null,
    requests: 0,
    errors: 0,
    p50_ms: null,
    p95_ms: null,
    days: [],
  })
  if (failing.length)
    incidents.push({
      service: 'Mirror sync',
      date: new Date(now).toISOString().slice(0, 10),
      title: `${failing.length} mirror${failing.length === 1 ? ' is' : 's are'} failing`,
      state: 'open',
      detail:
        'Nothing is lost: everything is kept here first, and a mirror catches up when it syncs again.',
    })
  // Runners: how long the oldest queued job has waited.
  const waiting = o.waiting
  const oldest = o.oldest ?? Infinity
  const waited = waiting ? now - oldest : 0
  services.push({
    id: 'runners',
    name: 'Pipelines',
    note: 'Jobs waiting for a runner',
    state: waited > 30 * 60_000 ? 'degraded' : 'up',
    detail: waiting
      ? `${waiting} job${waiting === 1 ? '' : 's'} waiting; the oldest for ${span(waited)}.`
      : null,
    uptime: null,
    requests: 0,
    errors: 0,
    p50_ms: null,
    p95_ms: null,
    days: [],
  })
  const worst: State = services.some((s) => s.state === 'down')
    ? 'down'
    : services.some((s) => s.state === 'degraded')
      ? 'degraded'
      : 'up'
  return {
    object: 'status' as const,
    state: worst,
    since: new Date(h?.since ?? now).toISOString(),
    services,
    incidents: incidents
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20),
    counts: o.counts,
  }
}
