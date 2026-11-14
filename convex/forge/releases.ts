import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internal } from '../_generated/api'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { actorOf, signedIn } from '../lib/actor'
import { accessStamp, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, emit } from '../lib/events'
import { actorOut, iso, repoUrl, urls } from '../lib/present'
import { notify } from './notifications'
import type { ActorRef } from '../lib/events'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Releases: a version with notes and signed files for each platform. A
 * stable release tells the people who starred the repository; betas and
 * nightlies reach only those who look.
 */

const SHARDS = 8

type Asset = {
  name: string
  platform: string
  arch: string
  size: number
  downloads: number
  sha256: string
  uploadId?: string
}
export type Release = {
  id: string
  tag: string
  channel: string
  title: string
  notes: { added: Array<string>; changed: Array<string>; fixed: Array<string> }
  signed: boolean
  commit: string | null
  withdrawn: { reason: string; at: number } | null
  assets: Array<Asset>
  author: ActorRef
  published: number
  version: number
}

async function counted(ctx: QueryCtx, id: Id<'releases'>, asset: string) {
  let n = 0
  for (const s of await ctx.db
    .query('downloads')
    .withIndex('by_releaseId_and_asset_and_shard', (q) =>
      q.eq('releaseId', id).eq('asset', asset),
    )
    .take(SHARDS))
    n += s.n
  return n
}

/** The release with its downloads counted in. */
async function load(ctx: QueryCtx, doc: Doc<'releases'>): Promise<Release> {
  const r = JSON.parse(doc.json) as Release
  for (const a of r.assets) a.downloads += await counted(ctx, doc._id, a.name)
  r.version = doc.version
  return r
}

function present(repo: Doc<'repos'>, r: Release) {
  return {
    object: 'release' as const,
    id: r.id,
    tag: r.tag,
    url: `${repoUrl(repo)}/releases/${encodeURIComponent(r.tag)}`,
    html_url: `${urls().html}/${repo.owner}/${repo.name}/releases`,
    channel: r.channel,
    title: r.title,
    notes: r.notes,
    signed: r.signed,
    commit: r.commit,
    withdrawn: r.withdrawn
      ? { reason: r.withdrawn.reason, at: iso(r.withdrawn.at) }
      : null,
    assets: r.assets.map(({ uploadId, ...a }) => ({
      ...a,
      content_url: uploadId
        ? `${urls().api}/uploads/${uploadId}/content`
        : null,
    })),
    downloads: r.assets.reduce((n, a) => n + a.downloads, 0),
    author: actorOut(r.author),
    published_at: iso(r.published),
    version: r.version,
  }
}

async function releaseOf(ctx: QueryCtx, repo: Doc<'repos'>, tag: string) {
  const doc = await ctx.db
    .query('releases')
    .withIndex('by_repoId_and_tag', (q) =>
      q.eq('repoId', repo._id).eq('tag', tag),
    )
    .unique()
  if (!doc)
    fail('not_found', `No release ${tag} in ${repo.owner}/${repo.name}.`)
  return doc
}

export async function insertRelease(
  ctx: MutationCtx,
  repoId: Id<'repos'>,
  r: Release,
) {
  return await ctx.db.insert('releases', {
    repoId,
    publicId: r.id,
    tag: r.tag,
    channel: r.channel,
    published: r.published,
    json: JSON.stringify(r),
    version: r.version,
  })
}

export const list = query({
  args: {
    owner: v.string(),
    name: v.string(),
    channel: v.optional(v.string()),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, q) => {
    const repo = await resolve(ctx, q.owner, q.name, await actorOf(ctx))
    const all = (
      await ctx.db
        .query('releases')
        .withIndex('by_repoId_and_published', (x) => x.eq('repoId', repo._id))
        .order('desc')
        .take(2000)
    ).filter((r) => !q.channel || r.channel === q.channel)
    let start = 0
    if (q.after) {
      const k = all.findIndex((r) => r.publicId === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const page = all.slice(start, start + q.limit)
    const last = page.at(-1)
    const items = []
    for (const d of page) items.push(present(repo, await load(ctx, d)))
    return out({
      items,
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.publicId }
          : null,
    })
  },
})

export const version = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const all = await ctx.db
      .query('releases')
      .withIndex('by_repoId_and_published', (x) => x.eq('repoId', repo._id))
      .take(2000)
    let rev = 0
    for (const r of all) {
      rev += r.version
      for (const s of await ctx.db
        .query('downloads')
        .withIndex('by_releaseId_and_asset_and_shard', (q) =>
          q.eq('releaseId', r._id),
        )
        .take(500))
        rev += s.n
    }
    return out(
      `${repo.publicId}.r${all.length}.${rev}.${await accessStamp(ctx, repo)}`,
    )
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), tag: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    return out(
      present(repo, await load(ctx, await releaseOf(ctx, repo, a.tag))),
    )
  },
})

const asset = v.object({
  name: v.string(),
  platform: v.string(),
  arch: v.string(),
  size: v.number(),
  sha256: v.string(),
  uploadId: v.optional(v.string()),
})
const notes = v.object({
  added: v.optional(v.array(v.string())),
  changed: v.optional(v.array(v.string())),
  fixed: v.optional(v.array(v.string())),
})

export const create = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    tag: v.string(),
    channel: v.string(),
    title: v.string(),
    notes: v.optional(notes),
    signed: v.optional(v.boolean()),
    commit: v.optional(v.string()),
    // Checked by the API against the uploads it holds: size and sha256 come from the upload.
    assets: v.array(asset),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const same = await ctx.db
      .query('releases')
      .withIndex('by_repoId_and_tag', (q) =>
        q.eq('repoId', repo._id).eq('tag', a.tag),
      )
      .unique()
    if (same)
      return out({
        release: present(repo, await load(ctx, same)),
        outcome: 'unchanged',
      })
    const at = Date.now()
    const by = await actorFor(ctx, p.handle, p.class)
    const r: Release = {
      id: newId('release', at),
      tag: a.tag,
      channel: a.channel,
      title: a.title,
      notes: {
        added: a.notes?.added ?? [],
        changed: a.notes?.changed ?? [],
        fixed: a.notes?.fixed ?? [],
      },
      signed: a.signed ?? false,
      commit: a.commit ?? null,
      withdrawn: null,
      assets: a.assets.map((x) => ({ ...x, downloads: 0 })),
      author: by,
      published: at,
      version: 1,
    }
    await insertRelease(ctx, repo._id, r)
    const shown = present(repo, r)
    await emit(
      ctx,
      repo,
      'release.published',
      by,
      { object: 'release', id: r.id, number: null },
      ['releases'],
      shown,
    )
    if (r.channel === 'stable')
      await ctx.scheduler.runAfter(0, internal.forge.releases.tellStargazers, {
        repo: repo._id,
        by: by.handle,
        title: `${repo.name} ${r.tag} is out: ${r.title}`,
        after: null,
      })
    return finish(a.dry, {
      release: shown,
      outcome: 'created',
      repo: `${repo.owner}/${repo.name}`,
      repoId: repo.publicId,
    })
  },
})

/** A stable release tells the people who starred the repository, a batch at a time. */
export const tellStargazers = internalMutation({
  args: {
    repo: v.id('repos'),
    by: v.string(),
    title: v.string(),
    after: v.union(v.null(), v.number()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const repo = await ctx.db.get('repos', a.repo)
    if (!repo) return null
    const page = await ctx.db
      .query('stars')
      .withIndex('by_repoId_and_at', (q) =>
        a.after === null
          ? q.eq('repoId', repo._id)
          : q.eq('repoId', repo._id).gt('at', a.after),
      )
      .take(200)
    for (const s of page)
      if (s.handle !== a.by)
        await notify(ctx, s.handle, {
          kind: 'release',
          title: a.title,
          repo: `${repo.owner}/${repo.name}`,
          path: `/${repo.owner}/${repo.name}/releases`,
        })
    if (page.length === 200)
      await ctx.scheduler.runAfter(0, internal.forge.releases.tellStargazers, {
        ...a,
        after: page[199].at,
      })
    return null
  },
})

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    tag: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(notes),
    withdrawn: v.optional(v.union(v.null(), v.string())),
    fields: v.array(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const doc = await releaseOf(ctx, repo, a.tag)
    const stored = JSON.parse(doc.json) as Release
    const next: Release = {
      ...stored,
      title: a.title ?? stored.title,
      notes: {
        ...stored.notes,
        ...a.notes,
      },
      withdrawn:
        a.withdrawn === undefined
          ? stored.withdrawn
          : a.withdrawn === null
            ? null
            : { reason: a.withdrawn, at: stored.withdrawn?.at ?? Date.now() },
    }
    await ctx.db.patch('releases', doc._id, {
      json: JSON.stringify(next),
      version: doc.version + 1,
    })
    const shown = present(
      repo,
      await load(ctx, (await ctx.db.get('releases', doc._id))!),
    )
    await emit(
      ctx,
      repo,
      a.withdrawn ? 'release.withdrawn' : 'release.updated',
      await actorFor(ctx, p.handle, p.class),
      { object: 'release', id: next.id, number: null },
      a.fields,
      shown,
    )
    return finish(a.dry, shown)
  },
})

/** Someone is downloading an asset: count it, and say where the file is. */
export const download = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    tag: v.string(),
    asset: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const doc = await releaseOf(ctx, repo, a.tag)
    const r = await load(ctx, doc)
    const x = r.assets.find((y) => y.name === a.asset)
    if (!x) fail('not_found', `No file ${a.asset} in ${a.tag}.`)
    if (r.withdrawn)
      fail('invalid_state', `${a.tag} was withdrawn: ${r.withdrawn.reason}`)
    const shard = Math.floor(Math.random() * SHARDS)
    const row = await ctx.db
      .query('downloads')
      .withIndex('by_releaseId_and_asset_and_shard', (q) =>
        q.eq('releaseId', doc._id).eq('asset', a.asset).eq('shard', shard),
      )
      .unique()
    if (row) await ctx.db.patch('downloads', row._id, { n: row.n + 1 })
    else
      await ctx.db.insert('downloads', {
        releaseId: doc._id,
        asset: a.asset,
        shard,
        n: 1,
      })
    const day = Math.floor(Date.now() / 86_400_000)
    const d = await ctx.db
      .query('downloadDays')
      .withIndex('by_repoId_and_day', (q) =>
        q.eq('repoId', repo._id).eq('day', day),
      )
      .unique()
    if (d) await ctx.db.patch('downloadDays', d._id, { n: d.n + 1 })
    else await ctx.db.insert('downloadDays', { repoId: repo._id, day, n: 1 })
    return out({
      object: 'download',
      release: r.tag,
      asset: x.name,
      sha256: x.sha256,
      url: `${urls().html}/${repo.owner}/${repo.name}/releases/download/${encodeURIComponent(r.tag)}/${encodeURIComponent(x.name)}`,
      downloads: x.downloads + 1,
      content_url: x.uploadId
        ? `${urls().api}/uploads/${x.uploadId}/content`
        : null,
    })
  },
})
