import { v } from 'convex/values'
import { newId, seededId } from '@source-code/api/ids'
import { seedLabels } from '../lib/issues'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { actorOf, signedIn, system } from '../lib/actor'
import {
  accessStamp,
  accountByHandle,
  assertAdmin,
  assertMatch,
  canRead,
  canWrite,
  hasGrant,
  isMember,
  mayReadId as mayRead,
  repoByKey,
  repoByPublicId,
  resolve,
  roleIn,
} from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, counters, emit } from '../lib/events'
import { keysetPage } from '../lib/paginate'
import { presentRepo, repoUrl } from '../lib/present'
import { hydrate, viewFor } from '../lib/changes'
import { knownActor } from '../lib/issues'
import { bumpAcl } from './accounts'
import { bumpAccess } from '../lib/acl'
import { revokeToken } from '../lib/tokens'
import { syncGrants } from '../lib/grants'
import { dropRepoHooks } from './webhooks'
import type { Actor } from '../lib/actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Accounts' repositories: creating, finding, renaming, moving and deleting them. */

const position = v.union(
  v.null(),
  v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
)

const maintainerError = (pointer: string, code: string, message: string) => ({
  errors: [{ pointer, code, message }],
})

async function assertPeople(ctx: QueryCtx, list: Array<string>) {
  if (list.length === 0)
    fail(
      'invalid_request',
      'A repository needs at least one maintainer.',
      maintainerError(
        '/body/maintainers',
        'empty',
        'Name at least one person.',
      ),
    )
  for (const h of list)
    if ((await accountByHandle(ctx, h))?.kind !== 'person')
      fail(
        'invalid_request',
        `${h} is not a person.`,
        maintainerError(
          '/body/maintainers',
          'not_a_person',
          `${h} is not a person.`,
        ),
      )
}

export const create = mutation({
  args: {
    owner: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.union(v.literal('public'), v.literal('private')),
    maintainers: v.optional(v.array(v.string())),
    at: v.optional(v.number()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const at = Date.now()
    const owner = args.owner ?? p.actingAs
    const acct = await accountByHandle(ctx, owner)
    if (!acct) fail('not_found', `No account ${owner}.`)
    const role =
      owner === p.handle ? 'owner' : await roleIn(ctx, acct, p.handle)
    if (!role) fail('not_found', `No account ${owner}.`)
    if (role === 'member')
      fail(
        'forbidden',
        `Members of ${owner} cannot create repositories there.`,
        {
          hint: 'Ask an owner or admin, or create it in an account you manage. GET /v1/accounts shows your role in each.',
        },
      )
    if (p.repos)
      fail(
        'forbidden',
        'A token limited to repositories cannot create new ones.',
      )
    const maintainers = new Set(args.maintainers ?? [])
    if (args.maintainers) await assertPeople(ctx, args.maintainers)
    else {
      if (acct.kind === 'person') maintainers.add(acct.handle)
      if (acct.kind === 'organization')
        for (const m of await ctx.db
          .query('memberships')
          .withIndex('by_organizationId_and_personId', (q) =>
            q.eq('organizationId', acct._id),
          )
          .take(5001)) {
          if (m.role !== 'owner' && m.role !== 'admin') continue
          const person = await ctx.db.get('accounts', m.personId)
          if (person?.kind === 'person') maintainers.add(person.handle)
        }
      if ((await accountByHandle(ctx, p.handle))?.kind === 'person')
        maintainers.add(p.handle)
    }
    if (maintainers.size === 0)
      fail(
        'invalid_request',
        'A repository needs at least one maintainer.',
        maintainerError(
          '/body/maintainers',
          'empty',
          'Name at least one person.',
        ),
      )
    const existing = await repoByKey(ctx, `${owner}/${args.name}`)
    if (existing)
      return out({ repo: await presentRepo(ctx, existing, at), created: false })
    const publicId = newId('repo', at)
    const list = [...maintainers]
    const id = await ctx.db.insert('repos', {
      publicId,
      storeId: publicId,
      ownerId: acct._id,
      owner,
      name: args.name,
      key: `${owner}/${args.name}`.toLowerCase(),
      description: args.description ?? '',
      visibility: args.visibility,
      defaultBranch: 'main',
      stars: 0,
      starsTodayBase: 0,
      forks: 0,
      upstream: null,
      install: null,
      category: null,
      languages: [],
      license: null,
      website: null,
      docsUrl: null,
      collaborators: list,
      installs: [],
      maintainers: list,
      maintainerGrants: list,
      env: [],
      created: at,
      updated: at,
      version: 1,
      aclRev: 0,
    })
    await ctx.db.insert('repoCounters', {
      repoId: id,
      nextNumber: 1,
      seq: 0,
      rev: 0,
      changeRev: 0,
      issueRev: 0,
      labelRev: 0,
      policyRev: 0,
      openChanges: 0,
      openIssues: 0,
    })
    await seedLabels(ctx, id, publicId, at, seededId)
    await syncGrants(ctx, id)
    // A name taken back from a rename stops redirecting.
    const lower = `${owner}/${args.name}`.toLowerCase()
    for (const a of await ctx.db
      .query('repoAliases')
      .withIndex('by_from', (q) => q.eq('from', lower))
      .take(10))
      await ctx.db.delete('repoAliases', a._id)
    await bumpAcl(ctx, acct)
    const repo = (await ctx.db.get('repos', id))!
    return finish(args.dry, {
      repo: await presentRepo(ctx, repo, at),
      created: true,
    })
  },
})

/**
 * Give a repository a new address. The old one answers 308 with the new one,
 * and so does any older address that led to it.
 */
async function moveRepo(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  toOwner: Doc<'accounts'>,
  toName: string,
) {
  const from = `${repo.owner}/${repo.name}`
  const to = `${toOwner.handle}/${toName}`
  await ctx.db.patch('repos', repo._id, {
    owner: toOwner.handle,
    ownerId: toOwner._id,
    name: toName,
    key: to.toLowerCase(),
  })
  for (const a of await ctx.db
    .query('repoAliases')
    .withIndex('by_to', (q) => q.eq('to', from))
    .take(1000))
    await ctx.db.patch('repoAliases', a._id, { to })
  const own = await ctx.db
    .query('repoAliases')
    .withIndex('by_from', (q) => q.eq('from', from.toLowerCase()))
    .unique()
  if (own) await ctx.db.patch('repoAliases', own._id, { to })
  else await ctx.db.insert('repoAliases', { from: from.toLowerCase(), to })
  for (const a of await ctx.db
    .query('repoAliases')
    .withIndex('by_from', (q) => q.eq('from', to.toLowerCase()))
    .take(10))
    await ctx.db.delete('repoAliases', a._id)
}

const nullable = (x: ReturnType<typeof v.string>) =>
  v.optional(v.union(v.null(), x))

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    body: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      visibility: v.optional(
        v.union(v.literal('public'), v.literal('private')),
      ),
      default_branch: v.optional(v.string()),
      maintainers: v.optional(v.array(v.string())),
      category: nullable(v.string()),
      website: nullable(v.string()),
      docs_url: nullable(v.string()),
      install: nullable(v.string()),
      transcripts: v.optional(v.union(v.literal('off'), v.literal('on'))),
      run_trailer: v.optional(
        v.union(v.literal('auto'), v.literal('on'), v.literal('off')),
      ),
    }),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { owner, name, body, ifMatch, dry }) => {
    const p = await signedIn(ctx)
    const at = Date.now()
    const repo = await resolve(ctx, owner, name, p, 'write')
    await assertAdmin(ctx, repo, p)
    const current = await presentRepo(ctx, repo, at)
    assertMatch(ifMatch, `${repo.publicId}.${repo.version}`, () => current)
    const renaming = body.name !== undefined && body.name !== repo.name
    if (renaming && p.repos)
      fail('forbidden', 'A token limited to repositories cannot rename one.', {
        hint: 'Use a token that is not limited to repositories.',
      })
    if (renaming) {
      const target = `${repo.owner}/${body.name}`
      const taken = await repoByKey(ctx, target)
      if (taken && taken._id !== repo._id)
        fail('invalid_state', `${target} already exists.`, {
          hint: 'Pick another name, or delete the repository that has it.',
        })
    }
    const next =
      body.maintainers !== undefined
        ? [...new Set(body.maintainers)].sort()
        : undefined
    const maintainersChanged =
      next !== undefined &&
      JSON.stringify([...repo.maintainers].sort()) !== JSON.stringify(next)
    if (maintainersChanged && p.repos)
      fail(
        'forbidden',
        'A token limited to repositories cannot change maintainers.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    if (body.maintainers !== undefined)
      await assertPeople(ctx, body.maintainers)
    const changed: Array<string> = []
    const patch: Partial<Doc<'repos'>> = {}
    const set = <K extends keyof Doc<'repos'>>(
      k: K,
      value: Doc<'repos'>[K] | undefined,
      label: string,
    ) => {
      if (value !== undefined && value !== repo[k]) {
        patch[k] = value
        changed.push(label)
      }
    }
    set('description', body.description, 'description')
    set('visibility', body.visibility, 'visibility')
    set('defaultBranch', body.default_branch, 'default_branch')
    set('category', body.category, 'category')
    set('website', body.website, 'website')
    set('docsUrl', body.docs_url, 'docs_url')
    set('install', body.install, 'install')
    if (
      body.transcripts !== undefined &&
      body.transcripts !== (repo.transcripts ?? 'off')
    ) {
      patch.transcripts = body.transcripts
      changed.push('transcripts')
    }
    if (
      body.run_trailer !== undefined &&
      body.run_trailer !== (repo.runTrailer ?? 'auto')
    ) {
      patch.runTrailer = body.run_trailer
      changed.push('run_trailer')
    }
    if (maintainersChanged) {
      const grants = new Set(repo.maintainerGrants)
      const collaborators = new Set(repo.collaborators)
      for (const h of repo.maintainers.filter((m) => !next.includes(m)))
        if (grants.delete(h)) collaborators.delete(h)
      for (const h of next)
        if (!collaborators.has(h)) {
          collaborators.add(h)
          grants.add(h)
        }
      patch.maintainers = next
      patch.collaborators = [...collaborators]
      patch.maintainerGrants = [...grants]
      changed.push('maintainers')
    }
    if (Object.keys(patch).length) await ctx.db.patch('repos', repo._id, patch)
    if (maintainersChanged) await syncGrants(ctx, repo._id)
    if (renaming) {
      const acct = (await ctx.db.get('accounts', repo.ownerId))!
      await moveRepo(
        ctx,
        (await ctx.db.get('repos', repo._id))!,
        acct,
        body.name!,
      )
      changed.push('name')
    }
    if (changed.length) {
      const fresh = (await ctx.db.get('repos', repo._id))!
      const aclChanged = changed.some(
        (c) => c === 'visibility' || c === 'name' || c === 'maintainers',
      )
      await ctx.db.patch('repos', repo._id, {
        version: fresh.version + 1,
        aclRev: fresh.aclRev + (aclChanged ? 1 : 0),
      })
      if (aclChanged) await bumpAccess(ctx)
      if (maintainersChanged) {
        const c = await counters(ctx, repo)
        await ctx.db.patch('repoCounters', c._id, {
          policyRev: c.policyRev + 1,
        })
      }
      const after = (await ctx.db.get('repos', repo._id))!
      await emit(
        ctx,
        after,
        'repo.updated',
        await actorFor(ctx, p.handle, p.class),
        { object: 'repo', id: repo.publicId, number: null },
        changed,
        await presentRepo(ctx, after, at),
      )
    }
    const final = (await ctx.db.get('repos', repo._id))!
    return finish(dry, await presentRepo(ctx, final, at))
  },
})

export const transfer = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    to: v.string(),
    toName: v.optional(v.string()),
    confirm: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const at = Date.now()
    const repo = await resolve(ctx, args.owner, args.name, p, 'write')
    await assertAdmin(ctx, repo, p)
    const from = `${repo.owner}/${repo.name}`
    if (p.repos)
      fail('forbidden', 'A token limited to repositories cannot transfer one.')
    if (args.confirm !== from)
      fail(
        'invalid_request',
        `Transferring ${from} changes who owns it. Send confirm=${from} to do it.`,
        maintainerError(
          '/body/confirm',
          'confirmation_required',
          `Send confirm: "${from}".`,
        ),
      )
    const acct = await accountByHandle(ctx, args.to)
    const role = !acct
      ? null
      : acct.handle === p.handle
        ? 'owner'
        : await roleIn(ctx, acct, p.handle)
    if (!acct || !role) fail('not_found', `No account ${args.to}.`)
    if (role === 'member')
      fail(
        'forbidden',
        `Members of ${args.to} cannot bring repositories there.`,
        {
          hint: 'Ask an owner or admin of that account to do it.',
        },
      )
    const toName = args.toName ?? repo.name
    const to = `${acct.handle}/${toName}`
    if (to === from) return out(await presentRepo(ctx, repo, at))
    const taken = await repoByKey(ctx, to)
    if (taken && taken._id !== repo._id)
      fail('invalid_state', `${to} already exists.`, {
        hint: 'Pass another name, or delete the repository that has it.',
      })
    const changed = repo.owner === acct.handle ? ['name'] : ['owner']
    if (repo.owner !== acct.handle) {
      // Teams belong to the account it leaves, so their access ends here.
      for (const g of await ctx.db
        .query('teamRepos')
        .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
        .take(1000)) {
        await ctx.db.delete('teamRepos', g._id)
        const t = await ctx.db.get('teams', g.teamId)
        if (t)
          await ctx.db.patch('teams', t._id, {
            updated: at,
            version: t.version + 1,
          })
      }
      if (toName !== repo.name) changed.push('name')
      const old = await ctx.db.get('accounts', repo.ownerId)
      if (old) await bumpAcl(ctx, old)
      await bumpAcl(ctx, acct)
    }
    await moveRepo(ctx, repo, acct, toName)
    await bumpAccess(ctx)
    const moved = (await ctx.db.get('repos', repo._id))!
    await ctx.db.patch('repos', repo._id, {
      version: moved.version + 1,
      aclRev: moved.aclRev + 1,
    })
    const after = (await ctx.db.get('repos', repo._id))!
    await emit(
      ctx,
      after,
      'repo.updated',
      await actorFor(ctx, p.handle, p.class),
      { object: 'repo', id: repo.publicId, number: null },
      changed,
      await presentRepo(ctx, after, at),
    )
    return finish(
      args.dry,
      await presentRepo(ctx, (await ctx.db.get('repos', repo._id))!, at),
    )
  },
})

export const remove = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    confirm: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p, 'write')
    await assertAdmin(ctx, repo, p)
    const full = `${repo.owner}/${repo.name}`
    if (p.repos)
      fail('forbidden', 'A token limited to repositories cannot delete one.')
    if (args.confirm !== full)
      fail(
        'invalid_request',
        `Deleting ${full} cannot be undone. Pass confirm=${full} to do it.`,
        {
          ...maintainerError(
            '/query/confirm',
            'confirmation_required',
            `Send confirm=${full}.`,
          ),
          hint: 'Check you are deleting the right repository, then repeat the request with ?confirm=owner/name.',
        },
      )
    if (args.dry) return out({ deleted: false, full })
    // The event is written first, while the repository still exists to be named.
    await emit(
      ctx,
      repo,
      'repo.deleted',
      await actorFor(ctx, p.handle, p.class),
      { object: 'repo', id: repo.publicId, number: null },
      ['deleted'],
      null,
    )
    for (const a of await ctx.db
      .query('repoAliases')
      .withIndex('by_to', (q) => q.eq('to', full))
      .take(1000))
      await ctx.db.delete('repoAliases', a._id)
    for (const a of await ctx.db
      .query('repoAliases')
      .withIndex('by_from', (q) => q.eq('from', full.toLowerCase()))
      .take(10))
      await ctx.db.delete('repoAliases', a._id)
    for (const g of await ctx.db
      .query('teamRepos')
      .withIndex('by_repoId', (q) => q.eq('repoId', repo._id))
      .take(1000)) {
      await ctx.db.delete('teamRepos', g._id)
      const t = await ctx.db.get('teams', g.teamId)
      if (t)
        await ctx.db.patch('teams', t._id, {
          updated: Date.now(),
          version: t.version + 1,
        })
    }
    // Its runs end with it, and their tokens stop working.
    for (const r of await ctx.db
      .query('runs')
      .withIndex('by_repoId_and_started_and_publicId', (q) =>
        q.eq('repoId', repo._id),
      )
      .take(5000)) {
      if (r.state === 'running') await revokeToken(ctx, r.tokenId)
      await ctx.db.delete('runs', r._id)
    }
    await ctx.db.insert('deletedRepos', {
      publicId: repo.publicId,
      full,
      key: full.toLowerCase(),
      owner: repo.owner,
      deleted: Date.now(),
    })
    const acct = await ctx.db.get('accounts', repo.ownerId)
    if (acct) await bumpAcl(ctx, acct)
    await dropRepoHooks(ctx, repo._id)
    await ctx.db.delete('repos', repo._id)
    await syncGrants(ctx, repo._id)
    return out({ deleted: true, full, id: repo.publicId })
  },
})

export const list = query({
  args: {
    owner: v.optional(v.string()),
    after: position,
    limit: v.number(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const owner = args.owner
    const page = await keysetPage<Doc<'repos'>>(
      owner
        ? {
            sameKey: (key, id) =>
              ctx.db
                .query('repos')
                .withIndex('by_owner_and_created_and_publicId', (q) =>
                  q
                    .eq('owner', owner)
                    .eq('created', key as number)
                    .lt('publicId', id),
                )
                .order('desc'),
            beyond: (key) =>
              ctx.db
                .query('repos')
                .withIndex('by_owner_and_created_and_publicId', (q) =>
                  key === null
                    ? q.eq('owner', owner)
                    : q.eq('owner', owner).lt('created', key as number),
                )
                .order('desc'),
          }
        : {
            sameKey: (key, id) =>
              ctx.db
                .query('repos')
                .withIndex('by_created_and_publicId', (q) =>
                  q.eq('created', key as number).lt('publicId', id),
                )
                .order('desc'),
            beyond: (key) =>
              ctx.db
                .query('repos')
                .withIndex('by_created_and_publicId', (q) =>
                  key === null ? q : q.lt('created', key as number),
                )
                .order('desc'),
          },
      (r) => r.created,
      {
        after: args.after,
        limit: args.limit,
        match: (r) => canRead(ctx, r, p),
      },
    )
    return out({
      items: await Promise.all(
        page.items.map((r) => presentRepo(ctx, r, args.at)),
      ),
      next: page.next,
    })
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    return out(await presentRepo(ctx, repo, args.at))
  },
})

/** What a cached answer about the repository depends on. */
export async function repoKey(ctx: QueryCtx, r: Doc<'repos'>) {
  const c = await counters(ctx, r)
  return `${r.publicId}.${r.version}.${c.rev}.${c.nextNumber}.${await accessStamp(ctx, r)}`
}

export const version = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const r = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    return out(await repoKey(ctx, r))
  },
})

export const listVersion = query({
  args: {
    owner: v.string(),
    name: v.string(),
    of: v.union(v.literal('changes'), v.literal('issues')),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const r = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const c = await counters(ctx, r)
    const rev = args.of === 'changes' ? c.changeRev : c.issueRev
    return out(`${r.publicId}.${rev}.${r.version}.${await accessStamp(ctx, r)}`)
  },
})

export const access = query({
  args: {
    owner: v.string(),
    name: v.string(),
    need: v.union(v.literal('read'), v.literal('write')),
    strict: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const r = await resolve(ctx, args.owner, args.name, p, args.need)
    if (args.strict && !(await hasGrant(ctx, r, p)))
      fail('not_found', `No repository ${args.owner}/${args.name}.`, {
        hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
      })
    return out(`${r.owner}/${r.name}`)
  },
})

export const idOf = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const r = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    return out(r.publicId)
  },
})

export const mayReadId = query({
  args: { id: v.union(v.null(), v.string()) },
  returns: v.string(),
  handler: async (ctx, { id }) =>
    out(await mayRead(ctx, id, await actorOf(ctx))),
})

export const mayReadName = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) => {
    const r = await repoByKey(ctx, full)
    return out(!!r && (await canRead(ctx, r, await actorOf(ctx))))
  },
})

export const canActAs = query({
  args: { login: v.string(), account: v.string() },
  returns: v.string(),
  handler: async (ctx, args) =>
    out(await isMember(ctx, args.account, args.login)),
})

/** Follows renames from a lowercase `owner/name`, at most ten steps. */
async function follow(ctx: QueryCtx, key: string) {
  const seen = new Set([key])
  for (let i = 0; i < 10; i++) {
    const next = await ctx.db
      .query('repoAliases')
      .withIndex('by_from', (q) => q.eq('from', key))
      .unique()
    if (!next || seen.has(next.to.toLowerCase())) break
    key = next.to.toLowerCase()
    seen.add(key)
  }
  return key
}

async function deletedId(ctx: QueryCtx, key: string) {
  return (
    (
      await ctx.db
        .query('deletedRepos')
        .withIndex('by_key', (q) => q.eq('key', key))
        .order('desc')
        .first()
    )?.publicId ?? null
  )
}

/** The stable id behind an address, without requiring that it still exists. */
export async function historyId(
  ctx: QueryCtx,
  full: string,
): Promise<string | null> {
  if (full.startsWith('rep_')) {
    if (await repoByPublicId(ctx, full)) return full
    const d = await ctx.db
      .query('deletedRepos')
      .withIndex('by_publicId', (q) => q.eq('publicId', full))
      .first()
    return d ? full : await deletedId(ctx, full.toLowerCase())
  }
  const direct = await repoByKey(ctx, full)
  if (direct) return direct.publicId
  const key = await follow(ctx, full.toLowerCase())
  const repo = await repoByKey(ctx, key)
  if (repo) return repo.publicId
  return await deletedId(ctx, key)
}

export const idForHistory = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) => out(await historyId(ctx, full)),
})

export const canonicalName = query({
  args: { full: v.string() },
  returns: v.string(),
  handler: async (ctx, { full }) => {
    const direct = await repoByKey(ctx, full)
    if (direct) return out(`${direct.owner}/${direct.name}`)
    const repo = await repoByKey(ctx, await follow(ctx, full.toLowerCase()))
    return out(repo ? `${repo.owner}/${repo.name}` : full)
  },
})

export const replayKey = query({
  args: {
    opId: v.string(),
    owner: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { opId, owner, name }) => {
    const p = await actorOf(ctx)
    if (!owner || !name) return out({ id: '', stamp: '' })
    const id =
      name === '~' && owner.startsWith('rep_')
        ? await historyId(ctx, owner)
        : await historyId(ctx, `${owner}/${name}`)
    if (!id) return out({ id: '', stamp: 'none' })
    if (opId === 'repos.delete') return out({ id, stamp: id })
    const repo = await repoByPublicId(ctx, id)
    return out({
      id,
      stamp: `${id}:${repo ? await canWrite(ctx, repo, p) : false}`,
    })
  },
})

/** Marks a repository's derived state as changed, without an event. */
export const bump = mutation({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const r = await resolve(ctx, args.owner, args.name, p, 'write')
    await ctx.db.patch('repos', r._id, {
      updated: Date.now(),
      version: r.version + 1,
    })
    return out(null)
  },
})

// ---- stars -------------------------------------------------------------------

async function starOf(ctx: QueryCtx, repo: Doc<'repos'>, p: Actor | null) {
  const mine = p
    ? await ctx.db
        .query('stars')
        .withIndex('by_repoId_and_handle', (q) =>
          q.eq('repoId', repo._id).eq('handle', p.handle),
        )
        .unique()
    : null
  return mine
}

export const getStar = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p)
    return out({
      object: 'star',
      repo: `${repo.owner}/${repo.name}`,
      starred: !!(await starOf(ctx, repo, p)),
      stars: repo.stars,
    })
  },
})

export const setStar = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    on: v.boolean(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p)
    if (p.class !== 'human')
      fail('forbidden', 'Only people can star a repository.', {
        hint: 'Agents and bots do not have stars to give.',
      })
    const mine = await starOf(ctx, repo, p)
    const had = !!mine
    const star = (starred: boolean, stars: number) => ({
      object: 'star',
      repo: `${repo.owner}/${repo.name}`,
      starred,
      stars,
    })
    if (had === args.on)
      return out({ star: star(had, repo.stars), changed: false })
    if (args.on)
      await ctx.db.insert('stars', {
        repoId: repo._id,
        handle: p.handle,
        at: Date.now(),
      })
    else await ctx.db.delete('stars', mine!._id)
    // The count is part of the repository, so its ETag moves. `updated_at`
    // does not: nothing about the project changed.
    const stars = repo.stars + (args.on ? 1 : -1)
    await ctx.db.patch('repos', repo._id, { stars, version: repo.version + 1 })
    return finish(args.dry, { star: star(args.on, stars), changed: true })
  },
})

// ---- facts that need changes and issues ----------------------------------------------

export const numberRef = query({
  args: { owner: v.string(), name: v.string(), number: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const r = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const change = await ctx.db
      .query('changes')
      .withIndex('by_repoId_and_number', (q) =>
        q.eq('repoId', r._id).eq('number', a.number),
      )
      .unique()
    const issue = change
      ? null
      : await ctx.db
          .query('issues')
          .withIndex('by_repoId_and_number', (q) =>
            q.eq('repoId', r._id).eq('number', a.number),
          )
          .unique()
    const type = change ? 'change' : issue ? 'issue' : null
    if (!type)
      fail(
        'not_found',
        `Nothing numbered #${a.number} in ${a.owner}/${a.name}.`,
      )
    return out({
      object: 'number_ref',
      number: a.number,
      type,
      url: `${repoUrl(r)}/${type === 'change' ? 'changes' : 'issues'}/${a.number}`,
    })
  },
})

/** What a coding agent needs first: the repository, what is open, what policy wants. */
export const context = query({
  args: { owner: v.string(), name: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const r = await resolve(ctx, a.owner, a.name, p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const open: Array<Doc<'changes'>> = []
    if (canPull)
      for await (const c of ctx.db
        .query('changes')
        .withIndex('by_repoId_and_updated_and_publicId', (q) =>
          q.eq('repoId', r._id),
        )
        .order('desc')) {
        if (c.state === 'open' || c.state === 'draft') open.push(c)
        if (open.length >= 50) break
      }
    const loaded = await Promise.all(open.map((c) => hydrate(ctx, c)))
    const view = await viewFor(
      ctx,
      r,
      p,
      a.at,
      loaded.map((l) => l.rec),
    )
    const issues = canIssue
      ? await ctx.db
          .query('issues')
          .withIndex('by_repoId_and_state_and_number', (q) =>
            q.eq('repoId', r._id).eq('state', 'open'),
          )
          .order('desc')
          .take(50)
      : []
    return out({
      repo: await presentRepo(ctx, r, a.at),
      changes: loaded.map(({ rec: c }) => {
        const reqs = view.evaluate(c)
        return {
          number: c.number,
          title: c.title,
          state: c.state,
          author: view.actor(c.author),
          checks: view.checksFor(c).state,
          policy: view.policyState(reqs),
          blocking: reqs
            .filter((q) => q.state === 'fail' || q.state === 'pending')
            .map((q) => `${q.id}:${q.state}`),
        }
      }),
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels,
      })),
      // Environment names are kept by the API for now; it adds them when this says so.
      envAllowed:
        !!p?.scopes.has('secrets:schema') && (await hasGrant(ctx, r, p)),
      full: `${r.owner}/${r.name}`,
      id: r.publicId,
    })
  },
})

function sampleFacts(sha: string) {
  const n = parseInt(sha.slice(0, 6), 16) || 0
  return {
    change: n % 9 < 5 ? 100 + ((n >>> 4) % 120) : null,
    checks: n % 17 === 0 ? ('fail' as const) : ('pass' as const),
  }
}

/**
 * Per commit: whose account wrote it, the change it landed through and
 * whether its checks passed. The caller has already been checked.
 */
export const commitFacts = query({
  args: {
    full: v.string(),
    commits: v.array(v.object({ sha: v.string(), email: v.string() })),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const repo = await repoByKey(ctx, a.full)
    const facts = []
    for (const c of a.commits) {
      const login = /^([a-z0-9-]+)@users\.source\.code$/.exec(
        c.email.toLowerCase(),
      )?.[1]
      const who = login ? await knownActor(ctx, login) : null
      const landed = repo
        ? (
            await ctx.db
              .query('changes')
              .withIndex('by_repoId_and_headSha', (q) =>
                q.eq('repoId', repo._id).eq('headSha', c.sha),
              )
              .take(10)
          ).find((x) => x.state === 'landed')
        : undefined
      let f: { change: number | null; checks: 'pass' | 'fail' | null }
      if (landed) {
        const { rec } = await hydrate(ctx, landed)
        f = {
          change: rec.number,
          checks: rec.checks.length
            ? rec.checks.some((k) => k.state === 'fail')
              ? 'fail'
              : 'pass'
            : null,
        }
      } else
        f = repo?.sampleFacts
          ? sampleFacts(c.sha)
          : { change: null, checks: null }
      facts.push({ actor: who ? { object: 'actor', ...who } : null, ...f })
    }
    return out(facts)
  },
})
