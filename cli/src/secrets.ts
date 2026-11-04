/**
 * How agents get to use secrets without ever seeing them.
 *
 *  - Values are injected into ONE child process, never printed or written.
 *  - Everything that process writes is scrubbed: exact values, and their
 *    base64 and URL-encoded forms, become «NAME».
 *  - An agent needs an expiring grant. Production is never available to agents.
 *  - Every run is written to the audit log.
 *
 * What this cannot stop: a command you let an agent run can still send a value
 * over the network. Keep grants to development values, keep them short, and run
 * agents where outbound traffic is restricted.
 */
import { SxError, exit } from './output'
import { store } from './fixtures'
import type { Grant } from './fixtures'

/**
 * Stand-ins for decrypted values. The hosted service decrypts for real; here
 * the values only exist so the injection and scrubbing can be exercised.
 */
const sample: Record<string, string> = {
  DATABASE_URL: 'postgres://dev:hunter2-dev-only@localhost:5432/gitfs',
  STRIPE_KEY: 'sk_test_51MockMockMockMock9x',
  API_PORT: '8080',
}

export const isAgent = () => process.env.SX_ACTOR === 'agent'

export function parseTtl(s: string | undefined): number {
  const m = (s ?? '1h').match(/^(\d+)(m|h)$/)
  if (!m)
    throw new SxError(
      'bad_ttl',
      `${s} is not a duration.`,
      'Use 15m, 1h or 8h.',
      exit.usage,
    )
  const ms = Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 60_000)
  if (ms > 8 * 3_600_000)
    throw new SxError(
      'ttl_too_long',
      'Agent grants last at most 8 hours.',
      'Request a shorter grant and renew it.',
      exit.usage,
    )
  return ms
}

export function activeGrant(env: string): Grant | undefined {
  const now = Date.now()
  return store.grants.find(
    (g) =>
      g.state === 'active' &&
      g.env === env &&
      g.expires !== undefined &&
      Date.parse(g.expires) > now &&
      g.uses < g.maxUses,
  )
}

export function audit(who: string, what: string) {
  store.audit.unshift({ when: new Date().toISOString(), who, what })
}

/** Replace every secret value, and its common encodings, with its name. */
export function scrub(text: string, secrets: Record<string, string>): string {
  let out = text
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length < 4) continue
    const forms = new Set([
      value,
      Buffer.from(value).toString('base64'),
      encodeURIComponent(value),
    ])
    for (const f of forms) out = out.split(f).join(`«${name}»`)
  }
  return out
}

export type RunResult = {
  env: string
  injected: Array<string>
  redacted: Array<string>
  exitCode: number
  stdout: string
  stderr: string
}

export async function runWithEnv(opts: {
  env: string
  only: Array<string> | undefined
  command: Array<string>
  dryRun: boolean
}): Promise<RunResult> {
  const agent = isAgent()
  const grant = agent ? activeGrant(opts.env) : undefined

  if (agent && opts.env === 'production')
    throw new SxError(
      'production_needs_human',
      'Agents cannot use production values.',
      'Ask a person to run this, or use development values.',
      exit.needsHuman,
    )
  if (agent && !grant)
    throw new SxError(
      'grant_required',
      `No active grant for ${opts.env}.`,
      `Run: sx env grant request --env ${opts.env} --reason "<why>". A person approves it, then retry.`,
      exit.needsHuman,
    )

  const allowed = store.env.filter(
    (v) =>
      v.set.includes(opts.env) &&
      (!opts.only || opts.only.includes(v.name)) &&
      (!grant || grant.vars.includes(v.name)),
  )
  const values: Record<string, string> = {}
  for (const v of allowed) if (v.name in sample) values[v.name] = sample[v.name]
  const secrets = Object.fromEntries(
    allowed
      .filter((v) => v.secret && v.name in values)
      .map((v) => [v.name, values[v.name]]),
  )
  const injected = allowed.map((v) => v.name)

  if (opts.dryRun)
    return {
      env: opts.env,
      injected,
      redacted: Object.keys(secrets),
      exitCode: 0,
      stdout: '',
      stderr: '',
    }

  const proc = Bun.spawn(opts.command, {
    env: { ...process.env, ...values },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (grant) grant.uses += 1
  audit(
    agent ? 'agent' : 'you',
    `ran "${opts.command.join(' ')}" with ${injected.length} variable${injected.length === 1 ? '' : 's'} (${opts.env})`,
  )
  return {
    env: opts.env,
    injected,
    redacted: Object.keys(secrets),
    exitCode,
    stdout: scrub(stdout, secrets),
    stderr: scrub(stderr, secrets),
  }
}
