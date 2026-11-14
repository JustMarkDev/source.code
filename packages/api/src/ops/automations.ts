import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { allScopes } from '../auth'
import { repoParams } from './common'

const list = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.literal(false),
    next_cursor: z.null(),
  })
const account = z.strictObject({ handle: z.string() })
const botParam = z.string().describe('The bot slug')
const tags = ['agents']
const many = <T>(data: Array<T>) => ({
  object: 'list' as const,
  data,
  has_more: false as const,
  next_cursor: null,
})

export const listBots = defineOp({
  id: 'bots.list',
  summary: 'Bots an account owns',
  description: 'Yours, or an organization you own or administer.',
  tags,
  method: 'GET',
  path: '/accounts/{handle}/bots',
  auth: 'required',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: account,
  response: list(S.Bot),
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return many(
        yield* run((d) => d.listBots(ctx.params.handle, ctx.principal)),
      )
    }),
})

export const createBot = defineOp({
  id: 'bots.create',
  summary: 'Make a bot',
  description:
    'Its slug is its handle everywhere it acts. Naturally idempotent: making one that is yours again returns it.',
  tags,
  method: 'POST',
  path: '/accounts/{handle}/bots',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: account,
  body: z.strictObject({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
    name: z.string().min(1).max(100),
    description: z.string().max(300).optional(),
    class: z.enum(['bot', 'agent']).default('bot'),
    scopes: z
      .array(z.enum(allScopes))
      .min(1)
      .refine((s) => !s.includes('tokens:manage'), 'A bot never mints tokens'),
  }),
  response: S.Bot,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createBot(ctx.params.handle, ctx.principal, ctx.body, ctx.dryRun),
      )
      return reply(r.bot, { status: r.created ? 201 : 200 })
    }),
})

export const installBot = defineOp({
  id: 'bots.install',
  summary: 'Install a bot on a repository, or remove it',
  description:
    'Installed, it can act in the repository with its scopes. Tokens made after this include the repository.',
  tags,
  method: 'PUT',
  path: '/repos/{owner}/{repo}/bots/{bot}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: repoParams.extend({ bot: botParam }),
  body: z.strictObject({ installed: z.boolean() }),
  response: S.Bot,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.installBot(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.bot,
          ctx.principal,
          ctx.body.installed,
          ctx.dryRun,
        ),
      )
    }),
})

export const updateBot = defineOp({
  id: 'bots.update',
  summary: 'Rename a bot or change what it may do',
  description:
    'While it is installed anywhere, its scopes can shrink but not grow: a repository approved it with the scopes it had.',
  tags,
  method: 'PATCH',
  path: '/bots/{bot}',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: z.strictObject({ bot: botParam }),
  body: bodies['bots.update'],
  response: S.Bot,
  errors: ['not_found', 'forbidden', 'invalid_state'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateBot(ctx.params.bot, ctx.principal, ctx.body, ctx.dryRun),
      )
    }),
})

export const mintBotToken = defineOp({
  id: 'bots.token',
  summary: 'Make a token for a bot',
  description:
    "With the bot's scopes, limited to the repositories it is installed on. Shown once.",
  tags,
  method: 'POST',
  path: '/bots/{bot}/tokens',
  auth: 'required',
  scopes: ['tokens:manage'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  params: z.strictObject({ bot: botParam }),
  body: z.strictObject({
    days: z.number().int().min(1).max(365).default(90),
  }),
  response: S.BotToken,
  status: 201,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const t = yield* run((d) =>
        d.mintBotToken(ctx.params.bot, ctx.principal, ctx.body.days),
      )
      return reply(t, { status: 201 })
    }),
})

export const listAutomations = defineOp({
  id: 'automations.list',
  summary: 'Automations in a repository',
  description: 'For people who can change the repository.',
  tags,
  method: 'GET',
  path: '/repos/{owner}/{repo}/automations',
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: repoParams,
  response: list(S.Automation),
  errors: ['not_found', 'forbidden', 'moved'],
  probe: (ctx, d) =>
    d.automationsVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return many(
        yield* run((d) =>
          d.listAutomations(ctx.params.owner, ctx.params.repo, ctx.principal),
        ),
      )
    }),
})

export const createAutomation = defineOp({
  id: 'automations.create',
  summary: 'Wake a bot when something happens',
  description:
    'The bot must be installed on the repository. Send an `Idempotency-Key` to retry safely.',
  tags,
  method: 'POST',
  path: '/repos/{owner}/{repo}/automations',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  dryRun: true,
  params: repoParams,
  body: bodies['automations.create'],
  response: S.Automation,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const a = yield* run((d) =>
        d.createAutomation(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(a, { status: ctx.dryRun ? 200 : 201 })
    }),
})

const automationParams = repoParams.extend({
  automation: z.string().describe('The automation id'),
})

export const updateAutomation = defineOp({
  id: 'automations.update',
  summary: 'Edit an automation, or turn it on or off',
  tags,
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/automations/{automation}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  params: automationParams,
  body: bodies['automations.update'],
  response: S.Automation,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateAutomation(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.automation,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const runAutomation = defineOp({
  id: 'automations.run',
  summary: 'Start an automation now',
  description:
    'Starts its run as if it had been triggered, for its bot to pick up with `runs.claim`. Counts as a trigger. Not idempotent by nature: send an `Idempotency-Key` to retry safely.',
  tags,
  method: 'POST',
  path: '/repos/{owner}/{repo}/automations/{automation}/run',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  params: automationParams,
  response: S.Run,
  status: 201,
  errors: ['not_found', 'forbidden', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.runAutomation(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.automation,
          ctx.principal,
        ),
      )
      return reply(r, { status: 201 })
    }),
})

export const deleteAutomation = defineOp({
  id: 'automations.delete',
  summary: 'Delete an automation',
  tags,
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/automations/{automation}',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  params: automationParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.deleteAutomation(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.automation,
          ctx.principal,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const automationOps = [
  listBots,
  createBot,
  installBot,
  updateBot,
  mintBotToken,
  listAutomations,
  createAutomation,
  updateAutomation,
  runAutomation,
  deleteAutomation,
]
