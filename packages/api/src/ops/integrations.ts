import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { repoParams } from './common'

const account = z.strictObject({
  handle: z.string().describe('A person or an organization'),
})
const one = z.string().describe('The integration, such as coderabbit')
const list = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.literal(false),
    next_cursor: z.null(),
  })
const tags = ['integrations']

export const listConnections = defineOp({
  id: 'integrations.list',
  summary: 'Services connected to an account',
  description: 'Yours, or an organization you own or administer.',
  tags,
  method: 'GET',
  path: '/accounts/{handle}/integrations',
  auth: 'required',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: account,
  response: list(S.IntegrationConnection),
  errors: ['not_found', 'forbidden'],
  probe: (ctx, d) => d.connectionsVersion(ctx.params.handle, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listConnections(ctx.params.handle, ctx.principal),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false as const,
        next_cursor: null,
      }
    }),
})

export const connect = defineOp({
  id: 'integrations.connect',
  summary: 'Connect a service to an account',
  description:
    'A service that takes a key needs `key`; it is kept as a hash and shown again only as its last four characters. Connecting again with the same key changes nothing; a new key replaces the old one.',
  tags,
  method: 'PUT',
  path: '/accounts/{handle}/integrations/{integration}',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: account.extend({ integration: one }),
  body: bodies['integrations.connect'],
  response: S.IntegrationConnection,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_state', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.connect(
          ctx.params.handle,
          ctx.params.integration,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r.connection, { status: r.created ? 201 : 200 })
    }),
})

export const disconnect = defineOp({
  id: 'integrations.disconnect',
  summary: 'Disconnect a service',
  description: 'It is turned off in every repository of the account too.',
  tags,
  method: 'DELETE',
  path: '/accounts/{handle}/integrations/{integration}',
  auth: 'required',
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  params: account.extend({ integration: one }),
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.disconnect(
          ctx.params.handle,
          ctx.params.integration,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const listRepoIntegrations = defineOp({
  id: 'integrations.repo',
  summary: 'Which connected services a repository uses',
  description:
    "Every service connected to the repository's owner, on or off here.",
  tags,
  method: 'GET',
  path: '/repos/{owner}/{repo}/integrations',
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  response: list(S.RepoIntegration),
  errors: ['not_found', 'moved'],
  probe: (ctx, d) =>
    d.repoIntegrationsVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listRepoIntegrations(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false as const,
        next_cursor: null,
      }
    }),
})

export const setRepoIntegration = defineOp({
  id: 'integrations.set',
  summary: 'Turn a connected service on or off for a repository',
  tags,
  method: 'PUT',
  path: '/repos/{owner}/{repo}/integrations/{integration}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: repoParams.extend({ integration: one }),
  body: bodies['integrations.set'],
  response: S.RepoIntegration,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.setRepoIntegration(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.integration,
          ctx.principal,
          ctx.body.enabled,
          ctx.dryRun,
        ),
      )
    }),
})

export const integrationOps = [
  listConnections,
  connect,
  disconnect,
  listRepoIntegrations,
  setRepoIntegration,
]
