import { v } from 'convex/values'
import { newId, randomSource, seededId } from '@source-code/api/ids'
import { RESERVED_HANDLES, isValidHandle } from '@source-code/api/handles'
import { base64url, hashToken } from '@source-code/api/auth'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn, system } from '../lib/actor'
import { accountByHandle, assertMatch, roleIn } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { iso, presentAccount, urls } from '../lib/present'
import { queueMail } from '../mail'
import { bumpAccess } from '../lib/acl'
import type { Actor } from '../lib/actor'
import type { Role } from '../lib/access'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Editing an account, creating an organization, and who belongs to one.
 * People and organizations share one namespace. A person comes from sign-in;
 * an organization is created here by the person who becomes its first
 * owner. An organization always has at least one owner.
 */

const MAX_MEMBERS = 5_000
const MAX_INVITES = 500
const INVITE_TTL = 7 * 86_400_000

const role = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
)

/** Something about who may see what in this account changed. */
export async function bumpAcl(ctx: MutationCtx, a: Doc<'accounts'>) {
  const fresh = await ctx.db.get('accounts', a._id)
  await ctx.db.patch('accounts', a._id, { aclRev: (fresh?.aclRev ?? 0) + 1 })
  await bumpAccess(ctx)
}

async function touch(ctx: MutationCtx, a: Doc<'accounts'>) {
  const fresh = (await ctx.db.get('accounts', a._id))!
  await ctx.db.patch('accounts', a._id, {
    updated: Date.now(),
    version: fresh.version + 1,
  })
}

async function members(ctx: QueryCtx, org: Doc<'accounts'>) {
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_organizationId_and_personId', (q) =>
      q.eq('organizationId', org._id),
    )
    .take(MAX_MEMBERS + 1)
  const found: Array<{
    handle: string
    name: string
    role: Role
    id: (typeof rows)[number]['_id']
  }> = []
  for (const m of rows) {
    const person = await ctx.db.get('accounts', m.personId)
    if (person)
      found.push({
        handle: person.handle,
        name: person.name,
        role: m.role,
        id: m._id,
      })
  }
  return found
}

async function membership(ctx: QueryCtx, org: Doc<'accounts'>, handle: string) {
  const person = await accountByHandle(ctx, handle)
  if (!person) return null
  return await ctx.db
    .query('memberships')
    .withIndex('by_organizationId_and_personId', (q) =>
      q.eq('organizationId', org._id).eq('personId', person._id),
    )
    .unique()
}

/** The account, when the caller may change it. A token limited to repositories may not. */
async function editable(ctx: QueryCtx, handle: string, p: Actor) {
  const a = await accountByHandle(ctx, handle)
  if (!a) fail('not_found', `No account ${handle}.`)
  if (p.repos)
    fail(
      'forbidden',
      'A token limited to repositories cannot change an account.',
      {
        hint: 'Use a token that is not limited to repositories.',
      },
    )
  if (a.kind === 'person') {
    if (a.handle !== p.handle)
      fail('forbidden', 'Only the person can change their account.')
    return a
  }
  const r = await roleIn(ctx, a, p.handle)
  if (!r) fail('not_found', `No account ${handle}.`)
  if (r === 'member')
    fail('forbidden', `Only an owner or admin of ${handle} can change it.`, {
      hint: 'GET /v1/accounts shows your role in each account.',
    })
  return a
}

/** The organization, when the caller belongs to it. Everyone else gets 404. */
async function memberOf(ctx: QueryCtx, handle: string, p: Actor) {
  const a = await accountByHandle(ctx, handle)
  if (!a || a.kind !== 'organization' || !(await roleIn(ctx, a, p.handle)))
    fail('not_found', `No organization ${handle}.`)
  if (p.repos)
    fail(
      'forbidden',
      'A token limited to repositories cannot read or change members.',
      {
        hint: 'Use a token that is not limited to repositories.',
      },
    )
  return a
}

function presentMember(org: string, handle: string, name: string, r: Role) {
  return {
    object: 'member' as const,
    account: org,
    handle,
    name,
    role: r,
    url: `${urls().api}/accounts/${org}/members/${handle}`,
  }
}

export const list = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const p = await signedIn(ctx)
    const found: Array<Doc<'accounts'>> = []
    const own = await accountByHandle(ctx, p.handle)
    if (own) found.push(own)
    if (own)
      for (const m of await ctx.db
        .query('memberships')
        .withIndex('by_personId', (q) => q.eq('personId', own._id))
        .take(1000)) {
        const org = await ctx.db.get('accounts', m.organizationId)
        if (org) found.push(org)
      }
    found.sort((a, b) => a._creationTime - b._creationTime)
    return out(await Promise.all(found.map((a) => presentAccount(ctx, a, p))))
  },
})

export const get = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    const a = await accountByHandle(ctx, handle)
    if (!a) fail('not_found', `No account ${handle}.`)
    return out(await presentAccount(ctx, a, await actorOf(ctx)))
  },
})

export const version = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    const a = await accountByHandle(ctx, handle)
    return out(a ? `${a.publicId}.${a.version}.${a.aclRev}` : null)
  },
})

/** A person signed in. Only the API server calls this; sign-in in Convex does the same itself. */
export const knowPerson = mutation({
  args: { handle: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle, name }) => {
    await system(ctx)
    const known = await accountByHandle(ctx, handle)
    const at = Date.now()
    if (!known)
      await ctx.db.insert('accounts', {
        kind: 'person',
        handle,
        name,
        bio: '',
        publicId: seededId('account', at, handle),
        created: at,
        updated: at,
        version: 1,
        aclRev: 0,
      })
    else if (known.kind === 'person' && known.name !== name)
      await ctx.db.patch('accounts', known._id, {
        name,
        updated: at,
        version: known.version + 1,
      })
    return out(null)
  },
})

export const update = mutation({
  args: {
    handle: v.string(),
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const a = await editable(ctx, args.handle, p)
    const current = await presentAccount(ctx, a, p)
    assertMatch(args.ifMatch, `${a.publicId}.${a.version}`, () => current)
    const next = { name: args.name ?? a.name, bio: args.bio ?? a.bio }
    if (next.name === a.name && next.bio === a.bio) return out(current)
    await ctx.db.patch('accounts', a._id, {
      ...next,
      updated: Date.now(),
      version: a.version + 1,
    })
    const after = (await ctx.db.get('accounts', a._id))!
    return finish(args.dry, await presentAccount(ctx, after, p))
  },
})

export const createOrganization = mutation({
  args: {
    handle: v.string(),
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    if (p.repos)
      fail(
        'forbidden',
        'A token limited to repositories cannot create an organization.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    if (p.class !== 'human')
      fail('human_required', 'Only a person can create an organization.')
    const existing = await accountByHandle(ctx, args.handle)
    if (existing) {
      if (
        existing.kind === 'organization' &&
        (await roleIn(ctx, existing, p.handle)) === 'owner'
      )
        return out({
          account: await presentAccount(ctx, existing, p),
          created: false,
        })
      fail('invalid_state', `${args.handle} is already taken.`, {
        hint: 'Choose another handle.',
      })
    }
    if (!isValidHandle(args.handle) || RESERVED_HANDLES.has(args.handle))
      fail('invalid_state', `${args.handle} is already taken.`, {
        hint: 'Choose another handle.',
      })
    const person = await accountByHandle(ctx, p.handle)
    if (!person) fail('not_found', `No account ${p.handle}.`)
    const at = Date.now()
    const id = await ctx.db.insert('accounts', {
      kind: 'organization',
      handle: args.handle,
      name: args.name ?? args.handle,
      bio: args.bio ?? '',
      publicId: seededId('account', at, args.handle),
      created: at,
      updated: at,
      version: 1,
      aclRev: 0,
    })
    await ctx.db.insert('memberships', {
      organizationId: id,
      personId: person._id,
      role: 'owner',
    })
    await bumpAccess(ctx)
    const org = (await ctx.db.get('accounts', id))!
    return finish(args.dry, {
      account: await presentAccount(ctx, org, p),
      created: true,
    })
  },
})

/** An organization that exists. Who is in one is public, like the organization. */
async function organization(ctx: QueryCtx, handle: string) {
  const a = await accountByHandle(ctx, handle)
  if (!a || a.kind !== 'organization')
    fail('not_found', `No organization ${handle}.`)
  return a
}

export const listMembers = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    const a = await organization(ctx, handle)
    const all = await members(ctx, a)
    all.sort((x, y) => (x.handle < y.handle ? -1 : 1))
    return out(
      all.map((m) => presentMember(a.handle, m.handle, m.name, m.role)),
    )
  },
})

export const membersVersion = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    const a = await organization(ctx, handle)
    return out(`${a.publicId}.${a.version}`)
  },
})

async function ownerCount(ctx: QueryCtx, a: Doc<'accounts'>) {
  return (await members(ctx, a)).filter((m) => m.role === 'owner').length
}

export const setMember = mutation({
  args: {
    handle: v.string(),
    login: v.string(),
    role,
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const a = await editable(ctx, args.handle, p)
    if (a.kind !== 'organization')
      fail('not_found', `No organization ${args.handle}.`)
    const person = await accountByHandle(ctx, args.login)
    if (!person || person.kind !== 'person')
      fail('not_found', `No person ${args.login}.`)
    const mine = await roleIn(ctx, a, p.handle)
    const row = await membership(ctx, a, args.login)
    const theirs = row?.role ?? null
    if ((args.role === 'owner' || theirs === 'owner') && mine !== 'owner')
      fail(
        'forbidden',
        `Only an owner of ${args.handle} can make or change an owner.`,
      )
    if (theirs === args.role)
      return out({
        member: presentMember(a.handle, person.handle, person.name, args.role),
        outcome: 'unchanged',
      })
    if (theirs === 'owner' && (await ownerCount(ctx, a)) === 1)
      fail(
        'invalid_state',
        `${args.login} is the only owner of ${args.handle}.`,
        {
          hint: 'Make someone else an owner first.',
        },
      )
    if (!theirs && (await members(ctx, a)).length >= MAX_MEMBERS)
      fail('limit_reached', `An organization can have ${MAX_MEMBERS} members.`)
    if (row) await ctx.db.patch('memberships', row._id, { role: args.role })
    else
      await ctx.db.insert('memberships', {
        organizationId: a._id,
        personId: person._id,
        role: args.role,
      })
    await touch(ctx, a)
    await bumpAcl(ctx, a)
    return finish(args.dry, {
      member: presentMember(a.handle, person.handle, person.name, args.role),
      outcome: theirs ? 'updated' : 'created',
    })
  },
})

export const removeMember = mutation({
  args: { handle: v.string(), login: v.string(), dry: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const a =
      args.login === p.handle
        ? await memberOf(ctx, args.handle, p)
        : await editable(ctx, args.handle, p)
    if (a.kind !== 'organization')
      fail('not_found', `No organization ${args.handle}.`)
    const row = await membership(ctx, a, args.login)
    // Already gone: removing is repeat-safe.
    if (!row) return out(null)
    if (row.role === 'owner') {
      if ((await roleIn(ctx, a, p.handle)) !== 'owner')
        fail(
          'forbidden',
          `Only an owner of ${args.handle} can remove an owner.`,
        )
      if ((await ownerCount(ctx, a)) === 1)
        fail(
          'invalid_state',
          `${args.login} is the only owner of ${args.handle}.`,
          {
            hint: 'Make someone else an owner first.',
          },
        )
    }
    await ctx.db.delete('memberships', row._id)
    // Their team memberships in this organization end with it.
    for (const tm of await ctx.db
      .query('teamMembers')
      .withIndex('by_handle', (q) => q.eq('handle', args.login))
      .take(500)) {
      const team = await ctx.db.get('teams', tm.teamId)
      if (team?.organizationId !== a._id) continue
      await ctx.db.delete('teamMembers', tm._id)
      await ctx.db.patch('teams', team._id, {
        updated: Date.now(),
        version: team.version + 1,
      })
    }
    await touch(ctx, a)
    await bumpAcl(ctx, a)
    return finish(args.dry, null)
  },
})

// ---- invitations -----------------------------------------------------------

function presentInvite(org: string, i: Doc<'invitations'>) {
  return {
    object: 'invitation' as const,
    id: i.publicId,
    account: org,
    email: i.email,
    role: i.role,
    invited_by: i.invitedBy,
    created_at: iso(i.created),
    expires_at: iso(i.expires),
    url: `${urls().api}/accounts/${org}/invitations/${i.publicId}`,
  }
}

/** The organization, when the caller is an owner or admin of it. */
async function managed(ctx: QueryCtx, handle: string, p: Actor) {
  const a = await editable(ctx, handle, p)
  if (a.kind !== 'organization') fail('not_found', `No organization ${handle}.`)
  return a
}

async function waiting(ctx: QueryCtx, a: Doc<'accounts'>, at: number) {
  return (
    await ctx.db
      .query('invitations')
      .withIndex('by_organizationId_and_created', (q) =>
        q.eq('organizationId', a._id),
      )
      .order('desc')
      .take(MAX_INVITES + 1)
  ).filter((i) => i.expires > at)
}

export const listInvitations = query({
  args: { handle: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, { handle, at }) => {
    const p = await signedIn(ctx)
    const a = await managed(ctx, handle, p)
    return out(
      (await waiting(ctx, a, at)).map((i) => presentInvite(a.handle, i)),
    )
  },
})

export const invite = mutation({
  args: {
    handle: v.string(),
    email: v.string(),
    role,
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await bodyOf(ctx, 'invitations.create', {
      email: args.email,
      role: args.role,
    })
    const p = await signedIn(ctx)
    const a = await managed(ctx, args.handle, p)
    if (args.role === 'owner' && (await roleIn(ctx, a, p.handle)) !== 'owner')
      fail('forbidden', `Only an owner of ${args.handle} can invite an owner.`)
    const at = Date.now()
    const email = args.email.trim().toLowerCase()
    const had = await ctx.db
      .query('invitations')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', a._id).eq('email', email),
      )
      .unique()
    const live = had && had.expires > at ? had : null
    if (!live && (await waiting(ctx, a, at)).length >= MAX_INVITES)
      fail(
        'limit_reached',
        `An organization can have ${MAX_INVITES} invitations waiting.`,
        {
          hint: 'Revoke some, or wait for them to be accepted.',
        },
      )
    const secret = `sxi_${base64url(randomSource.bytes(24))}`
    const fields = {
      email,
      role: args.role,
      secretHash: hashToken(secret),
      invitedBy: p.handle,
      created: at,
      expires: at + INVITE_TTL,
    }
    let rec: Doc<'invitations'>
    if (had) {
      await ctx.db.patch('invitations', had._id, {
        ...fields,
        publicId: live ? had.publicId : newId('invitation', at),
      })
      rec = (await ctx.db.get('invitations', had._id))!
    } else {
      const id = await ctx.db.insert('invitations', {
        ...fields,
        publicId: newId('invitation', at),
        organizationId: a._id,
      })
      rec = (await ctx.db.get('invitations', id))!
    }
    await touch(ctx, a)
    const by = (await accountByHandle(ctx, p.handle))?.name ?? p.handle
    await queueMail(ctx, {
      to: email,
      subject: `${by} invited you to ${a.name} on source.code`,
      text: [
        `${by} invited you to join ${a.name} (source.code/${a.handle}) as ${
          args.role === 'member' ? 'a member' : `an ${args.role}`
        }.`,
        '',
        `Accept: ${urls().html}/organizations/join?token=${secret}`,
        '',
        'The link works for 7 days. If you do not want to join, ignore this email.',
      ].join('\n'),
    })
    return finish(args.dry, {
      invitation: presentInvite(a.handle, rec),
      outcome: live ? 'updated' : 'created',
    })
  },
})

export const revokeInvitation = mutation({
  args: { handle: v.string(), id: v.string(), dry: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const a = await managed(ctx, args.handle, p)
    const i = await ctx.db
      .query('invitations')
      .withIndex('by_publicId', (q) => q.eq('publicId', args.id))
      .unique()
    if (!i || i.organizationId !== a._id) return out(null)
    await ctx.db.delete('invitations', i._id)
    await touch(ctx, a)
    return finish(args.dry, null)
  },
})

export const acceptInvitation = mutation({
  args: { secret: v.string(), dry: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    if (p.class !== 'human') fail('human_required', 'Only a person can join.')
    if (p.repos)
      fail(
        'forbidden',
        'A token limited to repositories cannot join an organization.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    const i = await ctx.db
      .query('invitations')
      .withIndex('by_secretHash', (q) =>
        q.eq('secretHash', hashToken(args.secret)),
      )
      .unique()
    const a = i && (await ctx.db.get('accounts', i.organizationId))
    const person = await accountByHandle(ctx, p.handle)
    if (!i || !a || i.expires <= Date.now() || !person)
      fail(
        'not_found',
        'This invitation does not exist, was revoked or has expired.',
        {
          hint: 'Ask an owner or admin of the organization for a new one.',
        },
      )
    const row = await membership(ctx, a, p.handle)
    // Already in: keep the higher of the two roles, never demote.
    const rank = { member: 0, admin: 1, owner: 2 }
    const r = row && rank[row.role] >= rank[i.role] ? row.role : i.role
    if (!row && (await members(ctx, a)).length >= MAX_MEMBERS)
      fail('limit_reached', `An organization can have ${MAX_MEMBERS} members.`)
    await ctx.db.delete('invitations', i._id)
    if (row) await ctx.db.patch('memberships', row._id, { role: r })
    else
      await ctx.db.insert('memberships', {
        organizationId: a._id,
        personId: person._id,
        role: r,
      })
    await touch(ctx, a)
    await bumpAcl(ctx, a)
    return finish(
      args.dry,
      presentMember(a.handle, person.handle, person.name, r),
    )
  },
})
