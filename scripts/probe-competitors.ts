/**
 * Latency of GitHub's and git.cafe's public APIs, measured from this machine.
 *
 *   bun scripts/probe-competitors.ts [--n 50] [--out docs/bench/competitors.json]
 *
 * Read requests only, one at a time on a kept-alive connection, so the figures
 * are what one client sees: network round trip plus the service. They are not
 * throughput figures and they depend on where you run this.
 *
 * GitHub uses the token from `gh auth token` (5,000 requests an hour; this
 * script spends about 6 x n + 20). The others are read anonymously, with
 * fewer samples where their limits are low or their lists are heavy:
 * git.cafe 1,200 an hour, GitLab 500 a minute, Bitbucket about 60 an hour (so
 * only a handful of samples there), Codeberg and Gitea.com publish none. Nothing
 * here writes.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const N = Number(arg('n', '50'))
const OUT = arg('out', '')
const ONLY = arg('only', '').split(',').filter(Boolean)
const want = (name: string) =>
  ONLY.length === 0 ||
  ONLY.map((o) => o.toLowerCase()).includes(name.toLowerCase())

type Probe = {
  name: string
  url: string
  headers?: Record<string, string>
  conditional?: boolean
  n?: number
  gapMs?: number
}
type Result = {
  timeouts: number
  target: string
  name: string
  status: number
  bytes: number
  n: number
  p50: number
  p95: number
  p99: number
  max: number
  min: number
  headers: Record<string, string>
}

const token = spawnSync('gh', ['auth', 'token'], {
  encoding: 'utf8',
}).stdout.trim()
const ua = {
  'user-agent': 'sx-latency-probe/0.1 (read-only; github.com/JustMarkDev)',
}

const github: Array<Probe> = [
  { name: 'API root', url: 'https://api.github.com/' },
  {
    name: 'One issue',
    url: 'https://api.github.com/repos/cli/cli/issues/1000',
  },
  {
    name: 'One pull request',
    url: 'https://api.github.com/repos/cli/cli/pulls/9000',
  },
  {
    name: 'One issue, If-None-Match (304)',
    url: 'https://api.github.com/repos/cli/cli/issues/1000',
    conditional: true,
  },
  {
    name: 'List of 50 issues',
    url: 'https://api.github.com/repos/cli/cli/issues?per_page=50&state=all',
  },
  {
    name: 'List of 50 pull requests',
    url: 'https://api.github.com/repos/cli/cli/pulls?per_page=50&state=all',
  },
  {
    name: 'Search (issues, 50)',
    url: 'https://api.github.com/search/issues?q=repo:cli/cli+is:issue+bug&per_page=50',
    // Search is limited to 30 a minute, so pace it below that.
    n: 15,
    gapMs: 2200,
  },
].map((p) => ({
  ...p,
  headers: {
    ...ua,
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
  },
}))

const cafe: Array<Probe> = [
  { name: 'Repository', url: 'https://git.cafe/api/repos/gitcafe/zig/' },
  {
    name: 'One issue',
    url: 'https://git.cafe/api/repos/gitcafe/bugs/issues/7',
  },
  {
    name: 'List of issues (7)',
    url: 'https://git.cafe/api/repos/gitcafe/bugs/issues/',
  },
  {
    name: 'List of pull requests (1)',
    url: 'https://git.cafe/api/repos/gitcafe/zig/pulls/',
  },
  {
    name: 'One pull request',
    url: 'https://git.cafe/api/repos/gitcafe/zig/pulls/1',
  },
  {
    name: 'Explore (5 repositories)',
    url: 'https://git.cafe/api/explore/repos?owner=gitcafe',
  },
].map((p) => ({ ...p, headers: { ...ua, accept: 'application/json' } }))

const anon = { ...ua, accept: 'application/json' }
const gitlab: Array<Probe> = [
  {
    name: 'Project',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli',
  },
  {
    name: 'One issue',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/issues/1000',
  },
  {
    name: 'One merge request',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/merge_requests/1000',
  },
  {
    name: 'One issue, If-None-Match (304)',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/issues/1000',
    conditional: true,
  },
  {
    name: 'List of 50 issues',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/issues?per_page=50',
    n: 20,
  },
  {
    name: 'List of 50 merge requests',
    url: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/merge_requests?per_page=50&state=all',
    n: 20,
  },
].map((p) => ({ ...p, headers: anon }))
const codeberg: Array<Probe> = [
  {
    name: 'One issue',
    url: 'https://codeberg.org/api/v1/repos/forgejo/forgejo/issues/1000',
    n: 30,
  },
  {
    name: 'One pull request',
    url: 'https://codeberg.org/api/v1/repos/forgejo/forgejo/pulls/1000',
    n: 30,
  },
  {
    name: 'List of 50 issues',
    url: 'https://codeberg.org/api/v1/repos/forgejo/forgejo/issues?limit=50&state=all&type=issues',
    n: 6,
  },
  {
    name: 'List of 50 pull requests',
    url: 'https://codeberg.org/api/v1/repos/forgejo/forgejo/pulls?limit=50&state=all',
    n: 4,
  },
].map((p) => ({ ...p, headers: anon }))
const gitea: Array<Probe> = [
  {
    name: 'One issue',
    url: 'https://gitea.com/api/v1/repos/gitea/tea/issues/1',
    n: 20,
  },
  {
    name: 'List of 50 issues',
    url: 'https://gitea.com/api/v1/repos/gitea/tea/issues?limit=50&state=all&type=issues',
    n: 5,
  },
].map((p) => ({ ...p, headers: anon }))
const bitbucket: Array<Probe> = [
  {
    name: 'Repository',
    url: 'https://api.bitbucket.org/2.0/repositories/atlassian/aui',
    n: 8,
  },
  {
    name: 'One pull request',
    url: 'https://api.bitbucket.org/2.0/repositories/atlassian/aui/pullrequests/1000',
    n: 8,
  },
  {
    name: 'List of 50 pull requests',
    url: 'https://api.bitbucket.org/2.0/repositories/atlassian/aui/pullrequests?pagelen=50&state=ALL',
    n: 6,
  },
].map((p) => ({ ...p, headers: anon }))

function pct(sorted: Array<number>, p: number) {
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ]
}

async function run(
  target: string,
  probes: Array<Probe>,
): Promise<Array<Result>> {
  const out: Array<Result> = []
  for (const p of probes) {
    const headers = { ...p.headers }
    if (p.conditional) {
      const first = await fetch(p.url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      await first.arrayBuffer()
      const etag = first.headers.get('etag')
      if (etag) headers['if-none-match'] = etag
    }
    const times: Array<number> = []
    let status = 0
    let timeouts = 0
    let bytes = 0
    let seen: Record<string, string> = {}
    // Three throwaway requests first: connection setup and TLS are not what we measure.
    const count = p.n ?? N
    for (let i = 0; i < count + 3; i++) {
      const t0 = performance.now()
      let res: Response
      try {
        res = await fetch(p.url, {
          headers,
          signal: AbortSignal.timeout(20_000),
        })
      } catch {
        // A request that hangs is a result too, but it is not a latency: count it and move on.
        timeouts++
        continue
      }
      const body = await res.arrayBuffer()
      const ms = performance.now() - t0
      if (i >= 3) times.push(ms)
      status = res.status
      bytes = body.byteLength
      if (i === 3)
        for (const k of [
          'cache-control',
          'etag',
          'server',
          'server-timing',
          'x-ratelimit-remaining',
          'ratelimit-policy',
          'cf-ray',
          'via',
        ])
          if (res.headers.has(k)) seen[k] = res.headers.get(k)!
      // Be a polite client: a small gap, so this is a measurement and not a load test.
      await new Promise((r) => setTimeout(r, p.gapMs ?? 40))
    }
    const sorted = [...times].sort((a, b) => a - b)
    out.push({
      target,
      name: p.name,
      status,
      bytes,
      n: sorted.length,
      timeouts,
      min: sorted[0],
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      p99: pct(sorted, 99),
      max: sorted[sorted.length - 1],
      headers: seen,
    })
    const r = out[out.length - 1]
    console.error(
      `${target.padEnd(8)} ${p.name.padEnd(32)} ${r.status}  p50 ${r.p50.toFixed(0)} ms  p95 ${r.p95.toFixed(0)}  p99 ${r.p99.toFixed(0)}  ${r.bytes} B`,
    )
    seen = {}
  }
  return out
}

// Where this runs matters as much as what is called, so record it.
const place = await fetch('https://api.github.com/zen', { headers: ua }).then(
  (r) => r.headers.get('x-github-request-id') ?? '',
)
void place
const results = [
  ...(want('GitHub') ? await run('GitHub', github) : []),
  ...(want('git.cafe') ? await run('git.cafe', cafe) : []),
  ...(want('GitLab') ? await run('GitLab', gitlab) : []),
  ...(want('Codeberg') ? await run('Codeberg', codeberg) : []),
  ...(want('Gitea') ? await run('Gitea', gitea) : []),
  ...(want('Bitbucket') ? await run('Bitbucket', bitbucket) : []),
]

const md = [
  '| Service | Request | n | Status | p50 ms | p95 ms | p99 ms | max ms | bytes |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    (r) =>
      `| ${r.target} | ${r.name} | ${r.n} | ${r.status} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.max.toFixed(0)} | ${r.bytes} |`,
  ),
].join('\n')
console.log(md)
if (OUT)
  writeFileSync(
    OUT,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), n: N, results }, null, 2)}\n`,
  )
