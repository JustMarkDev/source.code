import { accountNotFound, activeAccount, findAccount } from '../account'
import { gitContext, resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { store } from '../fixtures'
import { resolve } from '../config'
import type { Command } from './types'

const ownerOf = (slug: string) => slug.split('/').at(0) ?? ''

export const repo: Command = (
  { rest: [sub = 'view', ...rest], flags },
  ctx,
) => {
  if (sub === 'list') {
    // The repositories of the account you are acting as, or of all of them.
    const owners = new Set(
      has(flags, 'all')
        ? store.accounts.map((a) => a.handle)
        : [activeAccount(flags).handle],
    )
    const shown = store.repos.filter((r) => owners.has(ownerOf(r.slug)))
    print(ctx, shown, () =>
      table(
        shown.map((r) => [r.slug, r.visibility, String(r.stars)]),
        ['REPO', 'VISIBILITY', 'STARS'],
      ),
    )
    return
  }
  if (sub === 'create') {
    const given = rest.at(0)
    if (!given)
      throw new SxError(
        'missing_argument',
        'repo create needs a name.',
        'Example: sx repo create notes (as the account you are acting as), or sx repo create dana/notes',
        exit.usage,
      )
    // A bare name goes in the account you are acting as.
    const slug = given.includes('/')
      ? given
      : `${activeAccount(flags).handle}/${given}`
    const owner = findAccount(ownerOf(slug))
    if (!owner) throw accountNotFound(ownerOf(slug))
    if (owner.role === 'member')
      throw new SxError(
        'account_forbidden',
        `Members of ${owner.handle} cannot create repositories there.`,
        'Ask an owner or admin, or create it in an account you manage. sx account list shows your role in each.',
        exit.policy,
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
