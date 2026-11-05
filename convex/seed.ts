import { internalMutation } from './_generated/server'

// Demo data for local dev: `bunx convex run seed:seed`. No-op if already seeded.
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('accounts').first()) return null
    const dana = await ctx.db.insert('accounts', {
      kind: 'person',
      handle: 'dana',
      name: 'Dana Okafor',
      bio: 'Building small, fast dev tools. Rust + TS.',
      now: 'Stack: incremental pack indexing (2 of 3 open). claude-code is running tests on neg-cache.',
      setup: {
        agents: ['claude-code', 'codex'],
        models: ['opus', 'gpt'],
        tools: ['forge', 'postgres'],
      },
    })
    const hollis = await ctx.db.insert('accounts', {
      kind: 'person',
      handle: 'hollis',
      name: 'Hollis Reyes',
      bio: 'Local-first software, notes, and way too many keyboards.',
    })
    const ines = await ctx.db.insert('accounts', {
      kind: 'person',
      handle: 'ines',
      name: 'Inês Barbosa',
      bio: 'Databases, migrations and the occasional compiler.',
    })
    // An organization owns its repositories; people are members of it.
    const northwind = await ctx.db.insert('accounts', {
      kind: 'organization',
      handle: 'northwind',
      name: 'Northwind Labs',
      bio: 'Message infrastructure for small teams.',
    })
    for (const [personId, role] of [
      [dana, 'owner'],
      [hollis, 'admin'],
      [ines, 'member'],
    ] as const)
      await ctx.db.insert('memberships', {
        organizationId: northwind,
        personId,
        role,
      })
    const gitfs = await ctx.db.insert('repos', {
      ownerId: dana,
      name: 'gitfs',
      description: 'Git over object storage',
      stars: 2100,
      storeId: 'gitfs',
    })
    const tinyqueue = await ctx.db.insert('repos', {
      ownerId: dana,
      name: 'tinyqueue',
      description: 'Zero-dependency job queue',
      stars: 640,
      storeId: 'tinyqueue',
    })
    await ctx.db.insert('repos', {
      ownerId: northwind,
      name: 'relay',
      description: 'A small message relay with at-least-once delivery',
      stars: 310,
      storeId: 'relay',
    })
    const events = [
      {
        repoId: tinyqueue,
        kind: 'push',
        title: 'Pushed 1 commit: Document retries',
      },
      {
        repoId: tinyqueue,
        kind: 'agent_session',
        title: 'Steered codex through retry backoff',
        agent: 'codex',
      },
      { repoId: gitfs, kind: 'release', title: 'Shipped v0.9' },
      {
        repoId: gitfs,
        kind: 'agent_session',
        title: 'Cache negative ref lookups',
        agent: 'claude-code',
      },
    ] as const
    for (const e of events)
      await ctx.db.insert('events', { actorId: dana, ...e })
    return null
  },
})

// Clears the demo tables so the schema can change under them. Local dev only:
// `bunx convex run seed:reset`, then `bunx convex run seed:seed`.
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of [
      'events',
      'repos',
      'memberships',
      'handleAliases',
      'accounts',
    ] as const) {
      for (const doc of await ctx.db.query(table).take(500))
        await ctx.db.delete(table, doc._id)
    }
    return null
  },
})
