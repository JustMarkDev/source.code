import { v } from 'convex/values'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { integrations } from '@source-code/api/integrations'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn } from '../lib/actor'
import {
  accessStamp,
  accountByHandle,
  canWrite,
  resolve,
  roleIn,
} from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { iso, presentRepo } from '../lib/present'
import type { Actor } from '../lib/actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Services connected to an account, and which of them each repository uses.
 * A repository can only use what its owner has connected; disconnecting
 * turns it off everywhere. Linked accounts on other hosts, and imports.
 */

function known(id: string) {
  const i = integrations.find((x) => x.id === id)
  if (!i) fail('not_found', `No integration ${id}.`)
  return i
}

async function managedAccount(ctx: QueryCtx, handle: string, p: Actor | null) {
  const a = await accountByHandle(ctx, handle)
  if (!a || !p) fail('not_found', `No account ${handle}.`)
  const mine =
    a.kind === 'person'
      ? a.handle === p.handle
      : ['owner', 'admin'].includes((await roleIn(ctx, a, p.handle)) ?? '')
  if (!mine)
    fail(
      a.kind === 'person' ? 'not_found' : 'forbidden',
      a.kind === 'person'
        ? `No account ${handle}.`
        : 'Only owners and admins connect services for an organization.',
    )
  return a
}

const presentConnection = (
  c: Doc<'connections'> | Omit<Doc<'connections'>, '_id' | '_creationTime'>,
) => ({
  object: 'integration_connection' as const,
  integration: c.integration,
  account: c.account,
  key_hint: c.hint,
  connected_by: c.by,
  connected_at: iso(c.connected),
})

async function rev(ctx: QueryCtx, account: string) {
  return (
    (
      await ctx.db
        .query('integrationRev')
        .withIndex('by_account', (q) => q.eq('account', account))
        .unique()
    )?.rev ?? 0
  )
}

async function bump(ctx: MutationCtx, account: string) {
  const row = await ctx.db
    .query('integrationRev')
    .withIndex('by_account', (q) => q.eq('account', account))
    .unique()
  if (row) await ctx.db.patch('integrationRev', row._id, { rev: row.rev + 1 })
  else await ctx.db.insert('integrationRev', { account, rev: 1 })
}

async function connectionsOf(ctx: QueryCtx, account: string) {
  return await ctx.db
    .query('connections')
    .withIndex('by_account_and_integration', (q) => q.eq('account', account))
    .take(500)
}

export const listConnections = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    await managedAccount(ctx, handle, await actorOf(ctx))
    const all = (await connectionsOf(ctx, handle)).sort(
      (a, b) => a._creationTime - b._creationTime,
    )
    return out(all.map(presentConnection))
  },
})

export const connectionsVersion = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    await managedAccount(ctx, handle, await actorOf(ctx))
    return out(`${handle}.int${await rev(ctx, handle)}`)
  },
})

export const connect = mutation({
  args: {
    handle: v.string(),
    id: v.string(),
    key: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'integrations.connect', { key: a.key })
    const p = await signedIn(ctx)
    await managedAccount(ctx, a.handle, p)
    const i = known(a.id)
    if (i.status !== 'available')
      fail('invalid_state', `${a.id} cannot be connected yet.`)
    if (i.credential && !a.key)
      fail('invalid_request', `${a.id} needs a key.`, {
        errors: [
          {
            pointer: '/body/key',
            code: 'required',
            message: `${a.id} connects with a key.`,
          },
        ],
      })
    const have = await ctx.db
      .query('connections')
      .withIndex('by_account_and_integration', (q) =>
        q.eq('account', a.handle).eq('integration', a.id),
      )
      .unique()
    const keyHash = a.key ? bytesToHex(sha256(utf8ToBytes(a.key))) : null
    if (have && have.keyHash === keyHash)
      return out({ connection: presentConnection(have), created: false })
    const c = {
      account: a.handle,
      integration: a.id,
      hint: a.key ? a.key.slice(-4) : null,
      keyHash,
      by: p.handle,
      connected: Date.now(),
    }
    // Replaced, not edited, so it keeps its place at the end of the list as a new connection.
    if (have) await ctx.db.delete('connections', have._id)
    await ctx.db.insert('connections', c)
    await bump(ctx, a.handle)
    return finish(a.dry, { connection: presentConnection(c), created: !have })
  },
})

export const disconnect = mutation({
  args: { handle: v.string(), id: v.string(), dry: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, a) => {
    await managedAccount(ctx, a.handle, await signedIn(ctx))
    known(a.id)
    const have = await ctx.db
      .query('connections')
      .withIndex('by_account_and_integration', (q) =>
        q.eq('account', a.handle).eq('integration', a.id),
      )
      .unique()
    if (!have) return out(null)
    await ctx.db.delete('connections', have._id)
    const acct = (await accountByHandle(ctx, a.handle))!
    for (const r of await ctx.db
      .query('repos')
      .withIndex('by_ownerId_and_name', (q) => q.eq('ownerId', acct._id))
      .take(5000)) {
      const on = await ctx.db
        .query('repoIntegrations')
        .withIndex('by_repoId_and_integration', (q) =>
          q.eq('repoId', r._id).eq('integration', a.id),
        )
        .unique()
      if (on) await ctx.db.delete('repoIntegrations', on._id)
    }
    await bump(ctx, a.handle)
    return finish(a.dry, null)
  },
})

export const listRepoIntegrations = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const result = []
    for (const c of (await connectionsOf(ctx, repo.owner)).sort(
      (x, y) => x._creationTime - y._creationTime,
    )) {
      const on = await ctx.db
        .query('repoIntegrations')
        .withIndex('by_repoId_and_integration', (q) =>
          q.eq('repoId', repo._id).eq('integration', c.integration),
        )
        .unique()
      result.push({
        object: 'repo_integration',
        integration: c.integration,
        enabled: !!on,
      })
    }
    return out(result)
  },
})

export const repoIntegrationsVersion = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    return out(
      `${repo.publicId}.int${await rev(ctx, repo.owner)}.${await accessStamp(ctx, repo)}`,
    )
  },
})

export const setRepoIntegration = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    on: v.boolean(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'integrations.set', { enabled: a.on })
    const repo = await resolve(
      ctx,
      a.owner,
      a.name,
      await signedIn(ctx),
      'write',
    )
    known(a.id)
    const connected = await ctx.db
      .query('connections')
      .withIndex('by_account_and_integration', (q) =>
        q.eq('account', repo.owner).eq('integration', a.id),
      )
      .unique()
    if (a.on && !connected)
      fail(
        'invalid_state',
        `${a.id} is not connected to ${repo.owner}. Connect it there first.`,
      )
    const row = await ctx.db
      .query('repoIntegrations')
      .withIndex('by_repoId_and_integration', (q) =>
        q.eq('repoId', repo._id).eq('integration', a.id),
      )
      .unique()
    if (a.on && !row)
      await ctx.db.insert('repoIntegrations', {
        repoId: repo._id,
        integration: a.id,
      })
    if (!a.on && row) await ctx.db.delete('repoIntegrations', row._id)
    await bump(ctx, repo.owner)
    return finish(a.dry, {
      object: 'repo_integration',
      integration: a.id,
      enabled: a.on,
    })
  },
})

// ---- linked accounts ------------------------------------------------------------

async function self(ctx: QueryCtx, handle: string, p: Actor | null) {
  if (
    !p ||
    p.handle !== handle ||
    (await accountByHandle(ctx, handle))?.kind !== 'person'
  )
    fail('not_found', `No account ${handle}.`)
}

const presentLink = (l: {
  handle: string
  host: string
  login: string
  instance: string | null
  linked: number
}) => ({
  object: 'linked_account' as const,
  account: l.handle,
  host: l.host,
  login: l.login,
  instance: l.instance,
  verified: false,
  linked_at: iso(l.linked),
})

export const listLinks = query({
  args: { handle: v.string() },
  returns: v.string(),
  handler: async (ctx, { handle }) => {
    await self(ctx, handle, await actorOf(ctx))
    const all = await ctx.db
      .query('links')
      .withIndex('by_handle_and_host', (q) => q.eq('handle', handle))
      .take(50)
    return out(
      all
        .sort(
          (a, b) => a.linked - b.linked || a._creationTime - b._creationTime,
        )
        .map(presentLink),
    )
  },
})

export const link = mutation({
  args: {
    handle: v.string(),
    host: v.string(),
    login: v.string(),
    instance: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'links.set', { login: a.login, instance: a.instance })
    await self(ctx, a.handle, await signedIn(ctx))
    if (a.host === 'gitea' && !a.instance)
      fail('invalid_request', 'A Gitea account needs its address.', {
        errors: [
          {
            pointer: '/body/instance',
            code: 'required',
            message: 'Gitea runs on your own server: say where.',
          },
        ],
      })
    const had = await ctx.db
      .query('links')
      .withIndex('by_handle_and_host', (q) =>
        q.eq('handle', a.handle).eq('host', a.host),
      )
      .unique()
    if (had) await ctx.db.delete('links', had._id)
    const l = {
      handle: a.handle,
      host: a.host,
      login: a.login,
      instance: a.instance ?? null,
      linked: Date.now(),
    }
    await ctx.db.insert('links', l)
    await bump(ctx, `~${a.handle}`)
    return out(presentLink(l))
  },
})

export const unlink = mutation({
  args: { handle: v.string(), host: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await self(ctx, a.handle, await signedIn(ctx))
    const had = await ctx.db
      .query('links')
      .withIndex('by_handle_and_host', (q) =>
        q.eq('handle', a.handle).eq('host', a.host),
      )
      .unique()
    if (had) await ctx.db.delete('links', had._id)
    await bump(ctx, `~${a.handle}`)
    return out(null)
  },
})

// ---- imports -----------------------------------------------------------------------

/** After an imported repository was made: remember where it came from. */
export const markImported = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    host: v.string(),
    slug: v.string(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(
      ctx,
      a.owner,
      a.name,
      await signedIn(ctx),
      'write',
    )
    await ctx.db.patch('repos', repo._id, {
      upstream: { host: a.host as 'github', slug: a.slug },
      version: repo.version + 1,
    })
    return out(
      await presentRepo(ctx, (await ctx.db.get('repos', repo._id))!, a.at),
    )
  },
})

/** What the person imported: repositories they can change that came from another host. */
export const listImports = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const p = await signedIn(ctx, 'Sign in to see your imports.')
    const owners = new Set([p.handle])
    const me = await accountByHandle(ctx, p.handle)
    if (me)
      for (const m of await ctx.db
        .query('memberships')
        .withIndex('by_personId', (q) => q.eq('personId', me._id))
        .take(500)) {
        const org = await ctx.db.get('accounts', m.organizationId)
        if (org) owners.add(org.handle)
      }
    const found = []
    for (const owner of owners)
      for (const r of await ctx.db
        .query('repos')
        .withIndex('by_owner_and_created_and_publicId', (q) =>
          q.eq('owner', owner),
        )
        .take(5000))
        if (r.upstream && (await canWrite(ctx, r, p)))
          found.push({
            repo: `${r.owner}/${r.name}`,
            host: r.upstream.host,
            slug: r.upstream.slug,
            created: r.created,
          })
    return out(found)
  },
})
