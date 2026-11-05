import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Repositories belong to an account. An account is a person or an
 * organization, and both live in one namespace (`source.code/<handle>`), so a
 * name can never mean two things. A login is a person; a person can be a
 * member of any number of organizations and acts as one account at a time.
 */
export const role = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
)

export default defineSchema({
  accounts: defineTable({
    kind: v.union(v.literal('person'), v.literal('organization')),
    // The address in every URL. Generated for new accounts, changeable.
    handle: v.string(),
    // A person's full name, or an organization's name.
    name: v.string(),
    bio: v.string(),
    now: v.optional(v.string()),
    // How a person works with agents. Organizations have none.
    setup: v.optional(
      v.object({
        agents: v.array(v.string()),
        models: v.array(v.string()),
        tools: v.array(v.string()),
      }),
    ),
  }).index('by_handle', ['handle']),

  // Who belongs to which organization, and what they may do there. An
  // organization always has at least one owner.
  memberships: defineTable({
    organizationId: v.id('accounts'),
    personId: v.id('accounts'),
    role,
  })
    .index('by_organizationId_and_personId', ['organizationId', 'personId'])
    .index('by_personId', ['personId']),

  // Old addresses. A renamed account keeps answering at its old address by
  // redirecting, and nobody else can take the name.
  handleAliases: defineTable({
    handle: v.string(),
    accountId: v.id('accounts'),
  }).index('by_handle', ['handle']),

  repos: defineTable({
    ownerId: v.id('accounts'),
    name: v.string(),
    description: v.string(),
    stars: v.number(),
    // Repo id in code.storage (currently the in-memory fake in src/git).
    storeId: v.string(),
  }).index('by_ownerId_and_name', ['ownerId', 'name']),

  events: defineTable({
    // Always a person, even when the repository belongs to an organization.
    actorId: v.id('accounts'),
    repoId: v.id('repos'),
    kind: v.union(
      v.literal('release'),
      v.literal('review'),
      v.literal('agent_session'),
      v.literal('push'),
    ),
    title: v.string(),
    agent: v.optional(v.string()),
  })
    .index('by_actorId', ['actorId'])
    .index('by_repoId', ['repoId']),
})
