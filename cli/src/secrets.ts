/**
 * How agents get to use secrets without ever seeing them.
 *
 *  - Values are injected into ONE child process, never printed or written.
 *  - Everything that process writes is scrubbed: exact values, and their
 *    base64 and URL-encoded forms, become «NAME».
 *  - An agent needs an expiring grant. Production is never available to agents.
 *  - Every read is written to the audit log by the server.
 *
 * What this cannot stop: a command you let an agent run can still send a value
 * over the network. Keep grants to development values, keep them short, and run
 * agents where outbound traffic is restricted.
 */
import { createCipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SxError, exit } from './output'
import { whoami } from './account'
import { configPath } from './config'
import type { Ctx } from './output'
import type { RepoRef } from './repo'

export function parseTtl(s: string | undefined): number {
  const m = (s ?? '1h').match(/^(\d+)(m|h)$/)
  if (!m)
    throw new SxError(
      'bad_ttl',
      `${s} is not a duration.`,
      'Use 15m, 1h or 8h.',
      exit.usage,
    )
  const minutes = Number(m[1]) * (m[2] === 'h' ? 60 : 1)
  if (minutes > 8 * 60)
    throw new SxError(
      'ttl_too_long',
      'Agent grants last at most 8 hours.',
      'Request a shorter grant and renew it.',
      exit.usage,
    )
  return minutes
}

/** Replace every secret value, and its common encodings, with its name. */
export function scrub(text: string, secrets: Record<string, string>): string {
  let out = text
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length === 0) continue
    const forms = new Set([
      value,
      Buffer.from(value).toString('base64'),
      encodeURIComponent(value),
    ])
    for (const f of forms) {
      // A very short value would rewrite ordinary text, so redact it only
      // where it stands alone; anything longer is replaced everywhere.
      if (f.length < 4) {
        const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        out = out.replace(
          new RegExp(`(?<![^\\s()\\[\\]{}"'=,;:!?.])${escaped}(?![^\\s()\\[\\]{}"'=,;:!?.])`, 'g'),
          `«${name}»`,
        )
        continue
      }
      out = out.split(f).join(`«${name}»`)
    }
  }
  return out
}

/**
 * Seals a value on this machine, so a plaintext secret never reaches the
 * server. The key lives beside your settings. The hosted service encrypts to
 * the repository's recipients instead; the server only ever sees ciphertext.
 */
export function seal(value: string): string {
  const keyFile = join(dirname(configPath()), 'secret.key')
  let key: Buffer
  if (existsSync(keyFile))
    key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
  else {
    key = randomBytes(32)
    mkdirSync(dirname(keyFile), { recursive: true })
    writeFileSync(keyFile, key.toString('base64') + '\n', { mode: 0o600 })
  }
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()])
  return `sx1.${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`
}

export type RunResult = {
  env: string
  injected: Array<string>
  redacted: Array<string>
  namesKnown?: boolean
  exitCode: number
  stdout: string
  stderr: string
}

/** The CLI's own words for what the API says, so the next step is a command. */
function cliError(e: unknown, env: string): never {
  if (e instanceof SxError && e.code === 'grant_required')
    throw new SxError(
      e.code,
      `No active grant for ${env}.`,
      `Run: sx env grant request --env ${env} --reason "<why>". A person approves it, then retry.`,
      e.status,
    )
  if (e instanceof SxError && e.code === 'human_required')
    throw new SxError(
      e.code,
      'Agents cannot use production values.',
      'Ask a person to run this, or use development values.',
      e.status,
    )
  throw e
}

export async function runWithEnv(opts: {
  ctx: Ctx
  repo: RepoRef
  env: string
  only: Array<string> | undefined
  command: Array<string>
  dryRun: boolean
}): Promise<RunResult> {
  const api = opts.ctx.api()
  const who = await whoami(opts.ctx)
  const names = opts.only?.join(',')

  if (opts.dryRun) {
    // Ask the server to run the same access checks without reading or auditing values.
    await api.get(`${opts.repo.path}/env/${opts.env}/values`, { query: { check_only: 'true' } })
    const canSchema = who.scopes.includes('secrets:schema')
    let vars = canSchema
      ? ((await api.get(`${opts.repo.path}/env`, {
          query: { environment: opts.env as 'development' },
        })).json.data as Array<{ name: string; secret: boolean; set: boolean }>)
      : null
    if (vars && who.class !== 'human') {
      const grants = (await api.get(`${opts.repo.path}/env/grants`)).json.data as Array<{ state: string; environment: string; variables: Array<string> }>
      const active = grants.find((g) => g.state === 'active' && g.environment === opts.env)
      if (active) vars = vars.filter((v) => active.variables.includes(v.name))
    }
    const shown = (vars ?? []).filter((v) => v.set && (!opts.only || opts.only.includes(v.name)))
    return {
      env: opts.env,
      injected: shown.map((v) => v.name),
      redacted: shown.filter((v) => v.secret).map((v) => v.name),
      namesKnown: vars !== null,
      exitCode: 0,
      stdout: '',
      stderr: '',
    }
  }

  let read
  try {
    read = (
      await api.get(`${opts.repo.path}/env/${opts.env}/values`, {
        query: { names },
      })
    ).json as {
      values: Record<string, string>
      secrets: Array<string>
    }
  } catch (e) {
    cliError(e, opts.env)
  }
  const secrets = Object.fromEntries(
    read.secrets
      .filter((n) => n in read.values)
      .map((n) => [n, read.values[n]]),
  )
  const proc = Bun.spawn(opts.command, {
    env: { ...process.env, ...read.values },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    env: opts.env,
    injected: Object.keys(read.values),
    redacted: Object.keys(secrets),
    exitCode,
    stdout: scrub(stdout, secrets),
    stderr: scrub(stderr, secrets),
  }
}
