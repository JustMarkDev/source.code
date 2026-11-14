import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { system } from './lib/actor'
import { out } from './lib/errors'
import type { World } from '@source-code/api/world'
import { seededId } from '@source-code/api/ids'
import { insertChange } from './lib/changes'
import { insertRun } from './forge/pipelines'
import { insertRelease } from './forge/releases'
import type { Release } from './forge/releases'
import type { PipelineRun } from './forge/pipelines'
import type { ChangeRec } from './lib/changeTypes'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

/**
 * Loads a world of sample data (`packages/api/src/seed-export.ts`) into an
 * empty deployment. Tests load it into `convex-test`; a development
 * deployment loads the same world, so both start from the same place.
 */
export async function load(ctx: MutationCtx, w: World) {
  const accountIds = new Map<string, Id<'accounts'>>()
  for (const a of w.accounts)
    accountIds.set(
      a.handle,
      await ctx.db.insert('accounts', {
        kind: a.kind,
        handle: a.handle,
        name: a.name,
        bio: a.bio,
        publicId: a.publicId,
        created: a.created,
        updated: a.updated,
        version: a.version,
        aclRev: 0,
      }),
    )
  for (const a of w.accounts) {
    const orgId = accountIds.get(a.handle)!
    for (const [handle, role] of a.members) {
      const personId = accountIds.get(handle)
      if (personId)
        await ctx.db.insert('memberships', {
          organizationId: orgId,
          personId,
          role,
        })
    }
    for (const i of a.invites)
      await ctx.db.insert('invitations', {
        publicId: i.id,
        organizationId: orgId,
        email: i.email,
        role: i.role,
        secretHash: i.secretHash,
        invitedBy: i.invitedBy,
        created: i.created,
        expires: i.expires,
      })
  }
  for (const a of w.actors) await ctx.db.insert('actors', a)
  const repoIds = new Map<string, Id<'repos'>>()
  for (const r of w.repos) {
    const {
      starredBy,
      counters,
      labels,
      issues,
      changes,
      policy,
      pipelines,
      releases,
      ...fields
    } = r
    let ownerId = accountIds.get(r.owner)
    // A test may seed a repository for someone the sample has no account for.
    if (!ownerId) {
      ownerId = await ctx.db.insert('accounts', {
        kind: 'person',
        handle: r.owner,
        name: r.owner,
        bio: '',
        publicId: `acc_seed${r.owner}`.slice(0, 22),
        created: r.created,
        updated: r.created,
        version: 1,
        aclRev: 0,
      })
      accountIds.set(r.owner, ownerId)
    }
    const id = await ctx.db.insert('repos', {
      ...fields,
      category: fields.category ?? null,
      languages: fields.languages.map(([n, p]) => [n, p]),
      ownerId,
      key: `${r.owner}/${r.name}`.toLowerCase(),
      aclRev: 0,
    })
    repoIds.set(`${r.owner}/${r.name}`, id)
    const repoDoc = (await ctx.db.get('repos', id))!
    await ctx.db.insert('repoCounters', { repoId: id, ...counters })
    for (const h of new Set([...r.collaborators, ...r.installs]))
      await ctx.db.insert('repoGrants', { handle: h, repoId: id })
    for (const [handle, at] of starredBy)
      await ctx.db.insert('stars', { repoId: id, handle, at })
    const open = new Map<string, number>()
    for (const i of issues)
      if (i.state === 'open')
        for (const l of i.labels) open.set(l, (open.get(l) ?? 0) + 1)
    for (const l of labels)
      await ctx.db.insert('labels', {
        repoId: id,
        ...l,
        key: l.name.toLowerCase(),
        openIssues: open.get(l.name) ?? 0,
      })
    for (const json of changes) {
      const rec = JSON.parse(json) as ChangeRec
      rec.evidence ??= []
      rec.comments ??= []
      await insertChange(ctx, repoDoc, rec)
    }
    for (const json of releases)
      await insertRelease(ctx, id, JSON.parse(json) as Release)
    // Oldest first, so the counters end where the sample does.
    for (const json of [...pipelines].reverse())
      await insertRun(ctx, repoDoc, JSON.parse(json) as PipelineRun)
    if (policy)
      await ctx.db.insert('repoPolicy', {
        repoId: id,
        ruleModes: policy.ruleModes.map(([rule, mode]) => ({ id: rule, mode })),
        customRules: policy.customRules,
        exceptions: policy.exceptions,
      })
    for (const { comments, ...i } of issues) {
      const issueId = await ctx.db.insert('issues', {
        ...i,
        repoId: id,
        text: `${i.title}\n${i.body}`,
        commentCount: comments.length,
      })
      if (i.state === 'open')
        for (const a of i.assignees)
          await ctx.db.insert('issueAssignees', {
            handle: a.handle,
            issueId,
            repoId: id,
          })
      for (const c of comments)
        await ctx.db.insert('issueComments', { ...c, issueId, repoId: id })
    }
  }
  for (const [from, to] of w.aliases)
    await ctx.db.insert('repoAliases', { from: from.toLowerCase(), to })
  for (const t of w.teams) {
    const organizationId = accountIds.get(t.org)
    if (!organizationId) continue
    const { members, repos, ...fields } = t
    const teamId = await ctx.db.insert('teams', { ...fields, organizationId })
    for (const handle of members)
      await ctx.db.insert('teamMembers', { teamId, handle })
    for (const [full, level] of repos) {
      const repoId = repoIds.get(full)
      if (repoId) await ctx.db.insert('teamRepos', { teamId, repoId, level })
    }
  }
  // Tokens keep repository ids, so a rename never needs them rewritten.
  const refs = new Map(
    w.repos.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), r.publicId]),
  )
  for (const [handle, prefs] of w.accountPrefs)
    await ctx.db.insert('accountPrefs', { handle, prefs })
  const stat = new Map<
    string,
    { followers: number; following: number; rev: number }
  >()
  const statOf = (h: string) => {
    let s = stat.get(h)
    if (!s) stat.set(h, (s = { followers: 0, following: 0, rev: 0 }))
    return s
  }
  for (const [who, whom] of w.follows) {
    await ctx.db.insert('follows', { who, whom })
    statOf(who).following++
    statOf(whom).followers++
  }
  for (const c of w.contributions) {
    const repoId = repoIds.get(c.repo)
    if (!repoId) continue
    const { repo: _repo, ...rest } = c
    await ctx.db.insert('contributions', { ...rest, repoId })
    statOf(c.handle).rev++
  }
  for (const [handle, s] of stat)
    await ctx.db.insert('peopleStats', { handle, ...s })
  for (const d of w.downloadDays) {
    const repoId = repoIds.get(d.repo)
    if (repoId)
      await ctx.db.insert('downloadDays', { repoId, day: d.day, n: d.n })
  }
  for (const [full, json] of w.extras) {
    const repoId = repoIds.get(full)
    if (repoId) await ctx.db.insert('repoExtras', { repoId, json, version: 1 })
  }
  for (const c of w.connections) await ctx.db.insert('connections', c)
  for (const [full, ids] of w.repoIntegrations) {
    const repoId = repoIds.get(full)
    if (repoId)
      for (const integration of ids)
        await ctx.db.insert('repoIntegrations', { repoId, integration })
  }
  for (const l of w.links) await ctx.db.insert('links', l)
  for (const b of w.bots) {
    const installs = w.repos
      .filter((r) => r.installs.includes(b.slug))
      .map((r) => repoIds.get(`${r.owner}/${r.name}`)!)
    await ctx.db.insert('bots', { ...b, installs })
  }
  for (const [full, list] of w.automations) {
    const repoId = repoIds.get(full)
    if (!repoId) continue
    for (const json of list) {
      const a = JSON.parse(json) as Omit<
        Doc<'automations'>,
        '_id' | '_creationTime' | 'repoId' | 'publicId' | 'nextRun' | 'lastRun'
      > & {
        id: string
        lastRun?: string | null
      }
      const { id, lastRun, ...rest } = a
      const next = a.triggers.includes('schedule')
        ? (a.lastScheduled ?? a.created) +
            ({ hour: 3_600_000, day: 86_400_000 } as Record<string, number>)[
              a.every ?? ''
            ] || (a.lastScheduled ?? a.created) + 7 * 86_400_000
        : null
      await ctx.db.insert('automations', {
        ...rest,
        repoId,
        publicId: id,
        lastRun: lastRun ?? null,
        nextRun: next,
      })
    }
  }
  for (const n of w.notifications) {
    const r =
      n.repo && n.repo.includes('/')
        ? w.repos.find((x) => `${x.owner}/${x.name}` === n.repo)
        : undefined
    const prefix = r ? `/${r.owner}/${r.name}` : null
    await ctx.db.insert('notifications', {
      handle: n.handle,
      publicId: n.id,
      kind: n.kind,
      title: n.title,
      repoId: r?.publicId ?? null,
      repo: n.repo,
      path:
        prefix && n.path.startsWith(`${prefix}/`)
          ? n.path.slice(prefix.length)
          : n.path,
      unread: n.unread,
      created: n.created,
    })
  }
  const boxes = new Map<
    string,
    { count: number; prefs: Record<string, boolean> | null }
  >()
  for (const n of w.notifications) {
    const b = boxes.get(n.handle) ?? { count: 0, prefs: null }
    b.count++
    boxes.set(n.handle, b)
  }
  for (const [h, prefs] of w.notificationPrefs)
    boxes.set(h, { count: boxes.get(h)?.count ?? 0, prefs })
  for (const [handle, b] of boxes)
    await ctx.db.insert('inboxes', {
      handle,
      rev: 0,
      count: b.count,
      prefs: b.prefs,
    })
  for (const t of w.tokens)
    await ctx.db.insert('tokens', {
      ...t,
      repos: t.repos ? t.repos.map((n) => refs.get(n) ?? `n:${n}`) : null,
    })
  for (const a of w.authorizations) await ctx.db.insert('authorizations', a)
}

/** Loads a world given as JSON text, on an empty deployment only. */
export const loadWorld = internalMutation({
  args: { world: v.string() },
  returns: v.null(),
  handler: async (ctx, { world }) => {
    if (await ctx.db.query('accounts').first())
      throw new Error('This deployment already has data.')
    await load(ctx, JSON.parse(world) as World)
    return null
  },
})

/**
 * The API server seeds an empty development deployment with the sample it
 * builds. Only the API server may (its own JWT), and only once.
 */
export const loadSample = mutation({
  args: { world: v.string() },
  returns: v.string(),
  handler: async (ctx, { world }) => {
    await system(ctx)
    if (await ctx.db.query('accounts').first()) return out(false)
    await load(ctx, JSON.parse(world) as World)
    return out(true)
  },
})

/**
 * After a reseed: point each account back at the sign-in user it had, and
 * bring back people who signed up, so existing sign-ins keep working.
 */
export const relink = internalMutation({
  args: {
    links: v.array(
      v.object({ handle: v.string(), authId: v.string(), name: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { links }) => {
    for (const l of links) {
      const a = await ctx.db
        .query('accounts')
        .withIndex('by_handle', (q) => q.eq('handle', l.handle))
        .unique()
      if (a) await ctx.db.patch('accounts', a._id, { authId: l.authId })
      else {
        const at = Date.now()
        await ctx.db.insert('accounts', {
          kind: 'person',
          handle: l.handle,
          name: l.name,
          bio: '',
          authId: l.authId,
          publicId: seededId('account', at, l.handle),
          created: at,
          updated: at,
          version: 1,
          aclRev: 0,
        })
      }
    }
    return null
  },
})
