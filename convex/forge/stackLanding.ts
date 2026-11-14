import { v } from 'convex/values'
import { ConvexError } from 'convex/values'
import { errorCatalog } from '@source-code/api/problem'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import { emit } from '../lib/events'
import { repoUrl } from '../lib/present'
import { findChange, hydrate, viewFor } from '../lib/changes'
import { checkLandable, doLand } from './changes'
import { actorRef } from '../schema'
import type { Actor } from '../lib/actor'

/**
 * Landing a stack, one change per step, each step its own transaction. A
 * step that cannot land stops the operation with the reason, and what
 * landed below it stays landed.
 */
export const step = internalMutation({
  args: {
    operation: v.id('operations'),
    repo: v.id('repos'),
    stackId: v.string(),
    numbers: v.array(v.number()),
    trees: v.array(v.array(v.string())),
    i: v.number(),
    // Who asked, as they were checked when they asked.
    as: v.object({
      handle: v.string(),
      actingAs: v.string(),
      class: v.union(v.literal('human'), v.literal('agent'), v.literal('bot')),
      scopes: v.array(v.string()),
      repos: v.union(v.null(), v.array(v.string())),
    }),
    by: actorRef,
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const op = await ctx.db.get('operations', a.operation)
    const repo = await ctx.db.get('repos', a.repo)
    if (!op || !repo) return null
    const p: Actor = {
      ...a.as,
      scopes: new Set(a.as.scopes),
      tokenId: null,
      system: false,
    }
    const finished = async (fields: Partial<typeof op>) => {
      await ctx.db.patch('operations', op._id, {
        ...fields,
        finished: Date.now(),
      })
      await emit(
        ctx,
        repo,
        'operation.finished',
        a.by,
        { object: 'operation', id: op.publicId, number: null },
        ['state'],
        null,
      )
    }
    if (a.i >= a.numbers.length) {
      await finished({
        state: 'succeeded',
        result: {
          object: 'stack',
          id: a.stackId,
          url: `${repoUrl(repo)}/stacks/${a.stackId}`,
        },
      })
      return null
    }
    await ctx.db.patch('operations', op._id, { state: 'running' })
    const trees = Object.fromEntries(a.trees) as Record<string, string>
    const n = a.numbers[a.i]
    try {
      const doc = await findChange(ctx, repo, String(n))
      if (!doc)
        throw new ConvexError({ code: 'not_found', detail: `No change #${n}.` })
      const l = await hydrate(ctx, doc)
      const view = await viewFor(ctx, repo, p, Date.now(), [l.rec])
      checkLandable(view, l.rec, p, trees[String(n)])
      await doLand(ctx, repo, l, a.by)
    } catch (e) {
      const data = (e instanceof ConvexError ? e.data : null) as {
        code?: string
        detail?: string
        more?: string
      } | null
      const more = data?.more
        ? (JSON.parse(data.more) as Record<string, unknown>)
        : {}
      const code = (
        data?.code && data.code in errorCatalog ? data.code : 'internal'
      ) as keyof typeof errorCatalog
      const entry = errorCatalog[code]
      await finished({
        state: 'failed',
        error: JSON.stringify({
          type: `https://source.code/docs/api/errors#${code}`,
          title: entry.title,
          status: entry.status,
          code,
          detail: data?.detail ?? 'Unexpected failure.',
          hint: (more.hint as string | undefined) ?? entry.hint,
          retryable: (more.retryable as boolean | undefined) ?? entry.retryable,
          exit_code: entry.exit,
          ...(more.errors ? { errors: more.errors } : {}),
          ...(more.extra as Record<string, unknown> | undefined),
        }),
      })
      return null
    }
    await ctx.db.patch('operations', op._id, { done: a.i + 1 })
    await ctx.scheduler.runAfter(0, internal.forge.stackLanding.step, {
      ...a,
      i: a.i + 1,
    })
    return null
  },
})
