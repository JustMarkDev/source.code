import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    handle: v.string(),
    name: v.string(),
    bio: v.string(),
    now: v.optional(v.string()),
    setup: v.object({
      agents: v.array(v.string()),
      models: v.array(v.string()),
      tools: v.array(v.string()),
    }),
  }).index('by_handle', ['handle']),

  repos: defineTable({
    ownerId: v.id('users'),
    name: v.string(),
    description: v.string(),
    stars: v.number(),
    // Repo id in code.storage (currently the in-memory fake in src/git).
    storeId: v.string(),
  }).index('by_ownerId_and_name', ['ownerId', 'name']),

  events: defineTable({
    actorId: v.id('users'),
    repoId: v.id('repos'),
    kind: v.union(
      v.literal('release'),
      v.literal('review'),
      v.literal('agent_session'),
      v.literal('push'),
    ),
    title: v.string(),
    agent: v.optional(v.string()),
  }).index('by_actorId', ['actorId']),
})
