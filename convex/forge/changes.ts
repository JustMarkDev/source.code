import { v } from 'convex/values'
import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { newId } from '@source-code/api/ids'
import { internal } from '../_generated/api'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn } from '../lib/actor'
import {
  accessStamp,
  assertMatch,
  canWrite,
  mayReadId,
  resolve,
} from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, counters, emit } from '../lib/events'
import { keysetPage } from '../lib/paginate'
import { iso, urls } from '../lib/present'
import {
  branchOwner,
  findChange,
  hydrate,
  insertChange,
  loadChange,
  saveChange,
  stackMembers,
  viewFor,
} from '../lib/changes'
import type { Actor } from '../lib/actor'
import type { ActorRef } from '../lib/events'
import type { ChangeView, Loaded } from '../lib/changes'
import type {
  Assume,
  ChangeRec,
  CheckRec,
  EvidenceRec,
  FileStat,
  FindingRec,
  ReviewCommentRec,
  ReviewRec,
} from '../lib/changeTypes'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/** Changes: patch sets, reviews, checks, findings, policy, landing and stacks. */

const position = v.union(
  v.null(),
  v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
)
const hex = (s: string) => bytesToHex(sha1(utf8ToBytes(s)))

const isOpen = (s: ChangeRec['state']) => s === 'open' || s === 'draft'

/** Stamps a change as changed: a newer `updated`, a higher version. */
function touch(c: ChangeRec) {
  c.updated = Math.max(Date.now(), c.updated + 1)
  c.version++
}

/** Writes the change, keeps the open count, and emits its one event. */
async function commit(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  l: Loaded,
  wasState: ChangeRec['state'] | null,
  event: {
    type: string
    by: ActorRef
    changes: Array<string>
    data?: unknown
  } | null,
) {
  if (wasState === null)
    l.doc = (await ctx.db.get('changes', await insertChange(ctx, repo, l.rec)))!
  else await saveChange(ctx, l)
  const c = await counters(ctx, repo)
  const open =
    (isOpen(l.rec.state) ? 1 : 0) - (wasState && isOpen(wasState) ? 1 : 0)
  await ctx.db.patch('repoCounters', c._id, {
    changeRev: c.changeRev + 1,
    openChanges: Math.max(0, c.openChanges + open),
  })
  if (!event) return
  const fresh = (await ctx.db.get('repos', repo._id))!
  const view = await viewFor(ctx, fresh, null, Date.now(), [l.rec])
  await emit(
    ctx,
    fresh,
    event.type,
    event.by,
    { object: 'change', id: l.rec.id, number: l.rec.number },
    event.changes,
    event.data ?? view.presentChange(l.rec, 'event'),
  )
}

async function shown(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  c: ChangeRec,
  p: Actor | null,
  at: number,
  expand: ReadonlyArray<string> = [],
) {
  const view = await viewFor(ctx, repo, p, at, [c], {
    expandRepo: expand.includes('repo'),
  })
  return view.presentChange(c, p, expand)
}

// ---- reading -----------------------------------------------------------------

export const list = query({
  args: {
    owner: v.string(),
    name: v.string(),
    state: v.optional(v.string()),
    author: v.optional(v.string()),
    label: v.optional(v.string()),
    branch: v.optional(v.string()),
    sort: v.union(v.literal('updated_at'), v.literal('number')),
    desc: v.boolean(),
    after: position,
    limit: v.number(),
    expand: v.array(v.string()),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, q) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, q.owner, q.name, p)
    const states = q.state && q.state !== 'all' ? q.state.split(',') : null
    const everything = q.state === 'all'
    const order = q.desc ? 'desc' : 'asc'
    const byNumber = q.sort === 'number'
    const page = await keysetPage<Doc<'changes'>>(
      byNumber
        ? {
            sameKey: () => (async function* () {})(),
            beyond: (key) =>
              ctx.db
                .query('changes')
                .withIndex('by_repoId_and_number', (x) =>
                  key === null
                    ? x.eq('repoId', repo._id)
                    : q.desc
                      ? x.eq('repoId', repo._id).lt('number', key as number)
                      : x.eq('repoId', repo._id).gt('number', key as number),
                )
                .order(order),
          }
        : {
            sameKey: (key, id) =>
              ctx.db
                .query('changes')
                .withIndex('by_repoId_and_updated_and_publicId', (x) =>
                  q.desc
                    ? x
                        .eq('repoId', repo._id)
                        .eq('updated', key as number)
                        .lt('publicId', id)
                    : x
                        .eq('repoId', repo._id)
                        .eq('updated', key as number)
                        .gt('publicId', id),
                )
                .order(order),
            beyond: (key) =>
              ctx.db
                .query('changes')
                .withIndex('by_repoId_and_updated_and_publicId', (x) =>
                  key === null
                    ? x.eq('repoId', repo._id)
                    : q.desc
                      ? x.eq('repoId', repo._id).lt('updated', key as number)
                      : x.eq('repoId', repo._id).gt('updated', key as number),
                )
                .order(order),
          },
      (c) => (byNumber ? c.number : c.updated),
      {
        after: q.after,
        limit: q.limit,
        match: (c) =>
          (everything ||
            (states ? states.includes(c.state) : isOpen(c.state))) &&
          (!q.author || c.author.handle === q.author) &&
          (!q.branch || c.branch === q.branch) &&
          (!q.label || c.labels.includes(q.label)),
      },
    )
    const loaded = await Promise.all(page.items.map((d) => hydrate(ctx, d)))
    const view = await viewFor(
      ctx,
      repo,
      p,
      q.at,
      loaded.map((l) => l.rec),
      {
        expandRepo: q.expand.includes('repo'),
      },
    )
    return out({
      items: loaded.map((l) => view.presentChange(l.rec, p, q.expand)),
      next: page.next,
    })
  },
})

export const get = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    expand: v.array(v.string()),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const l = await loadChange(ctx, repo, a.ref)
    return out(await shown(ctx, repo, l.rec, p, a.at, a.expand))
  },
})

export const version = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    expand: v.array(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const c = await findChange(ctx, repo, a.ref)
    if (!c)
      fail('not_found', `No change ${a.ref} in ${repo.owner}/${repo.name}.`)
    let stackRev = 0
    if (c.stackId)
      for (const m of await stackMembers(ctx, repo, c.stackId))
        stackRev += m.version
    const owner = await branchOwner(ctx, repo, c.branch)
    const rev = a.expand.includes('repo')
      ? `.${(await counters(ctx, repo)).rev}`
      : ''
    return out(
      `${c.publicId}.${c.version}.${stackRev}.${owner?.publicId ?? ''}.${repo.version}.${await accessStamp(ctx, repo)}${rev}`,
    )
  },
})

// ---- opening and updating ----------------------------------------------------------

function patchFiles(prev: ChangeRec['patchSets'][number]) {
  return Object.fromEntries(
    Object.entries(prev.files).map(([path, f]) => [
      path,
      { ...f, hash: `${f.hash.slice(0, 4)}${prev.n + 1}` },
    ]),
  )
}

function pushPatchSet(
  c: ChangeRec,
  by: ActorRef,
  ps: {
    sha: string
    kind: 'update' | 'rebase'
    note: string
    tree?: string
    files?: Record<string, FileStat>
    contents?: Record<string, string | null>
  },
) {
  const prev = c.patchSets[c.patchSets.length - 1]
  const tree =
    ps.tree ?? (ps.kind === 'rebase' ? prev.tree : ps.sha.slice(0, 7))
  c.patchSets.push({
    n: prev.n + 1,
    sha: ps.sha,
    tree,
    note: ps.note,
    author: by,
    created: Date.now(),
    files: ps.files
      ? ps.files
      : ps.kind === 'rebase'
        ? prev.files
        : patchFiles(prev),
    kind: ps.kind,
    ...(ps.contents
      ? { contents: ps.contents }
      : ps.kind === 'rebase' && prev.contents
        ? { contents: prev.contents }
        : {}),
  })
  // An approval follows a rewrite only when the code did not change.
  if (ps.kind === 'update') for (const r of c.reviews) r.carries = false
  touch(c)
}

const patchSetEvent = (by: ActorRef) => ({
  type: 'change.updated',
  by,
  changes: ['head.patch_set', 'policy.state', 'checks.state'],
})

export const create = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    branch: v.string(),
    base: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    draft: v.optional(v.boolean()),
    sha: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const by = await actorFor(ctx, p.handle, p.class)
    const at = Date.now()
    const sha =
      a.sha ?? hex(`${repo.publicId}/${a.branch}/${at}/${Math.random()}`)
    const existing = await branchOwner(ctx, repo, a.branch)
    if (existing) {
      const l = await hydrate(ctx, existing)
      if (l.rec.patchSets[l.rec.patchSets.length - 1].sha === sha)
        return out({
          change: await shown(ctx, repo, l.rec, p, at),
          outcome: 'unchanged',
        })
      const was = l.rec.state
      pushPatchSet(l.rec, by, {
        sha,
        kind: 'update',
        note: 'Updated from branch',
      })
      await commit(ctx, repo, l, was, patchSetEvent(by))
      return finish(a.dry, {
        change: await shown(ctx, repo, l.rec, p, at),
        outcome: 'patch_set_added',
      })
    }
    const c = await counters(ctx, repo)
    await ctx.db.patch('repoCounters', c._id, { nextNumber: c.nextNumber + 1 })
    const rec: ChangeRec = {
      id: newId('change', at),
      number: c.nextNumber,
      title: a.title ?? `Changes from ${a.branch}`,
      description: a.description ?? '',
      state: a.draft ? 'draft' : 'open',
      author: by,
      base: a.base ?? repo.defaultBranch,
      branch: a.branch,
      patchSets: [
        {
          n: 1,
          sha,
          tree: sha.slice(0, 7),
          note: 'Initial version',
          author: by,
          created: at,
          files: {
            [`src/${a.branch.replace(/\W+/g, '_')}.rs`]: {
              hash: sha.slice(0, 6),
              add: 10,
              del: 1,
            },
          },
          kind: 'initial',
        },
      ],
      reviews: [],
      findings: [],
      checks: [],
      stackId: null,
      labels: [],
      mirrors: [],
      evidence: [],
      comments: [],
      commentRev: 0,
      created: at,
      updated: at,
      landed: null,
      version: 1,
    }
    const l = { rec, parts: new Map() } as unknown as Loaded
    await commit(ctx, repo, l, null, {
      type: 'change.opened',
      by,
      changes: ['state'],
    })
    return finish(a.dry, {
      change: await shown(ctx, repo, rec, p, at),
      outcome: 'created',
    })
  },
})

export const update = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    body: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
    }),
    fields: v.array(v.string()),
    ifMatch: v.optional(v.union(v.null(), v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { owner, name, ref, body, fields, ifMatch, dry }) => {
    const p = await signedIn(ctx)
    const at = Date.now()
    const repo = await resolve(ctx, owner, name, p, 'write')
    const l = await loadChange(ctx, repo, ref)
    const c = l.rec
    const current = await shown(ctx, repo, c, p, at)
    assertMatch(ifMatch, `${c.id}.${c.version}`, () => current)
    const same =
      (body.title === undefined || body.title === c.title) &&
      (body.description === undefined || body.description === c.description) &&
      (body.labels === undefined ||
        JSON.stringify(body.labels) === JSON.stringify(c.labels))
    if (same) return out(current)
    if (body.title !== undefined) c.title = body.title
    if (body.description !== undefined) c.description = body.description
    if (body.labels !== undefined) c.labels = body.labels
    touch(c)
    await commit(ctx, repo, l, c.state, {
      type: 'change.updated',
      by: await actorFor(ctx, p.handle, p.class),
      changes: fields,
    })
    return finish(dry, await shown(ctx, repo, c, p, at))
  },
})

// ---- patch sets ------------------------------------------------------------------

export const listPatchSets = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    return out(rec.patchSets.map((ps) => view.presentPatchSet(rec, ps)))
  },
})

function patchSetOf(c: ChangeRec, n: number) {
  const ps = c.patchSets[n - 1] as ChangeRec['patchSets'][number] | undefined
  if (!ps) fail('not_found', `Change #${c.number} has no patch set ${n}.`)
  return ps
}

export const getPatchSet = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    n: v.number(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    return out(view.presentPatchSet(rec, patchSetOf(rec, a.n)))
  },
})

/** Lines added and removed between two texts, by a longest common subsequence. */
function lineCounts(before: string | null, after: string | null) {
  const x = before === null ? [] : before.split('\n')
  const y = after === null ? [] : after.split('\n')
  const dp = Array.from({ length: x.length + 1 }, () =>
    Array.from({ length: y.length + 1 }, () => 0),
  )
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] =
        x[i] === y[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  const same = dp[0][0]
  return { add: y.length - same, del: x.length - same }
}

export const addPatchSet = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    sha: v.optional(v.string()),
    kind: v.union(v.literal('update'), v.literal('rebase')),
    note: v.optional(v.string()),
    // Edited files as `[path, text or null]`: paths are not field names.
    files: v.optional(v.array(v.array(v.union(v.string(), v.null())))),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    if (c.state === 'landed' || c.state === 'abandoned')
      fail('invalid_state', `Change #${c.number} is ${c.state}.`)
    const by = await actorFor(ctx, p.handle, p.class)
    const view = await viewFor(ctx, repo, p, Date.now(), [])
    if (a.files) {
      // A patch set made from files edited in the browser: the head's files with
      // these on top. Its commit id is a hash of what it holds.
      const prev = c.patchSets[c.patchSets.length - 1]
      if (!prev.contents)
        fail(
          'invalid_state',
          `Change #${c.number} came without its files, so it cannot be edited here. Push a commit instead.`,
        )
      const edits = Object.fromEntries(
        a.files.map(([path, text]) => [path as string, text]),
      )
      for (const [k, path] of Object.keys(edits).entries())
        if (!(path in prev.contents))
          fail('invalid_request', `${path} is not in this change.`, {
            errors: [
              {
                pointer: `/body/files/${k}`,
                code: 'not_in_change',
                message: `Only files the change touches can be edited here; ${path} is not one.`,
              },
            ],
          })
      const contents = { ...prev.contents, ...edits }
      const sha = hex(
        JSON.stringify(
          Object.entries(contents).sort(([x], [y]) => (x < y ? -1 : 1)),
        ),
      )
      const onBase = c.baseFiles ?? {}
      const files: Record<string, FileStat> = {}
      for (const [path, text] of Object.entries(contents)) {
        const { add, del } = lineCounts(onBase[path] ?? null, text)
        files[path] = { hash: hex(text ?? '').slice(0, 8), add, del }
      }
      pushPatchSet(c, by, {
        sha,
        kind: 'update',
        note: a.note ?? 'Edited in the browser',
        files,
        contents,
      })
    } else {
      if (!a.sha)
        fail('invalid_request', 'Send `sha`, or `files`.', {
          errors: [
            {
              pointer: '/body/sha',
              code: 'required',
              message:
                'A patch set is a commit (`sha`) or edited files (`files`).',
            },
          ],
        })
      pushPatchSet(c, by, {
        sha: a.sha,
        kind: a.kind,
        note: a.note ?? (a.kind === 'rebase' ? 'Rebased' : 'Updated'),
      })
    }
    await commit(ctx, repo, l, c.state, patchSetEvent(by))
    return finish(
      a.dry,
      view.presentPatchSet(c, c.patchSets[c.patchSets.length - 1]),
    )
  },
})

export const getPatchSetFiles = query({
  args: { owner: v.string(), name: v.string(), ref: v.string(), n: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const ps = patchSetOf(c, a.n)
    const base = c.baseFiles ?? {}
    return out({
      object: 'patch_set_files',
      change: c.number,
      patch_set: ps.n,
      available: !!ps.contents,
      files: ps.contents
        ? Object.entries(ps.contents)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([path, content]) => ({
              path,
              base: base[path] ?? null,
              content,
            }))
        : [],
    })
  },
})

export const comparePatchSets = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    from: v.number(),
    to: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const x = c.patchSets[a.from - 1] as
      | ChangeRec['patchSets'][number]
      | undefined
    const y = c.patchSets[a.to - 1] as
      | ChangeRec['patchSets'][number]
      | undefined
    if (!x || !y)
      fail(
        'not_found',
        `Change #${c.number} has ${c.patchSets.length} patch sets.`,
      )
    const files: Array<unknown> = []
    let unchanged = 0
    for (const path of new Set([
      ...Object.keys(x.files),
      ...Object.keys(y.files),
    ])) {
      const f = x.files[path] as FileStat | undefined
      const g = y.files[path] as FileStat | undefined
      if (f && g && f.hash === g.hash) unchanged++
      else
        files.push({
          path,
          status: !f ? 'added' : !g ? 'removed' : 'modified',
          additions:
            Math.max(0, (g?.add ?? 0) - (f?.add ?? 0)) || (g && !f ? g.add : 0),
          deletions:
            Math.max(0, (g?.del ?? 0) - (f?.del ?? 0)) || (f && !g ? f.del : 0),
        })
    }
    return out({
      object: 'patch_set_comparison',
      change: c.number,
      from: a.from,
      to: a.to,
      files,
      unchanged_files: unchanged,
    })
  },
})

// ---- reviews, findings, checks -------------------------------------------------------

export const review = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    state: v.union(
      v.literal('approved'),
      v.literal('commented'),
      v.literal('changes'),
    ),
    body: v.optional(v.string()),
    patch_set: v.optional(v.number()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const by = await actorFor(ctx, p.handle, p.class)
    if (!isOpen(c.state))
      fail('invalid_state', `Change #${c.number} is ${c.state}.`)
    if (a.state === 'approved' && c.author.handle === by.handle)
      fail(
        by.class === 'human' ? 'forbidden' : 'human_required',
        'You cannot approve your own change.',
        {
          hint: 'Ask someone else to review it.',
        },
      )
    const headN = c.patchSets[c.patchSets.length - 1].n
    const patchSet = a.patch_set ?? headN
    if (patchSet < 1 || patchSet > c.patchSets.length)
      fail(
        'invalid_request',
        `Change #${c.number} has no patch set ${patchSet}.`,
        {
          errors: [
            {
              pointer: '/body/patch_set',
              code: 'out_of_range',
              message: `1 to ${c.patchSets.length}`,
            },
          ],
        },
      )
    const r: ReviewRec = {
      id: newId('review', Date.now()),
      actor: by,
      state: a.state,
      patchSet,
      carries: patchSet === headN,
      body: a.body ?? '',
      created: Date.now(),
    }
    c.reviews.push(r)
    touch(c)
    await commit(ctx, repo, l, c.state, {
      type: 'change.reviewed',
      by,
      changes: ['reviewers', 'policy.state'],
    })
    return finish(a.dry, {
      object: 'review',
      id: r.id,
      actor: { object: 'actor', id: by.id, handle: by.handle, class: by.class },
      state: r.state,
      patch_set: r.patchSet,
      carries_to_head: r.carries,
      body: r.body,
      created_at: iso(r.created),
    })
  },
})

export const listFindings = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    state: v.optional(v.string()),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    return out(
      c.findings
        .filter((f) => !a.state || a.state === 'all' || f.state === a.state)
        .map((f) => view.presentFinding(c, f)),
    )
  },
})

const suggestion = v.object({
  summary: v.string(),
  file: v.string(),
  replace: v.array(v.string()),
  after: v.union(v.null(), v.string()),
  lines: v.array(v.string()),
})

export const raiseFinding = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    severity: v.union(v.literal('high'), v.literal('medium'), v.literal('low')),
    file: v.string(),
    line: v.number(),
    title: v.string(),
    body: v.optional(v.string()),
    suggestion: v.optional(suggestion),
    prompt: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    if (!isOpen(c.state))
      fail('invalid_state', `Change #${c.number} is ${c.state}.`)
    const head = c.patchSets[c.patchSets.length - 1]
    if (!(a.file in head.files || (head.contents && a.file in head.contents)))
      fail(
        'invalid_request',
        `${a.file} is not in patch set ${head.n} of #${c.number}.`,
        {
          errors: [
            {
              pointer: '/body/file',
              code: 'unknown',
              message: 'Name a file the change touches.',
            },
          ],
        },
      )
    const by = await actorFor(ctx, p.handle, p.class)
    const at = Date.now()
    const n =
      Math.max(
        0,
        ...c.findings.map((f) => Number(/^F-(\d+)$/.exec(f.label)?.[1] ?? 0)),
      ) + 1
    const f: FindingRec = {
      id: newId('finding', at),
      label: `F-${n}`,
      by: by.handle,
      severity: a.severity,
      state: 'open',
      reason: null,
      file: a.file,
      line: a.line,
      title: a.title,
      body: a.body ?? '',
      patchSet: head.n,
      created: at,
      ...(a.suggestion ? { suggestion: a.suggestion } : {}),
      ...(a.prompt ? { prompt: a.prompt } : {}),
    }
    c.findings.push(f)
    touch(c)
    await commit(ctx, repo, l, c.state, {
      type: 'finding.raised',
      by,
      changes: ['findings', 'policy.state'],
    })
    const view = await viewFor(ctx, repo, p, at, [])
    return finish(a.dry, view.presentFinding(c, f))
  },
})

export const setFinding = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    finding: v.string(),
    to: v.union(v.literal('resolved'), v.literal('dismissed')),
    reason: v.union(v.null(), v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    if (a.to === 'dismissed')
      await bodyOf(ctx, 'findings.dismiss', { reason: a.reason })
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const f = c.findings.find(
      (x) => x.id === a.finding || x.label === a.finding,
    )
    if (!f) fail('not_found', `No finding ${a.finding} on #${c.number}.`)
    if (a.to === 'dismissed' && !a.reason)
      fail('invalid_request', 'Dismissing needs a reason.', {
        errors: [
          {
            pointer: '/body/reason',
            code: 'required',
            message: 'Say why it is dismissed.',
          },
        ],
      })
    if (f.state !== a.to) {
      f.state = a.to
      f.reason = a.reason
      touch(c)
      await commit(ctx, repo, l, c.state, {
        type: 'finding.resolved',
        by: await actorFor(ctx, p.handle, p.class),
        changes: ['findings', 'policy.state'],
      })
    }
    const view = await viewFor(ctx, repo, p, Date.now(), [])
    return finish(a.dry, view.presentFinding(c, f))
  },
})

const testCase = v.object({
  suite: v.string(),
  name: v.string(),
  ms: v.number(),
  base: v.union(
    v.literal('pass'),
    v.literal('fail'),
    v.literal('skip'),
    v.literal('missing'),
  ),
  head: v.union(v.literal('pass'), v.literal('fail'), v.literal('skip')),
})

export const reportCheck = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    key: v.string(),
    state: v.union(v.literal('pending'), v.literal('pass'), v.literal('fail')),
    tree: v.string(),
    checkName: v.optional(v.string()),
    details_url: v.optional(v.string()),
    cases: v.optional(v.array(testCase)),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const found = c.checks.find((k) => k.key === a.key && k.tree === a.tree)
    let outcome: 'created' | 'updated' | 'unchanged' = 'created'
    if (found) {
      const nextDetails = a.details_url ?? found.detailsUrl
      outcome =
        found.state === a.state &&
        nextDetails === found.detailsUrl &&
        (a.cases === undefined ||
          JSON.stringify(a.cases) === JSON.stringify(found.cases))
          ? 'unchanged'
          : 'updated'
    }
    const at = Date.now()
    let rec: CheckRec | undefined = found
    if (outcome !== 'unchanged') {
      if (found) {
        found.state = a.state
        found.detailsUrl = a.details_url ?? found.detailsUrl
        if (a.cases) found.cases = a.cases
        found.updated = at
      } else {
        rec = {
          id: newId('check', at),
          key: a.key,
          name: a.checkName ?? a.key,
          state: a.state,
          tree: a.tree,
          detailsUrl: a.details_url ?? null,
          created: at,
          updated: at,
          ...(a.cases ? { cases: a.cases } : {}),
        }
        c.checks.push(rec)
      }
      touch(c)
      await commit(ctx, repo, l, c.state, {
        type: a.state === 'fail' ? 'ci.failed' : 'check.reported',
        by: await actorFor(ctx, p.handle, p.class),
        changes: ['checks', 'policy.state'],
      })
    }
    const view = await viewFor(ctx, repo, p, at, [])
    return finish(a.dry, { check: view.presentCheck(rec!), outcome })
  },
})

export const listChecks = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    return out(c.checks.map((k) => view.presentCheck(k)))
  },
})

const assume = v.optional(
  v.object({
    approve: v.optional(v.array(v.string())),
    // `[check, state]` pairs: check names are not field names.
    checks: v.optional(v.array(v.array(v.string()))),
    resolve: v.optional(v.array(v.string())),
  }),
)

function assumeOf(
  x:
    | {
        approve?: Array<string>
        checks?: Array<Array<string>>
        resolve?: Array<string>
      }
    | undefined,
): Assume | undefined {
  if (!x) return undefined
  return {
    ...(x.approve ? { approve: x.approve } : {}),
    ...(x.checks
      ? { checks: Object.fromEntries(x.checks) as Assume['checks'] }
      : {}),
    ...(x.resolve ? { resolve: x.resolve } : {}),
  }
}

export const policy = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    assume,
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const as = assumeOf(a.assume)
    const view = await viewFor(ctx, repo, p, a.at, [c], { assume: as })
    const reqs = view.evaluate(c, as ?? {})
    const assumed: Array<string> = []
    for (const h of as?.approve ?? []) assumed.push(`approve:${h}`)
    for (const [k, s] of Object.entries(as?.checks ?? {}))
      assumed.push(`check:${k}=${s}`)
    for (const r of as?.resolve ?? []) assumed.push(`resolve:${r}`)
    return out({
      object: 'policy_evaluation',
      change: c.number,
      tree: c.patchSets[c.patchSets.length - 1].tree,
      state: view.policyState(reqs),
      requirements: reqs,
      assumed,
    })
  },
})

// ---- state: ready, abandon, restore, land ------------------------------------------------

export const transition = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    action: v.union(
      v.literal('ready'),
      v.literal('abandon'),
      v.literal('restore'),
    ),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    if (!p.scopes.has('pulls:write'))
      fail('insufficient_scope', 'This needs pulls:write.', {
        extra: {
          required_scopes: ['pulls:write'],
          token_scopes: [...p.scopes],
        },
      })
    const from: Record<typeof a.action, Array<ChangeRec['state']>> = {
      ready: ['draft'],
      abandon: ['draft', 'open'],
      restore: ['abandoned'],
    }
    if (!from[a.action].includes(c.state))
      fail(
        'invalid_state',
        `Change #${c.number} is ${c.state}; it cannot be ${a.action === 'ready' ? 'marked ready' : a.action === 'abandon' ? 'abandoned' : 'restored'}.`,
      )
    if (a.action === 'restore') {
      const owner = await branchOwner(ctx, repo, c.branch)
      if (owner && owner.publicId !== c.id)
        fail(
          'invalid_state',
          `#${owner.number} already owns branch ${c.branch}.`,
          {
            hint: 'Land or abandon that change before restoring this one.',
          },
        )
    }
    const was = c.state
    c.state = a.action === 'abandon' ? 'abandoned' : 'open'
    touch(c)
    await commit(ctx, repo, l, was, {
      type: a.action === 'abandon' ? 'change.abandoned' : 'change.updated',
      by: await actorFor(ctx, p.handle, p.class),
      changes: ['state'],
    })
    return finish(a.dry, await shown(ctx, repo, c, p, Date.now()))
  },
})

export { presentOp, doLand }

export function checkLandable(
  view: ChangeView,
  c: ChangeRec,
  p: Actor,
  expectedTree: string,
) {
  if (!p.scopes.has('pulls:merge'))
    fail('insufficient_scope', 'Landing needs pulls:merge.', {
      extra: { required_scopes: ['pulls:merge'], token_scopes: [...p.scopes] },
    })
  if (c.state !== 'open')
    fail(
      'invalid_state',
      c.state === 'draft'
        ? `#${c.number} is a draft. Mark it ready first.`
        : `#${c.number} is ${c.state}.`,
    )
  const head = c.patchSets[c.patchSets.length - 1]
  if (head.tree !== expectedTree)
    fail(
      'stale_head',
      `#${c.number} is now at ${head.tree}, not ${expectedTree}.`,
      {
        extra: {
          current: { patch_set: head.n, tree: head.tree, sha: head.sha },
        },
      },
    )
  const parent = view.parentOf(c)
  if (parent && parent.state !== 'landed')
    fail(
      'parent_not_landed',
      `#${parent.number} below #${c.number} has not landed.`,
      {
        extra: { parent: parent.number },
      },
    )
  const reqs = view.evaluate(c)
  const bad = reqs.filter((r) => r.state === 'fail' || r.state === 'pending')
  if (bad.length)
    fail(
      'policy_blocked',
      `#${c.number} cannot land: ${bad.map((r) => r.detail.replace(/\.$/, '')).join('; ')}.`,
      {
        extra: { requirements: reqs },
        retryable: !bad.some((r) => r.state === 'fail'),
        hint: bad.some((r) => r.state === 'fail')
          ? 'Stop and report the failed requirements. Do not work around the policy.'
          : 'Wait for the pending requirements, then try again.',
      },
    )
}

async function doLand(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  l: Loaded,
  by: ActorRef,
) {
  const c = l.rec
  const was = c.state
  c.state = 'landed'
  c.landed = Date.now()
  touch(c)
  await commit(ctx, repo, l, was, {
    type: 'change.landed',
    by,
    changes: ['state', 'landed_at'],
  })
  // Changes above it are rebased onto the result. Their trees do not change,
  // so approvals and evidence stay valid.
  if (c.stackId) {
    const members = await stackMembers(ctx, repo, c.stackId)
    const i = members.findIndex((m) => m.number === c.number)
    const above = members[i + 1] as Doc<'changes'> | undefined
    if (above && isOpen(above.state)) {
      const up = await hydrate(ctx, above)
      pushPatchSet(up.rec, by, {
        sha: hex(
          `${repo.publicId}/${above.branch}/rebase/${Date.now()}/${Math.random()}`,
        ),
        kind: 'rebase',
        note: `Rebased onto main after #${c.number} landed`,
      })
      await commit(ctx, repo, up, up.rec.state, patchSetEvent(by))
    }
  }
}

export const land = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    expectedTree: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, Date.now(), [l.rec])
    checkLandable(view, l.rec, p, a.expectedTree)
    await doLand(ctx, repo, l, await actorFor(ctx, p.handle, p.class))
    return finish(a.dry, await shown(ctx, repo, l.rec, p, Date.now()))
  },
})

function presentOp(o: Doc<'operations'>) {
  return {
    object: 'operation',
    id: o.publicId,
    kind: o.kind,
    state: o.state,
    progress: { done: o.done, total: o.total },
    result: o.result,
    error: o.error ? JSON.parse(o.error) : null,
    url: `${urls().api}/operations/${o.publicId}`,
    created_at: iso(o.created),
    finished_at: o.finished ? iso(o.finished) : null,
  }
}

export const landStack = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    stackId: v.string(),
    // `[number, tree]` pairs.
    trees: v.array(v.array(v.string())),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const members = await stackMembers(ctx, repo, a.stackId)
    if (!members.length) fail('not_found', `No stack ${a.stackId}.`)
    const open = members.filter((c) => c.state === 'open')
    if (open.length === 0)
      fail('invalid_state', 'Nothing in this stack is open.')
    const firstAt = members.indexOf(open[0])
    const lastAt = members.indexOf(open[open.length - 1])
    for (const c of members.slice(firstAt, lastAt + 1))
      if (c.state !== 'open' && c.state !== 'landed')
        fail('invalid_state', `#${c.number} in this stack is ${c.state}.`, {
          hint: 'Every change between the open ones must be open or already landed.',
        })
    const trees = Object.fromEntries(a.trees) as Record<string, string>
    const missing = open
      .filter((c) => !trees[String(c.number)])
      .map((c) => c.number)
    if (missing.length)
      fail(
        'invalid_request',
        `expected_trees is missing ${missing.map((n) => `#${n}`).join(', ')}.`,
        {
          hint: 'Send the tree you checked for every open change in the stack.',
        },
      )
    const loaded = await Promise.all(open.map((c) => hydrate(ctx, c)))
    for (const l of loaded) {
      const head = l.rec.patchSets[l.rec.patchSets.length - 1]
      const expected = trees[String(l.rec.number)]
      if (head.tree !== expected)
        fail(
          'stale_head',
          `#${l.rec.number} is now at ${head.tree}, not ${expected}.`,
          {
            extra: {
              current: { patch_set: head.n, tree: head.tree, sha: head.sha },
            },
          },
        )
    }
    const view = await viewFor(ctx, repo, p, Date.now(), [loaded[0].rec])
    checkLandable(view, loaded[0].rec, p, trees[String(loaded[0].rec.number)])
    const at = Date.now()
    const id = await ctx.db.insert('operations', {
      publicId: newId('operation', at),
      kind: 'stack.land',
      repoId: repo.publicId,
      state: 'queued',
      done: 0,
      total: open.length,
      result: null,
      error: null,
      created: at,
      finished: null,
    })
    await ctx.scheduler.runAfter(0, internal.forge.stackLanding.step, {
      operation: id,
      repo: repo._id,
      stackId: a.stackId,
      numbers: open.map((c) => c.number),
      trees: a.trees,
      i: 0,
      as: {
        handle: p.handle,
        actingAs: p.actingAs,
        class: p.class,
        scopes: [...p.scopes],
        repos: p.repos ? [...p.repos] : null,
      },
      by: await actorFor(ctx, p.handle, p.class),
    })
    return finish(a.dry, presentOp((await ctx.db.get('operations', id))!))
  },
})

export const getOperation = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    const p = await actorOf(ctx)
    const op = await ctx.db
      .query('operations')
      .withIndex('by_publicId', (q) => q.eq('publicId', id))
      .unique()
    if (!op || !p || !(await mayReadId(ctx, op.repoId, p)))
      fail('not_found', `No operation ${id}.`)
    return out(presentOp(op))
  },
})

export const operationVersion = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    const p = await actorOf(ctx)
    const op = await ctx.db
      .query('operations')
      .withIndex('by_publicId', (q) => q.eq('publicId', id))
      .unique()
    if (!op || !p || !(await mayReadId(ctx, op.repoId, p))) return out(null)
    return out(`${id}.${op.state}.${op.done}`)
  },
})

export const operationRepoId = query({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    const op = await ctx.db
      .query('operations')
      .withIndex('by_publicId', (q) => q.eq('publicId', id))
      .unique()
    return out(op?.repoId ?? null)
  },
})

// ---- evidence ---------------------------------------------------------------------

export const addEvidence = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    kind: v.union(
      v.literal('image'),
      v.literal('recording'),
      v.literal('preview'),
      v.literal('test_results'),
    ),
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
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const l = await loadChange(ctx, repo, a.ref)
    const by = await actorFor(ctx, p.handle, p.class)
    const e: EvidenceRec = {
      id: newId('evidence', Date.now()),
      kind: a.kind,
      caption: a.caption,
      uploadId: a.upload.id,
      upload: a.upload,
      by,
      created: Date.now(),
    }
    ;(l.rec.evidence ??= []).push(e)
    touch(l.rec)
    await commit(ctx, repo, l, l.rec.state, {
      type: 'change.updated',
      by,
      changes: ['evidence_count'],
    })
    const view = await viewFor(ctx, repo, p, Date.now(), [])
    return finish(a.dry, {
      evidence: view.presentEvidence(l.rec, e),
      repo: `${repo.owner}/${repo.name}`,
      repoId: repo.publicId,
    })
  },
})

export const listEvidence = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    return out(
      (c.evidence ?? []).map((e) => ({
        uploadId: e.uploadId,
        shown: view.presentEvidence(c, e),
      })),
    )
  },
})

// ---- line comments ---------------------------------------------------------------------

export const listReviewComments = query({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    file: v.optional(v.string()),
    unresolved: v.optional(v.boolean()),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { rec: c } = await loadChange(ctx, repo, a.ref)
    const view = await viewFor(ctx, repo, p, a.at, [])
    const all = c.comments ?? []
    const open = new Set(
      all.filter((x) => !x.replyTo && !x.resolved).map((x) => x.id),
    )
    return out(
      all
        .filter(
          (x) =>
            (a.file === undefined || x.file === a.file) &&
            (!a.unresolved || open.has(x.replyTo ?? x.id)),
        )
        .map((x) => view.presentReviewComment(c, x)),
    )
  },
})

export const reviewCommentsVersion = query({
  args: { owner: v.string(), name: v.string(), ref: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const c = await findChange(ctx, repo, a.ref)
    if (!c)
      fail('not_found', `No change ${a.ref} in ${repo.owner}/${repo.name}.`)
    return out(
      `${c.publicId}.rc${c.commentRev}.${await accessStamp(ctx, repo)}`,
    )
  },
})

export const createReviewComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    body: v.string(),
    file: v.optional(v.string()),
    line: v.optional(v.number()),
    patch_set: v.optional(v.number()),
    reply_to: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const a = {
      ...given,
      ...(await bodyOf(ctx, 'change_comments.create', {
        body: given.body,
        file: given.file,
        line: given.line,
        patch_set: given.patch_set,
        reply_to: given.reply_to,
      })),
    }
    const p = await signedIn(ctx)
    // Anyone who can read the repository may comment, as on an issue.
    const repo = await resolve(ctx, a.owner, a.name, p)
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const comments = (c.comments ??= [])
    const latest = c.patchSets[c.patchSets.length - 1].n
    let file = a.file ?? null
    let line = a.line ?? null
    let patchSet = a.patch_set ?? latest
    let replyTo: string | null = null
    if (a.reply_to) {
      const root = comments.find((x) => x.id === a.reply_to)
      if (!root) fail('not_found', `No comment ${a.reply_to} on #${c.number}.`)
      replyTo = root.replyTo ?? root.id
      const start = comments.find((x) => x.id === replyTo)!
      file = start.file
      line = start.line
      patchSet = start.patchSet
    } else {
      if (line !== null && file === null)
        fail('invalid_request', 'A line needs a file.', {
          errors: [
            {
              pointer: '/body/file',
              code: 'required',
              message: 'Say which file the line is in.',
            },
          ],
        })
      const ps = c.patchSets.find((x) => x.n === patchSet)
      if (!ps)
        fail('invalid_request', `#${c.number} has no patch set ${patchSet}.`, {
          errors: [
            {
              pointer: '/body/patch_set',
              code: 'unknown',
              message: `Patch sets run from 1 to ${latest}.`,
            },
          ],
        })
      if (
        file !== null &&
        ps.contents &&
        !(file in ps.contents) &&
        !(file in ps.files)
      )
        fail(
          'invalid_request',
          `${file} is not in patch set ${patchSet} of #${c.number}.`,
          {
            errors: [
              {
                pointer: '/body/file',
                code: 'unknown',
                message: 'Name a file the change touches.',
              },
            ],
          },
        )
      const text = file !== null ? ps.contents?.[file] : undefined
      if (line !== null && typeof text === 'string') {
        const lines = text.split('\n').length
        if (line > lines)
          fail(
            'invalid_request',
            `${file} has ${lines} lines in patch set ${patchSet}.`,
            {
              errors: [
                {
                  pointer: '/body/line',
                  code: 'out_of_range',
                  message: `Lines run from 1 to ${lines}.`,
                },
              ],
            },
          )
      }
    }
    const at = Date.now()
    const by = await actorFor(ctx, p.handle, p.class)
    const x: ReviewCommentRec = {
      id: newId('comment', at),
      author: by,
      body: a.body,
      file,
      line,
      patchSet,
      replyTo,
      resolved: false,
      created: at,
      updated: at,
      version: 1,
    }
    const view = await viewFor(ctx, repo, p, at, [])
    const shownComment = view.presentReviewComment(c, x)
    comments.push(x)
    c.commentRev = (c.commentRev ?? 0) + 1
    // A reply reopens a settled thread: someone still has something to say.
    if (replyTo) {
      const start = comments.find((y) => y.id === replyTo)!
      if (start.resolved) {
        start.resolved = false
        start.version++
      }
    }
    const root = replyTo ?? x.id
    const thread = comments.filter((y) => y.id === root || y.replyTo === root)
    await commit(ctx, repo, l, c.state, {
      type: 'change.commented',
      by,
      changes: ['comments'],
      data: {
        ...shownComment,
        title: c.title,
        author: view.actor(c.author),
        thread: [...new Set(thread.map((y) => y.author.handle))],
      },
    })
    return finish(a.dry, shownComment)
  },
})

function reviewCommentOf(c: ChangeRec, id: string) {
  const x = (c.comments ?? []).find((y) => y.id === id)
  if (!x) fail('not_found', `No comment ${id} on #${c.number}.`)
  return x
}

export const updateReviewComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    id: v.string(),
    body: v.optional(v.string()),
    resolved: v.optional(v.boolean()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const a = {
      ...given,
      ...(await bodyOf(ctx, 'change_comments.update', {
        body: given.body,
        resolved: given.resolved,
      })),
    }
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const x = reviewCommentOf(c, a.id)
    if (a.body !== undefined && x.author.handle !== p.handle)
      fail('forbidden', 'Only its author can edit a comment.')
    if (a.resolved !== undefined) {
      if (x.replyTo)
        fail(
          'invalid_request',
          'Settle a thread on the comment that starts it.',
          {
            errors: [
              {
                pointer: '/body/resolved',
                code: 'not_a_thread',
                message: `Send it to ${x.replyTo}.`,
              },
            ],
          },
        )
      if (
        x.author.handle !== p.handle &&
        c.author.handle !== p.handle &&
        !(await canWrite(ctx, repo, p))
      )
        fail(
          'forbidden',
          "Only the thread's author, the change's author or someone who can change the repository settles a thread.",
        )
    }
    const view = await viewFor(ctx, repo, p, Date.now(), [])
    const next = { body: a.body ?? x.body, resolved: a.resolved ?? x.resolved }
    if (next.body === x.body && next.resolved === x.resolved)
      return out(view.presentReviewComment(c, x))
    Object.assign(x, next, { updated: Date.now(), version: x.version + 1 })
    c.commentRev = (c.commentRev ?? 0) + 1
    await commit(ctx, repo, l, c.state, null)
    return finish(a.dry, view.presentReviewComment(c, x))
  },
})

export const deleteReviewComment = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    ref: v.string(),
    id: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const l = await loadChange(ctx, repo, a.ref)
    const c = l.rec
    const x = reviewCommentOf(c, a.id)
    if (x.author.handle !== p.handle && !(await canWrite(ctx, repo, p)))
      fail(
        'forbidden',
        'Only its author or someone who can change the repository can delete a comment.',
      )
    // Deleting the comment that starts a thread deletes the thread.
    c.comments = (c.comments ?? []).filter(
      (y) => y.id !== x.id && y.replyTo !== x.id,
    )
    c.commentRev = (c.commentRev ?? 0) + 1
    await commit(ctx, repo, l, c.state, null)
    return finish(a.dry, null)
  },
})
