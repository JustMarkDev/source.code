/**
 * Load test for the API over real HTTP.
 *
 * The server runs in its own process (Bun's HTTP server in front of the same
 * `fetch` handler the app mounts). Load comes from several other processes, so
 * the generator is not the thing being measured. It reports how busy the
 * server's CPU was: near 100% means the server was the limit, much lower means
 * the clients were. It does not include TanStack Start, a real database or the
 * git store.
 *
 *   bun scripts/api-bench.ts                          all scenarios
 *   bun scripts/api-bench.ts --only change-hot,list-50
 *   bun scripts/api-bench.ts --out before.json
 *   bun scripts/api-bench.ts --compare before.json    show the difference
 *   bun scripts/api-bench.ts --quick                  2 s each
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { sampleTokens } from '../src/lib/api/sample'
import { Histogram } from './bench/histogram'
import { byId, scenarios } from './bench/scenarios'
import { buildWorld } from './bench/world'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const PORT = Number(arg('port', '4010'))
const BASE = `http://127.0.0.1:${PORT}/v1`

// ---------------------------------------------------------------------------
// Mode 1: the server.

if (flag('serve')) {
  const api = buildWorld(PORT, { allowPrivateWebhooks: flag('allow-private') })
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    idleTimeout: 120,
    fetch(req) {
      if (new URL(req.url).pathname === '/__stats') {
        const c = process.cpuUsage()
        const m = process.memoryUsage()
        return Response.json({
          cpu: (c.user + c.system) / 1e6,
          rss: m.rss,
          heap: m.heapUsed,
        })
      }
      return api.fetch(req)
    },
  })
  // A clean stop writes the CPU profile when one was asked for.
  process.on('SIGTERM', () => process.exit(0))
  console.log('ready')
}

// ---------------------------------------------------------------------------
// Mode 2: a load-generating client.
else if (flag('client')) {
  const spec = JSON.parse(arg('client', '{}')) as {
    scenario: string
    seconds: number
    warmup: number
    connections: number
    offset: number
    setup: Record<string, string>
  }
  const sc = byId.get(spec.scenario)!
  const ctx = { base: BASE, setup: spec.setup }
  const hist = new Histogram()
  let errors = 0
  let counter = spec.offset
  const loop = async (until: number, record: boolean) => {
    while (performance.now() < until) {
      const i = counter++
      const t = performance.now()
      try {
        const status = await sc.exec(i, ctx)
        if (status >= 400) errors++
      } catch {
        errors++
      }
      if (record) hist.add(performance.now() - t)
    }
  }
  await Promise.all(
    Array.from({ length: spec.connections }, () =>
      loop(performance.now() + spec.warmup * 1000, false),
    ),
  )
  errors = 0
  const t0 = performance.now()
  await Promise.all(
    Array.from({ length: spec.connections }, () =>
      loop(t0 + spec.seconds * 1000, true),
    ),
  )
  console.log(
    JSON.stringify({ hist, errors, elapsed: (performance.now() - t0) / 1000 }),
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Mode 2b: a fan-out listener. Holds `count` connections and reports when the event reaches each.
// Several of these run side by side, because one process holds at most 256 connections.
else if (flag('fan')) {
  const kind = arg('fan', 'sse')
  const count = Number(arg('count', '250'))
  const dana = { authorization: `Bearer ${sampleTokens.dana}` }
  const etag = arg('etag', '')
  let ready = 0
  let done = 0
  const bump = () => {
    if (++done === count) {
      console.log(`done ${Date.now()}`)
      process.exit(0)
    }
  }
  for (let i = 0; i < count; i++) {
    void (async () => {
      // Open connections in small groups: a burst of hundreds overflows the listen backlog.
      await new Promise((r) => setTimeout(r, Math.floor(i / 20) * 8))
      if (kind === 'poll') {
        ready++
        if (ready === count) console.log('ready')
        const r = await fetch(`${BASE}/repos/dana/gitfs/changes/216?wait=30`, {
          headers: { ...dana, 'if-none-match': etag },
        })
        await r.arrayBuffer()
        bump()
        return
      }
      const res = await fetch(`${BASE}/events/stream?repo=dana/huge`, {
        headers: dana,
      })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let first = true
      let seen = ''
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) return
        seen += dec.decode(value)
        if (first) {
          first = false
          if (++ready === count) console.log('ready')
        }
        if (seen.includes('event: issue.created')) {
          bump()
          return
        }
      }
    })()
  }
}

// ---------------------------------------------------------------------------
// Mode 3: the conductor.
else {
  type Row = {
    id: string
    title: string
    group: string
    rps: number
    p50: number
    p95: number
    p99: number
    p999: number
    max: number
    errors: number
    cpuPct: number
    usPerReq: number
  }
  type Results = {
    machine: string
    bun: string
    when: string
    seconds: number
    clients: number
    connections: number
    rows: Array<Row>
    extras: Record<string, unknown>
    rssMB: number
  }

  const seconds = Number(arg('seconds', flag('quick') ? '2' : '5'))
  const clients = Number(arg('clients', '3'))
  const connections = Number(arg('connections', '32'))
  const only = arg('only', '').split(',').filter(Boolean)
  const out = arg('out', '')
  const compare = arg('compare', '')
  const dana = { authorization: `Bearer ${sampleTokens.dana}` }
  const json = { ...dana, 'content-type': 'application/json' }

  const server = spawn(
    'bun',
    [import.meta.path, '--serve', '--port', String(PORT), '--allow-private'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  await new Promise<void>((resolve) =>
    server.stdout.on('data', (d) => String(d).includes('ready') && resolve()),
  )
  const stats = async () =>
    (await (await fetch(`http://127.0.0.1:${PORT}/__stats`)).json()) as {
      cpu: number
      rss: number
      heap: number
    }

  async function measure(
    id: string,
    opts: { clients?: number; connections?: number; seconds?: number } = {},
  ): Promise<Row> {
    const sc = byId.get(id)!
    const setup = (await sc.prepare?.(BASE)) ?? {}
    const nClients = opts.clients ?? clients
    const nConn = opts.connections ?? sc.connections ?? connections
    const secs = opts.seconds ?? seconds
    const s0 = await stats()
    const procs = Array.from({ length: nClients }, (_, k) => {
      const p = spawn(
        'bun',
        [
          import.meta.path,
          '--port',
          String(PORT),
          '--client',
          JSON.stringify({
            scenario: id,
            seconds: secs,
            warmup: 1,
            connections: nConn,
            offset: k * 10_000_000,
            setup,
          }),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      )
      return new Promise<{ hist: Histogram; errors: number; elapsed: number }>(
        (resolve) => {
          let buf = ''
          p.stdout.on('data', (d) => (buf += d))
          p.on('close', () => resolve(JSON.parse(buf)))
        },
      )
    })
    const results = await Promise.all(procs)
    const s1 = await stats()
    const h = new Histogram()
    let errors = 0
    let elapsed = 0
    for (const r of results) {
      h.merge(r.hist)
      errors += r.errors
      elapsed = Math.max(elapsed, r.elapsed)
    }
    // The server also served the clients' warm-up second; CPU is compared against the whole window.
    const window = secs + 1
    return {
      id,
      title: sc.title,
      group: sc.group,
      rps: h.total / elapsed,
      p50: h.at(0.5),
      p95: h.at(0.95),
      p99: h.at(0.99),
      p999: h.at(0.999),
      max: h.max,
      errors,
      cpuPct: ((s1.cpu - s0.cpu) / window) * 100,
      usPerReq:
        ((s1.cpu - s0.cpu) * 1e6) / Math.max(1, h.total + (h.total / secs) * 1),
    }
  }

  const rows: Array<Row> = []
  const extras: Record<string, unknown> = {}
  const picked = scenarios.filter(
    (s) => only.length === 0 || only.includes(s.id),
  )
  const fmt = (n: number, d = 2) => (n >= 100 ? n.toFixed(0) : n.toFixed(d))
  console.log(
    '| Scenario | req/s | p50 ms | p95 ms | p99 ms | p99.9 ms | server CPU | µs CPU/req | errors |',
  )
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const sc of picked) {
    const r = await measure(sc.id)
    rows.push(r)
    console.log(
      `| ${r.title} | ${r.rps.toFixed(0)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.p999)} | ${r.cpuPct.toFixed(0)}% | ${r.usPerReq.toFixed(0)} | ${r.errors} |`,
    )
  }

  // ----- special scenarios --------------------------------------------------
  const wantsExtra = (name: string) => only.length === 0 || only.includes(name)

  if (wantsExtra('sweep')) {
    console.log('\n**Saturation: one hot read, more and more connections**\n')
    console.log('| Connections | req/s | p50 ms | p99 ms | server CPU |')
    console.log('| ---: | ---: | ---: | ---: | ---: |')
    const sweep: Array<Row & { conns: number }> = []
    for (const total of [1, 8, 32, 128, 512, 2048]) {
      const nClients = total >= 128 ? 4 : 1
      const r = await measure('change-hot', {
        clients: nClients,
        connections: Math.ceil(total / nClients),
        seconds: Math.min(seconds, 3),
      })
      sweep.push({ ...r, conns: total })
      console.log(
        `| ${total} | ${r.rps.toFixed(0)} | ${fmt(r.p50)} | ${fmt(r.p99)} | ${r.cpuPct.toFixed(0)}% |`,
      )
    }
    extras.sweep = sweep
  }

  if (wantsExtra('fanout')) {
    console.log('\n**Fan-out: one write, many listeners**\n')
    const PER = 250
    const PROCS = 4
    /** Starts listener processes, waits until every connection is open, makes one write, times the last arrival. */
    const fan = async (
      kind: 'poll' | 'sse',
      write: () => Promise<unknown>,
      etag = '',
    ) => {
      const kids = Array.from({ length: PROCS }, () => {
        const p = spawn(
          'bun',
          [
            import.meta.path,
            '--port',
            String(PORT),
            '--fan',
            kind,
            '--count',
            String(PER),
            '--etag',
            etag,
          ],
          { stdio: ['ignore', 'pipe', 'inherit'] },
        )
        let buf = ''
        const ready = new Promise<void>((res) =>
          p.stdout.on('data', (d) => {
            buf += d
            if (buf.includes('ready')) res()
          }),
        )
        const finished = new Promise<number>((res) =>
          p.on('close', () => res(Number(/done (\d+)/.exec(buf)?.[1] ?? NaN))),
        )
        return { ready, finished, p }
      })
      await Promise.all(
        kids.map((k) =>
          Promise.race([k.ready, new Promise((r) => setTimeout(r, 20_000))]),
        ),
      )
      await new Promise((r) => setTimeout(r, 300))
      const t0 = Date.now()
      await write()
      const ends = await Promise.all(
        kids.map((k) =>
          Promise.race([
            k.finished,
            new Promise<number>((r) => setTimeout(() => r(NaN), 20_000)),
          ]),
        ),
      )
      for (const k of kids) k.p.kill()
      const ok = ends.filter((e) => !Number.isNaN(e))
      return {
        ms: ok.length === PROCS ? Math.max(...ok) - t0 : NaN,
        listeners: ok.length * PER,
      }
    }
    let etag = (
      await fetch(`${BASE}/repos/dana/gitfs/changes/216`, { headers: dana })
    ).headers.get('etag')!
    const lp: Array<number> = []
    for (let round = 0; round < 3; round++) {
      const r = await fan(
        'poll',
        () =>
          fetch(`${BASE}/repos/dana/gitfs/changes/216/reviews`, {
            method: 'POST',
            headers: {
              ...json,
              authorization: `Bearer ${sampleTokens.hollis}`,
            },
            body: JSON.stringify({ state: 'commented' }),
          }),
        etag,
      )
      lp.push(r.ms)
      etag = (
        await fetch(`${BASE}/repos/dana/gitfs/changes/216`, { headers: dana })
      ).headers.get('etag')!
    }
    const sse = await fan('sse', () =>
      fetch(`${BASE}/repos/dana/huge/issues`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: `Fan-out ${Date.now()}` }),
      }),
    )
    console.log(
      `- ${PER * PROCS} long-polling readers across ${PROCS} processes, all answered after one write: ${lp.map((x) => `${x.toFixed(0)} ms`).join(', ')} (three rounds)`,
    )
    console.log(
      `- ${PER * PROCS} open event streams (one write): the last of ${sse.listeners} listeners had it after **${sse.ms.toFixed(0)} ms**`,
    )
    extras.fanout = {
      longPollMs: lp,
      sseMs: sse.ms,
      sseListeners: sse.listeners,
      n: PER * PROCS,
    }
  }

  if (wantsExtra('webhooks')) {
    console.log('\n**Webhook delivery**\n')
    let received = 0
    const sink = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        await req.arrayBuffer()
        received++
        return new Response('ok')
      },
    })
    const hook = await (
      await fetch(`${BASE}/repos/dana/huge/webhooks`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          endpoint: `http://127.0.0.1:${sink.port}/h`,
          events: ['issue.created'],
        }),
      })
    ).json()
    const total = 3000
    const t0 = performance.now()
    let sent = 0
    const s0 = await stats()
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        while (sent < total) {
          const i = sent++
          const r = await fetch(`${BASE}/repos/dana/huge/issues`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ title: `Hooked ${i} ${Math.random()}` }),
          })
          await r.arrayBuffer()
        }
      }),
    )
    const writeMs = performance.now() - t0
    for (let i = 0; i < 600 && received < total; i++)
      await new Promise((r) => setTimeout(r, 50))
    const drainMs = performance.now() - t0
    const s1 = await stats()
    console.log(
      `- ${total} writes with a subscribed webhook: **${(total / (writeMs / 1000)).toFixed(0)} writes/s**`,
    )
    console.log(
      `- ${received} of ${total} deliveries received; the last arrived **${(drainMs - writeMs).toFixed(0)} ms** after the last write (${((received / drainMs) * 1000).toFixed(0)} deliveries/s overall)`,
    )
    console.log(
      `- server CPU for the whole run: ${(s1.cpu - s0.cpu).toFixed(1)} s (${(((s1.cpu - s0.cpu) * 1e6) / total).toFixed(0)} µs per write including its delivery)`,
    )
    extras.webhooks = {
      total,
      received,
      writePerSec: total / (writeMs / 1000),
      drainAfterLastWriteMs: drainMs - writeMs,
    }
    await fetch(`${BASE}/repos/dana/huge/webhooks/${hook.id}`, {
      method: 'DELETE',
      headers: dana,
    })
    void sink.stop(true)
  }

  if (wantsExtra('oauth')) {
    console.log('\n**Sign-in, one after another**\n')
    const origin = `http://127.0.0.1:${PORT}`
    const reg = await (
      await fetch(`${BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'bench',
          redirect_uris: ['https://app.example.com/cb'],
        }),
      })
    ).json()
    const { createHash, randomBytes } = await import('node:crypto')
    const timings: Record<string, Array<number>> = {
      authorize: [],
      approve: [],
      token: [],
      refresh: [],
      api: [],
    }
    const sess = await fetch(`${BASE}/oauth/session`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://source.code',
      },
      body: 'handle=dana&return_to=/',
    })
    const cookie = sess.headers.get('set-cookie')!.split(';')[0]
    const time = async <T>(k: string, f: () => Promise<T>) => {
      const t = performance.now()
      const r = await f()
      timings[k].push(performance.now() - t)
      return r
    }
    for (let i = 0; i < 40; i++) {
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url')
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: reg.client_id,
        redirect_uri: 'https://app.example.com/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'repo:read',
      })
      const html = await time('authorize', async () =>
        (
          await fetch(`${BASE}/oauth/authorize?${q}`, {
            headers: { cookie },
            redirect: 'manual',
          })
        ).text(),
      )
      const requestId = /name="request_id" value="([^"]+)"/.exec(html)![1]
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]
      const done = await time('approve', () =>
        fetch(`${BASE}/oauth/authorize`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
            origin,
          },
          body: new URLSearchParams({
            request_id: requestId,
            csrf,
            decision: 'approve',
          }),
        }),
      )
      const code = new URL(done.headers.get('location')!).searchParams.get(
        'code',
      )!
      const tok = await time('token', async () =>
        (
          await fetch(`${BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: reg.client_id,
              redirect_uri: 'https://app.example.com/cb',
              code_verifier: verifier,
            }),
          })
        ).json(),
      )
      await time('api', async () =>
        (
          await fetch(`${BASE}/auth/principal`, {
            headers: { authorization: `Bearer ${tok.access_token}` },
          })
        ).arrayBuffer(),
      )
      await time('refresh', async () =>
        (
          await fetch(`${BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: tok.refresh_token,
              client_id: reg.client_id,
            }),
          })
        ).arrayBuffer(),
      )
    }
    const med = (a: Array<number>) =>
      [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    console.log('| Step | median ms |\n| --- | ---: |')
    for (const [k, v] of Object.entries(timings))
      console.log(
        `| ${({ authorize: 'Consent page', approve: 'Approve (redirect with code)', token: 'Exchange the code', refresh: 'Rotate a refresh token', api: 'First API call with the token' } as Record<string, string>)[k]} | ${med(v).toFixed(2)} |`,
      )
    extras.oauth = Object.fromEntries(
      Object.entries(timings).map(([k, v]) => [k, med(v)]),
    )
  }

  const end = await stats()
  console.log(
    `\nServer memory after the run: ${(end.rss / 1048576).toFixed(0)} MB resident, ${(end.heap / 1048576).toFixed(0)} MB heap`,
  )
  server.kill()

  const cpu = Bun.spawnSync(['sysctl', '-n', 'machdep.cpu.brand_string'])
    .stdout.toString()
    .trim()
  const results: Results = {
    machine: cpu || process.platform,
    bun: Bun.version,
    when: new Date().toISOString(),
    seconds,
    clients,
    connections,
    rows,
    extras,
    rssMB: end.rss / 1048576,
  }
  console.log(
    `\n_${results.machine}, Bun ${results.bun}, ${clients} client processes x ${connections} connections, ${seconds} s per scenario_`,
  )
  if (out) writeFileSync(out, JSON.stringify(results, null, 2))

  if (compare) {
    const before = JSON.parse(readFileSync(compare, 'utf8')) as Results
    console.log('\n**Against ' + compare + '**\n')
    console.log(
      '| Scenario | req/s before | after | change | p99 ms before | after | change | µs CPU/req before | after |',
    )
    console.log(
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    )
    const pct = (a: number, b: number) =>
      a === 0
        ? 'n/a'
        : `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)}%`
    for (const r of rows) {
      const b = before.rows.find((x) => x.id === r.id)
      if (!b) continue
      console.log(
        `| ${r.title} | ${b.rps.toFixed(0)} | ${r.rps.toFixed(0)} | ${pct(b.rps, r.rps)} | ${fmt(b.p99)} | ${fmt(r.p99)} | ${pct(b.p99, r.p99)} | ${b.usPerReq.toFixed(0)} | ${r.usPerReq.toFixed(0)} |`,
      )
    }
  }
  process.exit(0)
}
