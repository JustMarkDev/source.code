import { SxError, exit, print } from '../output'
import { str } from '../args'
import { installSkill, skillFile } from '../skill'
import { schema } from '../schema'
import type { Command } from './types'

export const skill: Command = ({ rest, flags }, ctx) => {
  const sub = rest.at(0)
  if (sub === undefined) {
    // Raw markdown, ready to redirect into a file.
    ctx.out(skillFile.trimEnd())
    return
  }
  if (sub !== 'install')
    throw new SxError(
      'unknown_command',
      `skill ${sub} is not a command.`,
      'sx skill prints the skill. sx skill install writes it into this repository.',
      exit.usage,
    )
  const target = str(flags, 'target') ?? 'claude'
  if (target !== 'claude' && target !== 'agents')
    throw new SxError(
      'bad_target',
      `${target} is not a skill target.`,
      'Use --target claude (.claude/skills/sx/SKILL.md) or --target agents (AGENTS.md).',
      exit.usage,
    )
  if (flags['dry-run'] === true) {
    print(
      ctx,
      { target, dryRun: true },
      () => `would install the ${target} skill`,
    )
    return
  }
  const r = installSkill(process.cwd(), target)
  print(ctx, { target, ...r }, () => `${r.action} ${r.path}`)
}

/** `sx commands`: the whole CLI as JSON. Always JSON, since its reader is a program. */
export const commandsList: Command = (_args, ctx) => {
  ctx.out(JSON.stringify({ commands: schema }, null, 2))
}
