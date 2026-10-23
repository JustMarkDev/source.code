import { internalMutation } from './_generated/server'

// Demo data for local dev: `bunx convex run seed:seed`. No-op if already seeded.
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('users').first()) return null
    const dana = await ctx.db.insert('users', {
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
