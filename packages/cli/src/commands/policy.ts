import { resolveRepo } from '../repo'
import { SxError, exit, print } from '../output'
import { str } from '../args'
import { blockers } from './change'
import type { Command } from './types'

export const policy: Command = async (
  { rest: [sub = 'check', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const id = (rest.at(0) ?? str(flags, 'change'))?.replace(/^#/, '')
  if (!id)
    throw new SxError(
      'change_not_found',
      'policy check needs a change.',
      'Example: sx policy check 216',
      exit.usage,
    )
  if (sub !== 'check' && sub !== 'explain')
    throw new SxError(
      'unknown_command',
      `policy ${sub} is not a command.`,
      'sx policy --help lists them.',
      exit.usage,
    )
  const p = (await ctx.api().get(`${repo.path}/changes/${id}/policy`)).json
  const why = blockers(p.requirements)
  const allowed = p.state === 'met'
  print(
    ctx,
    { change: p.change, allowed, requirements: why, detail: p.requirements },
    () =>
      allowed
        ? `#${p.change} meets every policy`
        : `#${p.change} is blocked:\n${why.map((w) => `  - ${w}`).join('\n')}`,
  )
  return allowed ? exit.ok : exit.policy
}
