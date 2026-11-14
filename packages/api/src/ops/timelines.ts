import { Effect } from 'effect'
import { z } from 'zod'
import { pageSorted } from '../cursor'
import { Domain, defineOp } from '../registry'
import * as S from '../schemas'
import {
  afterOf,
  changeParams,
  fp,
  listOf,
  pageShape,
  repoParams,
} from './common'

/**
 * One timeline per change and per issue: everything that happened to it, in
 * time order, so a person or an agent reads the whole story in one call.
 */

const base = {
  auth: 'optional' as const,
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
  query: z.strictObject({ ...pageShape }),
  response: S.listOf(S.TimelineEntry),
  errors: ['not_found', 'moved', 'cursor_mismatch'] as const,
}

const page = (
  entries: ReadonlyArray<z.infer<typeof S.TimelineEntry>>,
  q: { cursor?: string; limit: number },
  f: string,
) => {
  // Entries come in time order; several in one millisecond keep theirs, so
  // the key is the time and the place within that millisecond.
  const keyOf = new Map<string, number>()
  let last = Number.NaN
  let k = 0
  for (const e of entries) {
    const t = Date.parse(e.created_at)
    k = t === last ? k + 1 : 0
    last = t
    keyOf.set(e.id, t * 1000 + Math.min(k, 999))
  }
  const p = pageSorted(
    entries,
    (e) => keyOf.get(e.id)!,
    (e) => e.id,
    { limit: q.limit, after: afterOf(q.cursor, f), desc: false },
  )
  return listOf(p.items, p.next, f)
}

export const changeTimeline = defineOp({
  ...base,
  errors: [...base.errors],
  scopes: ['pulls:read'],
  id: 'changes.timeline',
  summary: "A change's timeline",
  description:
    'Everything that happened to a change, oldest first: patch sets, review comments, reviews, findings, checks, evidence, the notes of the agent runs that worked on it, and its state changes. Each entry names the run that made it, if one did, and carries the object itself in `item`.',
  tags: ['changes'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/timeline',
  params: changeParams,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const { owner, repo, number } = ctx.params
      const entries = yield* run((d) =>
        d.timeline(owner, repo, { kind: 'change', ref: number }, ctx.principal),
      )
      return page(
        entries,
        ctx.query,
        fp('changes.timeline', owner, repo, number),
      )
    }),
})

export const issueTimeline = defineOp({
  ...base,
  errors: [...base.errors],
  scopes: ['issues:read'],
  id: 'issues.timeline',
  summary: "An issue's timeline",
  description:
    'Everything that happened to an issue, oldest first: comments, evidence, the notes of the agent runs working on it (a run names its issue with `runs.update`), the changes that link it (`Fixes #n`, `Closes #n`, `Resolves #n`, or `Refs #n`), and its state changes.',
  tags: ['issues'],
  method: 'GET',
  path: '/repos/{owner}/{repo}/issues/{number}/timeline',
  params: repoParams.extend({
    number: z.coerce.number().int().min(1).describe('The issue number'),
  }),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const { owner, repo, number } = ctx.params
      const entries = yield* run((d) =>
        d.timeline(
          owner,
          repo,
          { kind: 'issue', ref: String(number) },
          ctx.principal,
        ),
      )
      return page(
        entries,
        ctx.query,
        fp('issues.timeline', owner, repo, String(number)),
      )
    }),
})

export const timelineOps = [changeTimeline, issueTimeline]
