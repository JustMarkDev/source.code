import { v } from 'convex/values'
import { query } from '../_generated/server'
import { actorOf } from '../lib/actor'
import { resolve } from '../lib/access'
import { out } from '../lib/errors'
import { actorOut, iso, urls } from '../lib/present'
import { issueOf } from '../lib/issues'
import { hydrate, loadChange, viewFor } from '../lib/changes'
import { presentGuide } from '@source-code/api/guides'
import { presentComment, presentIssueEvidence } from './issues'
import type { ActorRef } from '../lib/events'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * One timeline per change and per issue: its parts, the notes of the runs
 * that worked on it, its state changes and, for an issue, the changes that
 * link it. The same entries `MemoryDomain.timeline` makes.
 */

type Entry = {
  object: 'timeline_entry'
  id: string
  kind: string
  created_at: string
  actor: ReturnType<typeof actorOut> | null
  run: string | null
  summary: string
  item: unknown
}

/** How many runs of a repository are looked at for one timeline. */
const RUNS = 500

export const get = query({
  args: {
    owner: v.string(),
    name: v.string(),
    kind: v.union(v.literal('change'), v.literal('issue')),
    ref: v.string(),
    at: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const entries: Array<Entry> = []
    const entry = (
      kind: string,
      id: string,
      at: number,
      actor: ActorRef | null,
      run: string | null,
      summary: string,
      item: unknown,
    ) =>
      entries.push({
        object: 'timeline_entry',
        id: `${kind}:${id}`,
        kind,
        created_at: iso(at),
        actor: actor ? actorOut(actor) : null,
        run,
        summary,
        item,
      })
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_repoId_and_started_and_publicId', (q) =>
        q.eq('repoId', repo._id),
      )
      .order('desc')
      .take(RUNS)
    const runNotes = async (mine: Array<Doc<'runs'>>) => {
      for (const r of mine.sort((x, y) => x.started - y.started)) {
        const agent = await agentOf(ctx, r.handle)
        r.notes.forEach((x, k) =>
          entry(
            'run_note',
            `${r.publicId}:${k}`,
            x.at,
            agent,
            r.publicId,
            x.text,
            {
              object: 'run_note',
              run: r.publicId,
              task: r.task,
              text: x.text,
              final: false,
            },
          ),
        )
        if (r.finished && r.summary)
          entry(
            'run_note',
            `${r.publicId}:end`,
            r.finished,
            agent,
            r.publicId,
            r.summary,
            {
              object: 'run_note',
              run: r.publicId,
              task: r.task,
              text: r.summary,
              final: true,
            },
          )
      }
    }
    const states = async (subject: string) => {
      let from: string | null = null
      for (const s of await ctx.db
        .query('stateChanges')
        .withIndex('by_repoId_and_subject_and_at', (q) =>
          q.eq('repoId', repo._id).eq('subject', subject),
        )
        .take(200)) {
        if (s.to === from) continue
        entry(
          'state_change',
          s.eventId,
          s.at,
          s.actor,
          null,
          from ? `${from} to ${s.to}` : `opened as ${s.to}`,
          { object: 'state_change', from, to: s.to },
        )
        from = s.to
      }
      return from
    }
    if (a.kind === 'change') {
      const { doc, rec: c } = await loadChange(ctx, repo, a.ref)
      const view = await viewFor(ctx, repo, p, a.at, [c])
      for (const ps of c.patchSets)
        entry(
          'patch_set',
          String(ps.n),
          ps.created,
          ps.author,
          ps.via?.run ?? null,
          `Patch set ${ps.n}: ${ps.note}`,
          view.presentPatchSet(c, ps),
        )
      for (const x of c.comments ?? [])
        entry(
          'comment',
          x.id,
          x.created,
          x.author,
          x.via?.run ?? null,
          `${x.file ? `${x.file}${x.line ? `:${x.line}` : ''}: ` : ''}${x.body.split('\n')[0]}`,
          view.presentReviewComment(c, x),
        )
      for (const r of c.reviews)
        entry(
          'review',
          r.id,
          r.created,
          r.actor,
          r.via?.run ?? null,
          `${r.state === 'changes' ? 'asked for changes' : r.state} on patch set ${r.patchSet}${r.carries ? '' : ' (stale)'}`,
          view.presentReview(r),
        )
      for (const f of c.findings)
        entry(
          'finding',
          f.id,
          f.created,
          await agentOf(ctx, f.by),
          f.via?.run ?? null,
          `${f.label} (${f.severity}): ${f.title}`,
          view.presentFinding(c, f),
        )
      for (const k of c.checks)
        entry(
          'check',
          k.id,
          k.updated,
          null,
          null,
          `${k.name}: ${k.state}`,
          view.presentCheck(k),
        )
      if (c.guide)
        entry(
          'guide',
          `${c.id}:${c.guide.created}`,
          c.guide.created,
          c.guide.by,
          c.guide.run,
          `Guide for patch set ${c.guide.patchSet}: ${c.guide.summary.split('\n')[0]}`,
          presentGuide(
            c.number,
            c.patchSets[c.patchSets.length - 1].n,
            c.guide,
            (x) => view.actor(x),
            iso,
          ),
        )
      for (const e of c.evidence ?? [])
        entry(
          'evidence',
          e.id,
          e.created,
          e.by,
          null,
          `${e.kind}: ${e.caption}`,
          view.presentEvidence(c, e),
        )
      const pushed = new Set(
        (
          await ctx.db
            .query('runPatchSets')
            .withIndex('by_changeId_and_patchSet', (q) =>
              q.eq('changeId', doc._id),
            )
            .take(200)
        ).map((x) => x.runId),
      )
      await runNotes(
        runs.filter((r) => r.change === c.number || pushed.has(r._id)),
      )
      if ((await states(`change:${c.number}`)) === null)
        entry(
          'state_change',
          `${c.id}:opened`,
          c.created,
          c.author,
          null,
          `opened as ${c.state}`,
          {
            object: 'state_change',
            from: null,
            to: c.state,
          },
        )
    } else {
      const n = Number(a.ref)
      const i = await issueOf(ctx, repo, n)
      for (const x of await ctx.db
        .query('issueComments')
        .withIndex('by_issueId', (q) => q.eq('issueId', i._id))
        .take(1000))
        entry(
          'comment',
          x.publicId,
          x.created,
          x.author,
          null,
          x.body.split('\n')[0],
          presentComment(i, x),
        )
      for (const e of await ctx.db
        .query('issueEvidence')
        .withIndex('by_issueId', (q) => q.eq('issueId', i._id))
        .take(200))
        entry(
          'evidence',
          e.publicId,
          e.created,
          e.by,
          null,
          `${e.kind}: ${e.caption}`,
          presentIssueEvidence(i, e),
        )
      await runNotes(runs.filter((r) => r.issue === n))
      for (const ref of await ctx.db
        .query('issueRefs')
        .withIndex('by_repoId_and_issue', (q) =>
          q.eq('repoId', repo._id).eq('issue', n),
        )
        .take(200)) {
        const doc = await ctx.db.get('changes', ref.changeId)
        if (!doc) continue
        const { rec: c } = await hydrate(ctx, doc)
        entry(
          'reference',
          c.id,
          c.created,
          c.author,
          c.patchSets[0]?.via?.run ?? null,
          `#${c.number} ${ref.closes ? 'fixes' : 'refers to'} this: ${c.title}`,
          {
            object: 'reference',
            change: c.number,
            title: c.title,
            state: c.state,
            closes: ref.closes,
            url: `${urls().api}/repos/${repo.owner}/${repo.name}/changes/${c.number}`,
          },
        )
      }
      if ((await states(`issue:${n}`)) === null)
        entry(
          'state_change',
          `${i.publicId}:opened`,
          i.created,
          i.author,
          null,
          `opened as ${i.state}`,
          {
            object: 'state_change',
            from: null,
            to: i.state,
          },
        )
    }
    return out(
      entries.sort(
        (x, y) =>
          // Stable: entries at the same moment keep the order they were made in.
          Date.parse(x.created_at) - Date.parse(y.created_at),
      ),
    )
  },
})

/** The actor an agent or bot handle acts as, without writing anything. */
async function agentOf(ctx: QueryCtx, handle: string): Promise<ActorRef> {
  const account = await ctx.db
    .query('accounts')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
  if (account) return { id: account.publicId, handle, class: 'human' }
  for (const key of [handle, `${handle}~agent`]) {
    const own = await ctx.db
      .query('actors')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique()
    if (own) return { id: own.publicId, handle, class: own.class }
  }
  return { id: 'acc_unknown', handle, class: 'agent' }
}
