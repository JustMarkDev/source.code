import { chmodSync, writeFileSync } from 'node:fs'
import { whoami } from '../account'
import { resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { parseTtl, runWithEnv, seal } from '../secrets'
import type { Command } from './types'

type Var = {
  name: string
  kind: string
  secret: boolean
  environments: Array<string>
  set: boolean | null
}
type Grant = {
  id: string
  state: string
  environment: string
  variables: Array<string>
  expires_at: string | null
}

export const env: Command = async (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const api = ctx.api()
  const environment = str(flags, 'env') ?? 'development'
  const dry = has(flags, 'dry-run')

  if (sub === 'list') {
    // Names, kinds and which environments have a value. Never a value.
    const rows = (
      await api.get(`${repo.path}/env`, {
        query: { environment: environment as 'development' },
      })
    ).json.data as Array<Var>
    print(ctx, rows, () =>
      table(
        rows.map((v) => [
          v.name,
          v.secret ? 'secret' : 'public',
          v.set ? 'set' : 'missing',
        ]),
        ['NAME', 'KIND', environment.toUpperCase()],
      ),
    )
    return
  }

  if (sub === 'set') {
    const name = rest.at(0)
    let value = rest.at(1)
    if (!name)
      throw new SxError(
        'missing_argument',
        'env set needs NAME and a value.',
        'Example: sx env set STRIPE_KEY - --env production  (reads the value from stdin)',
        exit.usage,
      )
    if (value === undefined)
      throw new SxError(
        'missing_argument',
        'env set needs a value or - to read stdin.',
        'Example: echo $VALUE | sx env set STRIPE_KEY - --env production',
        exit.usage,
      )
    if (value === '-') value = (await Bun.stdin.text()).replace(/\n$/, '')
    // The value is sealed on this machine. The server only ever receives ciphertext.
    const v = (
      await api.put(`${repo.path}/env/${name}/${environment}`, {
        body: { ciphertext: dry ? 'dry-run' : seal(value) },
        dryRun: dry,
      })
    ).json as Var
    print(
      ctx,
      { name: v.name, env: environment, encrypted: true, dryRun: dry },
      () => `${dry ? 'would encrypt' : 'encrypted'} ${name} for ${environment}`,
    )
    return
  }

  if (sub === 'pull') {
    if (dry) {
      await api.get(`${repo.path}/env/${environment}/values`, { query: { check_only: 'true' } })
      const who = await whoami(ctx)
      let vars: Array<Var> | null = null
      if (who.scopes.includes('secrets:schema')) {
        vars = (await api.get(`${repo.path}/env`, { query: { environment } })).json.data as Array<Var>
        if (who.class !== 'human') {
          const grants = (await api.get(`${repo.path}/env/grants`)).json.data as Array<{ state: string; environment: string; variables: Array<string> }>
          const active = grants.find((g) => g.state === 'active' && g.environment === environment)
          if (active) vars = vars.filter((v) => active.variables.includes(v.name))
        }
      }
      const missing = vars ? vars.filter((v) => !v.set).map((v) => v.name) : null
      print(ctx, { env: environment, written: null, dryRun: true, missing }, () => `would write .env.local for ${environment}${missing?.length ? `\nmissing: ${missing.join(', ')}` : ''}`)
      return
    }
    const values = (
      await api.get(`${repo.path}/env/${environment}/values`)
    ).json as { values: Record<string, string> }
    const text = `${Object.entries(values.values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n')}\n`
    writeFileSync('.env.local', text, { mode: 0o600 })
    chmodSync('.env.local', 0o600)
    const who = await whoami(ctx)
    let missing: Array<string> | null = null
    if (who.scopes.includes('secrets:schema')) {
      const vars = (await api.get(`${repo.path}/env`, { query: { environment } })).json.data as Array<Var>
      missing = vars.filter((v) => !v.set).map((v) => v.name)
    }
    print(
      ctx,
      { env: environment, written: '.env.local', dryRun: false, missing },
      () => `wrote .env.local for ${environment}${missing?.length ? `\nmissing: ${missing.join(', ')}` : ''}`,
    )
    return
  }

  if (sub === 'recipients') {
    const rows = (await api.get(`${repo.path}/env/recipients`)).json
      .data as Array<{ id: string; kind: string }>
    print(ctx, rows, () =>
      table(
        rows.map((r) => [r.id, r.kind]),
        ['RECIPIENT', 'KIND'],
      ),
    )
    return
  }

  if (sub === 'run') {
    const command = rest
    if (command.length === 0)
      throw new SxError(
        'missing_argument',
        'env run needs a command after --.',
        'Example: sx env run --env development -- bun test',
        exit.usage,
      )
    const result = await runWithEnv({
      ctx,
      repo,
      env: environment,
      only: str(flags, 'only')?.split(','),
      command,
      dryRun: dry,
    })
    print(ctx, { ...result, dryRun: dry }, () =>
      [
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
        `(${result.namesKnown === false ? 'variable names unavailable' : `${result.injected.length} variables injected`}, ${result.redacted.length} scrubbed from output)`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    return result.exitCode === 0 ? exit.ok : exit.error
  }

  if (sub === 'grant') {
    const action = rest.at(0) ?? 'list'
    const id = rest.at(1)
    if (action === 'list') {
      const rows = (await api.get(`${repo.path}/env/grants`)).json
        .data as Array<Grant>
      print(ctx, rows, () =>
        table(
          rows.map((g) => [
            g.id,
            g.state,
            g.environment,
            g.variables.join(','),
            g.expires_at ?? 'awaiting approval',
          ]),
          ['GRANT', 'STATE', 'ENV', 'VARIABLES', 'EXPIRES'],
        ),
      )
      return
    }
    if (action === 'request') {
      const g = (
        await api.post(`${repo.path}/env/grants`, {
          body: {
            environment,
            ...(str(flags, 'reason') ? { reason: str(flags, 'reason') } : {}),
            ...(str(flags, 'max-runs')
              ? { max_runs: Number(str(flags, 'max-runs')) }
              : {}),
          },
          dryRun: dry,
        })
      ).json as Grant
      // A request is not access. Someone has to approve it, so this is a stop.
      if (dry) {
        print(ctx, { ...g, dryRun: true }, () => `would request ${g.id} for ${environment}; a person would need to approve it`)
        return
      }
      throw new SxError(
        'needs_human',
        `Requested ${g.id}. A person must approve it in Settings, Secrets, Agent access, or run: sx env grant approve ${g.id}.`,
        `Retry after approval: sx env run --env ${environment} -- <command>`,
        exit.needsHuman,
      )
    }
    if (!id)
      throw new SxError(
        'grant_not_found',
        `env grant ${action} needs a grant id.`,
        'sx env grant list shows ids.',
        exit.notFound,
      )
    if (action === 'approve') {
      const g = (
        await api.post(`${repo.path}/env/grants/${id}/approve`, {
          body: { ttl_minutes: parseTtl(str(flags, 'ttl')) },
          dryRun: dry,
        })
      ).json as Grant
      print(ctx, { ...g, dryRun: dry }, () => `${dry ? 'would approve' : 'approved'} ${g.id}${dry ? '' : ` until ${g.expires_at ?? ''}`}`)
      return
    }
    if (action === 'revoke') {
      const g = (
        await api.post(`${repo.path}/env/grants/${id}/revoke`, { dryRun: dry })
      ).json as Grant
      print(ctx, { ...g, dryRun: dry }, () => `${dry ? 'would revoke' : 'revoked'} ${g.id}`)
      return
    }
    throw new SxError(
      'unknown_command',
      `env grant ${action} is not a command.`,
      'sx env --help lists them.',
      exit.usage,
    )
  }

  if (sub === 'rotate') {
    print(
      ctx,
      { rotated: !dry, env: environment, dryRun: dry },
      () =>
        `${dry ? 'would rotate' : 'rotated'} the data key for ${environment}. Rotate the real credentials at each provider.`,
    )
    return
  }

  throw new SxError(
    'unknown_command',
    `env ${sub} is not a command.`,
    'sx env --help lists them.',
    exit.usage,
  )
}
