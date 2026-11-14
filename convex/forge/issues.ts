import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn } from '../lib/actor'
import { accessStamp, assertMatch, canWrite, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, counters, emit } from '../lib/events'
import { keysetPage } from '../lib/paginate'
import { actorOut, iso, urls } from '../lib/present'
import { assignable, issueOf, presentIssue, recountLabels } from '../lib/issues'
import { syncAssignees } from '../lib/grants'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Issues, their labels, comments, and the images and recordings on them. */

const position = v.union(
  v.null(),
  v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
)
const color = v.union(
  v.literal('gray'),
  v.literal('red'),
  v.literal('orange'),
  v.literal('yellow'),
  v.literal('green'),
  v.literal('blue'),
  v.literal('purple'),
)

async function bumpIssues(ctx: MutationCtx, repo: Doc<'repos'>, open = 0) {
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, {
    issueRev: c.issueRev + 1,
    openIssues: c.openIssues + open,
  })
}

export const list = query({
  args: {
    owner: v.string(),
    name: v.string(),
    state: v.string(),
    label: v.optional(v.string()),
    author: v.optional(v.string()),
    after: position,
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const state =
      args.state === 'open' || args.state === 'closed' ? args.state : null
    const page = await keysetPage<Doc<'issues'>>(
      {
        sameKey: () => (async function* () {})(),
        beyond: (key) =>
          state
            ? ctx.db
                .query('issues')
                .withIndex('by_repoId_and_state_and_number', (q) =>
                  key === null
                    ? q.eq('repoId', repo._id).eq('state', state)
                    : q
                        .eq('repoId', repo._id)
                        .eq('state', state)
                        .lt('number', key as number),
                )
                .order('desc')
            : ctx.db
                .query('issues')
                .withIndex('by_repoId_and_number', (q) =>
                  key === null
                    ? q.eq('repoId', repo._id)
                    : q.eq('repoId', repo._id).lt('number', key as number),
                )
                .order('desc'),
      },
      (i) => i.number,
      {
        after: args.after,
        limit: args.limit,
        match: (i) =>
          (!args.label || i.labels.includes(args.label)) &&
          (!args.author || i.author.handle === args.author),
      },
    )
    return out({
      items: page.items.map((i) => presentIssue(repo, i)),
      next: page.next,
    })
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), number: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    return out(presentIssue(repo, await issueOf(ctx, repo, args.number)))
  },
})

export const version = query({
  args: { owner: v.string(), name: v.string(), number: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const i = await ctx.db
      .query('issues')
      .withIndex('by_repoId_and_number', (q) =>
        q.eq('repoId', repo._id).eq('number', args.number),
      )
      .unique()
    return out(
      i
        ? `${i.publicId}.${i.version}.${repo.version}.${await accessStamp(ctx, repo)}`
        : null,
    )
  },
})

async function openWithTitle(ctx: QueryCtx, repo: Doc<'repos'>, title: string) {
  return (
    await ctx.db
      .query('issues')
      .withIndex('by_repoId_and_title', (q) =>
        q.eq('repoId', repo._id).eq('title', title),
      )
      .take(50)
  ).find((i) => i.state === 'open')
}

export const create = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    assignees: v.optional(v.array(v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const args = {
      ...given,
      ...(await bodyOf(ctx, 'issues.create', {
        title: given.title,
        body: given.body,
        labels: given.labels,
        assignees: given.assignees,
      })),
    }
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p, 'write')
    const assignees =
      args.assignees && (await assignable(ctx, repo, args.assignees))
    const same = await openWithTitle(ctx, repo, args.title)
    if (same)
      return out({ issue: presentIssue(repo, same), outcome: 'unchanged' })
    const at = Date.now()
    const by = await actorFor(ctx, p.handle, p.class)
    const c = await counters(ctx, repo)
    await ctx.db.patch('repoCounters', c._id, { nextNumber: c.nextNumber + 1 })
    const body = args.body ?? ''
    const id = await ctx.db.insert('issues', {
      repoId: repo._id,
      publicId: newId('issue', at),
      number: c.nextNumber,
      title: args.title,
      body,
      text: `${args.title}\n${body}`,
      state: 'open',
      author: by,
      labels: args.labels ?? [],
      assignees: assignees ?? [],
      commentCount: 0,
      created: at,
      updated: at,
      closed: null,
      version: 1,
    })
    const issue = (await ctx.db.get('issues', id))!
    await syncAssignees(ctx, issue)
    await recountLabels(ctx, repo._id, null, issue)
    await bumpIssues(ctx, repo, 1)
    const shown = presentIssue(repo, issue)
    await emit(
      ctx,
      repo,
      'issue.created',
      by,
      { object: 'issue', id: issue.publicId, number: issue.number },
      ['state'],
      shown,
    )
    return finish(args.dry, { issue: shown, outcome: 'created' })
  },
})

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    number: v.number(),
    body: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
      state: v.optional(v.union(v.literal('open'), v.literal('closed'))),
      assignees: v.optional(v.array(v.string())),
    }),
    // The fields as the caller sent them, in their order, for the event.
    fields: v.array(v.string()),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (
    ctx,
    { owner, name, number, body: given, fields, ifMatch, dry },
  ) => {
    const body = await bodyOf(ctx, 'issues.update', given)
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, owner, name, p, 'write')
    const i = await issueOf(ctx, repo, number)
    const assignees =
      body.assignees && (await assignable(ctx, repo, body.assignees))
    const handles = (a: Array<{ handle: string }> | undefined) =>
      (a ?? []).map((x) => x.handle).join(',')
    assertMatch(ifMatch, `${i.publicId}.${i.version}`, () =>
      presentIssue(repo, i),
    )
    const same =
      (body.title === undefined || body.title === i.title) &&
      (body.body === undefined || body.body === i.body) &&
      (body.labels === undefined ||
        JSON.stringify(body.labels) === JSON.stringify(i.labels)) &&
      (body.state === undefined || body.state === i.state) &&
      (assignees === undefined || handles(assignees) === handles(i.assignees))
    if (same) return out(presentIssue(repo, i))
    const at = Date.now()
    const next: Partial<Doc<'issues'>> = {
      title: body.title ?? i.title,
      body: body.body ?? i.body,
      labels: body.labels ?? i.labels,
      assignees: assignees ?? i.assignees,
      updated: at,
      version: i.version + 1,
    }
    next.text = `${next.title}\n${next.body}`
    if (body.state !== undefined && body.state !== i.state) {
      next.state = body.state
      next.closed = body.state === 'closed' ? at : null
    }
    await ctx.db.patch('issues', i._id, next)
    const after = (await ctx.db.get('issues', i._id))!
    await syncAssignees(ctx, after)
    await recountLabels(ctx, repo._id, i, after)
    const opened =
      (after.state === 'open' ? 1 : 0) - (i.state === 'open' ? 1 : 0)
    await bumpIssues(ctx, repo, opened)
    const shown = presentIssue(repo, after)
    await emit(
      ctx,
      repo,
      after.state === 'closed' ? 'issue.closed' : 'issue.updated',
      await actorFor(ctx, p.handle, p.class),
      { object: 'issue', id: after.publicId, number: after.number },
      fields,
      shown,
    )
    return finish(dry, shown)
  },
})

// ---- labels ------------------------------------------------------------------

function presentLabel(l: Doc<'labels'>, shown: Partial<Doc<'labels'>> = {}) {
  const x = { ...l, ...shown }
  return {
    object: 'label' as const,
    id: x.publicId,
    name: x.name,
    color: x.color,
    description: x.description,
    issues: x.openIssues,
    created_at: iso(x.created),
  }
}

async function labelOf(ctx: QueryCtx, repo: Doc<'repos'>, label: string) {
  const l = await ctx.db
    .query('labels')
    .withIndex('by_repoId_and_key', (q) =>
      q.eq('repoId', repo._id).eq('key', label.toLowerCase()),
    )
    .unique()
  if (!l) fail('not_found', `No label ${label} in ${repo.owner}/${repo.name}.`)
  return l
}

export const listLabels = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const all = await ctx.db
      .query('labels')
      .withIndex('by_repoId_and_key', (q) => q.eq('repoId', repo._id))
      .take(1000)
    all.sort((a, b) => (a.name < b.name ? -1 : 1))
    return out(all.map((l) => presentLabel(l)))
  },
})

export const labelsVersion = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const c = await counters(ctx, repo)
    return out(
      `${repo.publicId}.${c.labelRev}.${c.issueRev}.${await accessStamp(ctx, repo)}`,
    )
  },
})

async function bumpLabels(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  issues = false,
) {
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, {
    labelRev: c.labelRev + 1,
    ...(issues ? { issueRev: c.issueRev + 1 } : {}),
  })
}

export const createLabel = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    label: v.string(),
    color: v.optional(color),
    description: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p, 'write')
    const have = await ctx.db
      .query('labels')
      .withIndex('by_repoId_and_key', (q) =>
        q.eq('repoId', repo._id).eq('key', args.label.toLowerCase()),
      )
      .unique()
    if (have) return out({ label: presentLabel(have), outcome: 'unchanged' })
    const at = Date.now()
    const id = await ctx.db.insert('labels', {
      repoId: repo._id,
      publicId: newId('label', at),
      name: args.label,
      key: args.label.toLowerCase(),
      color: args.color ?? 'gray',
      description: args.description ?? '',
      created: at,
      openIssues: 0,
    })
    await bumpLabels(ctx, repo)
    return finish(args.dry, {
      label: presentLabel((await ctx.db.get('labels', id))!),
      outcome: 'created',
    })
  },
})

/** Every issue that has a label, a batch at a time: a label is on few issues or many. */
async function* issuesWith(ctx: QueryCtx, repo: Doc<'repos'>, label: string) {
  for await (const i of ctx.db
    .query('issues')
    .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id)))
    if (i.labels.includes(label)) yield i
}

export const updateLabel = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    label: v.string(),
    body: v.object({
      name: v.optional(v.string()),
      color: v.optional(color),
      description: v.optional(v.string()),
    }),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { owner, name, label, body, dry }) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, owner, name, p, 'write')
    const l = await labelOf(ctx, repo, label)
    const renamed = body.name !== undefined && body.name !== l.name
    if (renamed && body.name!.toLowerCase() !== l.key) {
      const taken = await ctx.db
        .query('labels')
        .withIndex('by_repoId_and_key', (q) =>
          q.eq('repoId', repo._id).eq('key', body.name!.toLowerCase()),
        )
        .unique()
      if (taken)
        fail('invalid_request', `${body.name} is already a label.`, {
          errors: [
            {
              pointer: '/body/name',
              code: 'taken',
              message: `There is already a label called ${body.name}.`,
            },
          ],
        })
    }
    const next = {
      name: body.name ?? l.name,
      key: (body.name ?? l.name).toLowerCase(),
      color: body.color ?? l.color,
      description: body.description ?? l.description,
    }
    if (renamed) {
      // Issues carry the name, so a rename follows it onto every issue.
      const at = Date.now()
      for await (const i of issuesWith(ctx, repo, l.name))
        await ctx.db.patch('issues', i._id, {
          labels: i.labels.map((x) => (x === l.name ? next.name : x)),
          version: i.version + 1,
          updated: at,
        })
    }
    await ctx.db.patch('labels', l._id, next)
    await bumpLabels(ctx, repo, renamed)
    return finish(dry, presentLabel((await ctx.db.get('labels', l._id))!))
  },
})

export const deleteLabel = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    label: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p, 'write')
    const l = await labelOf(ctx, repo, args.label)
    const at = Date.now()
    for await (const i of issuesWith(ctx, repo, l.name))
      await ctx.db.patch('issues', i._id, {
        labels: i.labels.filter((x) => x !== l.name),
        version: i.version + 1,
        updated: at,
      })
    await ctx.db.delete('labels', l._id)
    await bumpLabels(ctx, repo, true)
    return finish(args.dry, null)
  },
})

// ---- comments ----------------------------------------------------------------

function presentComment(
  i: Doc<'issues'>,
  c: Doc<'issueComments'>,
  shown: Partial<Doc<'issueComments'>> = {},
) {
  const x = { ...c, ...shown }
  return {
    object: 'issue_comment' as const,
    id: x.publicId,
    issue: i.number,
    author: actorOut(x.author),
    body: x.body,
    created_at: iso(x.created),
    updated_at: iso(x.updated),
    version: x.version,
  }
}

export const listComments = query({
  args: {
    owner: v.string(),
    name: v.string(),
    number: v.number(),
    after: position,
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const i = await issueOf(ctx, repo, args.number)
    // Oldest first. The cursor is the last comment sent, by position and id,
    // so a comment deleted before it moves the page back by one, never skips.
    let start = 0
    const all = await ctx.db
      .query('issueComments')
      .withIndex('by_issueId', (q) => q.eq('issueId', i._id))
      .take(
        Math.min(
          10_000,
          (args.after ? Number(args.after.key) : 0) + args.limit + 1 + 100,
        ),
      )
    if (args.after) {
      const k = all.findIndex((c) => c.publicId === args.after!.id)
      start = k >= 0 ? k + 1 : Math.min(Number(args.after.key), all.length)
    }
    const items = all.slice(start, start + args.limit)
    const last = items.at(-1)
    return out({
      items: items.map((c) => presentComment(i, c)),
      next:
        start + args.limit < i.commentCount && last
          ? { key: start + args.limit, id: last.publicId }
          : null,
    })
  },
})

export const commentsVersion = query({
  args: { owner: v.string(), name: v.string(), number: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const i = await ctx.db
      .query('issues')
      .withIndex('by_repoId_and_number', (q) =>
        q.eq('repoId', repo._id).eq('number', args.number),
      )
      .unique()
    return out(
      i ? `${i.publicId}.${i.version}.c.${await accessStamp(ctx, repo)}` : null,
    )
  },
})

export const createComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    number: v.number(),
    body: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const args = {
      ...given,
      ...(await bodyOf(ctx, 'comments.create', { body: given.body })),
    }
    const p = await signedIn(ctx)
    // Anyone who can read the repository may comment on its issues.
    const repo = await resolve(ctx, args.owner, args.name, p)
    const i = await issueOf(ctx, repo, args.number)
    const at = Date.now()
    const by = await actorFor(ctx, p.handle, p.class)
    const id = await ctx.db.insert('issueComments', {
      issueId: i._id,
      repoId: repo._id,
      publicId: newId('comment', at),
      author: by,
      body: args.body,
      created: at,
      updated: at,
      version: 1,
    })
    await ctx.db.patch('issues', i._id, {
      commentCount: i.commentCount + 1,
      updated: at,
      version: i.version + 1,
    })
    await bumpIssues(ctx, repo)
    const shown = presentComment(i, (await ctx.db.get('issueComments', id))!)
    await emit(
      ctx,
      repo,
      'issue.commented',
      by,
      { object: 'issue', id: i.publicId, number: i.number },
      ['comments'],
      shown,
    )
    return finish(args.dry, shown)
  },
})

async function commentOf(ctx: QueryCtx, repo: Doc<'repos'>, id: string) {
  const c = await ctx.db
    .query('issueComments')
    .withIndex('by_repoId_and_publicId', (q) =>
      q.eq('repoId', repo._id).eq('publicId', id),
    )
    .unique()
  const i = c && (await ctx.db.get('issues', c.issueId))
  if (!c || !i)
    fail('not_found', `No comment ${id} in ${repo.owner}/${repo.name}.`)
  return { i, c }
}

export const updateComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    body: v.string(),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p)
    const { i, c } = await commentOf(ctx, repo, args.id)
    if (c.author.handle !== p.handle)
      fail('forbidden', 'Only its author can edit a comment.')
    assertMatch(args.ifMatch, `${c.publicId}.${c.version}`, () =>
      presentComment(i, c),
    )
    if (args.body === c.body) return out(presentComment(i, c))
    await ctx.db.patch('issueComments', c._id, {
      body: args.body,
      updated: Date.now(),
      version: c.version + 1,
    })
    await ctx.db.patch('issues', i._id, { version: i.version + 1 })
    await bumpIssues(ctx, repo)
    return finish(
      args.dry,
      presentComment(i, (await ctx.db.get('issueComments', c._id))!),
    )
  },
})

export const deleteComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p)
    const { i, c } = await commentOf(ctx, repo, args.id)
    if (c.author.handle !== p.handle && !(await canWrite(ctx, repo, p)))
      fail(
        'forbidden',
        'Only its author or someone who can change the repository can delete a comment.',
      )
    await ctx.db.delete('issueComments', c._id)
    await ctx.db.patch('issues', i._id, {
      commentCount: Math.max(0, i.commentCount - 1),
      version: i.version + 1,
    })
    await bumpIssues(ctx, repo)
    return finish(args.dry, null)
  },
})

// ---- evidence ----------------------------------------------------------------

function presentIssueEvidence(i: Doc<'issues'>, e: Doc<'issueEvidence'>) {
  return {
    object: 'issue_evidence' as const,
    id: e.publicId,
    issue: i.number,
    kind: e.kind,
    caption: e.caption,
    upload: {
      id: e.upload.id,
      content_type: e.upload.contentType,
      size: e.upload.size,
      sha256: e.upload.sha256,
      content_url: `${urls().api}/uploads/${e.upload.id}/content`,
    },
    created_by: actorOut(e.by),
    created_at: iso(e.created),
  }
}

/** Anyone who can read the repository may show what they saw on an issue. */
export const addEvidence = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    number: v.number(),
    kind: v.union(v.literal('image'), v.literal('recording')),
    caption: v.string(),
    upload: v.object({
      id: v.string(),
      contentType: v.string(),
      size: v.number(),
      sha256: v.string(),
    }),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, args.owner, args.name, p)
    const i = await issueOf(ctx, repo, args.number)
    const by = await actorFor(ctx, p.handle, p.class)
    const at = Date.now()
    const id = await ctx.db.insert('issueEvidence', {
      issueId: i._id,
      publicId: newId('evidence', at),
      kind: args.kind,
      caption: args.caption,
      upload: args.upload,
      by,
      created: at,
    })
    await ctx.db.patch('issues', i._id, { updated: at, version: i.version + 1 })
    await bumpIssues(ctx, repo)
    const after = (await ctx.db.get('issues', i._id))!
    await emit(
      ctx,
      repo,
      'issue.updated',
      by,
      { object: 'issue', id: i.publicId, number: i.number },
      ['evidence'],
      presentIssue(repo, after),
    )
    return finish(args.dry, {
      evidence: presentIssueEvidence(
        after,
        (await ctx.db.get('issueEvidence', id))!,
      ),
      repo: `${repo.owner}/${repo.name}`,
      repoId: repo.publicId,
    })
  },
})

export const listEvidence = query({
  args: { owner: v.string(), name: v.string(), number: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const repo = await resolve(ctx, args.owner, args.name, await actorOf(ctx))
    const i = await issueOf(ctx, repo, args.number)
    const all = await ctx.db
      .query('issueEvidence')
      .withIndex('by_issueId', (q) => q.eq('issueId', i._id))
      .take(1000)
    return out(
      all.map((e) => ({
        uploadId: e.upload.id,
        shown: presentIssueEvidence(i, e),
      })),
    )
  },
})
