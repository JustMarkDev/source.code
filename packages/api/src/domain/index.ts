import { DomainPeople } from './people'
import type { DomainPort } from './port'

export * from './records'
export type { DomainPort } from './port'

/**
 * The data behind the API, in memory. What the API needs from it is
 * `DomainPort` (`port.ts`): the pipeline and the operations are typed against
 * that interface, so the Convex-backed version implements the same one and
 * nothing above this file changes. Seeding (`seed*`) is this class's own.
 *
 * What it enforces is the product, not the storage: who may see a repository,
 * what policy requires, that an approval follows a rewrite only when the code
 * did not change, that a change lands only as the exact tree that was checked,
 * and that every mutation writes one event.
 *
 * It is built in layers, one file each, every layer extending the one before
 * it, so a method can use anything in the files above it:
 *
 *   state    records, indexes, seeding
 *   access   who may see and change what
 *   present  how records are shown, including policy evaluation
 *   events   build and emit the one event a mutation writes
 *   accounts editing an account, organizations and their members
 *   repos    accounts and repositories
 *   teams    teams and their access to repositories
 *   runs     agent runs and long operations
 *   issues   issues
 *   changes  patch sets, reviews, checks, policy, landing, stacks
 *   sync     the event feed and the sync snapshot
 *   notifications  each person's inbox, fed from the events
 *   releases releases, their files and download counts
 *   pipelines pipeline runs, their jobs, steps and logs
 *   policy   a repository's rules, their modes and exceptions
 *   integrations  services connected to accounts, used by repositories
 *   automations   bots, where they are installed, and what wakes them
 *   imports  repositories brought from another host, linked accounts
 *   insights what a repository and an account add up to
 *   people   preferences, follows, profiles and the directory of people
 *
 * Add a method to the layer that owns the concept. If it needs a method from a
 * layer below, move it down a layer rather than reaching up.
 */
export class MemoryDomain extends DomainPeople implements DomainPort {}
