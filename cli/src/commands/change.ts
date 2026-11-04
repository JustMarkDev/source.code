import { gitContext, resolveRepo } from '../repo'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { nextChangeId, store } from '../fixtures'
import { resolve } from '../config'
import type { Change } from '../fixtures'
import type { Command } from './types'

const label = (c: Change) =>
  c.state === 'landed' ? 'landed' : c.state === 'draft' ? 'draft' : 'open'

function find(id: string | undefined): Change {
  const ctxBranch = gitContext().branch
  const c = store.changes.find(
    (x) => x.id === id || (id === undefined && x.branch === ctxBranch),
  )
  if (!c)
    throw new SxError(
      'change_not_found',
      id ? `No change ${id}.` : 'No change for the current branch.',
      'sx change list shows open changes. sx change create makes one.',
      exit.notFound,
    )
  return c
}

/** What stops this change from landing, said once and the same everywhere. */
function blockers(c: Change): Array<string> {
  const out: Array<string> = []
  for (const parent of c.blockedBy) {
    const p = store.changes.find((x) => x.id === parent)
    if (p && p.state !== 'landed') out.push(`${parent} must land first`)
  }
  if (c.state === 'draft') out.push('still a draft')
  if (c.ci !== 'pass')
    out.push(c.ci === 'fail' ? 'ci/test failed' : 'ci/test is running')
  if (c.findings.high > 0)
    out.push(`${c.findings.high} high finding unresolved`)
  if (c.approvals < 1) out.push('needs 1 human approval')
  return out
}

export const change: Command = (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const dry = has(flags, 'dry-run')

  if (sub === 'list') {
    const rows = store.changes.filter(
      (c) => has(flags, 'all') || c.state !== 'landed',
    )
    print(ctx, rows, () =>
      table(
        rows.map((c) => [
          c.id,
          label(c),
          c.stack ? `${c.stack.index}/${c.stack.of}` : '-',
          c.title,
        ]),
        ['CHANGE', 'STATE', 'STACK', 'TITLE'],
      ),
    )
    return
  }

  if (sub === 'create') {
    // No questions: the title is your last commit, the base is the default
    // branch, and running it twice adds a patch set instead of a duplicate.
    const git = gitContext()
    const branch = str(flags, 'branch') ?? git.branch
    const title = str(flags, 'title') ?? git.subject
    if (!branch || !title)
      throw new SxError(
        'missing_context',
        'Could not work out a branch and title.',
        'Run inside a clone, or pass --branch and --title.',
        exit.usage,
      )
    const base = str(flags, 'base') ?? resolve('change.base').value
    const existing = store.changes.find((c) => c.branch === branch)
    if (existing) {
      if (!dry) existing.patchSets += 1
      print(
        ctx,
        { ...existing, action: 'patch_set_added', base, repo: repo.slug },
        () => `${existing.id} now at patch set ${existing.patchSets}`,
      )
      return
    }
    const created: Change = {
      id: nextChangeId(),
      title,
      branch,
      author: 'you',
      state:
        has(flags, 'draft') || resolve('change.draft').value === 'true'
          ? 'draft'
          : 'open',
      patchSets: 1,
      ci: 'pending',
      approvals: 0,
      findings: { high: 0, medium: 0, low: 0 },
      stack: null,
      blockedBy: [],
    }
    if (!dry) store.changes.push(created)
    print(
      ctx,
      { ...created, action: 'created', base, repo: repo.slug, dryRun: dry },
      () => `${dry ? 'would create' : 'created'} ${created.id}  ${title}`,
    )
    return
  }

  const c = find(rest.at(0))
  if (sub === 'view') {
    print(ctx, { ...c, blockers: blockers(c) }, () =>
      [
        `${c.id}  ${label(c)}  ${c.title}`,
        `patch sets ${c.patchSets}, ${c.approvals} approval, ci ${c.ci}`,
        ...blockers(c).map((b) => `  blocked: ${b}`),
      ].join('\n'),
    )
    return
  }

  if (sub === 'land') {
    const why = blockers(c)
    if (why.length > 0)
      throw new SxError(
        'policy_blocked',
        `${c.id} cannot land: ${why.join('; ')}.`,
        'sx change view shows each requirement. sx policy explain says which rule asked for it.',
        exit.policy,
      )
    if (!dry) c.state = 'landed'
    print(
      ctx,
      { id: c.id, landed: !dry, dryRun: dry },
      () => `${dry ? 'would land' : 'landed'} ${c.id}`,
    )
    return
  }

  if (sub === 'checkout') {
    print(ctx, { id: c.id, branch: c.branch }, () => `git switch ${c.branch}`)
    return
  }

  throw new SxError(
    'unknown_command',
    `change ${sub} is not a command.`,
    'sx change --help lists them.',
    exit.usage,
  )
}

export { blockers }
