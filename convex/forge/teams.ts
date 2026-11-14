import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { signedIn } from '../lib/actor'
import { accountByHandle, assertMatch, orgFor, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { iso, urls } from '../lib/present'
import { bumpAcl } from './accounts'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Teams and their access to repositories. */

const MAX_TEAM = 500

async function teamRec(ctx: QueryCtx, org: string, slug: string) {
  const t = await ctx.db
    .query('teams')
    .withIndex('by_org_and_slug', (q) => q.eq('org', org).eq('slug', slug))
    .unique()
  if (!t) fail('not_found', `No team ${slug} in ${org}.`)
  return t
}

async function teamMembers(ctx: QueryCtx, t: Doc<'teams'>) {
  return await ctx.db
    .query('teamMembers')
    .withIndex('by_teamId_and_handle', (q) => q.eq('teamId', t._id))
    .take(MAX_TEAM + 1)
}

async function teamRepos(ctx: QueryCtx, t: Doc<'teams'>) {
  const rows = await ctx.db
    .query('teamRepos')
    .withIndex('by_teamId_and_repoId', (q) => q.eq('teamId', t._id))
    .take(1000)
  const found: Array<{
    full_name: string
    permission: 'read' | 'write'
    row: Doc<'teamRepos'>
  }> = []
  for (const r of rows) {
    const repo = await ctx.db.get('repos', r.repoId)
    if (repo)
      found.push({
        full_name: `${repo.owner}/${repo.name}`,
        permission: r.level,
        row: r,
      })
  }
  return found
}

export async function presentTeam(ctx: QueryCtx, t: Doc<'teams'>) {
  const members = (await teamMembers(ctx, t)).map((m) => m.handle).sort()
  const repos = (await teamRepos(ctx, t))
    .map(({ full_name, permission }) => ({ full_name, permission }))
    .sort((a, b) => (a.full_name < b.full_name ? -1 : 1))
  return {
    object: 'team' as const,
    id: t.publicId,
    org: t.org,
    slug: t.slug,
    name: t.name,
    description: t.description,
    members,
    repos,
    url: `${urls().api}/accounts/${t.org}/teams/${t.slug}`,
    created_at: iso(t.created),
    updated_at: iso(t.updated),
    version: t.version,
  }
}

async function touch(ctx: MutationCtx, t: Doc<'teams'>) {
  const fresh = (await ctx.db.get('teams', t._id))!
  await ctx.db.patch('teams', t._id, {
    updated: Date.now(),
    version: fresh.version + 1,
  })
}

export const list = query({
  args: { org: v.string() },
  returns: v.string(),
  handler: async (ctx, { org }) => {
    const p = await signedIn(ctx)
    await orgFor(ctx, org, p, 'member')
    const teams = await ctx.db
      .query('teams')
      .withIndex('by_org_and_slug', (q) => q.eq('org', org))
      .take(1000)
    return out(await Promise.all(teams.map((t) => presentTeam(ctx, t))))
  },
})

export const get = query({
  args: { org: v.string(), slug: v.string() },
  returns: v.string(),
  handler: async (ctx, { org, slug }) => {
    const p = await signedIn(ctx)
    await orgFor(ctx, org, p, 'member')
    return out(await presentTeam(ctx, await teamRec(ctx, org, slug)))
  },
})

export const version = query({
  args: { org: v.string(), slug: v.string() },
  returns: v.string(),
  handler: async (ctx, { org, slug }) => {
    const p = await signedIn(ctx)
    await orgFor(ctx, org, p, 'member')
    const t = await teamRec(ctx, org, slug)
    return out(`${t.publicId}.${t.version}`)
  },
})

export const create = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const existing = await ctx.db
      .query('teams')
      .withIndex('by_org_and_slug', (q) =>
        q.eq('org', args.org).eq('slug', args.slug),
      )
      .unique()
    if (existing)
      return out({ team: await presentTeam(ctx, existing), created: false })
    const at = Date.now()
    const id = await ctx.db.insert('teams', {
      publicId: newId('team', at),
      organizationId: acct._id,
      org: args.org,
      slug: args.slug,
      name: args.name ?? args.slug,
      description: args.description ?? '',
      created: at,
      updated: at,
      version: 1,
    })
    return finish(args.dry, {
      team: await presentTeam(ctx, (await ctx.db.get('teams', id))!),
      created: true,
    })
  },
})

export const update = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    const current = await presentTeam(ctx, t)
    assertMatch(args.ifMatch, `${t.publicId}.${t.version}`, () => current)
    const same =
      (args.name === undefined || args.name === t.name) &&
      (args.description === undefined || args.description === t.description)
    if (same) return out(current)
    await ctx.db.patch('teams', t._id, {
      name: args.name ?? t.name,
      description: args.description ?? t.description,
      updated: Date.now(),
      version: t.version + 1,
    })
    return finish(
      args.dry,
      await presentTeam(ctx, (await ctx.db.get('teams', t._id))!),
    )
  },
})

export const remove = mutation({
  args: { org: v.string(), slug: v.string(), dry: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    for (const m of await teamMembers(ctx, t))
      await ctx.db.delete('teamMembers', m._id)
    for (const r of await teamRepos(ctx, t))
      await ctx.db.delete('teamRepos', r.row._id)
    await ctx.db.delete('teams', t._id)
    await bumpAcl(ctx, acct)
    return finish(args.dry, null)
  },
})

export const setMember = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    login: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    const person = await accountByHandle(ctx, args.login)
    if (!person || person.kind !== 'person')
      fail('not_found', `No person ${args.login}.`)
    const members = await teamMembers(ctx, t)
    const had = members.some((m) => m.handle === args.login)
    if (members.length >= MAX_TEAM && !had)
      fail('limit_reached', 'A team can have 500 members.')
    if (!had) {
      await ctx.db.insert('teamMembers', { teamId: t._id, handle: args.login })
      await touch(ctx, t)
      await bumpAcl(ctx, acct)
    }
    return finish(
      args.dry,
      await presentTeam(ctx, (await ctx.db.get('teams', t._id))!),
    )
  },
})

export const removeMember = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    login: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    const row = (await teamMembers(ctx, t)).find((m) => m.handle === args.login)
    if (!row) fail('not_found', `${args.login} is not in ${args.slug}.`)
    await ctx.db.delete('teamMembers', row._id)
    await touch(ctx, t)
    await bumpAcl(ctx, acct)
    return finish(args.dry, null)
  },
})

const level = v.union(v.literal('read'), v.literal('write'))

export const setRepo = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    owner: v.string(),
    name: v.string(),
    permission: level,
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    const repo = await resolve(ctx, args.owner, args.name, p, 'read')
    // A team belongs to an organization and reaches only that organization's repositories.
    if (repo.owner !== args.org)
      fail(
        'invalid_request',
        `${repo.owner}/${repo.name} is not in ${args.org}.`,
        {
          hint: 'A team can only be given repositories of its own organization.',
        },
      )
    const row = await ctx.db
      .query('teamRepos')
      .withIndex('by_teamId_and_repoId', (q) =>
        q.eq('teamId', t._id).eq('repoId', repo._id),
      )
      .unique()
    if (row?.level === args.permission) return out(await presentTeam(ctx, t))
    if (row)
      await ctx.db.patch('teamRepos', row._id, { level: args.permission })
    else
      await ctx.db.insert('teamRepos', {
        teamId: t._id,
        repoId: repo._id,
        level: args.permission,
      })
    await touch(ctx, t)
    await bumpAcl(ctx, acct)
    return finish(
      args.dry,
      await presentTeam(ctx, (await ctx.db.get('teams', t._id))!),
    )
  },
})

export const removeRepo = mutation({
  args: {
    org: v.string(),
    slug: v.string(),
    owner: v.string(),
    name: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const { acct } = await orgFor(ctx, args.org, p, 'admin')
    const t = await teamRec(ctx, args.org, args.slug)
    const repo = await resolve(ctx, args.owner, args.name, p, 'read')
    const row = await ctx.db
      .query('teamRepos')
      .withIndex('by_teamId_and_repoId', (q) =>
        q.eq('teamId', t._id).eq('repoId', repo._id),
      )
      .unique()
    if (!row)
      fail(
        'not_found',
        `${args.slug} has no access to ${repo.owner}/${repo.name}.`,
      )
    await ctx.db.delete('teamRepos', row._id)
    await touch(ctx, t)
    await bumpAcl(ctx, acct)
    return finish(args.dry, null)
  },
})
