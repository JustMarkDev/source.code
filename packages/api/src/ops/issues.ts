import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { issueMarkdown } from '../markdown'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const topic = async (
  p: { owner: string; repo: string },
  d?: {
    repoIdForHistory?: (full: string) => string | null | Promise<string | null>
  },
) => {
  const id = await d?.repoIdForHistory?.(`${p.owner}/${p.repo}`)
  if (id) return `repo-id:${id}`
  const owner = p.owner.toLowerCase()
  return owner.startsWith('rep_')
    ? `repo-id:${owner}`
    : `repo:${owner}/${p.repo.toLowerCase()}`
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
  probe: (ctx, d) =>
    d.issueListVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      const f = fp(
        'issues.list',
        ctx.params.owner,
        ctx.params.repo,
        q.state,
        q.label,
        q.author,
      )
      const page = yield* run((d) =>
        d.listIssues(ctx.params.owner, ctx.params.repo, ctx.principal, {
          state: q.state,
          label: q.label,
          author: q.author,
          after: afterOf(q.cursor, f),
          limit: q.limit,
        }),
      )
      return listOf(
        page.items as unknown as Array<z.infer<typeof S.Issue>>,
        page.next,
        f,
      )
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
    d.issueVersion(
      ctx.params.owner,
      ctx.params.repo,
      ctx.params.number,
      ctx.principal,
    ),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getIssue(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
        ),
      )
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
  body: bodies['issues.create'],
  response: S.Issue,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createIssue(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
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
  ifMatch: true,
  idempotent: true,
  dryRun: true,
  params: issueParams,
  body: bodies['issues.update'],
  response: S.Issue,
  errors: [
    'not_found',
    'forbidden',
    'version_mismatch',
    'moved',
    'invalid_request',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateIssue(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.ifMatch,
          ctx.dryRun,
        ),
      )
    }),
})

const labelParams = repoParams.extend({
  label: z.string().min(1).max(50).describe('The label name'),
})
const commentParams = repoParams.extend({
  comment: z.string().describe('The comment id'),
})
const labelColor = z.enum(S.labelColors)

export const listLabels = defineOp({
  id: 'labels.list',
  summary: 'Labels in a repository',
  description:
    'Every label, by name, with how many open issues carry it. A repository starts with six.',
  tags: ['issues'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/labels',
  auth: 'optional',
  scopes: ['issues:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  response: z.strictObject({
    object: z.literal('list'),
    data: z.array(S.Label),
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
  errors: ['not_found', 'moved'],
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.labelsVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listLabels(ctx.params.owner, ctx.params.repo, ctx.principal),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false as const,
        next_cursor: null,
      }
    }),
})

export const createLabel = defineOp({
  id: 'labels.create',
  summary: 'Add a label',
  description:
    'Naturally idempotent: a label with the same name, in any case, is returned instead. `Sx-Outcome` is created or unchanged.',
  tags: ['issues'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/labels',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: repoParams,
  body: z.strictObject({
    name: z.string().trim().min(1).max(50),
    color: labelColor.optional().describe('Gray when left out'),
    description: z.string().max(200).optional(),
  }),
  response: S.Label,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createLabel(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r.label, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: { 'sx-outcome': r.outcome },
      })
    }),
})

export const updateLabel = defineOp({
  id: 'labels.update',
  summary: 'Rename or recolour a label',
  description: 'A new name follows the label onto every issue that has it.',
  tags: ['issues'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/labels/{label}',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: labelParams,
  body: z.strictObject({
    name: z.string().trim().min(1).max(50).optional(),
    color: labelColor.optional(),
    description: z.string().max(200).optional(),
  }),
  response: S.Label,
  errors: ['not_found', 'forbidden', 'moved', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateLabel(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.label,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const deleteLabel = defineOp({
  id: 'labels.delete',
  summary: 'Delete a label',
  description: 'It comes off every issue that has it.',
  tags: ['issues'],
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/labels/{label}',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  params: labelParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.deleteLabel(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.label,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const listComments = defineOp({
  id: 'comments.list',
  summary: 'Comments on an issue',
  description: 'Oldest first.',
  tags: ['issues'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/issues/{number}/comments',
  auth: 'optional',
  scopes: ['issues:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: issueParams,
  query: z.strictObject({ ...pageShape }),
  response: S.listOf(S.IssueComment),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  waitOn: (p, _q, d) => topic(p, d),
  probe: (ctx, d) =>
    d.commentsVersion(
      ctx.params.owner,
      ctx.params.repo,
      ctx.params.number,
      ctx.principal,
    ),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp(
        'comments.list',
        ctx.params.owner,
        ctx.params.repo,
        String(ctx.params.number),
      )
      const page = yield* run((d) =>
        d.listComments(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          { after: afterOf(ctx.query.cursor, f), limit: ctx.query.limit },
        ),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const createComment = defineOp({
  id: 'comments.create',
  summary: 'Comment on an issue',
  description:
    'Anyone who can read the repository may comment. Not idempotent by nature: send an `Idempotency-Key` to retry safely.',
  tags: ['issues'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/issues/{number}/comments',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  dryRun: true,
  params: issueParams,
  body: bodies['comments.create'],
  response: S.IssueComment,
  status: 201,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const c = yield* run((d) =>
        d.createComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(c, { status: ctx.dryRun ? 200 : 201 })
    }),
})

export const updateComment = defineOp({
  id: 'comments.update',
  summary: 'Edit a comment',
  description: 'Its author only. Send If-Match with the ETag you read.',
  tags: ['issues'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/issues/comments/{comment}',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'write',
  ifMatch: true,
  idempotent: true,
  dryRun: true,
  params: commentParams,
  body: z.strictObject({ body: z.string().trim().min(1).max(65536) }),
  response: S.IssueComment,
  errors: ['not_found', 'forbidden', 'version_mismatch', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.comment,
          ctx.principal,
          ctx.body,
          ctx.ifMatch,
          ctx.dryRun,
        ),
      )
    }),
})

export const deleteComment = defineOp({
  id: 'comments.delete',
  summary: 'Delete a comment',
  description: 'Its author, or anyone who can change the repository.',
  tags: ['issues'],
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/issues/comments/{comment}',
  auth: 'required',
  scopes: ['issues:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  params: commentParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.deleteComment(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.comment,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const issueOps = [
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listComments,
  createComment,
  updateComment,
  deleteComment,
]
