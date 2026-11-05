#!/usr/bin/env bun
import { has, parse } from './args'
import { SxError, exit, fail, wantsJson } from './output'
import { completions, groupHelp, topHelp, version } from './help'
import { account } from './commands/account'
import { agent } from './commands/agent'
import { auth } from './commands/auth'
import { change } from './commands/change'
import { config } from './commands/config'
import { context } from './commands/context'
import { env } from './commands/env'
import { issue } from './commands/issue'
import { mcp } from './commands/mcp'
import { mirror } from './commands/mirror'
import { policy } from './commands/policy'
import { repo } from './commands/repo'
import { commandsList, skill } from './commands/skill'
import type { Ctx } from './output'
import type { Command } from './commands/types'

const commands: Record<string, Command> = {
  repo,
  change,
  issue,
  env,
  policy,
  mirror,
  agent,
  context,
  config,
  account,
  auth,
  skill,
  mcp,
  commands: commandsList,
}

/** The nearest command name, if one is within two edits. */
function closest(word: string, names: Array<string>): string | undefined {
  const dist = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j]
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        )
        prev = tmp
      }
    }
    return row[b.length]
  }
  return names
    .map((n) => [n, dist(word, n)] as const)
    .filter(([, d]) => d <= 2)
    .sort((a, b) => a[1] - b[1])
    .at(0)?.[0]
}

/** Runs sx and returns the exit code. Separate from `main` so tests can call it. */
export async function run(
  argv: ReadonlyArray<string>,
  io: { out: (s: string) => void; err: (s: string) => void } = {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  },
): Promise<number> {
  const { positionals, flags } = parse(argv)
  const ctx: Ctx = { json: wantsJson(flags), ...io }
  const name = positionals.at(0)
  const rest = positionals.slice(1)
  try {
    if (has(flags, 'version') || name === 'version') {
      ctx.out(version)
      return exit.ok
    }
    if (name === undefined || (name === 'help' && rest.length === 0)) {
      ctx.out(topHelp)
      return exit.ok
    }
    if (name === 'completion') {
      const shell = rest.at(0) ?? ''
      const script = completions[shell] as string | undefined
      if (script === undefined)
        throw new SxError(
          'bad_shell',
          `${shell || '(none)'} is not a shell.`,
          'Use bash, zsh or fish.',
          exit.usage,
        )
      ctx.out(script.trimEnd())
      return exit.ok
    }
    const target = name === 'help' ? (rest.at(0) ?? '') : name
    if (name === 'help' || has(flags, 'help')) {
      const text = groupHelp[target] as string | undefined
      ctx.out(text ?? topHelp)
      return exit.ok
    }
    const command = commands[name] as Command | undefined
    if (command === undefined)
      throw new SxError(
        'unknown_command',
        `${name} is not a command.`,
        closest(name, Object.keys(commands))
          ? `Did you mean: sx ${closest(name, Object.keys(commands))}? sx commands lists everything as JSON.`
          : 'sx commands lists everything as JSON.',
        exit.usage,
      )
    const code = await command({ rest, flags }, ctx)
    return code ?? exit.ok
  } catch (e) {
    if (process.env.SX_DEBUG && e instanceof Error) console.error(e.stack)
    return fail(ctx, e)
  }
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2))
