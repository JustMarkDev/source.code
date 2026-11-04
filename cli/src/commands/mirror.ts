import { resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { store } from '../fixtures'
import type { Command } from './types'

export const mirror: Command = (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  resolveRepo(str(flags, 'repo'))
  if (sub === 'list') {
    print(ctx, store.mirrors, () =>
      table(
        store.mirrors.map((m) => [m.id, m.host, m.slug, m.direction, m.state]),
        ['ID', 'HOST', 'REPO', 'DIRECTION', 'STATE'],
      ),
    )
    return
  }
  if (sub === 'add') {
    const [host, slug] = rest
    if (!host || !slug)
      throw new SxError(
        'missing_argument',
        'mirror add needs a host and owner/name.',
        'Example: sx mirror add codeberg dana/gitfs --direction push',
        exit.usage,
      )
    const dupe = store.mirrors.find((m) => m.host === host && m.slug === slug)
    const created = dupe ?? {
      id: `m${store.mirrors.length + 1}`,
      host,
      slug,
      direction:
        (str(flags, 'direction') as 'push' | 'pull' | 'two-way' | undefined) ??
        'push',
      state: 'in-sync' as const,
      lastSync: new Date().toISOString(),
    }
    if (!dupe && !has(flags, 'dry-run')) store.mirrors.push(created)
    print(
      ctx,
      { ...created, created: !dupe },
      () => `${dupe ? 'already mirrored' : 'added'} ${host}:${slug}`,
    )
    return
  }
  const m = store.mirrors.find((x) => x.id === rest.at(0))
  if (!m)
    throw new SxError(
      'mirror_not_found',
      `No mirror ${rest.at(0) ?? ''}.`,
      'sx mirror list shows ids.',
      exit.notFound,
    )
  if (sub === 'sync') {
    m.state = 'in-sync'
    m.lastSync = new Date().toISOString()
    print(ctx, m, () => `synced ${m.host}:${m.slug}`)
    return
  }
  if (sub === 'remove') {
    if (!has(flags, 'dry-run'))
      store.mirrors.splice(store.mirrors.indexOf(m), 1)
    print(
      ctx,
      { removed: m.id },
      () => `removed ${m.host}:${m.slug}. History here is untouched.`,
    )
    return
  }
  throw new SxError(
    'unknown_command',
    `mirror ${sub} is not a command.`,
    'sx mirror --help lists them.',
    exit.usage,
  )
}
