import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'

const host = z.enum(['github', 'gitlab', 'codeberg', 'gitea'])
const many = <T>(data: Array<T>) => ({
  object: 'list' as const,
  data,
  has_more: false as const,
  next_cursor: null,
})
const list = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.literal(false),
    next_cursor: z.null(),
  })
const person = z.strictObject({ handle: z.string() })
const tags = ['imports']

export const listLinks = defineOp({
  id: 'links.list',
  summary: 'Your accounts on other hosts',
  tags,
  method: 'GET',
  path: '/accounts/{handle}/links',
  auth: 'required',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: person,
  response: list(S.LinkedAccount),
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return many(
        yield* run((d) => d.listLinks(ctx.params.handle, ctx.principal)),
      )
    }),
})

export const linkAccount = defineOp({
  id: 'links.set',
  summary: 'Say who you are on another host',
  description:
    'One per host; linking again replaces it. Recorded as given and unverified until signing in with that host is built.',
  tags,
  method: 'PUT',
  path: '/accounts/{handle}/links/{host}',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  params: person.extend({ host }),
  body: bodies['links.set'],
  response: S.LinkedAccount,
  errors: ['not_found', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.linkAccount(
          ctx.params.handle,
          ctx.params.host,
          ctx.principal,
          ctx.body,
        ),
      )
    }),
})

export const unlinkAccount = defineOp({
  id: 'links.remove',
  summary: 'Forget an account on another host',
  tags,
  method: 'DELETE',
  path: '/accounts/{handle}/links/{host}',
  auth: 'required',
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  params: person.extend({ host }),
  response: z.null(),
  status: 204,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.unlinkAccount(ctx.params.handle, ctx.params.host, ctx.principal),
      )
      return reply(null, { status: 204 })
    }),
})

export const listImports = defineOp({
  id: 'imports.list',
  summary: 'What you imported',
  description:
    'Repositories you can change that came from another host, with how their mirror is doing.',
  tags,
  method: 'GET',
  path: '/imports',
  auth: 'required',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: list(S.Import),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return many(yield* run((d) => d.listImports(ctx.principal)))
    }),
})

export const importRepo = defineOp({
  id: 'imports.create',
  summary: 'Import a repository from another host',
  description:
    'Makes the repository here, remembers where it came from, and pulls from it through a mirror. Naturally idempotent like `repos.create`.',
  tags,
  method: 'POST',
  path: '/imports',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({
    host,
    slug: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'owner/name on that host'),
    owner: z.string().optional().describe('Default: the account you act as'),
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
      .optional()
      .describe('Default: its name on that host'),
    visibility: z.enum(['public', 'private']).default('public'),
  }),
  response: S.Repo,
  status: 201,
  errors: ['forbidden', 'not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.importRepo(ctx.principal!, ctx.body, ctx.dryRun),
      )
      return reply(r.repo, {
        status: r.created ? 201 : 200,
        headers: { 'sx-outcome': r.created ? 'created' : 'unchanged' },
      })
    }),
})

export const importOps = [
  listLinks,
  linkAccount,
  unlinkAccount,
  listImports,
  importRepo,
]
