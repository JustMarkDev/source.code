import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { contextMarkdown } from '../markdown'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const common = {
  auth: 'optional' as const,
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
}

export const listAccounts = defineOp({
  ...common,
  id: 'accounts.list',
  summary: 'Every account you can act as',
  description:
    'Yourself and each organization you belong to, with your role in each. Send Sx-Account to act as one of them.',
  tags: ['accounts'],
  method: 'GET',
  path: '/accounts',
  auth: 'required',
  response: z.strictObject({
    object: z.literal('list'),
    data: z.array(S.Account),
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) => d.listAccounts(ctx.principal!))
      return { object: 'list' as const, data, has_more: false as const, next_cursor: null }
    }),
})

export const getAccount = defineOp({
  ...common,
  id: 'accounts.get',
  summary: 'One account',
  tags: ['accounts'],
  method: 'GET',
  path: '/accounts/{handle}',
  params: z.object({ handle: z.string().describe('Account handle') }),
  response: S.Account,
  errors: ['not_found'],
  shapeable: true,
  probe: (ctx, d) =>
      d.accountVersion(ctx.params.handle),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getAccount(ctx.params.handle, ctx.principal))
    }),
})

export const listRepos = defineOp({
  ...common,
  id: 'repos.list',
  summary: 'Repositories you can see',
  tags: ['repositories'],
  method: 'GET',
  path: '/repos',
  query: z.strictObject({
    ...pageShape,
    owner: z.string().optional().describe('Only repositories of this account'),
  }),
  response: S.listOf(S.Repo),
  shapeable: true,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp('repos.list', ctx.query.owner)
      const page = yield* run((d) =>
        d.listRepos(ctx.principal, {
          owner: ctx.query.owner,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const getRepo = defineOp({
  ...common,
  id: 'repos.get',
  summary: 'One repository',
  tags: ['repositories'],
  method: 'GET',
  path: '/repos/{owner}/{repo}',
  params: repoParams,
  response: S.Repo,
  errors: ['not_found', 'moved'],
  shapeable: true,
  waitOn: (p) => `repo:${p.owner}/${p.repo}`,
  probe: (ctx, d) =>
      d.repoVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getRepo(ctx.params.owner, ctx.params.repo, ctx.principal))
    }),
})

export const repoContext = defineOp({
  ...common,
  id: 'repos.context',
  summary: 'Everything needed to start work, in one request',
  description:
    'Open changes and what blocks each, open issues, a policy summary and the env schema (names and kinds only, never values). This is what `sx context` calls. The cursor is a position in the event log to continue from with /sync.',
  tags: ['repositories', 'agents'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/context',
  params: repoParams,
  response: S.Context,
  errors: ['not_found', 'moved'],
  shapeable: true,
  markdown: contextMarkdown,
  waitOn: (p) => `repo:${p.owner}/${p.repo}`,
  probe: (ctx, d) => d.repoVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.context(ctx.params.owner, ctx.params.repo, ctx.principal))
    }),
})

export const numberRef = defineOp({
  ...common,
  id: 'repos.number',
  summary: 'Resolve #n to a change or an issue',
  description:
    'Changes and issues share one counter per repository, so a number is never ambiguous. Answers 200 with the type and its address.',
  tags: ['repositories'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/numbers/{number}',
  params: repoParams.extend({
    number: z.coerce.number().int().min(1).describe('A change or issue number'),
  }),
  response: S.NumberRef,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.numberRef(ctx.params.owner, ctx.params.repo, ctx.params.number, ctx.principal))
    }),
})

export const updateRepo = defineOp({
  id: 'repos.update',
  summary: 'Rename a repository, change its description, visibility or default branch',
  description:
    'Owners of the account and admins of the organization only. Send `If-Match` with the ETag you read. A rename keeps working at the old address: it answers `308` with the new one, and webhooks, mirrors and variables move with the repository. Making a repository private hides it from everyone who could only see it because it was public.',
  tags: ['repositories'],
  method: 'PATCH',
  path: '/repos/{owner}/{repo}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: repoParams,
  body: z.strictObject({
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'Letters, digits, dot, dash and underscore; up to 100')
      .optional(),
    description: z.string().max(500).optional(),
    visibility: z.enum(['public', 'private']).optional(),
    default_branch: z.string().min(1).max(200).optional(),
  }),
  response: S.Repo,
  errors: ['not_found', 'forbidden', 'version_mismatch', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateRepo(ctx.params.owner, ctx.params.repo, ctx.principal!, ctx.body, ctx.ifMatch, ctx.dryRun),
      )
    }),
})

export const deleteRepo = defineOp({
  id: 'repos.delete',
  summary: 'Delete a repository',
  description:
    'Permanent. Owners of the account and admins of the organization only. You must repeat the full name as `?confirm=owner/name`, so a mistyped path cannot delete the wrong thing. Its changes, issues, webhooks, mirrors and variables go with it; events already written stay in the log.',
  tags: ['repositories'],
  method: 'DELETE',
  path: '/repos/{owner}/{repo}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: false,
  dryRun: true,
  params: repoParams,
  query: z.strictObject({ confirm: z.string().optional().describe('`owner/name`, to confirm') }),
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.deleteRepo(ctx.params.owner, ctx.params.repo, ctx.principal!, ctx.query.confirm, ctx.dryRun),
      )
      return reply(null, { status: 204 })
    }),
})

export const repoOps = [listAccounts, getAccount, listRepos, getRepo, repoContext, numberRef, updateRepo, deleteRepo]
