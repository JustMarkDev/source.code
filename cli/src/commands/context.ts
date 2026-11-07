import { activeAccount } from '../account'
import { gitContext, resolveRepo } from '../repo'
import { print } from '../output'
import { str } from '../args'
import type { Command } from './types'

/** Everything an agent needs to start well, in one call, with no secret values. */
export const context: Command = async ({ flags }, ctx) => {
  const repo = resolveRepo(str(flags, 'repo'))
  const git = gitContext()
  const api = ctx.api()
  const [acting, c, grants] = await Promise.all([
    activeAccount(ctx, flags),
    api.get(`${repo.path}/context`),
    // Reading grants needs a scope some tokens do not have; that is not an error here.
    api.get(`${repo.path}/env/grants`).catch(() => ({
      json: {
        data: [] as Array<{
          id: string
          state: string
          environment: string
          expires_at: string | null
        }>,
      },
    })),
  ])
  const data = {
    account: { handle: acting.handle, kind: acting.kind, role: acting.role },
    repo: repo.slug,
    defaultBranch: c.json.repo.default_branch,
    branch: git.branch ?? null,
    openChanges: c.json.changes.map(
      (x: { number: number; title: string; blocking: Array<string> }) => ({
        number: x.number,
        title: x.title,
        blockers: x.blocking,
      }),
    ),
    openIssues: c.json.issues.map((i: { number: number; title: string }) => ({
      number: i.number,
      title: i.title,
    })),
    policy: { humanApprovalRequired: true, agentsMayApprove: false },
    envSchema: c.json.env.map((v: { name: string; kind: string }) => ({
      name: v.name,
      kind: v.kind,
    })),
    envAccess: {
      values: 'never returned',
      run: 'sx env run --env development -- <command>',
      needAccess:
        'sx env grant request --env development --reason "<why>"; a person approves; then retry',
      activeGrants: grants.json.data
        .filter((g: { state: string }) => g.state === 'active')
        .map(
          (g: {
            id: string
            environment: string
            expires_at: string | null
          }) => ({ id: g.id, env: g.environment, expires: g.expires_at }),
        ),
      production: 'not available to agents',
    },
    cursor: c.json.cursor,
    note: 'Secret values are never included. Run commands through sx env run so values reach the process but never you.',
  }
  print(ctx, data, () => JSON.stringify(data, null, 2))
}
