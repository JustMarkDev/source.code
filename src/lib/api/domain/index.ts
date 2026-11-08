import { DomainSync } from './sync'

export * from './records'

/**
 * The data behind the API, in memory. It is the whole of what the API needs
 * from storage, written as plain async methods, so the Convex-backed version
 * implements the same surface and nothing above this file changes.
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
 *   repos    accounts and repositories
 *   teams    teams and their access to repositories
 *   runs     agent runs and long operations
 *   issues   issues
 *   changes  patch sets, reviews, checks, policy, landing, stacks
 *   sync     the event feed and the sync snapshot
 *
 * Add a method to the layer that owns the concept. If it needs a method from a
 * layer below, move it down a layer rather than reaching up.
 */
export class MemoryDomain extends DomainSync {}

export type DomainCore = MemoryDomain
