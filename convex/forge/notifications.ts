import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { signedIn } from '../lib/actor'
import {
  accountByHandle,
  canRead,
  repoByKey,
  repoByPublicId,
} from '../lib/access'
import { fail, out } from '../lib/errors'
import { iso, urls } from '../lib/present'
import type { Actor } from '../lib/actor'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Each person's inbox. It is fed from the events every write already emits
 * (`fanOut`, run after the events are numbered), so a write does not have to
 * know who to tell. Someone is never told about what they did themself, nor
 * shown something about a repository they can no longer read.
 */

export const defaultPrefs: Record<string, boolean> = {
  review: true,
  mention: true,
  release: true,
  ci: true,
  issue: true,
  import: true,
  digest: false,
}

const MAX = 1000

async function inbox(ctx: QueryCtx, handle: string) {
  return await ctx.db
    .query('inboxes')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
}

async function bump(ctx: MutationCtx, handle: string, count = 0) {
  const box = await inbox(ctx, handle)
  if (box)
    await ctx.db.patch('inboxes', box._id, {
      rev: box.rev + 1,
      count: box.count + count,
    })
  else await ctx.db.insert('inboxes', { handle, rev: 1, count, prefs: null })
}

/** Put something in a person's inbox, if they want that kind. */
export async function notify(
  ctx: MutationCtx,
  handle: string,
  n: {
    kind: string
    title: string
    repo: string | null
    path: string
    at?: number
    unread?: boolean
    id?: string
  },
) {
  const account = await accountByHandle(ctx, handle)
  if (account?.kind !== 'person') return
  const box = await inbox(ctx, handle)
  const prefs = { ...defaultPrefs, ...box?.prefs }
  if (!prefs[n.kind]) return
  const at = n.at ?? Date.now()
  // A repository is kept by id, and the path by what follows its address.
  const r =
    n.repo && n.repo.includes('/') && !n.repo.startsWith('~')
      ? await repoByKey(ctx, n.repo)
      : null
  const prefix = r ? `/${r.owner}/${r.name}` : null
  await ctx.db.insert('notifications', {
    handle,
    publicId: n.id ?? newId('notification', at),
    kind: n.kind,
    title: n.title,
    repoId: r?.publicId ?? null,
    repo: n.repo,
    path:
      prefix && n.path.startsWith(`${prefix}/`)
        ? n.path.slice(prefix.length)
        : n.path,
    unread: n.unread ?? true,
    created: at,
  })
  await bump(ctx, handle, 1)
  // An inbox keeps its newest thousand.
  if ((box?.count ?? 0) + 1 > MAX) {
    const oldest = await ctx.db
      .query('notifications')
      .withIndex('by_handle_and_created', (q) => q.eq('handle', handle))
      .first()
    if (oldest) {
      await ctx.db.delete('notifications', oldest._id)
      await bump(ctx, handle, -1)
    }
  }
}

/** Handles written as `@handle` in a text, at most ten, in order. */
function mentions(text: string): Array<string> {
  const found: Array<string> = []
  for (const m of text.matchAll(/(?:^|[^\w@/])@([a-z0-9][a-z0-9-]{0,38})/gi))
    if (!found.includes(m[1].toLowerCase())) found.push(m[1].toLowerCase())
  return found.slice(0, 10)
}

type Event = {
  type: string
  repo: string | null
  repo_id: string | null
  actor: { handle: string }
  subject: { object: string; id: string; number: number | null }
  changes: Array<string>
  data: Record<string, unknown> | null
}

/** Who an event tells, and what. */
export async function fanOutEvent(ctx: MutationCtx, e: Event) {
  if (!e.repo) return
  const full = e.repo
  const n = e.subject.number
  const by = e.actor.handle
  const d = (e.data ?? {}) as {
    title?: string
    body?: string
    author?: { handle: string }
    assignees?: Array<{ handle: string }>
    issue?: number
    thread?: Array<string>
  }
  const tell = async (
    who: string | undefined,
    kind: string,
    title: string,
    path: string,
  ) => {
    if (!who || who === by) return
    await notify(ctx, who, { kind, title, repo: full, path })
  }
  const type = e.type
  if (type === 'issue.created' || type === 'issue.updated') {
    if (
      !d.assignees ||
      (type === 'issue.updated' && !e.changes.includes('assignees'))
    )
      return
    for (const a of d.assignees)
      await tell(
        a.handle,
        'issue',
        `${by} assigned you #${n} ${d.title ?? ''}`.trim(),
        `/${full}/issues?n=${n}`,
      )
    return
  }
  if (type === 'issue.commented') {
    const repo = e.repo_id ? await repoByPublicId(ctx, e.repo_id) : null
    const issue = repo
      ? await ctx.db
          .query('issues')
          .withIndex('by_repoId_and_number', (q) =>
            q.eq('repoId', repo._id).eq('number', d.issue ?? -1),
          )
          .unique()
      : null
    for (const h of mentions(d.body ?? ''))
      await tell(
        h,
        'mention',
        `${by} mentioned you on #${d.issue} ${issue?.title ?? ''}`.trim(),
        `/${full}/issues?n=${d.issue}`,
      )
    return
  }
  const author = d.author?.handle
  const where = `/${full}/changes?n=${n}`
  // A fix that answers a thread tells whoever started the thread.
  const addressed = (e.data as { addressed?: unknown } | null)?.addressed
  if (Array.isArray(addressed)) {
    for (const x of addressed as Array<{ author: string; patch_set: number }>)
      await tell(
        x.author,
        'review',
        `${by} addressed your comment on #${n} in patch set ${x.patch_set}`,
        where,
      )
    if (type === 'change.comment_addressed') return
  }
  if (type === 'change.commented') {
    const told = new Set<string>()
    for (const h of mentions(d.body ?? '')) {
      told.add(h)
      await tell(
        h,
        'mention',
        `${by} mentioned you on #${n} ${d.title ?? ''}`.trim(),
        where,
      )
    }
    for (const h of [author, ...(d.thread ?? [])])
      if (h && !told.has(h)) {
        told.add(h)
        await tell(
          h,
          'review',
          `${by} commented on #${n} ${d.title ?? ''}`.trim(),
          where,
        )
      }
    return
  }
  if (type === 'finding.raised')
    await tell(
      author,
      'review',
      `${by} raised a finding on #${n} ${d.title ?? ''}`.trim(),
      where,
    )
  if (type === 'change.reviewed')
    await tell(
      author,
      'review',
      `${by} reviewed #${n} ${d.title ?? ''}`.trim(),
      where,
    )
  if (type === 'ci.failed')
    await tell(
      author,
      'ci',
      `Checks failed on #${n} ${d.title ?? ''}`.trim(),
      where,
    )
  if (type === 'change.landed')
    await tell(
      author,
      'review',
      `${by} landed #${n} ${d.title ?? ''}`.trim(),
      where,
    )
}

/** For writes that tell someone directly, not through an event (a finished import). */
export const deliver = internalMutation({
  args: {
    handle: v.string(),
    kind: v.string(),
    title: v.string(),
    repo: v.union(v.null(), v.string()),
    path: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await notify(ctx, a.handle, a)
    return null
  },
})

// ---- reading ---------------------------------------------------------------------

async function present(ctx: QueryCtx, x: Doc<'notifications'>) {
  const r = x.repoId ? await repoByPublicId(ctx, x.repoId) : null
  const full = r ? `${r.owner}/${r.name}` : x.repo
  return {
    object: 'notification' as const,
    id: x.publicId,
    kind: x.kind,
    title: x.title,
    repo: full,
    html_url: `${urls().html}${r ? `/${full}${x.path}` : x.path}`,
    unread: x.unread,
    created_at: iso(x.created),
  }
}

/** Items about a repository the viewer can no longer read drop out. */
async function visible(ctx: QueryCtx, p: Actor, x: Doc<'notifications'>) {
  if (!x.repo || x.repo.startsWith('~')) return true
  if (x.repoId) {
    const r = await repoByPublicId(ctx, x.repoId)
    return !!r && (await canRead(ctx, r, p))
  }
  const r = await repoByKey(ctx, x.repo)
  // Not a repository (an account-level item such as an import): keep it.
  if (!r) return !x.repo.includes('/')
  return await canRead(ctx, r, p)
}

async function all(ctx: QueryCtx, p: Actor) {
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_handle_and_created', (q) => q.eq('handle', p.handle))
    .order('desc')
    .take(MAX + 50)
  const shown: Array<Doc<'notifications'>> = []
  for (const x of rows) if (await visible(ctx, p, x)) shown.push(x)
  return shown
}

const who = async (ctx: QueryCtx) =>
  signedIn(ctx, 'Sign in to read your inbox.')

export const list = query({
  args: {
    unread: v.optional(v.boolean()),
    kind: v.optional(v.string()),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, q) => {
    const p = await who(ctx)
    const items = (await all(ctx, p)).filter(
      (x) => (!q.unread || x.unread) && (!q.kind || x.kind === q.kind),
    )
    let start = 0
    if (q.after) {
      const k = items.findIndex((x) => x.publicId === q.after!.id)
      start = k >= 0 ? k + 1 : items.length
    }
    const page = items.slice(start, start + q.limit)
    const last = page.at(-1)
    return out({
      items: await Promise.all(page.map((x) => present(ctx, x))),
      next:
        start + q.limit < items.length && last
          ? { key: start + q.limit, id: last.publicId }
          : null,
    })
  },
})

export const version = query({
  args: { access: v.number() },
  returns: v.string(),
  handler: async (ctx, { access }) => {
    const p = await who(ctx)
    return out(
      `${p.handle}.${(await inbox(ctx, p.handle))?.rev ?? 0}.${access}`,
    )
  },
})

export const unreadCount = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const p = await who(ctx)
    return out({
      object: 'notification_count',
      unread: (await all(ctx, p)).filter((x) => x.unread).length,
    })
  },
})

export const markRead = mutation({
  args: { id: v.union(v.null(), v.string()) },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    const p = await who(ctx)
    if (id !== null) {
      const x = await ctx.db
        .query('notifications')
        .withIndex('by_publicId', (q) => q.eq('publicId', id))
        .unique()
      if (!x || x.handle !== p.handle)
        fail('not_found', `No notification ${id}.`)
      if (x.unread) {
        await ctx.db.patch('notifications', x._id, { unread: false })
        await bump(ctx, p.handle)
      }
      return out(null)
    }
    let changed = false
    for (const x of await ctx.db
      .query('notifications')
      .withIndex('by_handle_and_unread', (q) =>
        q.eq('handle', p.handle).eq('unread', true),
      )
      .take(MAX + 50)) {
      await ctx.db.patch('notifications', x._id, { unread: false })
      changed = true
    }
    if (changed) await bump(ctx, p.handle)
    return out(null)
  },
})

export const getPrefs = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const p = await who(ctx)
    const box = await inbox(ctx, p.handle)
    return out({
      object: 'notification_preferences',
      ...defaultPrefs,
      ...box?.prefs,
    })
  },
})

export const updatePrefs = mutation({
  args: { prefs: v.record(v.string(), v.boolean()) },
  returns: v.string(),
  handler: async (ctx, { prefs }) => {
    await bodyOf(ctx, 'notifications.update_preferences', prefs)
    const p = await who(ctx)
    const box = await inbox(ctx, p.handle)
    const next = { ...defaultPrefs, ...box?.prefs }
    for (const [k, on] of Object.entries(prefs))
      if (k in defaultPrefs) next[k] = on
    if (box) await ctx.db.patch('inboxes', box._id, { prefs: next })
    else
      await ctx.db.insert('inboxes', {
        handle: p.handle,
        rev: 0,
        count: 0,
        prefs: next,
      })
    // Key order as the API has always shown it.
    const ordered = Object.fromEntries(
      Object.keys(defaultPrefs).map((k) => [k, next[k]]),
    )
    return out({ object: 'notification_preferences', ...ordered })
  },
})
