import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { actorOf, signedIn } from '../lib/actor'
import { accessStamp, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { counters } from '../lib/events'
import { repoUrl, urls } from '../lib/present'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Pipeline runs: a workflow run on a runner, its jobs, their steps and the
 * log each step wrote. Starting a run queues its jobs; a runner claims the
 * oldest queued job and reports each step, which finishes the job and then
 * the run. Claiming is one transaction, so two runners never take one job.
 */

type Status = 'queued' | 'running' | 'success' | 'failure' | 'canceled'
type Line = { t: string; level: string | null }
type Step = {
  name: string
  status: string
  duration: number
  lines: Array<Line>
}
type Job = {
  name: string
  runner: string
  status: string
  duration: number
  steps: Array<Step>
}
export type PipelineRun = {
  id: string
  number: number
  workflow: string
  title: string
  branch: string
  sha: string
  status: Status
  trigger: string
  actor: string
  started: number
  finished: number | null
  file: string
  annotations: Array<{
    level: 'error' | 'warn'
    text: string
    job: string
    step: string
  }>
  jobs: Array<Job>
  version: number
}

const done = (s: string) =>
  s === 'success' || s === 'failure' || s === 'canceled'

/** A run as stored: lines come back only when asked for. */
async function load(
  ctx: QueryCtx,
  doc: Doc<'pipelineRuns'>,
  withLines = false,
): Promise<PipelineRun> {
  const r = JSON.parse(doc.json) as PipelineRun
  // Lines are kept apart; a stored step has none of its own.
  for (const j of r.jobs)
    for (const s of j.steps) (s as { lines?: Array<Line> }).lines ??= []
  if (withLines)
    for (const log of await ctx.db
      .query('pipelineLogs')
      .withIndex('by_runId_and_job_and_step', (q) => q.eq('runId', doc._id))
      .take(1000)) {
      const s = r.jobs.at(log.job - 1)?.steps.at(log.step - 1)
      if (s) s.lines = JSON.parse(log.lines) as Array<Line>
    }
  return r
}

/** How many lines each step has, without reading them. */
async function lineCounts(ctx: QueryCtx, doc: Doc<'pipelineRuns'>) {
  const counts = new Map<string, number>()
  for (const log of await ctx.db
    .query('pipelineLogs')
    .withIndex('by_runId_and_job_and_step', (q) => q.eq('runId', doc._id))
    .take(1000))
    counts.set(`${log.job}/${log.step}`, log.count)
  return counts
}

function stripped(r: PipelineRun) {
  return JSON.stringify({
    ...r,
    jobs: r.jobs.map((j) => ({
      ...j,
      steps: j.steps.map((s) => ({ ...s, lines: [] })),
    })),
  })
}

export async function insertRun(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  r: PipelineRun,
) {
  const id = await ctx.db.insert('pipelineRuns', {
    repoId: repo._id,
    publicId: r.id,
    number: r.number,
    workflow: r.workflow,
    status: r.status,
    started: r.started,
    json: stripped(r),
  })
  for (const [ji, j] of r.jobs.entries())
    for (const [si, s] of j.steps.entries())
      if (s.lines.length) await writeLog(ctx, id, ji + 1, si + 1, s.lines)
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, {
    pipelines: (c.pipelines ?? 0) + 1,
    pipelineNumber: Math.max(c.pipelineNumber ?? 0, r.number),
    pipelineRev: (c.pipelineRev ?? 0) + 1,
  })
  return id
}

async function writeLog(
  ctx: MutationCtx,
  runId: Id<'pipelineRuns'>,
  job: number,
  step: number,
  lines: Array<Line>,
) {
  const kept = lines.slice(-5000)
  const had = await ctx.db
    .query('pipelineLogs')
    .withIndex('by_runId_and_job_and_step', (q) =>
      q.eq('runId', runId).eq('job', job).eq('step', step),
    )
    .unique()
  if (had)
    await ctx.db.patch('pipelineLogs', had._id, {
      lines: JSON.stringify(kept),
      count: kept.length,
    })
  else
    await ctx.db.insert('pipelineLogs', {
      runId,
      job,
      step,
      lines: JSON.stringify(kept),
      count: kept.length,
    })
}

async function save(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  doc: Doc<'pipelineRuns'>,
  r: PipelineRun,
) {
  await ctx.db.patch('pipelineRuns', doc._id, {
    status: r.status,
    json: stripped(r),
  })
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, {
    pipelineRev: (c.pipelineRev ?? 0) + 1,
  })
}

function present(
  repo: Doc<'repos'>,
  r: PipelineRun,
  detail: boolean,
  counts?: Map<string, number>,
) {
  const iso = (t: number) => new Date(t).toISOString()
  const base = `${repoUrl(repo)}/pipelines/${r.number}`
  return {
    object: 'pipeline_run' as const,
    id: r.id,
    number: r.number,
    url: base,
    html_url: `${urls().html}/${repo.owner}/${repo.name}/pipelines?n=${r.number}`,
    workflow: r.workflow,
    file: r.file,
    title: r.title,
    branch: r.branch,
    sha: r.sha,
    status: r.status,
    trigger: r.trigger,
    actor: r.actor,
    started_at: iso(r.started),
    finished_at: r.finished === null ? null : iso(r.finished),
    duration_ms: r.finished === null ? null : r.finished - r.started,
    jobs: detail
      ? r.jobs.map((j, ji) => ({
          name: j.name,
          runner: j.runner,
          status: j.status,
          duration_ms: j.duration,
          steps: j.steps.map((s, si) => ({
            name: s.name,
            status: s.status,
            duration_ms: s.duration,
            lines: counts?.get(`${ji + 1}/${si + 1}`) ?? s.lines.length,
            log_url: `${base}/jobs/${ji + 1}/steps/${si + 1}/log`,
          })),
        }))
      : null,
    annotations: r.annotations,
    version: r.version,
  }
}

async function runOf(ctx: QueryCtx, repo: Doc<'repos'>, n: number) {
  const doc = await ctx.db
    .query('pipelineRuns')
    .withIndex('by_repoId_and_number', (q) =>
      q.eq('repoId', repo._id).eq('number', n),
    )
    .unique()
  if (!doc)
    fail('not_found', `No pipeline run ${n} in ${repo.owner}/${repo.name}.`)
  return doc
}

const shown = async (
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  doc: Doc<'pipelineRuns'>,
  r: PipelineRun,
) => present(repo, r, true, await lineCounts(ctx, doc))

export const list = query({
  args: {
    owner: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    workflow: v.optional(v.string()),
    after: v.union(
      v.null(),
      v.object({ key: v.union(v.string(), v.number()), id: v.string() }),
    ),
    limit: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, q) => {
    const repo = await resolve(ctx, q.owner, q.name, await actorOf(ctx))
    // Newest first; the cursor is the last one sent, by position and id.
    const all = (
      await ctx.db
        .query('pipelineRuns')
        .withIndex('by_repoId_and_started', (x) => x.eq('repoId', repo._id))
        .order('desc')
        .take(2000)
    ).filter(
      (r) =>
        (!q.status || r.status === q.status) &&
        (!q.workflow || r.workflow === q.workflow),
    )
    let start = 0
    if (q.after) {
      const k = all.findIndex((r) => r.publicId === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const page = all.slice(start, start + q.limit)
    const last = page.at(-1)
    const items = []
    for (const d of page) items.push(present(repo, await load(ctx, d), false))
    return out({
      items,
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.publicId }
          : null,
    })
  },
})

export const version = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const c = await counters(ctx, repo)
    return out(
      `${repo.publicId}.p${c.pipelines ?? 0}.${c.pipelineRev ?? 0}.${await accessStamp(ctx, repo)}`,
    )
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), n: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const doc = await runOf(ctx, repo, a.n)
    return out(await shown(ctx, repo, doc, await load(ctx, doc)))
  },
})

export const log = query({
  args: {
    owner: v.string(),
    name: v.string(),
    n: v.number(),
    job: v.number(),
    step: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const doc = await runOf(ctx, repo, a.n)
    const r = await load(ctx, doc, true)
    const j = r.jobs[a.job - 1] as Job | undefined
    const s = j?.steps[a.step - 1]
    if (!j || !s)
      fail('not_found', `Run ${a.n} has no job ${a.job} step ${a.step}.`)
    return out({
      object: 'pipeline_log',
      run: r.number,
      job: j.name,
      step: s.name,
      status: s.status,
      lines: s.lines.map((l) => ({ text: l.t, level: l.level })),
    })
  },
})

async function queuedFrom(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  from: PipelineRun,
  actor: string,
): Promise<PipelineRun> {
  const at = Date.now()
  const c = await counters(ctx, repo)
  return {
    ...from,
    id: newId('pipeline', at),
    number: (c.pipelineNumber ?? 0) + 1,
    status: 'queued',
    trigger: 'manual',
    actor,
    started: at,
    finished: null,
    annotations: [],
    jobs: from.jobs.map((j) => ({
      ...j,
      status: 'queued',
      duration: 0,
      steps: j.steps.map((s) => ({
        ...s,
        status: 'queued',
        duration: 0,
        lines: [],
      })),
    })),
    version: 1,
  }
}

/** Run a workflow again on the same commit. It is queued for a runner. */
export const rerun = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    n: v.number(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const from = await load(ctx, await runOf(ctx, repo, a.n))
    const r = await queuedFrom(ctx, repo, from, p.handle)
    await insertRun(ctx, repo, r)
    return finish(a.dry, present(repo, r, true))
  },
})

/** Start a workflow on a branch, from its last run's jobs. The API passes the branch's newest commit. */
export const start = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    workflow: v.string(),
    branch: v.optional(v.string()),
    sha: v.optional(v.string()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    let last: PipelineRun | null = null
    for await (const d of ctx.db
      .query('pipelineRuns')
      .withIndex('by_repoId_and_started', (q) => q.eq('repoId', repo._id))
      .order('desc'))
      if (d.workflow === a.workflow) {
        last = await load(ctx, d)
        break
      }
    if (!last)
      fail(
        'not_found',
        `No workflow ${a.workflow} in ${repo.owner}/${repo.name}.`,
        {
          hint: 'GET the pipelines list to see which workflows have run.',
        },
      )
    const branch = a.branch ?? repo.defaultBranch
    const r = await queuedFrom(ctx, repo, last, p.handle)
    r.branch = branch
    r.sha = a.sha ?? last.sha
    r.title = `${a.workflow} on ${branch}`
    await insertRun(ctx, repo, r)
    return finish(a.dry, present(repo, r, true))
  },
})

/** A runner asks for work: the oldest queued job in the repository, now running on it. */
export const claim = mutation({
  args: { owner: v.string(), name: v.string(), runner: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const candidates: Array<Doc<'pipelineRuns'>> = []
    for (const status of ['queued', 'running'])
      candidates.push(
        ...(await ctx.db
          .query('pipelineRuns')
          .withIndex('by_repoId_and_status_and_started', (q) =>
            q.eq('repoId', repo._id).eq('status', status),
          )
          .take(200)),
      )
    candidates.sort((x, y) => x.started - y.started)
    for (const doc of candidates) {
      const r = await load(ctx, doc)
      const ji = r.jobs.findIndex((j) => j.status === 'queued')
      if (ji < 0) continue
      const j = r.jobs[ji]
      j.status = 'running'
      j.runner = a.runner
      if (r.status === 'queued') r.status = 'running'
      r.version++
      await save(ctx, repo, doc, r)
      return out({
        object: 'pipeline_job',
        run: r.number,
        job: ji + 1,
        name: j.name,
        workflow: r.workflow,
        file: r.file,
        branch: r.branch,
        sha: r.sha,
        steps: j.steps.map((s, si) => ({ number: si + 1, name: s.name })),
        url: `${repoUrl(repo)}/pipelines/${r.number}/jobs/${ji + 1}`,
      })
    }
    return out(null)
  },
})

/** A runner says how a step went, with the lines it wrote. One call per step. */
export const report = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    n: v.number(),
    job: v.number(),
    step: v.number(),
    status: v.union(
      v.literal('running'),
      v.literal('success'),
      v.literal('failure'),
      v.literal('skipped'),
    ),
    lines: v.optional(
      v.array(
        v.object({
          text: v.string(),
          level: v.optional(v.union(v.null(), v.string())),
        }),
      ),
    ),
    duration_ms: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const doc = await runOf(ctx, repo, a.n)
    const r = await load(ctx, doc, true)
    const j = r.jobs.at(a.job - 1)
    const s = j?.steps.at(a.step - 1)
    if (!j || !s || a.job < 1 || a.step < 1)
      fail('not_found', `Run ${a.n} has no job ${a.job} step ${a.step}.`)
    if (done(r.status))
      fail('invalid_state', `Run ${a.n} has already finished.`)
    if (j.status !== 'running')
      fail(
        'invalid_state',
        `Job ${a.job} of run ${a.n} is ${j.status}; a runner claims it first.`,
      )
    s.status = a.status
    if (a.duration_ms !== undefined) s.duration = a.duration_ms
    for (const l of a.lines ?? [])
      s.lines.push({ t: l.text, level: l.level ?? null })
    if (a.lines?.length) await writeLog(ctx, doc._id, a.job, a.step, s.lines)
    if (a.status === 'failure') {
      const last = [...(a.lines ?? [])]
        .reverse()
        .find((l) => l.level === 'error')
      r.annotations.push({
        level: 'error',
        text: last?.text ?? `${s.name} failed`,
        job: j.name,
        step: s.name,
      })
      // A failed step stops the job: what is left is skipped.
      for (const rest of j.steps.slice(a.step))
        if (rest.status === 'queued') rest.status = 'skipped'
    }
    const over = (x: { status: string }) =>
      x.status === 'success' ||
      x.status === 'failure' ||
      x.status === 'skipped' ||
      x.status === 'canceled'
    if (j.steps.every(over)) {
      j.status = j.steps.some((x) => x.status === 'failure')
        ? 'failure'
        : 'success'
      j.duration = j.steps.reduce((t, x) => t + x.duration, 0)
    }
    if (r.jobs.every(over)) {
      r.status = r.jobs.some((x) => x.status === 'failure')
        ? 'failure'
        : 'success'
      r.finished = Date.now()
    }
    r.version++
    await save(ctx, repo, doc, r)
    return out(present(repo, r, true))
  },
})

export const cancel = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    n: v.number(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const doc = await runOf(ctx, repo, a.n)
    const r = await load(ctx, doc)
    if (done(r.status))
      fail('invalid_state', `Run ${a.n} has already finished.`)
    r.status = 'canceled'
    r.finished = Date.now()
    for (const j of r.jobs) {
      if (!done(j.status) && j.status !== 'skipped') j.status = 'canceled'
      for (const s of j.steps)
        if (!done(s.status) && s.status !== 'skipped') s.status = 'canceled'
    }
    r.version++
    await save(ctx, repo, doc, r)
    return finish(a.dry, await shown(ctx, repo, doc, r))
  },
})
