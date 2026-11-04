import { resolveRepo } from '../repo'
import { SxError, exit, print } from '../output'
import { str } from '../args'
import { store } from '../fixtures'
import { blockers } from './change'
import type { Command } from './types'

export const policy: Command = (
  { rest: [sub = 'check', ...rest], flags },
  ctx,
) => {
  resolveRepo(str(flags, 'repo'))
  const c = store.changes.find(
    (x) => x.id === (rest.at(0) ?? str(flags, 'change')),
  )
  if (!c)
    throw new SxError(
      'change_not_found',
      'policy check needs a change.',
      'Example: sx policy check ch_7f3a',
      exit.usage,
    )
  const why = blockers(c)
  if (sub === 'check' || sub === 'explain') {
    print(
      ctx,
      { change: c.id, allowed: why.length === 0, requirements: why },
      () =>
        why.length === 0
          ? `${c.id} meets every policy`
          : `${c.id} is blocked:\n${why.map((w) => `  - ${w}`).join('\n')}`,
    )
    return why.length === 0 ? exit.ok : exit.policy
  }
  throw new SxError(
    'unknown_command',
    `policy ${sub} is not a command.`,
    'sx policy --help lists them.',
    exit.usage,
  )
}
