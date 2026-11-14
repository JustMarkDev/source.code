import { showTimeline } from '../timeline'
import { showPresence } from '../presence'
import { amendHead, gitContext, headCommit, resolveRepo } from '../repo'
import { runTrailerOn, withRunTrailer } from '../trailer'
import { SxError, exit, print, table } from '../output'
import { has, str } from '../args'
import { resolve } from '../config'
import type { Ctx } from '../output'
import type { Command } from './types'

type Change = any

const label = (c: Change) => c.state
const num = (id: string) => id.replace(/^#/, '')

/** What stops this change from landing, said once and the same everywhere. */
export function blockers(
  requirements: Array<{ state: string; detail: string }>,
): Array<string> {
  return requirements
    .filter((r) => r.state === 'fail' || r.state === 'pending')
    .map((r) => r.detail)
}

export const landHint =
  'sx change view shows each requirement. sx policy explain says which rule asked for it.'

async function find(
  ctx: Ctx,
  repoPath: string,
  id: string | undefined,
): Promise<Change> {
  const api = ctx.api()
  if (id) return (await api.get(`${repoPath}/changes/${num(id)}`)).json
  const branch = gitContext().branch
  if (branch) {
    const found = (
      await api.get(`${repoPath}/changes`, {
        query: { branch, state: 'open,draft', limit: 1 },
      })
    ).json.data[0]
    if (found) return found
  }
  throw new SxError(
    'not_found',
    'No change for the current branch.',
    'sx change list shows open changes. sx change create makes one.',
    exit.notFound,
  )
}

export const change: Command = async (
  { rest: [sub = 'list', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const api = ctx.api()
  const dry = has(flags, 'dry-run')

  if (sub === 'list') {
    const rows = (
      await api.get(`${repo.path}/changes`, {
        query: { state: has(flags, 'all') ? 'all' : undefined, limit: 200 },
      })
    ).json.data as Array<Change>
    print(ctx, rows, () =>
      table(
        rows.map((c) => [
          `#${c.number}`,
          label(c),
          c.stack ? `${c.stack.position}/${c.stack.size}` : '-',
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
    const draft =
      has(flags, 'draft') || resolve('change.draft').value === 'true'
    // Inside an agent run (SX_RUN), the commit says which run made it: a
    // `Run-Id:` trailer, when the repository keeps one. The server reads it.
    const run = process.env.SX_RUN
    let head: { sha: string; message: string } | undefined
    if (run && /^run_[A-Za-z0-9]+$/.test(run) && !str(flags, 'branch')) {
      head = headCommit()
      const shown = head && (await api.get(repo.path)).json
      if (head && shown && runTrailerOn(shown)) {
        const message = withRunTrailer(head.message, run)
        if (message.trim() !== head.message.trim() && !dry) {
          const sha = amendHead(message)
          if (!sha)
            throw new SxError(
              'git_failed',
              'Could not add the Run-Id trailer to HEAD.',
              'Commit your work, then run sx change create again.',
              exit.usage,
            )
          head = { sha, message }
        } else head = { ...head, message }
      }
    }
    // The review threads this patch set fixes: `--addresses cmt_1,cmt_2`.
    const addresses = (str(flags, 'addresses') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((comment) => ({ comment }))
    const r = await api.post(`${repo.path}/changes`, {
      body: {
        branch,
        title,
        base,
        draft,
        ...(head ? { sha: head.sha, message: head.message } : {}),
        ...(addresses.length ? { addresses } : {}),
      },
      dryRun: dry,
    })
    const action = r.headers.get('sx-outcome') ?? 'created'
    print(
      ctx,
      {
        ...r.json,
        id: String(r.json.number),
        action,
        base,
        repo: repo.slug,
        dryRun: dry,
      },
      () =>
        action === 'created'
          ? `${dry ? 'would create' : 'created'} #${r.json.number}  ${title}`
          : `#${r.json.number} ${dry ? 'would be' : 'now'} at patch set ${r.json.patch_set_count}`,
    )
    return
  }

  const c = await find(ctx, repo.path, rest.at(0))
  if (sub === 'guide') {
    // `--set '<json>'` writes it: {"summary": "...", "order": [{"path", "why", "risk"}]}.
    const set = str(flags, 'set')
    const path = `${repo.path}/changes/${c.number}/guide`
    let body: unknown
    if (set)
      try {
        body = JSON.parse(set)
      } catch {
        throw new SxError(
          'bad_json',
          '--set is not JSON.',
          'Send {"summary": "...", "order": [{"path": "...", "why": "...", "risk": "low"}]}.',
          exit.usage,
        )
      }
    const g = set
      ? (await api.put(path, { body, dryRun: has(flags, 'dry-run') })).json
      : (await api.get(path)).json
    print(ctx, { ...g, id: String(c.number) }, () =>
      [
        `#${c.number} guide for patch set ${g.patch_set}${g.current ? '' : ' (an older one)'}`,
        g.summary,
        ...g.order.map(
          (o: { path: string; why: string; risk: string }, i: number) =>
            `${i + 1}. ${o.path} [${o.risk}] ${o.why}`,
        ),
      ].join('\n'),
    )
    return
  }
  if (sub === 'presence') {
    await showPresence(
      ctx,
      `${repo.path}/changes/${c.number}/presence`,
      String(c.number),
      {
        here: has(flags, 'here'),
        path: str(flags, 'path'),
        leave: has(flags, 'leave'),
      },
    )
    return
  }
  if (sub === 'timeline') {
    await showTimeline(
      ctx,
      `${repo.path}/changes/${c.number}/timeline`,
      String(c.number),
    )
    return
  }
  if (sub === 'view') {
    const policy = (await api.get(`${repo.path}/changes/${c.number}/policy`))
      .json
    const why = blockers(policy.requirements)
    print(ctx, { ...c, id: String(c.number), blockers: why }, () =>
      [
        `#${c.number}  ${label(c)}  ${c.title}`,
        `patch sets ${c.patch_set_count}, checks ${c.checks.state}, policy ${c.policy.state}`,
        ...why.map((b) => `  blocked: ${b}`),
      ].join('\n'),
    )
    return
  }

  if (sub === 'land') {
    try {
      // Land exactly the tree we just read, so nothing lands that was not looked at.
      await api.post(`${repo.path}/changes/${c.number}/land`, {
        body: { expected_tree: c.head.tree },
        dryRun: dry,
      })
    } catch (e) {
      if (e instanceof SxError && e.code === 'policy_blocked')
        throw new SxError(e.code, e.message, landHint, e.status)
      throw e
    }
    print(
      ctx,
      { id: String(c.number), number: c.number, landed: !dry, dryRun: dry },
      () => `${dry ? 'would land' : 'landed'} #${c.number}`,
    )
    return
  }

  if (sub === 'checkout') {
    print(
      ctx,
      { id: String(c.number), branch: c.branch },
      () => `git switch ${c.branch}`,
    )
    return
  }

  throw new SxError(
    'unknown_command',
    `change ${sub} is not a command.`,
    'sx change --help lists them.',
    exit.usage,
  )
}
