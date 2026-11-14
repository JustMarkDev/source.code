/**
 * The Pipelines tab was designed on `mock/pipelines`' shapes. These turn the
 * API's runs and step logs into them.
 */
import type { PipelineLog, PipelineRun } from '@source-code/sdk'
import type { Run, RunDetail } from '~/lib/model/pipelines'
import { timeAgo } from '~/lib/repo'

/** "2m 41s", "9s", "1h 4m". */
export function duration(ms: number | null): string {
  if (ms === null) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function toRun(r: PipelineRun): Run {
  return {
    id: r.number,
    workflow: r.workflow,
    title: r.title,
    branch: r.branch,
    sha: r.sha,
    status: r.status,
    duration: duration(r.duration_ms),
    when: timeAgo(r.started_at),
    actor: r.actor,
    trigger: r.trigger,
  }
}

/** A run with its jobs and every step's log, in the order `jobs` lists them. */
export function toRunDetail(
  r: PipelineRun,
  logs: Array<PipelineLog>,
): RunDetail {
  let k = 0
  return {
    run: toRun(r),
    file: r.file,
    annotations: r.annotations,
    jobs: (r.jobs ?? []).map((j) => ({
      name: j.name,
      runner: j.runner,
      status: j.status,
      time: duration(j.duration_ms),
      steps: j.steps.map((s) => ({
        name: s.name,
        status: s.status,
        time: duration(s.duration_ms),
        lines: (logs[k++]?.lines ?? []).map((l) => ({
          t: l.text,
          ...(l.level ? { level: l.level } : {}),
        })),
      })),
    })),
  }
}
