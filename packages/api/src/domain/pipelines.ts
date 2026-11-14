import { newId } from '../ids'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type { PipelineRunRec, PipelineStatus, RepoRec, Viewer } from './records'
import { DomainReleases } from './releases'

const done = (s: PipelineStatus) =>
  s === 'success' || s === 'failure' || s === 'canceled'

/**
 * Pipeline runs: a workflow run on a runner, its jobs, their steps and the log
 * each step wrote. Starting a run queues its jobs; a runner claims the oldest
 * queued job, reads the workflow file at the run's commit, and reports each
 * step's status and log lines back, which finishes the job and then the run.
 */
export abstract class DomainPipelines extends DomainReleases {
  seedPipelineRun(repo: RepoRec, r: PipelineRunRec) {
    repo.pipelines = [...(repo.pipelines ?? []), r].sort(
      (a, b) => b.started - a.started,
    )
  }

  private runOf(repo: RepoRec, n: number) {
    const r = repo.pipelines?.find((x) => x.number === n)
    if (!r)
      throw apiError(
        'not_found',
        `No pipeline run ${n} in ${repo.owner}/${repo.name}.`,
      )
    return r
  }

  protected presentPipelineRun(
    repo: RepoRec,
    r: PipelineRunRec,
    detail: boolean,
  ) {
    const iso = (t: number) => new Date(t).toISOString()
    const base = `${this.repoUrl(repo)}/pipelines/${r.number}`
    return {
      object: 'pipeline_run' as const,
      id: r.id,
      number: r.number,
      url: base,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/pipelines?n=${r.number}`,
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
              lines: s.lines.length,
              log_url: `${base}/jobs/${ji + 1}/steps/${si + 1}/log`,
            })),
          }))
        : null,
      annotations: r.annotations,
      version: r.version,
    }
  }

  async listPipelineRuns(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      status?: PipelineStatus
      workflow?: string
      after: CursorPosition | null
      limit: number
    },
  ) {
    const repo = this.resolve(owner, name, p)
    const all = (repo.pipelines ?? []).filter(
      (r) =>
        (!q.status || r.status === q.status) &&
        (!q.workflow || r.workflow === q.workflow),
    )
    let start = 0
    if (q.after) {
      const k = all.findIndex((r) => r.id === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map((r) => this.presentPipelineRun(repo, r, false)),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.id }
          : null,
    }
  }

  async pipelinesVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const v = (repo.pipelines ?? []).reduce((n, r) => n + r.version, 0)
    return `${repo.id}.p${repo.pipelines?.length ?? 0}.${v}.${this.accessRevision}`
  }

  async getPipelineRun(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return this.presentPipelineRun(repo, this.runOf(repo, n), true)
  }

  async getPipelineLog(
    owner: string,
    name: string,
    n: number,
    job: number,
    step: number,
    p: Viewer,
  ) {
    const repo = this.resolve(owner, name, p)
    const r = this.runOf(repo, n)
    const j = r.jobs[job - 1] as (typeof r.jobs)[number] | undefined
    const s = j?.steps[step - 1]
    if (!j || !s)
      throw apiError('not_found', `Run ${n} has no job ${job} step ${step}.`)
    return {
      object: 'pipeline_log' as const,
      run: r.number,
      job: j.name,
      step: s.name,
      status: s.status,
      lines: s.lines.map((l) => ({ text: l.t, level: l.level })),
    }
  }

  /** Run a workflow again on the same commit. It is queued for a runner. */
  async rerunPipeline(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const from = this.runOf(repo, n)
    const at = this.now()
    const number =
      Math.max(0, ...(repo.pipelines ?? []).map((r) => r.number)) + 1
    const r: PipelineRunRec = {
      ...from,
      id: newId('pipeline', at),
      number,
      status: 'queued',
      trigger: 'manual',
      actor: p!.handle,
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
    if (!dry) this.seedPipelineRun(repo, r)
    return this.presentPipelineRun(repo, r, true)
  }

  /** Start a workflow on the newest commit of a branch, from its last run's jobs. */
  async startPipeline(
    owner: string,
    name: string,
    p: Viewer,
    body: { workflow: string; branch?: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const last = (repo.pipelines ?? []).find(
      (r) => r.workflow === body.workflow,
    )
    if (!last)
      throw apiError(
        'not_found',
        `No workflow ${body.workflow} in ${repo.owner}/${repo.name}.`,
        { hint: 'GET the pipelines list to see which workflows have run.' },
      )
    const branch = body.branch ?? repo.defaultBranch
    let sha = last.sha
    try {
      sha =
        (await this.svc.git.commits(`${repo.owner}/${repo.name}`, 1))[0]?.sha ??
        sha
    } catch {
      // No history in the store: start it on the commit it last ran on.
    }
    const r = this.queuedFrom(repo, last, p!.handle)
    r.branch = branch
    r.sha = sha
    r.title = `${body.workflow} on ${branch}`
    if (!dry) this.seedPipelineRun(repo, r)
    return this.presentPipelineRun(repo, r, true)
  }

  private queuedFrom(repo: RepoRec, from: PipelineRunRec, actor: string) {
    const at = this.now()
    const number =
      Math.max(0, ...(repo.pipelines ?? []).map((r) => r.number)) + 1
    const r: PipelineRunRec = {
      ...from,
      id: newId('pipeline', at),
      number,
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
    return r
  }

  /**
   * A runner asks for work: the oldest queued job in the repository, now
   * running on it. Null when there is nothing to do.
   */
  async claimPipelineJob(
    owner: string,
    name: string,
    p: Viewer,
    body: { runner: string },
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const queued = [...(repo.pipelines ?? [])]
      .filter((r) => r.status === 'queued' || r.status === 'running')
      .sort((a, b) => a.started - b.started)
    for (const r of queued) {
      const ji = r.jobs.findIndex((j) => j.status === 'queued')
      if (ji < 0) continue
      const j = r.jobs[ji]
      j.status = 'running'
      j.runner = body.runner
      if (r.status === 'queued') r.status = 'running'
      r.version++
      return {
        object: 'pipeline_job' as const,
        run: r.number,
        job: ji + 1,
        name: j.name,
        workflow: r.workflow,
        file: r.file,
        branch: r.branch,
        sha: r.sha,
        steps: j.steps.map((s, si) => ({ number: si + 1, name: s.name })),
        url: `${this.repoUrl(repo)}/pipelines/${r.number}/jobs/${ji + 1}`,
      }
    }
    return null
  }

  /** A runner says how a step went, with the lines it wrote. */
  async reportPipelineStep(
    owner: string,
    name: string,
    n: number,
    job: number,
    step: number,
    p: Viewer,
    body: {
      status: 'running' | 'success' | 'failure' | 'skipped'
      lines?: Array<{
        text: string
        level?: 'cmd' | 'info' | 'ok' | 'warn' | 'error' | null
      }>
      duration_ms?: number
    },
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const r = this.runOf(repo, n)
    const j = r.jobs.at(job - 1)
    const s = j?.steps.at(step - 1)
    if (!j || !s || job < 1 || step < 1)
      throw apiError('not_found', `Run ${n} has no job ${job} step ${step}.`)
    if (done(r.status))
      throw apiError('invalid_state', `Run ${n} has already finished.`)
    if (j.status !== 'running')
      throw apiError(
        'invalid_state',
        `Job ${job} of run ${n} is ${j.status}; a runner claims it first.`,
      )
    s.status = body.status
    if (body.duration_ms !== undefined) s.duration = body.duration_ms
    for (const l of body.lines ?? [])
      s.lines.push({ t: l.text, level: l.level ?? null })
    if (s.lines.length > 5000) s.lines.splice(0, s.lines.length - 5000)
    if (body.status === 'failure') {
      const last = [...(body.lines ?? [])]
        .reverse()
        .find((l) => l.level === 'error')
      r.annotations.push({
        level: 'error',
        text: last?.text ?? `${s.name} failed`,
        job: j.name,
        step: s.name,
      })
      // A failed step stops the job: what is left is skipped.
      for (const rest of j.steps.slice(step))
        if (rest.status === 'queued') rest.status = 'skipped'
    }
    const finished = (x: { status: string }) =>
      x.status === 'success' ||
      x.status === 'failure' ||
      x.status === 'skipped' ||
      x.status === 'canceled'
    if (j.steps.every(finished)) {
      j.status = j.steps.some((x) => x.status === 'failure')
        ? 'failure'
        : 'success'
      j.duration = j.steps.reduce((t, x) => t + x.duration, 0)
    }
    if (r.jobs.every(finished)) {
      r.status = r.jobs.some((x) => x.status === 'failure')
        ? 'failure'
        : 'success'
      r.finished = this.now()
    }
    r.version++
    return this.presentPipelineRun(repo, r, true)
  }

  async cancelPipeline(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const r = this.runOf(repo, n)
    if (done(r.status))
      throw apiError('invalid_state', `Run ${n} has already finished.`)
    if (dry)
      return this.presentPipelineRun(repo, { ...r, status: 'canceled' }, true)
    const at = this.now()
    r.status = 'canceled'
    r.finished = at
    for (const j of r.jobs) {
      if (!done(j.status as PipelineStatus) && j.status !== 'skipped')
        j.status = 'canceled'
      for (const s of j.steps)
        if (!done(s.status as PipelineStatus) && s.status !== 'skipped')
          s.status = 'canceled'
    }
    r.version++
    return this.presentPipelineRun(repo, r, true)
  }
}
