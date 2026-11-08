import { Effect } from 'effect'
import { z } from 'zod'
import { ENVIRONMENTS } from '../extras'
import { apiError } from '../problem'
import { Domain, defineOp, reply } from '../registry'
import { iso } from '../domain'
import * as S from '../schemas'
import { repoParams } from './common'
import type { GrantRec, MirrorRec } from '../extras'
import type { MemoryDomain } from '../domain'

const environment = z.enum(ENVIRONMENTS)
const MAX_GRANT_MINUTES = 8 * 60

// ---------------------------------------------------------------------------
// Repositories

export const createRepo = defineOp({
  id: 'repos.create',
  summary: 'Create a repository',
  description:
    'A bare name goes in the account you act as; set `owner` to use another. Naturally idempotent: asking for one that exists returns it with `Sx-Outcome: unchanged`. Members of an organization cannot create repositories there.',
  tags: ['repositories'],
  method: 'POST',
  path: '/repos',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'Letters, digits, dot, dash and underscore; up to 100'),
    owner: z.string().optional().describe('Account handle. Default: the account you act as'),
    description: z.string().max(500).optional(),
    visibility: z.enum(['public', 'private']).default('public'),
  }),
  response: S.Repo,
  status: 201,
  errors: ['forbidden', 'not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) => d.createRepo(ctx.principal!, ctx.body, ctx.dryRun))
      return reply(r.repo, {
        status: r.created ? 201 : 200,
        headers: { 'sx-outcome': r.created ? 'created' : 'unchanged', ...(r.created ? { location: r.repo.url } : {}) },
      })
    }),
})

// ---------------------------------------------------------------------------
// Mirrors

const presentMirror = (d: MemoryDomain, full: string, m: MirrorRec): z.infer<typeof S.Mirror> => ({
  object: 'mirror',
  id: m.id,
  host: m.host,
  slug: m.slug,
  direction: m.direction,
  state: m.state,
  detail: m.detail,
  last_sync_at: iso(m.lastSync),
  url: `${d.urls.api}/repos/${full}/mirrors/${m.id}`,
  created_at: iso(m.created),
})

const mirrorParams = repoParams.extend({ mirror: z.string().describe('The mirror `mir_` id') })
const hosts = ['github', 'gitlab', 'codeberg', 'gitea', 'forgejo', 'bitbucket'] as const

export const listMirrors = defineOp({
  id: 'mirrors.list',
  summary: 'Copies of the repository on other hosts',
  tags: ['mirrors'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/mirrors',
  params: repoParams,
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.listOf(S.Mirror),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'read')
        return d.svc.extras.for(full).mirrors.map((m) => presentMirror(d, full, m))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const createMirror = defineOp({
  id: 'mirrors.create',
  summary: 'Add a mirror',
  description: 'Naturally idempotent: the same host and repository returns the existing mirror with `Sx-Outcome: unchanged`.',
  tags: ['mirrors'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/mirrors',
  params: repoParams,
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({
    host: z.enum(hosts),
    slug: z.string().regex(/^[^/\s]+\/[^/\s]+$/).describe('`owner/name` on that host'),
    direction: z.enum(['push', 'pull', 'two-way']).default('push'),
  }),
  response: S.Mirror,
  status: 201,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const x = d.svc.extras.for(full)
        const same = x.mirrors.find((m) => m.host === ctx.body.host && m.slug === ctx.body.slug)
        if (same) return { m: presentMirror(d, full, same), created: false }
        const rec: MirrorRec = { id: `mir_${ctx.now().toString(36)}${x.mirrors.length}`.padEnd(22, '0').slice(0, 22), host: ctx.body.host, slug: ctx.body.slug, direction: ctx.body.direction, state: 'in-sync', lastSync: ctx.now(), detail: null, created: ctx.now() }
        if (!ctx.dryRun) x.mirrors.push(rec)
        return { m: presentMirror(d, full, rec), created: true }
      })
      return reply(out.m, { status: out.created ? 201 : 200, headers: { 'sx-outcome': out.created ? 'created' : 'unchanged' } })
    }),
})

export const syncMirror = defineOp({
  id: 'mirrors.sync',
  summary: 'Sync one mirror now',
  tags: ['mirrors'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/mirrors/{mirror}/sync',
  params: mirrorParams,
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  response: S.Mirror,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const m = d.svc.extras.for(full).mirrors.find((x) => x.id === ctx.params.mirror)
        if (!m) throw apiError('not_found', `No mirror ${ctx.params.mirror}.`)
        if (!ctx.dryRun) {
          m.state = 'in-sync'
          m.lastSync = ctx.now()
          m.detail = null
        }
        return presentMirror(d, full, m)
      })
    }),
})

export const deleteMirror = defineOp({
  id: 'mirrors.delete',
  summary: 'Remove a mirror',
  description: 'The copy on the other host is left as it is.',
  tags: ['mirrors'],
  method: 'DELETE',
  path: '/repos/{owner}/{repo}/mirrors/{mirror}',
  params: mirrorParams,
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const x = d.svc.extras.for(full)
        const i = x.mirrors.findIndex((m) => m.id === ctx.params.mirror)
        if (i < 0) throw apiError('not_found', `No mirror ${ctx.params.mirror}.`)
        if (!ctx.dryRun) x.mirrors.splice(i, 1)
      })
      return reply(null, { status: 204 })
    }),
})

// ---------------------------------------------------------------------------
// Environment variables and grants

const presentGrant = (d: MemoryDomain, full: string, g: GrantRec, now: number): z.infer<typeof S.Grant> => ({
  object: 'grant',
  id: g.id,
  environment: g.environment,
  // A grant with no expiry yet (a pending request) is not expired; an active
  // grant is expired only once its deadline has passed or its uses are gone.
  state: g.state === 'active' && ((g.expires !== null && g.expires <= now) || g.uses >= g.maxRuns) ? 'expired' : g.state,
  variables: g.variables,
  reason: g.reason,
  requested_by: g.requestedBy,
  max_runs: g.maxRuns,
  uses: g.uses,
  expires_at: g.expires ? iso(g.expires) : null,
  url: `${d.urls.api}/repos/${full}/env/grants/${g.id}`,
  created_at: iso(g.created),
})

const grantParams = repoParams.extend({ grant: z.string().describe('The grant `grt_` id') })
const schemaRead = { auth: 'required' as const, scopes: ['secrets:schema' as const], pool: 'read' as const, safety: 'read' as const, idempotent: true, tags: ['secrets'] }

export const listEnv = defineOp({
  ...schemaRead,
  id: 'env.list',
  summary: 'Variable names, kinds and where they are set',
  description: 'Names and kinds only. A value is never in this answer.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/env',
  params: repoParams,
  query: z.strictObject({ environment: environment.optional().describe('Also say whether each is set in this one') }),
  response: S.listOf(S.EnvVar),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'read')
        return d.svc.extras.for(full).env.map((v) => ({
          object: 'env_var' as const,
          name: v.name,
          kind: v.kind,
          secret: v.secret,
          description: v.description,
          environments: [...v.set],
          set: ctx.query.environment ? v.set.includes(ctx.query.environment) : null,
        }))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const setEnv = defineOp({
  id: 'env.set',
  summary: 'Set a variable in an environment',
  description:
    'The value is encrypted on your machine and sent as `ciphertext`; a plaintext value never reaches the server. The name must already be in the schema, so reviewers can see it exists. The response never contains the value.',
  tags: ['secrets'],
  method: 'PUT',
  path: '/repos/{owner}/{repo}/env/{name}/{environment}',
  params: repoParams.extend({ name: z.string().describe('The variable name'), environment }),
  auth: 'required',
  scopes: ['secrets:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({ ciphertext: z.string().min(1).max(65536) }),
  response: S.EnvVar,
  errors: ['not_found', 'forbidden', 'invalid_request', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const x = d.svc.extras.for(full)
        const v = x.env.find((e) => e.name === ctx.params.name)
        if (!v)
          throw apiError('invalid_request', `${ctx.params.name} is not in the env schema.`, {
            hint: 'Add it to the schema first so reviewers can see it exists.',
            errors: [{ pointer: '/params/name', code: 'not_in_schema', message: 'Add it to .env.schema.' }],
          })
        if (!ctx.dryRun && !v.set.includes(ctx.params.environment)) {
          v.set.push(ctx.params.environment)
          x.note(ctx.principal!.handle, `set ${v.name} (${ctx.params.environment})`)
          await d.bumpRepo(ctx.params.owner, ctx.params.repo, ctx.principal)
        }
        return { object: 'env_var' as const, name: v.name, kind: v.kind, secret: v.secret, description: v.description, environments: [...v.set], set: v.set.includes(ctx.params.environment) }
      })
    }),
})

export const listRecipients = defineOp({
  ...schemaRead,
  id: 'env.recipients',
  summary: 'Who values are encrypted for',
  method: 'GET',
  path: '/repos/{owner}/{repo}/env/recipients',
  params: repoParams,
  response: S.listOf(S.Recipient),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'read')
        return d.svc.extras.for(full).recipients.map((r) => ({ object: 'recipient' as const, id: r.id, kind: r.kind }))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const envValues = defineOp({
  id: 'env.values',
  summary: 'Read values',
  description:
    'The only place a value leaves. A person with `secrets:decrypt` may read any environment. An agent needs an unexpired grant for a development or preview environment, may only read the names the grant covers, and each read counts against the grant. Production is never available to an agent. Every read is written to the audit log. The answer is never cached.',
  tags: ['secrets'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/env/{environment}/values',
  params: repoParams.extend({ environment }),
  query: z.strictObject({ names: z.string().optional().describe('Comma list. Default: every variable set here') }),
  auth: 'required',
  scopes: ['secrets:decrypt'],
  pool: 'write',
  safety: 'read',
  idempotent: false,
  response: S.EnvValues,
  errors: ['not_found', 'forbidden', 'grant_required', 'human_required', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const p = ctx.principal!
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, p, 'write')
        const x = d.svc.extras.for(full)
        const agent = p.class !== 'human'
        if (agent && ctx.params.environment === 'production')
          throw apiError('human_required', 'Agents cannot use production values.', { hint: 'Ask a person to run this, or use development values.' })
        if (agent && !x.activeGrant(ctx.params.environment))
          throw apiError('grant_required', `No active grant for ${ctx.params.environment}.`, {
            hint: `POST /v1/repos/${full}/env/grants to request one. A person approves it, then retry.`,
          })
        const r = x.values({ environment: ctx.params.environment, names: ctx.query.names?.split(','), who: `${p.handle} (${p.class})`, agent })
        return { object: 'env_values' as const, environment: ctx.params.environment, values: r.values, secrets: r.secrets, grant: r.grant }
      })
      return reply(out, { headers: { 'cache-control': 'no-store' } })
    }),
})

export const listGrants = defineOp({
  ...schemaRead,
  id: 'grants.list',
  summary: 'Grants that let an agent use values',
  method: 'GET',
  path: '/repos/{owner}/{repo}/env/grants',
  params: repoParams,
  response: S.listOf(S.Grant),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'read')
        return d.svc.extras.for(full).grants.map((g) => presentGrant(d, full, g, ctx.now()))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const requestGrant = defineOp({
  id: 'grants.request',
  summary: 'Ask for access to an environment',
  description:
    'A request is not access: a person has to approve it, so the next step for an agent is to stop and wait. Asking again for the same environment returns the pending request. Production cannot be requested by an agent.',
  tags: ['secrets'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/env/grants',
  params: repoParams,
  auth: 'required',
  scopes: ['secrets:schema'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({
    environment,
    reason: z.string().max(300).optional(),
    max_runs: z.number().int().min(1).max(200).default(20),
  }),
  response: S.Grant,
  status: 201,
  errors: ['not_found', 'forbidden', 'human_required', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const p = ctx.principal!
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, p, 'write')
        if (p.class !== 'human' && ctx.body.environment === 'production')
          throw apiError('human_required', 'Agents cannot be granted production values.', { hint: 'Use development, or ask a person to run the command.' })
        const x = d.svc.extras.for(full)
        if (ctx.dryRun) return { g: presentGrant(d, full, { id: 'grt_dryrun', environment: ctx.body.environment, state: 'pending', variables: [], reason: ctx.body.reason ?? null, requestedBy: p.handle, maxRuns: ctx.body.max_runs, uses: 0, expires: null, created: ctx.now() }, ctx.now()), created: true }
        const r = x.requestGrant({ environment: ctx.body.environment, reason: ctx.body.reason ?? null, maxRuns: ctx.body.max_runs, who: p.handle })
        return { g: presentGrant(d, full, r.grant, ctx.now()), created: r.created }
      })
      return reply(out.g, { status: out.created ? 201 : 200, headers: { 'sx-outcome': out.created ? 'created' : 'unchanged', location: out.g.url } })
    }),
})

export const approveGrant = defineOp({
  id: 'grants.approve',
  summary: 'Approve a grant',
  description: `A person approves, for up to ${MAX_GRANT_MINUTES / 60} hours. An agent cannot approve a grant, least of all its own.`,
  tags: ['secrets'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/env/grants/{grant}/approve',
  params: grantParams,
  auth: 'required',
  scopes: ['secrets:write'],
  pool: 'write',
  safety: 'write',
  idempotent: true,
  dryRun: true,
  body: z.strictObject({ ttl_minutes: z.number().int().min(1).max(MAX_GRANT_MINUTES).default(60) }),
  response: S.Grant,
  errors: ['not_found', 'forbidden', 'human_required', 'invalid_state', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const p = ctx.principal!
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, p, 'write')
        if (p.class !== 'human') throw apiError('human_required', 'An agent cannot approve a grant.', { hint: 'Ask a person to approve it.' })
        const x = d.svc.extras.for(full)
        const g = x.grants.find((e) => e.id === ctx.params.grant)
        if (!g) throw apiError('not_found', `No grant ${ctx.params.grant}.`)
        if (g.state === 'revoked') throw apiError('invalid_state', 'That grant was revoked.')
        if (!ctx.dryRun) {
          g.state = 'active'
          g.expires = ctx.now() + ctx.body.ttl_minutes * 60_000
          x.note(p.handle, `approved ${g.id} for ${g.environment} (${ctx.body.ttl_minutes} minutes)`)
        }
        return presentGrant(d, full, g, ctx.now())
      })
    }),
})

export const revokeGrant = defineOp({
  id: 'grants.revoke',
  summary: 'Revoke a grant',
  tags: ['secrets'],
  method: 'POST',
  path: '/repos/{owner}/{repo}/env/grants/{grant}/revoke',
  params: grantParams,
  auth: 'required',
  scopes: ['secrets:write'],
  pool: 'write',
  safety: 'destructive',
  idempotent: true,
  dryRun: true,
  response: S.Grant,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        const x = d.svc.extras.for(full)
        const g = x.grants.find((e) => e.id === ctx.params.grant)
        if (!g) throw apiError('not_found', `No grant ${ctx.params.grant}.`)
        if (!ctx.dryRun && g.state !== 'revoked') {
          g.state = 'revoked'
          x.note(ctx.principal!.handle, `revoked ${g.id}`)
        }
        return presentGrant(d, full, g, ctx.now())
      })
    }),
})

export const envAudit = defineOp({
  ...schemaRead,
  id: 'env.audit',
  summary: 'Who did what with values',
  description: 'Newest first, the last 200 entries.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/env/audit',
  params: repoParams,
  response: S.listOf(S.AuditEntry),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run(async (d) => {
        const full = await d.repoAccess(ctx.params.owner, ctx.params.repo, ctx.principal, 'write')
        return d.svc.extras.for(full).audit.slice(0, 200).map((a) => ({ object: 'audit_entry' as const, at: iso(a.at), who: a.who, action: a.action }))
      })
      return { object: 'list' as const, data, has_more: false, next_cursor: null }
    }),
})

export const extrasOps = [
  createRepo, listMirrors, createMirror, syncMirror, deleteMirror,
  listEnv, setEnv, listRecipients, envValues, listGrants, requestGrant, approveGrant, revokeGrant, envAudit,
]
