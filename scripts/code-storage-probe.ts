/**
 * Asks a code.storage test repository three questions the docs leave open,
 * with a handful of pushes, never a load test (see docs/convex-migration.md,
 * "Syncing with other hosts"):
 *
 *   1. Is `atomic` push advertised?
 *   2. Is `--force-with-lease` refused when the branch moved?
 *   3. With a GitHub upstream: what happens when both sides change a branch?
 *
 *   CODE_STORAGE_REMOTE=https://t:<jwt>@<name>.code.storage/<repo>.git \
 *   GITHUB_REMOTE=https://<token>@github.com/<owner>/<repo>.git   # optional, for 3
 *   bun scripts/code-storage-probe.ts
 *
 * It writes only to branches named `probe/*`, and prints what it saw.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const remote = process.env.CODE_STORAGE_REMOTE
if (!remote) {
  console.error(
    'Set CODE_STORAGE_REMOTE to a test repository (see the top of this file).',
  )
  process.exit(2)
}

const run = (
  cwd: string,
  args: Array<string>,
  env: Record<string, string> = {},
) => {
  const p = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, ...env },
  })
  return {
    ok: p.exitCode === 0,
    out: `${p.stdout.toString()}${p.stderr.toString()}`,
  }
}

const dir = mkdtempSync(join(tmpdir(), 'probe-'))
const branch = `probe/${Date.now().toString(36)}`
try {
  const a = join(dir, 'a')
  const b = join(dir, 'b')
  run(dir, ['clone', '--quiet', remote, a])
  run(dir, ['clone', '--quiet', remote, b])
  for (const c of [a, b]) {
    run(c, ['config', 'user.email', 'probe@source.code'])
    run(c, ['config', 'user.name', 'probe'])
  }
  const commit = (c: string, text: string) => {
    writeFileSync(join(c, 'probe.txt'), text)
    run(c, ['add', 'probe.txt'])
    run(c, ['commit', '--quiet', '-m', text])
    return run(c, ['rev-parse', 'HEAD']).out.trim()
  }

  // 1. The server's capabilities, as the push handshake shows them.
  const trace = run(
    a,
    ['push', '--dry-run', 'origin', `HEAD:refs/heads/${branch}`],
    { GIT_TRACE_PACKET: '1' },
  )
  console.log(
    `1. atomic push advertised: ${/\batomic\b/.test(trace.out) ? 'yes' : 'no'}`,
  )

  // 2. Someone else moves the branch; a lease on the old value must fail.
  run(a, ['checkout', '--quiet', '-b', branch])
  const first = commit(a, 'one')
  run(a, ['push', '--quiet', 'origin', branch])
  run(b, ['fetch', '--quiet', 'origin', branch])
  run(b, ['checkout', '--quiet', '-b', branch, `origin/${branch}`])
  commit(b, 'two')
  run(b, ['push', '--quiet', 'origin', branch])
  commit(a, 'three')
  const lease = run(a, [
    'push',
    `--force-with-lease=${branch}:${first}`,
    'origin',
    branch,
  ])
  console.log(
    `2. --force-with-lease refused when the branch moved: ${lease.ok ? 'NO, it was accepted' : 'yes'}`,
  )

  // 3. Both sides change the branch: which commit wins?
  const github = process.env.GITHUB_REMOTE
  if (!github)
    console.log('3. skipped: set GITHUB_REMOTE to the synced GitHub repository')
  else {
    const g = join(dir, 'g')
    run(dir, ['clone', '--quiet', github, g])
    run(g, ['config', 'user.email', 'probe@source.code'])
    run(g, ['config', 'user.name', 'probe'])
    run(g, ['fetch', '--quiet', 'origin', branch])
    run(g, ['checkout', '--quiet', '-b', branch, `origin/${branch}`])
    const there = commit(g, 'on github')
    run(g, ['push', '--quiet', 'origin', branch])
    const here = commit(b, 'on code.storage')
    const pushed = run(b, ['push', 'origin', branch])
    // Give the sync a moment, then see who won on each side.
    await Bun.sleep(30_000)
    const onStorage = run(b, [
      'ls-remote',
      'origin',
      `refs/heads/${branch}`,
    ]).out.split('\t')[0]
    const onGithub = run(g, [
      'ls-remote',
      'origin',
      `refs/heads/${branch}`,
    ]).out.split('\t')[0]
    console.log(
      `3. push to code.storage after GitHub moved: ${pushed.ok ? 'accepted' : 'refused'}`,
    )
    console.log(
      `   code.storage now at ${onStorage === here ? 'ours' : onStorage === there ? 'GitHub' : onStorage}`,
    )
    console.log(
      `   GitHub now at ${onGithub === here ? 'ours' : onGithub === there ? 'GitHub' : onGithub}`,
    )
  }
} finally {
  run(join(dir, 'a'), ['push', '--quiet', 'origin', '--delete', branch])
  rmSync(dir, { recursive: true, force: true })
}
