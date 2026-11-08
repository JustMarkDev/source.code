import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { repoParams } from './common'

const read = {
  auth: 'required' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
  tags: ['teams'],
}
const write = {
  auth: 'required' as const,
  scopes: ['repo:write' as const],
  pool: 'write' as const,
  safety: 'write' as const,
  idempotent: true,
  dryRun: true,
  tags: ['teams'],
}

const org = z.object({ handle: z.string().describe('Handle of the organization') })
const team = org.extend({ slug: z.string().describe('The team slug') })
const slugRule = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'Lower-case letters, digits and dashes; up to 40')

export const listTeams = defineOp({
  ...read,
  id: 'teams.list',
  summary: "An organization's teams",
  description: 'Members of the organization only. Everyone else gets 404.',
  method: 'GET',
  path: '/accounts/{handle}/teams',
  params: org,
  response: z.strictObject({ object: z.literal('list'), data: z.array(S.Team), has_more: z.literal(false), next_cursor: z.null() }),
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) => d.listTeams(ctx.params.handle, ctx.principal!))
      return { object: 'list' as const, data, has_more: false as const, next_cursor: null }
    }),
})

export const createTeam = defineOp({
  ...write,
  id: 'teams.create',
  summary: 'Create a team',
  description:
    'Owners and admins only. A team is a named group of people. Give it repositories of the organization and its members can read or write them, whether or not they belong to the organization. Naturally idempotent on the slug: asking for one that exists returns it with `Sx-Outcome: unchanged`.',
  method: 'POST',
  path: '/accounts/{handle}/teams',
  params: org,
  body: z.strictObject({ slug: slugRule, name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional() }),
  response: S.Team,
  status: 201,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) => d.createTeam(ctx.params.handle, ctx.principal!, ctx.body, ctx.dryRun))
      return reply(r.team, {
        status: r.created ? 201 : 200,
        headers: { 'sx-outcome': r.created ? 'created' : 'unchanged', ...(r.created ? { location: r.team.url } : {}) },
      })
    }),
})

export const getTeam = defineOp({
  ...read,
  id: 'teams.get',
  summary: 'One team, with its members and repositories',
  method: 'GET',
  path: '/accounts/{handle}/teams/{slug}',
  params: team,
  response: S.Team,
  errors: ['not_found'],
  probe: (ctx, d) => d.teamVersion(ctx.params.handle, ctx.params.slug, ctx.principal!),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getTeam(ctx.params.handle, ctx.params.slug, ctx.principal!))
    }),
})

export const updateTeam = defineOp({
  ...write,
  id: 'teams.update',
  summary: 'Rename a team or change its description',
  description: 'Send If-Match with the ETag you read.',
  method: 'PATCH',
  path: '/accounts/{handle}/teams/{slug}',
  params: team,
  body: z.strictObject({ name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional() }),
  response: S.Team,
  errors: ['not_found', 'forbidden', 'version_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.updateTeam(ctx.params.handle, ctx.params.slug, ctx.principal!, ctx.body, ctx.ifMatch, ctx.dryRun))
    }),
})

export const deleteTeam = defineOp({
  ...write,
  id: 'teams.delete',
  summary: 'Delete a team',
  description: 'Its members lose the access it gave them. Repositories are not touched.',
  method: 'DELETE',
  path: '/accounts/{handle}/teams/{slug}',
  params: team,
  safety: 'destructive',
  idempotent: false,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.deleteTeam(ctx.params.handle, ctx.params.slug, ctx.principal!, ctx.dryRun))
      return reply(null, { status: 204 })
    }),
})

export const addTeamMember = defineOp({
  ...write,
  id: 'teams.members.add',
  summary: 'Add a person to a team',
  description: 'Adding someone who is already in the team changes nothing. A team has at most 500 members.',
  method: 'PUT',
  path: '/accounts/{handle}/teams/{slug}/members/{login}',
  params: team.extend({ login: z.string().describe('Handle of the person') }),
  response: S.Team,
  errors: ['not_found', 'forbidden', 'limit_reached'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.setTeamMember(ctx.params.handle, ctx.params.slug, ctx.params.login, ctx.principal!, ctx.dryRun))
    }),
})

export const removeTeamMember = defineOp({
  ...write,
  id: 'teams.members.remove',
  summary: 'Remove a person from a team',
  method: 'DELETE',
  path: '/accounts/{handle}/teams/{slug}/members/{login}',
  params: team.extend({ login: z.string() }),
  safety: 'destructive',
  idempotent: false,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.removeTeamMember(ctx.params.handle, ctx.params.slug, ctx.params.login, ctx.principal!, ctx.dryRun))
      return reply(null, { status: 204 })
    }),
})

export const setTeamRepo = defineOp({
  ...write,
  id: 'teams.repos.set',
  summary: 'Give a team a repository',
  description: '`read` lets members read it, including a private one; `write` lets them change it. Only repositories of the team\'s own organization. Setting it again changes the permission.',
  method: 'PUT',
  path: '/accounts/{handle}/teams/{slug}/repos/{owner}/{repo}',
  params: team.extend(repoParams.shape),
  body: z.strictObject({ permission: z.enum(['read', 'write']) }),
  response: S.Team,
  errors: ['not_found', 'forbidden', 'invalid_request'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.setTeamRepo(ctx.params.handle, ctx.params.slug, ctx.params.owner, ctx.params.repo, ctx.body.permission, ctx.principal!, ctx.dryRun),
      )
    }),
})

export const removeTeamRepo = defineOp({
  ...write,
  id: 'teams.repos.remove',
  summary: "Take a repository away from a team",
  method: 'DELETE',
  path: '/accounts/{handle}/teams/{slug}/repos/{owner}/{repo}',
  params: team.extend(repoParams.shape),
  safety: 'destructive',
  idempotent: false,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.removeTeamRepo(ctx.params.handle, ctx.params.slug, ctx.params.owner, ctx.params.repo, ctx.principal!, ctx.dryRun))
      return reply(null, { status: 204 })
    }),
})

export const teamOps = [listTeams, createTeam, getTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember, setTeamRepo, removeTeamRepo]
