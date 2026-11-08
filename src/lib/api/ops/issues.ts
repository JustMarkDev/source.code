import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { issueMarkdown } from '../markdown'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const topic = (p: { owner: string; repo: string }, d?: { repoIdForHistory?: (full: string) => string | null }) => {
  const id = d?.repoIdForHistory?.(`${p.owner}/${p.repo}`)
  if (id) return `repo-id:${id}`
  const owner = p.owner.toLowerCase()
  return owner.startsWith('rep_') ? `repo-id:${owner}` : `repo:${owner}/${p.repo.toLowerCase()}`
}
const issueParams = repoParams.extend({
  number: z.coerce.number().int().min(1).describe('The issue number'),
})

export const listIssues = defineOp({
  id: 'issues.list',
  summary: 'Issues in a repository',
  description: 'Open by default, newest number first.',
  tags: ['issues'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/issues',
  auth: 'optional',
  scopes: ['issues:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  query: z.strictObject({
    ...pageShape,
    state: z.enum(['open', 'closed', 'all']).default('open'),
    label: z.string().optional().describe('A label name'),
    author: z.string().optional().describe('Handle of the author'),
  }),
  response: S.listOf(S.Issue),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  shapeable: true,
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) => d.issueListVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      const f = fp('issues.list', ctx.params.owner, ctx.params.repo, q.state, q.label, q.author)
      const page = yield* run((d) =>
        d.listIssues(ctx.params.owner, ctx.params.repo, ctx.principal, {
          state: q.state,
          label: q.label,
          author: q.author,
          after: afterOf(q.cursor, f),
          limit: q.limit,
        }),
      )
      return listOf(page.items as unknown as Array<z.infer<typeof S.Issue>>, page.next, f)
    }),
})

export const getIssue = defineOp({
  id: 'issues.get',
  summary: 'One issue',
  tags: ['issues'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/issues/{number}',
  auth: 'optional',
  scopes: ['issues:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: issueParams,
  response: S.Issue,
  errors: ['not_found', 'moved'],
  shapeable: true,
  markdown: issueMarkdown,
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
      d.issueVersion(ctx.params.owner, ctx.params.repo, ctx.params.number, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getIssue(ctx.params.owner, ctx.params.repo, ctx.params.number, ctx.principal))
    }),
})

export const createIssue = defineOp({
  id: 'issues.create',
  summary: 'Open an issue',
  description:
    'Naturally idempotent: an open issue with the same title is returned instead of a second one. `Sx-Outcome` is created or unchanged.',
  tags: ['issues'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/issues',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: repoParams,
  body: z.strictObject({
    title: z.string().min(1).max(300),
    body: z.string().max(65536).optional(),
    labels: z.array(z.string().max(50)).max(50).optional(),
  }),
  response: S.Issue,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createIssue(ctx.params.owner, ctx.params.repo, ctx.principal, ctx.body, ctx.dryRun),
      )
      return reply(r.issue, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: {
          'sx-outcome': r.outcome,
          ...(r.outcome === 'created' ? { location: r.issue.url } : {}),
        },
      })
    }),
})

export const updateIssue = defineOp({
  id: 'issues.update',
  summary: 'Edit an issue, or close or reopen it',
  description: 'Send If-Match with the ETag you read. `state: closed` closes.',
  tags: ['issues'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/issues/{number}',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: issueParams,
  body: z.strictObject({
    title: z.string().min(1).max(300).optional(),
    body: z.string().max(65536).optional(),
    labels: z.array(z.string().max(50)).max(50).optional(),
    state: z.enum(['open', 'closed']).optional(),
  }),
  response: S.Issue,
  errors: ['not_found', 'forbidden', 'version_mismatch', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateIssue(ctx.params.owner, ctx.params.repo, ctx.params.number, ctx.principal, ctx.body, ctx.ifMatch, ctx.dryRun),
      )
    }),
})

export const issueOps = [listIssues, getIssue, createIssue, updateIssue]
