import { resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { store } from '../fixtures'
import type { Command } from './types'

export const issue: Command = (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  resolveRepo(str(flags, 'repo'))
  if (sub === 'list') {
    const state = str(flags, 'state') ?? 'open'
    const rows = store.issues.filter(
      (i) => state === 'all' || i.state === state,
    )
    print(ctx, rows, () =>
      table(
        rows.map((i) => [`#${i.number}`, i.state, i.title]),
        ['ISSUE', 'STATE', 'TITLE'],
      ),
    )
    return
  }
  if (sub === 'create') {
    const title = str(flags, 'title') ?? rest.join(' ')
    if (!title)
      throw new SxError(
        'missing_argument',
        'issue create needs a title.',
        'Example: sx issue create "Crash on empty repo" --label bug',
        exit.usage,
      )
    const dupe = store.issues.find(
      (i) => i.title === title && i.state === 'open',
    )
    if (dupe) {
      print(
        ctx,
        { ...dupe, created: false },
        () => `#${dupe.number} already open`,
      )
      return
    }
    const created = {
      number: Math.max(...store.issues.map((i) => i.number)) + 1,
      title,
      state: 'open' as const,
      author: 'you',
      labels: str(flags, 'label')?.split(',') ?? [],
    }
    if (!has(flags, 'dry-run')) store.issues.push(created)
    print(
      ctx,
      { ...created, created: true },
      () => `created #${created.number}`,
    )
    return
  }
  const n = Number((rest.at(0) ?? '').replace('#', ''))
  const found = store.issues.find((i) => i.number === n)
  if (!found)
    throw new SxError(
      'issue_not_found',
      `No issue ${rest.at(0) ?? ''}.`,
      'sx issue list --state all shows every issue.',
      exit.notFound,
    )
  if (sub === 'view') {
    print(ctx, found, () => `#${found.number} ${found.state}  ${found.title}`)
    return
  }
  if (sub === 'close') {
    if (!has(flags, 'dry-run')) found.state = 'closed'
    print(ctx, found, () => `closed #${found.number}`)
    return
  }
  throw new SxError(
    'unknown_command',
    `issue ${sub} is not a command.`,
    'sx issue --help lists them.',
    exit.usage,
  )
}
