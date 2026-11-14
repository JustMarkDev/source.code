/**
 * What our API looks like to a client that is not on the same machine.
 *
 *   bun scripts/api-network.ts [--n 60] [--backend-ms 15] [--rtt 0,5,30,90,180] [--out docs/bench/network.json]
 *
 * The in-memory benchmark (api-bench.ts) shows the cost of our own code. This
 * puts the same server behind a TCP proxy that delays every chunk by half a
 * round trip each way, then times one client doing one request after another,
 * the way a person, a CLI or an agent does. Two things here are models, not
 * measurements, and the output says so:
 *
 *  1. Distance. The proxy adds `rtt` milliseconds per request on a kept-alive
 *     connection. A new connection also pays a TCP and a TLS round trip before
 *     the first byte, which is computed (2 x rtt), and not the CPU cost of TLS.
 *  2. The database. Today everything is in memory. In the hosted service a
 *     request that misses our caches asks Convex. `--backend-ms` is what we
 *     assume one such round trip costs; a read that is served from the body
 *     cache or answered with a 304 pays none, because it never leaves the node.
 *     Writes pay two (read, then commit), lists and searches one.
 */
import { writeFileSync } from 'node:fs'
import { sampleTokens } from '@source-code/api/sample'
import { HUGE, buildWorld } from './bench/world'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const N = Number(arg('n', '60'))
const BACKEND = Number(arg('backend-ms', '15'))
const RTTS = arg('rtt', '0,5,30,90,180').split(',').map(Number)
const OUT = arg('out', '')

const SERVER = 4021
const PROXY = 4022

const api = buildWorld(SERVER, { allowPrivateWebhooks: false })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The server, with the modelled database latency applied after our real work.
Bun.serve({
  port: SERVER,
  idleTimeout: 120,
  async fetch(req) {
    const res = await api.fetch(req)
    const hops = Number(req.headers.get('x-sim-backend-hops') ?? 0)
    if (hops > 0 && BACKEND > 0) await sleep(hops * BACKEND)
    return res
  },
})

/** A TCP relay that holds every chunk for `delay` ms in each direction. */
let delay = 0
Bun.listen<{
  up: Awaited<ReturnType<typeof Bun.connect>> | null
  queue: Array<Uint8Array>
}>({
  hostname: '127.0.0.1',
  port: PROXY,
  socket: {
    async open(client) {
      client.data = { up: null, queue: [] }
      const up = await Bun.connect({
        hostname: '127.0.0.1',
        port: SERVER,
        socket: {
          data(_s, chunk) {
            const copy = new Uint8Array(chunk)
            if (delay === 0) client.write(copy)
            else setTimeout(() => client.write(copy), delay / 2)
          },
          close() {
            client.end()
          },
        },
      })
      client.data.up = up
      for (const q of client.data.queue) up.write(q)
      client.data.queue = []
    },
    data(client, chunk) {
      const copy = new Uint8Array(chunk)
      const send = () =>
        client.data.up
          ? client.data.up.write(copy)
          : client.data.queue.push(copy)
      if (delay === 0) send()
      else setTimeout(send, delay / 2)
    },
    close(client) {
      client.data.up?.end()
    },
  },
})

const base = `http://127.0.0.1:${PROXY}/v1`
const auth = {
  authorization: `Bearer ${sampleTokens.dana}`,
  'content-type': 'application/json',
}

type Scenario = {
  name: string
  hops: number
  /** Why this many hops. */
  why: string
  request: (i: number) => { url: string; init: RequestInit }
  prepare?: () => Promise<Record<string, string>>
}

const scenarios: Array<Scenario> = [
  {
    name: 'One change, from the body cache',
    hops: 0,
    why: 'served from the node',
    request: () => ({
      url: `${base}/repos/dana/gitfs/changes/216`,
      init: { headers: auth },
    }),
  },
  {
    name: 'One change, If-None-Match (304)',
    hops: 0,
    why: 'answered from the node',
    prepare: async () => {
      const res = await fetch(`${base}/repos/dana/gitfs/changes/216`, {
        headers: auth,
      })
      await res.arrayBuffer()
      return { 'if-none-match': res.headers.get('etag') ?? '' }
    },
    request: () => ({
      url: `${base}/repos/dana/gitfs/changes/216`,
      init: { headers: auth },
    }),
  },
  {
    name: 'One change, not cached',
    hops: 1,
    why: 'one database read',
    request: (i) => ({
      url: `${base}/repos/${HUGE}/changes/${1 + ((i * 7919) % 10000)}`,
      init: { headers: auth },
    }),
  },
  {
    name: 'List of 50 changes',
    hops: 1,
    why: 'one query for the page',
    request: () => ({
      url: `${base}/repos/${HUGE}/changes?state=all&limit=50`,
      init: { headers: auth },
    }),
  },
  {
    name: 'Search, 50 results',
    hops: 1,
    why: 'one query',
    request: () => ({
      url: `${base}/search?q=change&limit=50`,
      init: { headers: auth },
    }),
  },
  {
    name: 'POST an issue',
    hops: 2,
    why: 'read, then commit',
    request: (i) => ({
      url: `${base}/repos/${HUGE}/issues`,
      init: {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: `Net ${i} ${Math.random()}` }),
      },
    }),
  },
  {
    name: 'Agent start-up: context',
    hops: 1,
    why: 'one query for the bundle',
    request: () => ({
      url: `${base}/repos/dana/gitfs/context`,
      init: { headers: auth },
    }),
  },
]

const pct = (s: Array<number>, p: number) =>
  s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]

type Cell = {
  rtt: number
  p50: number
  p95: number
  p99: number
  cold50: number
}
const table: Record<string, Array<Cell>> = {}

for (const rtt of RTTS) {
  delay = rtt
  // Fewer samples when each takes long, so the whole run stays a few minutes.
  const n = rtt >= 90 ? Math.min(N, 40) : N
  for (const s of scenarios) {
    const extra = (await s.prepare?.()) ?? {}
    const times: Array<number> = []
    for (let i = 0; i < n + 3; i++) {
      const { url, init } = s.request(i)
      const headers = {
        ...(init.headers as Record<string, string>),
        ...extra,
        'x-sim-backend-hops': String(s.hops),
      }
      const t0 = performance.now()
      const res = await fetch(url, { ...init, headers })
      await res.arrayBuffer()
      if (i >= 3) times.push(performance.now() - t0)
    }
    const sorted = [...times].sort((a, b) => a - b)
    const cell = {
      rtt,
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      p99: pct(sorted, 99),
      cold50: pct(sorted, 50) + 2 * rtt,
    }
    ;(table[s.name] ??= []).push(cell)
    console.error(
      `rtt ${String(rtt).padStart(3)} ms  ${s.name.padEnd(34)} p50 ${cell.p50.toFixed(1)}  p99 ${cell.p99.toFixed(1)}`,
    )
  }
}

const head = [
  '| Request | Hops | ' +
    RTTS.map((r) => (r === 0 ? 'same machine' : `RTT ${r} ms`)).join(' | ') +
    ' |',
  '| --- | ---: | ' + RTTS.map(() => '---:').join(' | ') + ' |',
]
const rows = scenarios.map(
  (s) =>
    `| ${s.name} | ${s.hops} | ${table[s.name].map((c) => `${c.p50.toFixed(0)} / ${c.p99.toFixed(0)}`).join(' | ')} |`,
)
const cold = scenarios.map(
  (s) =>
    `| ${s.name} | ${table[s.name].map((c) => c.cold50.toFixed(0)).join(' | ')} |`,
)
console.log(
  `**p50 / p99 ms, kept-alive connection, backend ${BACKEND} ms per hop**\n`,
)
console.log([...head, ...rows].join('\n'))
console.log(
  `\n**p50 ms on a new connection (kept-alive p50 plus TCP and TLS round trips)**\n`,
)
console.log(
  [
    '| Request | ' +
      RTTS.map((r) => (r === 0 ? 'same machine' : `RTT ${r} ms`)).join(' | ') +
      ' |',
    '| --- | ' + RTTS.map(() => '---:').join(' | ') + ' |',
    ...cold,
  ].join('\n'),
)
if (OUT)
  writeFileSync(
    OUT,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), n: N, backendMs: BACKEND, rtts: RTTS, table }, null, 2)}\n`,
  )
process.exit(0)
