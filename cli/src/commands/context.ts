import { activeAccount } from '../account'
import { gitContext, resolveRepo } from '../repo'
import { print } from '../output'
import { str } from '../args'
import { store } from '../fixtures'
import { blockers } from './change'
import type { Command } from './types'

/** Everything an agent needs to start well, in one call, with no secret values. */
export const context: Command = ({ flags }, ctx) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const git = gitContext()
  const acting = activeAccount(flags)
  const data = {
    account: { handle: acting.handle, kind: acting.kind, role: acting.role },
    repo: repo.slug,
    defaultBranch: repo.defaultBranch,
    branch: git.branch ?? null,
    openChanges: store.changes
      .filter((c) => c.state !== 'landed')
      .map((c) => ({ id: c.id, title: c.title, blockers: blockers(c) })),
    openIssues: store.issues
      .filter((i) => i.state === 'open')
      .map((i) => ({ number: i.number, title: i.title })),
    policy: { humanApprovalRequired: true, agentsMayApprove: false },
    envSchema: store.env.map((v) => ({ name: v.name, secret: v.secret })),
    envAccess: {
      values: 'never returned',
      run: 'sx env run --env development -- <command>',
      needAccess:
        'sx env grant request --env development --reason "<why>"; a person approves; then retry',
      activeGrants: store.grants
        .filter((g) => g.state === 'active')
        .map((g) => ({ id: g.id, env: g.env, expires: g.expires })),
      production: 'not available to agents',
    },
    note: 'Secret values are never included. Run commands through sx env run so values reach the process but never you.',
  }
  print(ctx, data, () => JSON.stringify(data, null, 2))
}
