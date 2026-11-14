import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp } from '../registry'
import * as S from '../schemas'
import { repoParams } from './common'

export const repoInsights = defineOp({
  id: 'repos.insights',
  summary: 'What a repository adds up to',
  description:
    'Commits by week and by who wrote them (people, agents, bots), contributors, downloads by day, stars, issues and changes.',
  tags: ['repositories'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/insights',
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'heavy',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  response: S.RepoInsights,
  errors: ['not_found', 'moved'],
  probe: (ctx, d) =>
    d.insightsVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.repoInsights(ctx.params.owner, ctx.params.repo, ctx.principal),
      )
    }),
})

export const dashboard = defineOp({
  id: 'dashboard.get',
  summary: 'Your dashboard',
  description:
    'For the account you act as: what needs you, what is moving without you, recent activity, repository health, mirrors, storage, downloads, your contributions and stars.',
  tags: ['accounts'],
  method: 'GET',
  path: '/dashboard',
  auth: 'required',
  pool: 'heavy',
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    account: z
      .string()
      .optional()
      .describe(
        'An organization you belong to. Default: the account you act as',
      ),
  }),
  response: S.Dashboard,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.dashboard(ctx.principal, ctx.query.account))
    }),
})

export const insightOps = [repoInsights, dashboard]
