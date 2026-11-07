import { resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import type { Command } from './types'

type Mirror = {
  id: string
  host: string
  slug: string
  direction: string
  state: string
  last_sync_at: string
}

export const mirror: Command = async (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const api = ctx.api()
  const dry = has(flags, 'dry-run')
  if (sub === 'list') {
    const rows = (await api.get(`${repo.path}/mirrors`)).json
      .data as Array<Mirror>
    print(ctx, rows, () =>
      table(
        rows.map((m) => [m.id, m.host, m.slug, m.direction, m.state]),
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
    const r = await api.post(`${repo.path}/mirrors`, {
      body: { host, slug, direction: str(flags, 'direction') ?? 'push' },
      dryRun: dry,
    })
    const created = r.headers.get('sx-outcome') === 'created'
    print(
      ctx,
      { ...r.json, created },
      () => `${created ? 'added' : 'already mirrored'} ${host}:${slug}`,
    )
    return
  }
  const id = rest.at(0)
  if (!id)
    throw new SxError(
      'mirror_not_found',
      `mirror ${sub} needs an id.`,
      'sx mirror list shows ids.',
      exit.notFound,
    )
  if (sub === 'sync') {
    const m = (
      await api.post(`${repo.path}/mirrors/${id}/sync`, { dryRun: dry })
    ).json as Mirror
    print(ctx, m, () => `synced ${m.host}:${m.slug}`)
    return
  }
  if (sub === 'remove') {
    await api.del(`${repo.path}/mirrors/${id}`, { dryRun: dry })
    print(
      ctx,
      { removed: id },
      () => `removed ${id}. History here is untouched.`,
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
