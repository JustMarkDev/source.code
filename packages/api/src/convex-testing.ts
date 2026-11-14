import { setSystemTime } from 'bun:test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from '../../../convex/schema'
import { load } from '../../../convex/seed'
import { ConvexDomain, claimsOf } from './domain/convex'
import { exportWorld } from './seed-export'
import { ConvexOAuthState, ConvexTokens } from './stores/convex-tokens'
import { ConvexEventFeed } from './stores/convex-events'
import { SearchIndex } from './search'
import { ConvexExtras } from './stores/convex-extras'
import { ConvexUploads } from './stores/convex-uploads'
import { ConvexHooks } from './stores/convex-hooks'
import { MemoryBlobStore, UploadSigner } from './uploads'
import type { ConvexCall } from './domain/convex'
import type { DomainFactory } from './index'

// The Convex functions, loaded the way Vite's `import.meta.glob` would load them.
const dir = new URL('../../../convex/', import.meta.url).pathname
const modules: Record<string, () => Promise<never>> = {}
for (const f of new Bun.Glob('**/*.{ts,js}').scanSync(dir))
  if (!f.endsWith('.d.ts') && !f.includes('.test.'))
    modules[`./${f}`] = () => import(`${dir}${f}`) as Promise<never>

/**
 * A component's functions and schema, from its built files, for
 * `registerComponent`. The packages' own `test.ts` uses Vite's
 * `import.meta.glob`, which Bun does not have.
 */
function component(entry: string) {
  const root = `${entry.slice(0, entry.lastIndexOf('/dist/'))}/dist/component/`
  const mods: Record<string, () => Promise<never>> = {}
  for (const f of new Bun.Glob('**/*.js').scanSync(root))
    mods[`./component/${f}`] = () => import(`${root}${f}`) as Promise<never>
  const own = require(`${root}schema.js`) as { default: never }
  return { schema: own.default, modules: mods }
}
const presence = component(require.resolve('@convex-dev/presence'))
const batchWorker = component(
  require.resolve('@convex-dev/batch-worker', {
    paths: [require.resolve('@convex-dev/presence')],
  }),
)

type Fn = (ref: unknown, args: unknown) => Promise<unknown>

/**
 * One Convex function at a time in the whole test process. Each sets the
 * system clock to its test's clock while it runs; two at once, even from
 * two tests, would let one reset the clock under the other.
 */
let lock: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn)
  lock = next.catch(() => {})
  return next
}

/**
 * The sample API on Convex, for tests: the forge functions run in memory
 * through `convex-test`, seeded with the same sample world the memory domain
 * starts from. The test clock is the system clock while a function runs, and
 * scheduled work (mail, fan-out) is finished before a call returns, so a test
 * sees the world as it will be once the write settled.
 */
export const convexFactory: DomainFactory = ({
  memory,
  auth: sample,
  urls,
  now,
  events,
  hooks: hookOptions,
}) => {
  process.env.SITE_URL = urls.html
  process.env.API_URL = urls.api
  const t = convexTest(schema, modules)
  t.registerComponent('presence', presence.schema, presence.modules)
  t.registerComponent(
    'presence/batchWorker',
    batchWorker.schema,
    batchWorker.modules,
  )
  const world = exportWorld(memory, sample)
  // Convex never lets time go backwards: a function runs at the later of
  // the clock and the last commit. So the seed commits at the test clock too.
  const ready = exclusive(async () => {
    setSystemTime(new Date(now()))
    try {
      await t.run(async (ctx) => {
        await load(ctx, world)
      })
    } finally {
      setSystemTime()
    }
  })
  const g = globalThis as { __sxMailSink?: unknown }
  g.__sxMailSink = (m: { to: string; subject: string; text: string }) =>
    memory.svc.mail.send(m)
  let following = false
  /** One function, with the lock held and the test clock as the system clock. */
  const callNow: ConvexCall = async (kind, name, args, who) => {
    setSystemTime(new Date(now()))
    try {
      const as = who === null ? t : t.withIdentity(claimsOf(who))
      const fn = (as as unknown as Record<string, Fn>)[kind]
      const ref = makeFunctionReference(name as never)
      const result = await fn(ref, args)
      if (kind !== 'query') {
        await settle()
        // Once per write, not again for the reads and writes that follow it.
        if (!following) {
          following = true
          try {
            // What the write added to the feed reaches this server's window,
            // as a subscription to the feed's head would bring it in production.
            await feed.pull()
            // And what is to be sent goes out, before the write answers. A
            // send under way already goes on until nothing is due.
            if (!svc.hooks.busy) await svc.hooks.send(callNow)
          } finally {
            following = false
          }
        }
      }
      return result
    } finally {
      setSystemTime()
    }
  }
  const locked: ConvexCall = (kind, name, args, who) =>
    exclusive(() => callNow(kind, name, args, who))
  // Scheduled work runs on a timer of 0, and may schedule more (the
  // sequencer, a stack landing step by step). Run it all, a few rounds deep.
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 0))
      await t.finishInProgressScheduledFunctions()
      const pending = await t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).some(
          (j) => j.state.kind === 'pending' || j.state.kind === 'inProgress',
        ),
      )
      if (!pending) return
    }
  }
  const call: ConvexCall = async (kind, name, args, who) => {
    await indexed
    return await locked(kind, name, args, who)
  }
  // The memory sample's own sender has nothing to send here.
  ;(memory.svc.hooks as { dispose?: () => void }).dispose?.()
  const auth = new ConvexTokens(call)
  const svc = {
    ...memory.svc,
    auth,
    extras: new ConvexExtras(call, now),
    uploads: new ConvexUploads(
      call,
      new MemoryBlobStore(),
      new UploadSigner(),
      now,
    ),
    hooks: new ConvexHooks(call, {
      events,
      now,
      transport: hookOptions.transport,
      scheduler: hookOptions.scheduler,
      allowPrivate: hookOptions.allowPrivate,
    }),
  }
  const d = new ConvexDomain(urls, call, events, svc, now)
  svc.search = new SearchIndex(() => d.searchDocs(), events)
  // Built before anything is written, so it follows the feed from the start.
  const indexed = ready.then(async () => {
    await d.refreshSearch(locked)
    svc.search.ensure()
  })
  const feed = new ConvexEventFeed(callNow, events, (rev) => {
    d.accessRevision = rev
  })
  /**
   * One function called the way a page calls it: as a person signed in
   * (Better Auth's identity, not the API's), or as a visitor.
   */
  const asPerson = async (
    kind: 'query' | 'mutation',
    ref: unknown,
    args: unknown,
    handle: string | null,
  ) => {
    await indexed
    return await exclusive(async () => {
      setSystemTime(new Date(now()))
      try {
        let as: typeof t = t
        if (handle) {
          const authId = `auth_${handle}`
          await t.run(async (ctx) => {
            const a = await ctx.db
              .query('accounts')
              .withIndex('by_handle', (q) => q.eq('handle', handle))
              .unique()
            if (a && !a.authId)
              await ctx.db.patch('accounts', a._id, { authId })
          })
          as = t.withIdentity({ subject: authId }) as typeof t
        }
        const fn = (as as unknown as Record<string, Fn>)[kind]
        const result = await fn(ref, args)
        if (kind === 'mutation') {
          await settle()
          await feed.pull()
        }
        return result
      } finally {
        setSystemTime()
      }
    })
  }
  return Object.assign(d, {
    oauthState: new ConvexOAuthState(call),
    asPerson,
  })
}
