import { resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { nextGrantId, store } from '../fixtures'
import { audit, isAgent, parseTtl, runWithEnv } from '../secrets'
import type { Command } from './types'

export const env: Command = async (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  resolveRepo(str(flags, 'repo'))
  const environment = str(flags, 'env') ?? 'development'
  const dry = has(flags, 'dry-run')

  if (sub === 'list') {
    // Names, types and which environments have a value. Never a value.
    print(ctx, store.env, () =>
      table(
        store.env.map((v) => [
          v.name,
          v.secret ? 'secret' : 'public',
          v.set.includes(environment) ? 'set' : 'missing',
        ]),
        ['NAME', 'KIND', environment.toUpperCase()],
      ),
    )
    return
  }

  if (sub === 'set') {
    const name = rest.at(0)
    const value = rest.at(1)
    if (!name)
      throw new SxError(
        'missing_argument',
        'env set needs NAME and a value.',
        'Example: sx env set STRIPE_KEY - --env production  (reads the value from stdin)',
        exit.usage,
      )
    const v = store.env.find((x) => x.name === name)
    if (!v)
      throw new SxError(
        'not_in_schema',
        `${name} is not in .env.schema.`,
        'Add it to the schema first so reviewers can see it exists.',
        exit.usage,
      )
    // The value is encrypted on this machine. A plaintext value in a secret
    // key never reaches the server, and the push guard rejects it if it tries.
    if (value === undefined)
      throw new SxError(
        'missing_argument',
        'env set needs a value or - to read stdin.',
        'Example: echo $VALUE | sx env set STRIPE_KEY - --env production',
        exit.usage,
      )
    if (!dry && !v.set.includes(environment)) v.set.push(environment)
    print(
      ctx,
      { name, env: environment, encrypted: true, dryRun: dry },
      () => `${dry ? 'would encrypt' : 'encrypted'} ${name} for ${environment}`,
    )
    return
  }

  if (sub === 'pull') {
    const missing = store.env.filter((v) => !v.set.includes(environment))
    print(
      ctx,
      {
        env: environment,
        written: '.env.local',
        missing: missing.map((m) => m.name),
      },
      () =>
        `wrote .env.local for ${environment}${missing.length ? `\nmissing: ${missing.map((m) => m.name).join(', ')}` : ''}`,
    )
    return
  }

  if (sub === 'recipients') {
    print(ctx, store.recipients, () =>
      table(
        store.recipients.map((r) => [r.id, r.kind]),
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
      env: environment,
      only: str(flags, 'only')?.split(','),
      command,
      dryRun: dry,
    })
    print(ctx, { ...result, dryRun: dry }, () =>
      [
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
        `(${result.injected.length} variables injected, ${result.redacted.length} scrubbed from output)`,
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
      print(ctx, store.grants, () =>
        table(
          store.grants.map((g) => [
            g.id,
            g.state,
            g.env,
            g.vars.join(','),
            g.expires ?? 'awaiting approval',
          ]),
          ['GRANT', 'STATE', 'ENV', 'VARIABLES', 'EXPIRES'],
        ),
      )
      return
    }
    if (action === 'request') {
      if (environment === 'production')
        throw new SxError(
          'production_needs_human',
          'Agents cannot be granted production values.',
          'Use development, or ask a person to run the command.',
          exit.needsHuman,
        )
      const existing = store.grants.find(
        (g) => g.state === 'pending' && g.env === environment,
      )
      const req =
        existing ??
        ({
          id: nextGrantId(),
          bot: isAgent() ? 'agent' : 'you',
          env: environment as 'development' | 'preview',
          vars: store.env
            .filter((v) => v.set.includes(environment))
            .map((v) => v.name),
          state: 'pending',
          uses: 0,
          maxUses: Number(str(flags, 'max-runs') ?? 20),
          reason: str(flags, 'reason'),
        } as const)
      if (!existing && !dry) {
        store.grants.push({ ...req, vars: [...req.vars] })
        audit(
          req.bot,
          `requested ${environment} access: ${req.reason ?? 'no reason given'}`,
        )
      }
      // A request is not access. Someone has to approve it, so this is a stop.
      throw new SxError(
        'needs_human',
        `Requested ${req.id}. A person must approve it in Settings, Secrets, Agent access, or run: sx env grant approve ${req.id}.`,
        `Retry after approval: sx env run --env ${environment} -- <command>`,
        exit.needsHuman,
      )
    }
    const g = store.grants.find((x) => x.id === id)
    if (!g)
      throw new SxError(
        'grant_not_found',
        `No grant ${id ?? ''}.`,
        'sx env grant list shows ids.',
        exit.notFound,
      )
    if (action === 'approve') {
      if (isAgent())
        throw new SxError(
          'human_only',
          'An agent cannot approve its own grant.',
          'Ask a person to approve it.',
          exit.needsHuman,
        )
      const ms = parseTtl(str(flags, 'ttl'))
      if (!dry) {
        g.state = 'active'
        g.expires = new Date(Date.now() + ms).toISOString()
        audit(
          'you',
          `approved ${g.id} for ${g.env} (${str(flags, 'ttl') ?? '1h'})`,
        )
      }
      print(ctx, g, () => `approved ${g.id} until ${g.expires ?? ''}`)
      return
    }
    if (action === 'revoke') {
      if (!dry) {
        g.state = 'revoked'
        audit('you', `revoked ${g.id}`)
      }
      print(ctx, g, () => `revoked ${g.id}`)
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
