import { fail, moved } from './errors'
import type { Actor } from './actor'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * Who may see and change what. Every forge function asks here; nothing
 * decides access on its own. A private thing a caller cannot see is
 * `not_found`, never `forbidden`, so its existence does not leak.
 */
type Ctx = Pick<QueryCtx, 'db'>

export type Role = 'owner' | 'admin' | 'member'

export async function accountByHandle(ctx: Ctx, handle: string) {
  return await ctx.db
    .query('accounts')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
}

export async function roleIn(
  ctx: Ctx,
  org: Doc<'accounts'> | Id<'accounts'>,
  handle: string,
): Promise<Role | null> {
  const orgId = typeof org === 'string' ? org : org._id
  const person = await accountByHandle(ctx, handle)
  if (!person) return null
  const m = await ctx.db
    .query('memberships')
    .withIndex('by_organizationId_and_personId', (q) =>
      q.eq('organizationId', orgId).eq('personId', person._id),
    )
    .unique()
  return m?.role ?? null
}

/** Whether `who` is the account `handle` or a member of it. */
export async function isMember(ctx: Ctx, handle: string, who: string) {
  if (handle === who) return !!(await accountByHandle(ctx, handle))
  const acc = await accountByHandle(ctx, handle)
  if (!acc || acc.kind !== 'organization') return false
  return (await roleIn(ctx, acc, who)) !== null
}

/** What the teams someone is in give them on a repository. */
export async function teamLevel(
  ctx: Ctx,
  repo: Doc<'repos'>,
  handle: string,
): Promise<'read' | 'write' | null> {
  const memberships = await ctx.db
    .query('teamMembers')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .take(200)
  let level: 'read' | 'write' | null = null
  for (const m of memberships) {
    const g = await ctx.db
      .query('teamRepos')
      .withIndex('by_teamId_and_repoId', (q) =>
        q.eq('teamId', m.teamId).eq('repoId', repo._id),
      )
      .unique()
    if (g?.level === 'write') return 'write'
    if (g) level = 'read'
  }
  return level
}

const full = (r: { owner: string; name: string }) => `${r.owner}/${r.name}`

export async function hasAccess(ctx: Ctx, repo: Doc<'repos'>, a: Actor) {
  return (
    repo.collaborators.includes(a.handle) ||
    repo.installs.includes(a.handle) ||
    (await isMember(ctx, repo.owner, a.handle))
  )
}

export async function canRead(ctx: Ctx, repo: Doc<'repos'>, a: Actor | null) {
  if (a?.system) return true
  if (a?.repos && !a.repos.includes(full(repo).toLowerCase()))
    return repo.visibility === 'public'
  if (repo.visibility === 'public') return true
  return (
    !!a &&
    ((await hasAccess(ctx, repo, a)) ||
      (await teamLevel(ctx, repo, a.handle)) !== null)
  )
}

export async function canWrite(ctx: Ctx, repo: Doc<'repos'>, a: Actor | null) {
  if (!a) return false
  if (a.repos && !a.repos.includes(full(repo).toLowerCase())) return false
  return (
    (await hasAccess(ctx, repo, a)) ||
    (await teamLevel(ctx, repo, a.handle)) === 'write'
  )
}

/** A relationship with the repository, not just its being public. */
export async function hasGrant(ctx: Ctx, repo: Doc<'repos'>, a: Actor | null) {
  if (!a) return false
  if (a.repos && !a.repos.includes(full(repo).toLowerCase())) return false
  return (
    (await hasAccess(ctx, repo, a)) ||
    (await teamLevel(ctx, repo, a.handle)) !== null
  )
}

export async function repoByKey(ctx: Ctx, key: string) {
  return await ctx.db
    .query('repos')
    .withIndex('by_key', (q) => q.eq('key', key.toLowerCase()))
    .unique()
}

export async function repoByPublicId(ctx: Ctx, id: string) {
  return await ctx.db
    .query('repos')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .unique()
}

/**
 * The repository at `owner/name` (or `rep_.../~`), if the caller may read it,
 * and write it when `need` says so. An old address of a repository the caller
 * can read answers `moved`.
 */
export async function resolve(
  ctx: Ctx,
  owner: string,
  name: string,
  a: Actor | null,
  need: 'read' | 'write' = 'read',
): Promise<Doc<'repos'>> {
  let repo: Doc<'repos'> | null
  if (name === '~' && owner.startsWith('rep_'))
    repo = await repoByPublicId(ctx, owner)
  else {
    const key = `${owner}/${name}`.toLowerCase()
    repo = await repoByKey(ctx, key)
    if (!repo) {
      let target = key
      const seen = new Set([target])
      for (let i = 0; i < 10; i++) {
        const next = await ctx.db
          .query('repoAliases')
          .withIndex('by_from', (q) => q.eq('from', target))
          .unique()
        if (!next || seen.has(next.to)) break
        seen.add(next.to)
        target = next.to
      }
      if (target !== key) {
        const there = await repoByKey(ctx, target)
        if (there && (await canRead(ctx, there, a)))
          moved(key, `${there.owner}/${there.name}`)
      }
    }
  }
  if (!repo || !(await canRead(ctx, repo, a)))
    fail('not_found', `No repository ${owner}/${name}.`)
  if (need === 'write' && !(await canWrite(ctx, repo, a)))
    fail('forbidden', 'You can read this repository but not change it.')
  return repo
}

/** Who may rename, hide or delete a repository: an owner or admin of its account. */
export async function assertAdmin(ctx: Ctx, repo: Doc<'repos'>, a: Actor) {
  const role =
    repo.owner === a.handle
      ? 'owner'
      : await roleIn(ctx, repo.ownerId, a.handle)
  if (role !== 'owner' && role !== 'admin')
    fail('forbidden', `Only an owner or admin of ${repo.owner} can do this.`, {
      hint: 'GET /v1/accounts shows your role in each account.',
    })
}

/** An organization the caller belongs to, with the role it needs. */
export async function orgFor(
  ctx: Ctx,
  handle: string,
  a: Actor,
  need: 'member' | 'admin',
) {
  const acct = await accountByHandle(ctx, handle)
  if (!acct || acct.kind !== 'organization')
    fail('not_found', `No organization ${handle}.`)
  const role = await roleIn(ctx, acct, a.handle)
  if (!role) fail('not_found', `No organization ${handle}.`)
  if (need === 'admin' && role !== 'owner' && role !== 'admin')
    fail(
      'forbidden',
      `Only an owner or admin of ${handle} can change its teams.`,
      {
        hint: 'GET /v1/accounts shows your role in each account.',
      },
    )
  if (a.repos)
    fail(
      'forbidden',
      'A token limited to repositories cannot read or change teams.',
      {
        hint: 'Use a token that is not limited to repositories.',
      },
    )
  return { acct, role }
}

/**
 * Whether the caller may read what happened in a repository, by public id,
 * including a deleted one whose history stays with who administered it.
 */
export async function mayReadId(ctx: Ctx, id: string | null, a: Actor | null) {
  if (!id) return !!a
  const r = await repoByPublicId(ctx, id)
  if (r) return await canRead(ctx, r, a)
  const d = await ctx.db
    .query('deletedRepos')
    .withIndex('by_publicId', (q) => q.eq('publicId', id))
    .first()
  if (!d || !a) return false
  if (a.repos && !a.repos.includes(d.full.toLowerCase())) return false
  if (d.owner === a.handle) return true
  const org = await accountByHandle(ctx, d.owner)
  const role = org ? await roleIn(ctx, org, a.handle) : null
  return role === 'owner' || role === 'admin'
}

/**
 * What a cached answer about a repository depends on for access: the owning
 * account's and the repository's own access revisions. No global counter.
 */
export async function accessStamp(ctx: Ctx, repo: Doc<'repos'>) {
  const owner = await ctx.db.get('accounts', repo.ownerId)
  return `${owner?.aclRev ?? 0}-${repo.aclRev}`
}

/** `If-Match` carries the ETag the client read: `W/"<version>"`. */
export function assertMatch(
  ifMatch: string | null | undefined,
  version: string,
  current: () => unknown,
) {
  if (ifMatch === null || ifMatch === undefined) return
  const tags = ifMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, '').replace(/"/g, ''))
  if (
    tags.includes('*') ||
    tags.some(
      (t) =>
        t === version ||
        t.startsWith(`${version}-`) ||
        t.startsWith(`${version}.`),
    )
  )
    return
  fail('version_mismatch', 'The object changed since you read it.', {
    extra: { current: current() as never },
  })
}
