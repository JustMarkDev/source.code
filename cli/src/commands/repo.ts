import { gitContext, resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { str } from '../args'
import { store } from '../fixtures'
import { resolve } from '../config'
import type { Command } from './types'

export const repo: Command = (
  { rest: [sub = 'view', ...rest], flags },
  ctx,
) => {
  if (sub === 'list') {
    print(ctx, store.repos, () =>
      table(
        store.repos.map((r) => [r.slug, r.visibility, String(r.stars)]),
        ['REPO', 'VISIBILITY', 'STARS'],
      ),
    )
    return
  }
  if (sub === 'create') {
    const slug = rest.at(0)
    if (!slug?.includes('/'))
      throw new SxError(
        'missing_argument',
        'repo create needs owner/name.',
        'Example: sx repo create dana/notes --public',
        exit.usage,
      )
    const existing = store.repos.find((r) => r.slug === slug)
    // Creating twice is fine: the answer is the repository that exists.
    const created = existing ?? {
      slug,
      description: str(flags, 'description') ?? '',
      visibility:
        flags.private === true ? ('private' as const) : ('public' as const),
      defaultBranch: 'main',
      stars: 0,
    }
    if (!existing && flags['dry-run'] !== true) store.repos.push(created)
    print(ctx, { ...created, created: !existing }, () =>
      existing ? `${slug} already exists` : `created ${slug}`,
    )
    return
  }
  if (sub === 'clone') {
    const slug = rest.at(0)
    if (!slug)
      throw new SxError(
        'missing_argument',
        'repo clone needs owner/name.',
        'Example: sx repo clone dana/gitfs',
        exit.usage,
      )
    const proto = resolve('clone.protocol').value
    const url =
      proto === 'https'
        ? `https://source.code/${slug}.git`
        : `git@source.code:${slug}.git`
    print(ctx, { slug, url }, () => `git clone ${url}`)
    return
  }
  const r = resolveRepo(str(flags, 'repo'))
  if (sub === 'view') {
    print(
      ctx,
      { ...r, branch: gitContext().branch ?? null },
      () => `${r.slug}  ${r.visibility}  ${r.stars} stars\n${r.description}`,
    )
    return
  }
  throw new SxError(
    'unknown_command',
    `repo ${sub} is not a command.`,
    'sx repo --help lists them.',
    exit.usage,
  )
}
