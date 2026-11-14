/**
 * The sample repositories' pipeline runs, with every job, step and log line:
 * a success, a failure, one running and one queued, per language. `ago` is
 * hours before the sample's clock; durations are milliseconds.
 *
 * Written the way a person reads a run ("2m 41s", "3 days ago") and turned
 * into numbers at the end; the logs come from one toolchain per language.
 */
type Level = 'cmd' | 'info' | 'dim' | 'ok' | 'warn' | 'error'
type Status = 'success' | 'failure' | 'running' | 'queued' | 'skipped'
export type SampleRun = {
  number: number
  workflow: string
  title: string
  branch: string
  sha: string
  status: 'success' | 'failure' | 'running' | 'queued'
  trigger: 'push' | 'change' | 'tag' | 'schedule' | 'manual'
  actor: string
  duration: number | null
  ago: number
  file: string
  annotations: Array<{
    level: 'error' | 'warn'
    text: string
    job: string
    step: string
  }>
  jobs: Array<{
    name: string
    runner: string
    status: Status
    duration: number
    steps: Array<{
      name: string
      status: Status
      duration: number
      lines: Array<[string] | [string, Level]>
    }>
  }>
}

type RunStatus = 'success' | 'failure' | 'running' | 'queued' | 'canceled'
type StepStatus = RunStatus | 'skipped'

type Run = {
  id: number
  workflow: string
  title: string
  branch: string
  sha: string
  status: RunStatus
  duration: string
  when: string
  actor: string
  trigger: 'push' | 'change' | 'tag' | 'schedule' | 'manual'
}

type LogLevel = 'cmd' | 'info' | 'dim' | 'ok' | 'warn' | 'error'

type LogLine = { t: string; level?: LogLevel }

type Step = {
  name: string
  status: StepStatus
  time: string
  lines: Array<LogLine>
}

type Job = {
  name: string
  runner: string
  status: StepStatus
  time: string
  steps: Array<Step>
}

type RunDetail = {
  run: Run
  file: string
  jobs: Array<Job>
  /** What a person should look at first, with where it came from. */
  annotations: Array<{
    level: 'error' | 'warn'
    text: string
    job: string
    step: string
  }>
}

// ---------------------------------------------------------------------------
// Runs per repository
// ---------------------------------------------------------------------------

const r = (
  id: number,
  workflow: string,
  title: string,
  branch: string,
  sha: string,
  status: RunStatus,
  duration: string,
  when: string,
  actor: string,
  trigger: Run['trigger'] = 'push',
): Run => ({
  id,
  workflow,
  title,
  branch,
  sha,
  status,
  duration,
  when,
  actor,
  trigger,
})

const gitfs: Array<Run> = [
  r(
    1842,
    'build',
    'Cache negative ref lookups',
    'main',
    'a41c9e2',
    'success',
    '2m 41s',
    '2 days ago',
    'dana',
  ),
  r(
    1841,
    'release',
    'Release v0.9.0',
    'v0.9.0',
    '9c02e7b',
    'success',
    '6m 12s',
    '2 weeks ago',
    'dana',
    'tag',
  ),
  r(
    1840,
    'build',
    'Add a read-only mount mode',
    'kofi/readonly-mount',
    '3fd81aa',
    'running',
    '1m 05s',
    '2 hours ago',
    'kofi',
    'change',
  ),
  r(
    1839,
    'build',
    'Windows ARM64 builds',
    'yuki/win-arm64',
    'be4410c',
    'failure',
    '3m 58s',
    '3 days ago',
    'yuki',
    'change',
  ),
  r(
    1838,
    'security',
    'Nightly dependency audit',
    'main',
    'a41c9e2',
    'success',
    '48s',
    'yesterday',
    'scheduler',
    'schedule',
  ),
  r(
    1837,
    'build',
    'Cache negative lookups',
    'dana/neg-cache',
    '77ab3d0',
    'queued',
    '-',
    'yesterday',
    'dana',
    'change',
  ),
  r(
    1836,
    'build',
    'Document retry settings',
    'sol/docs-retry',
    '51c0aa9',
    'success',
    '2m 30s',
    'last week',
    'sol',
    'change',
  ),
  r(
    1835,
    'release',
    'Beta: v0.10.0-beta.2',
    'v0.10.0-beta.2',
    '0e19c4f',
    'failure',
    '5m 44s',
    'last week',
    'dana',
    'tag',
  ),
]

const lumen: Array<Run> = [
  r(
    412,
    'release',
    'Release v2.4.1',
    'v2.4.1',
    '6b1d0a3',
    'success',
    '9m 03s',
    '3 days ago',
    'hollis',
    'tag',
  ),
  r(
    411,
    'build',
    'Fix search index on rename',
    'main',
    '2e7f9c4',
    'success',
    '3m 12s',
    '3 days ago',
    'hollis',
  ),
  r(
    410,
    'build',
    'Notarize the macOS build',
    'hollis/notarize',
    '88c3e1b',
    'failure',
    '4m 31s',
    '5 days ago',
    'hollis',
    'change',
  ),
  r(
    409,
    'nightly',
    'Nightly 2.5.0',
    'main',
    '2e7f9c4',
    'running',
    '2m 20s',
    '20 minutes ago',
    'scheduler',
    'schedule',
  ),
]

const tinyqueue: Array<Run> = [
  r(
    96,
    'ci',
    'Backoff is capped at 30 seconds',
    'main',
    'd90a1f2',
    'success',
    '1m 08s',
    '5 days ago',
    'dana',
  ),
  r(
    95,
    'ci',
    'Retry on 429',
    'dana/retry-429',
    '4cc17e0',
    'failure',
    '1m 22s',
    '6 days ago',
    'dana',
    'change',
  ),
  r(
    94,
    'ci',
    'Update dependencies',
    'main',
    '0f3a9bb',
    'success',
    '1m 01s',
    'last week',
    'dependabot',
  ),
]

const tern: Array<Run> = [
  r(
    233,
    'ci',
    'Add `tern lint`',
    'main',
    '5ab02cd',
    'success',
    '2m 02s',
    '4 days ago',
    'ines',
  ),
  r(
    232,
    'ci',
    'Parse nested migrations',
    'ines/nested',
    'c1e88d4',
    'failure',
    '1m 47s',
    '4 days ago',
    'ines',
    'change',
  ),
  r(
    231,
    'release',
    'Release v1.12.0',
    'v1.12.0',
    'ee40b12',
    'success',
    '4m 40s',
    '4 days ago',
    'ines',
    'tag',
  ),
  r(
    230,
    'ci',
    'Fix dry-run output',
    'ines/dry-run',
    '71d3a09',
    'queued',
    '-',
    '10 minutes ago',
    'ines',
    'change',
  ),
]

const relay: Array<Run> = [
  r(
    58,
    'ci',
    'Replay from an offset',
    'main',
    'bb71f08',
    'success',
    '1m 55s',
    'yesterday',
    'dana',
  ),
  r(
    57,
    'ci',
    'Bound the replay log',
    'dana/bound-log',
    '20ce4a7',
    'success',
    '1m 49s',
    '3 days ago',
    'dana',
    'change',
  ),
]

/** inkwell has no workflow at all, so the empty state can be seen. */
function runsFor(repo: { name: string }): Array<Run> {
  switch (repo.name) {
    case 'gitfs':
      return gitfs
    case 'lumen':
      return lumen
    case 'tinyqueue':
      return tinyqueue
    case 'tern':
      return tern
    case 'relay':
      return relay
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

type Toolchain = {
  setup: Array<LogLine>
  build: Array<LogLine>
  lint: Array<LogLine>
  test: (failing: boolean) => { lines: Array<LogLine>; error: string }
}

const rust: Toolchain = {
  setup: [
    { t: 'Run actions/checkout', level: 'cmd' },
    { t: 'Syncing repository', level: 'dim' },
    { t: 'Run rustup toolchain install stable', level: 'cmd' },
    { t: 'info: using existing install for stable-x86_64', level: 'dim' },
    { t: 'stable-x86_64 installed - rustc 1.84.0', level: 'ok' },
  ],
  build: [
    { t: '$ cargo build --workspace --locked', level: 'cmd' },
    { t: '   Compiling libc v0.2.169', level: 'dim' },
    { t: '   Compiling memmap2 v0.9.5', level: 'dim' },
    { t: '   Compiling gitfs v0.10.0', level: 'dim' },
    { t: 'warning: unused variable: `hint`', level: 'warn' },
    { t: '  --> src/refs.rs:41:13', level: 'warn' },
    { t: '   |     let hint = self.neg.len();', level: 'warn' },
    {
      t: '   = note: `#[warn(unused_variables)]` on by default',
      level: 'warn',
    },
    {
      t: '    Finished `dev` profile [unoptimized + debuginfo] in 18.42s',
      level: 'ok',
    },
  ],
  lint: [
    { t: '$ cargo clippy --workspace -- -D warnings', level: 'cmd' },
    { t: '    Checking gitfs v0.10.0', level: 'dim' },
    { t: '    Finished `dev` profile in 6.10s', level: 'ok' },
  ],
  test: (failing) => ({
    error: failing
      ? "thread 'mount::remount_after_error' panicked at tests/mount.rs:88:9: assertion `left == right` failed (left: 0, right: 1)"
      : '',
    lines: [
      { t: '$ cargo test --workspace', level: 'cmd' },
      { t: 'running 41 tests', level: 'info' },
      { t: 'test refs::lookup_hits_cache ... ok', level: 'ok' },
      { t: 'test refs::lookup_reads_disk_once ... ok', level: 'ok' },
      { t: 'test store::retries_on_503 ... ok', level: 'ok' },
      ...(failing
        ? ([
            { t: 'test mount::remount_after_error ... FAILED', level: 'error' },
            { t: '', level: 'dim' },
            { t: 'failures:', level: 'error' },
            { t: '', level: 'dim' },
            {
              t: '---- mount::remount_after_error stdout ----',
              level: 'error',
            },
            {
              t: "thread 'mount::remount_after_error' panicked at tests/mount.rs:88:9:",
              level: 'error',
            },
            { t: 'assertion `left == right` failed', level: 'error' },
            { t: '  left: 0', level: 'error' },
            { t: ' right: 1', level: 'error' },
            {
              t: 'note: run with `RUST_BACKTRACE=1` for a backtrace',
              level: 'dim',
            },
            { t: '', level: 'dim' },
            {
              t: 'test result: FAILED. 40 passed; 1 failed; 0 ignored',
              level: 'error',
            },
            {
              t: 'error: test failed, to rerun pass `--test mount`',
              level: 'error',
            },
          ] as Array<LogLine>)
        : ([
            { t: 'test mount::remount_after_error ... ok', level: 'ok' },
            { t: '', level: 'dim' },
            {
              t: 'test result: ok. 41 passed; 0 failed; 0 ignored',
              level: 'ok',
            },
          ] as Array<LogLine>)),
    ],
  }),
}

const node: Toolchain = {
  setup: [
    { t: 'Run actions/checkout', level: 'cmd' },
    { t: 'Syncing repository', level: 'dim' },
    { t: 'Run actions/setup-node (node 22)', level: 'cmd' },
    { t: 'Node 22.11.0 ready, cache restored', level: 'ok' },
  ],
  build: [
    { t: '$ npm ci', level: 'cmd' },
    {
      t: 'npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported',
      level: 'warn',
    },
    { t: 'added 214 packages in 6s', level: 'dim' },
    { t: '$ npm run build', level: 'cmd' },
    { t: 'built in 1.9s', level: 'ok' },
  ],
  lint: [
    { t: '$ npm run lint', level: 'cmd' },
    { t: '/src/queue.ts', level: 'dim' },
    {
      t: '  58:7  warning  Unexpected console statement  no-console',
      level: 'warn',
    },
    { t: '✖ 1 problem (0 errors, 1 warning)', level: 'warn' },
  ],
  test: (failing) => ({
    error: failing
      ? 'AssertionError: expected 3 to be 4 (src/queue.test.ts > retries > backs off between attempts)'
      : '',
    lines: [
      { t: '$ npm test', level: 'cmd' },
      { t: ' RUN  v2.1.8', level: 'info' },
      { t: ' ✓ src/queue.test.ts (12 tests) 214ms', level: 'ok' },
      ...(failing
        ? ([
            {
              t: ' ❯ src/retry.test.ts (6 tests | 1 failed) 402ms',
              level: 'error',
            },
            { t: '   × retries > backs off between attempts', level: 'error' },
            {
              t: '     → expected 3 to be 4 // Object.is equality',
              level: 'error',
            },
            { t: '', level: 'dim' },
            {
              t: ' FAIL  src/retry.test.ts > retries > backs off between attempts',
              level: 'error',
            },
            { t: 'AssertionError: expected 3 to be 4', level: 'error' },
            { t: ' ❯ src/retry.test.ts:44:24', level: 'error' },
            { t: '     42|     await run(task, { retries: 4 })', level: 'dim' },
            { t: '     43|     const attempts = calls.length', level: 'dim' },
            { t: '     44|     expect(attempts).toBe(4)', level: 'error' },
            { t: '', level: 'dim' },
            { t: ' Test Files  1 failed | 1 passed (2)', level: 'error' },
            { t: '      Tests  1 failed | 17 passed (18)', level: 'error' },
          ] as Array<LogLine>)
        : ([
            { t: ' ✓ src/retry.test.ts (6 tests) 188ms', level: 'ok' },
            { t: '', level: 'dim' },
            { t: ' Test Files  2 passed (2)', level: 'ok' },
            { t: '      Tests  18 passed (18)', level: 'ok' },
          ] as Array<LogLine>)),
    ],
  }),
}

const go: Toolchain = {
  setup: [
    { t: 'Run actions/checkout', level: 'cmd' },
    { t: 'Syncing repository', level: 'dim' },
    { t: 'Run actions/setup-go (go 1.23)', level: 'cmd' },
    { t: 'go version go1.23.4 linux/amd64', level: 'ok' },
  ],
  build: [
    { t: '$ go build ./...', level: 'cmd' },
    { t: 'go: downloading github.com/spf13/cobra v1.8.1', level: 'dim' },
    { t: 'ok', level: 'ok' },
  ],
  lint: [
    { t: '$ golangci-lint run', level: 'cmd' },
    {
      t: 'internal/parse/nested.go:88:2: ineffectual assignment to err (ineffassign)',
      level: 'error',
    },
    { t: '	err = p.skipComments()', level: 'error' },
    {
      t: 'internal/parse/nested.go:112:9: string `up` has 3 occurrences, make it a constant (goconst)',
      level: 'warn',
    },
    { t: 'Error: golangci-lint found 2 issues', level: 'error' },
  ],
  test: (failing) => ({
    error: failing ? '--- FAIL: TestReplayFromOffset (0.02s)' : '',
    lines: [
      { t: '$ go test ./... -race', level: 'cmd' },
      { t: 'ok  	example.com/relay/log	0.412s', level: 'ok' },
      ...(failing
        ? ([
            { t: '--- FAIL: TestReplayFromOffset (0.02s)', level: 'error' },
            {
              t: '    replay_test.go:57: got 11 entries, want 12',
              level: 'error',
            },
            { t: 'FAIL', level: 'error' },
            { t: 'FAIL	example.com/relay/replay	0.034s', level: 'error' },
          ] as Array<LogLine>)
        : ([
            { t: 'ok  	example.com/relay/replay	0.098s', level: 'ok' },
          ] as Array<LogLine>)),
    ],
  }),
}

const toolchainFor = (name: string): Toolchain =>
  name === 'tinyqueue' ? node : name === 'tern' || name === 'relay' ? go : rust

const packaging: Array<LogLine> = [
  { t: '$ sx release build --sign', level: 'cmd' },
  { t: 'Building 5 targets', level: 'info' },
  { t: 'macos arm64 ... ok', level: 'ok' },
  { t: 'macos x64 ... ok', level: 'ok' },
  { t: 'windows x64 ... ok', level: 'ok' },
  { t: 'linux x64 ... ok', level: 'ok' },
  { t: 'linux arm64 ... ok', level: 'ok' },
  { t: 'Signed 5 artifacts', level: 'ok' },
]

const notarize: Array<LogLine> = [
  {
    t: '$ xcrun notarytool submit dist/lumen-macos-arm64.dmg --wait',
    level: 'cmd',
  },
  {
    t: 'Conducting pre-submission checks for lumen-macos-arm64.dmg',
    level: 'dim',
  },
  { t: 'Submission ID received: 9d2f2f10-3c1e-4a8e-9a55-7e41', level: 'dim' },
  { t: 'Waiting for processing to complete...', level: 'info' },
  { t: 'Current status: Invalid', level: 'error' },
  { t: 'Error: The signature of the binary is invalid.', level: 'error' },
  {
    t: 'Error: The binary uses an SDK older than the 10.9 SDK.',
    level: 'error',
  },
  { t: 'Process completed with exit code 1.', level: 'error' },
]

const stepsFor = (
  tc: Toolchain,
  status: RunStatus,
  failIn: 'test' | 'lint' | 'notarize' | null,
  withPackage: boolean,
): Array<Step> => {
  const t = tc.test(failIn === 'test')
  const base: Array<Step> = [
    { name: 'Set up job', status: 'success', time: '2s', lines: tc.setup },
    { name: 'Build', status: 'success', time: '24s', lines: tc.build },
    {
      name: 'Lint',
      status: failIn === 'lint' ? 'failure' : 'success',
      time: '9s',
      lines: tc.lint,
    },
    {
      name: 'Test',
      status:
        failIn === 'test'
          ? 'failure'
          : failIn === 'lint'
            ? 'skipped'
            : 'success',
      time: failIn === 'lint' ? '-' : '41s',
      lines: failIn === 'lint' ? [] : t.lines,
    },
  ]
  if (withPackage)
    base.push({
      name: failIn === 'notarize' ? 'Notarize' : 'Package and sign',
      status:
        failIn === 'notarize' ? 'failure' : failIn ? 'skipped' : 'success',
      time: failIn === 'notarize' ? '1m 58s' : failIn ? '-' : '53s',
      lines: failIn === 'notarize' ? notarize : failIn ? [] : packaging,
    })
  if (status === 'running') {
    // The last step is still going: the earlier ones are done.
    const i = Math.max(1, base.length - 2)
    return base.map((s, n) =>
      n < i
        ? { ...s, status: 'success' as const }
        : n === i
          ? {
              ...s,
              status: 'running' as const,
              time: '...',
              lines: s.lines.slice(0, Math.ceil(s.lines.length / 2)),
            }
          : { ...s, status: 'queued' as const, time: '-', lines: [] },
    )
  }
  if (status === 'queued')
    return base.map((s) => ({
      ...s,
      status: 'queued' as const,
      time: '-',
      lines: [],
    }))
  return base
}

/** The jobs of a run, with the logs a runner would have produced. */
function detailFor(repo: { name: string }, run: Run): RunDetail {
  const tc = toolchainFor(repo.name)
  const release = run.workflow === 'release' || run.workflow === 'nightly'
  const failIn: 'test' | 'lint' | 'notarize' | null =
    run.status !== 'failure'
      ? null
      : repo.name === 'lumen'
        ? 'notarize'
        : repo.name === 'tern'
          ? 'lint'
          : 'test'
  const runners =
    repo.name === 'lumen' || run.workflow === 'release'
      ? ['ubuntu-latest', 'macos-14', 'windows-latest']
      : ['ubuntu-latest', 'macos-14']
  const jobs: Array<Job> = runners.map((runner, i) => {
    const os = runner.split('-')[0]
    // Only one runner fails, the way a real failure is usually found.
    const fails =
      failIn !== null && i === (failIn === 'notarize' ? 1 : runners.length - 1)
    const steps = stepsFor(
      tc,
      run.status === 'running' && i > 0 ? 'queued' : run.status,
      fails ? failIn : null,
      release && i === 0,
    )
    const status: StepStatus = fails
      ? 'failure'
      : run.status === 'failure'
        ? 'success'
        : run.status === 'running' && i > 0
          ? 'queued'
          : run.status
    return {
      name: `${run.workflow === 'ci' ? 'test' : run.workflow} (${os})`,
      runner,
      status,
      time:
        status === 'queued'
          ? '-'
          : status === 'running'
            ? '...'
            : `${1 + i}m ${10 + i * 14}s`,
      steps,
    }
  })

  const annotations: RunDetail['annotations'] = []
  for (const j of jobs)
    for (const s of j.steps)
      for (const l of s.lines)
        if (
          (l.level === 'error' || l.level === 'warn') &&
          !annotations.some(
            (a) => a.level === l.level && a.step === s.name && a.job === j.name,
          )
        )
          annotations.push({
            level: l.level,
            text: l.t,
            job: j.name,
            step: s.name,
          })

  return {
    run,
    file: `.source/workflows/${run.workflow}.yml`,
    jobs,
    annotations: annotations.slice(0, 6),
  }
}

/** A short description of why a run failed, for a person and for an agent. */
const ms = (t: string) => {
  let n = 0
  for (const m of t.matchAll(/(\d+)(h|m|s)/g))
    n +=
      Number(m[1]) * (m[2] === 'h' ? 3_600_000 : m[2] === 'm' ? 60_000 : 1000)
  return n
}

const hoursAgo = (when: string) => {
  if (when === 'yesterday') return 24
  if (when === 'last week') return 168
  const m = /(\d+) (minute|hour|day|week)s? ago/.exec(when)
  if (!m) throw new Error(`Unknown time: ${when}`)
  const n = Number(m[1])
  return { minute: n / 60, hour: n, day: n * 24, week: n * 168 }[
    m[2] as 'minute' | 'hour' | 'day' | 'week'
  ]
}

const sampleOf = (name: string): Array<SampleRun> =>
  runsFor({ name }).map((run) => {
    const d = detailFor({ name }, run)
    return {
      number: run.id,
      workflow: run.workflow,
      title: run.title,
      branch: run.branch,
      sha: run.sha,
      status: run.status as SampleRun['status'],
      trigger: run.trigger,
      actor: run.actor,
      duration:
        run.status === 'running' || run.status === 'queued'
          ? null
          : ms(run.duration),
      ago: hoursAgo(run.when),
      file: d.file,
      annotations: d.annotations,
      jobs: d.jobs.map((j) => ({
        name: j.name,
        runner: j.runner,
        status: j.status as Status,
        duration: ms(j.time),
        steps: j.steps.map((s) => ({
          name: s.name,
          status: s.status as Status,
          duration: ms(s.time),
          lines: s.lines.map((l): [string] | [string, Level] =>
            l.level ? [l.t, l.level] : [l.t],
          ),
        })),
      })),
    }
  })

export const samplePipelines = {
  'dana/gitfs': sampleOf('gitfs'),
  'hollis/lumen': sampleOf('lumen'),
  'ines/tern': sampleOf('tern'),
  'northwind/relay': sampleOf('relay'),
  'dana/tinyqueue': sampleOf('tinyqueue'),
}
