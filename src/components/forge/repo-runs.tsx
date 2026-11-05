import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PlayIcon,
  StopIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, EmptyState, Panel, Seg } from './bits'
import { slugOf } from './repo-shell'
import { WorkWithAgent } from './work-with-agent'
import type { Repo } from '~/mock/data'
import type {
  Job,
  Level,
  LogLine,
  Run,
  RunStatus,
  Step,
  StepStatus,
} from '~/mock/pipelines'
import { Button } from '~/components/ui/button'
import { detailFor, failureOf, runsFor } from '~/mock/pipelines'

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
  className,
}: {
  status: StepStatus
  className?: string
}) {
  const c = cn('size-4 shrink-0', className)
  if (status === 'success')
    return (
      <CheckCircleIcon aria-label="Passed" className={cn(c, 'text-success')} />
    )
  if (status === 'failure')
    return <XCircleIcon aria-label="Failed" className={cn(c, 'text-danger')} />
  if (status === 'skipped')
    return (
      <MinusCircleIcon
        aria-label="Skipped"
        className={cn(c, 'text-muted-foreground')}
      />
    )
  if (status === 'queued')
    return (
      <ClockIcon
        aria-label="Waiting"
        className={cn(c, 'text-muted-foreground')}
      />
    )
  return (
    <ArrowPathIcon
      aria-label="Running"
      className={cn(c, 'animate-spin text-warning motion-reduce:animate-none')}
    />
  )
}

const statusLabel: Record<RunStatus, string> = {
  success: 'Passed',
  failure: 'Failed',
  running: 'Running',
  queued: 'Waiting',
}

const statusTone = {
  success: 'success',
  failure: 'danger',
  running: 'warning',
  queued: 'muted',
} as const

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type Filter = 'all' | 'running' | 'failure'

function RunList({ repo }: { repo: Repo }) {
  const [list, setList] = React.useState(() => runsFor(repo))
  const [filter, setFilter] = React.useState<Filter>('all')
  const shown = list.filter(
    (r) =>
      filter === 'all' ||
      r.status === filter ||
      (filter === 'running' && r.status === 'queued'),
  )
  if (list.length === 0)
    return (
      <EmptyState title="No pipelines yet">
        Add a workflow file under{' '}
        <code className="font-mono text-xs">.source/workflows/</code> to run
        something on every push or change. Its runs, with the full log of each
        step, appear here.
      </EmptyState>
    )
  const start = () => {
    const id = Math.max(...list.map((r) => r.id)) + 1
    const run: Run = {
      id,
      workflow: list[0].workflow,
      title: 'Run started by hand',
      branch: 'main',
      sha: 'a41c9e2',
      status: 'running',
      duration: '0s',
      when: 'just now',
      actor: 'you',
      trigger: 'manual',
    }
    setList((all) => [run, ...all])
    setTimeout(
      () =>
        setList((all) =>
          all.map((r) =>
            r.id === id ? { ...r, status: 'success', duration: '2m 10s' } : r,
          ),
        ),
      5000,
    )
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'All runs'],
            ['running', 'In progress'],
            ['failure', 'Failed'],
          ]}
        />
        <Button onClick={start}>
          <PlayIcon className="size-4" />
          Run a workflow
        </Button>
      </div>
      <Panel className="divide-y overflow-hidden">
        {shown.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No runs match.
          </div>
        )}
        {shown.map((r) => (
          <Link
            key={r.id}
            to="/$handle/$repo/$tab"
            params={{ handle: repo.owner, repo: repo.name, tab: 'pipelines' }}
            search={{ n: r.id }}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <StatusIcon status={r.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">
                {r.workflow} #{r.id} · {r.branch} · {r.actor}
              </div>
            </div>
            <span className="hidden w-16 text-right font-mono text-xs text-muted-foreground md:block">
              {r.duration}
            </span>
            <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">
              {r.when}
            </span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

type LevelFilter = 'all' | 'warn' | 'error'

const lineClass: Record<Level, string> = {
  cmd: 'font-semibold text-foreground',
  info: 'text-info',
  dim: 'text-muted-foreground',
  ok: 'text-success',
  warn: 'bg-warning/10 text-warning',
  error: 'bg-danger/10 text-danger',
}

function LogLines({
  lines,
  level,
  query,
}: {
  lines: Array<LogLine>
  level: LevelFilter
  query: string
}) {
  const q = query.trim().toLowerCase()
  const rows = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) =>
      level === 'all'
        ? true
        : level === 'error'
          ? l.level === 'error'
          : l.level === 'error' || l.level === 'warn',
    )
    .filter(({ l }) => !q || l.t.toLowerCase().includes(q))
  if (lines.length === 0)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        This step did not run.
      </p>
    )
  if (rows.length === 0)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">No lines match.</p>
    )
  return (
    <pre className="max-h-[26rem] overflow-auto py-2 font-mono text-xs leading-5">
      {rows.map(({ l, n }) => (
        <div
          key={n}
          className={cn('flex gap-3 px-4', lineClass[l.level ?? 'dim'])}
        >
          <span
            aria-hidden
            className="w-7 shrink-0 text-right text-muted-foreground/60 select-none tabular-nums"
          >
            {n}
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-all">
            {l.t || ' '}
          </span>
        </div>
      ))}
    </pre>
  )
}

function StepBlock({
  step,
  open,
  onToggle,
  level,
  query,
  live,
}: {
  step: Step
  open: boolean
  onToggle: () => void
  level: LevelFilter
  query: string
  live: boolean
}) {
  const errors = step.lines.filter((l) => l.level === 'error').length
  const warns = step.lines.filter((l) => l.level === 'warn').length
  return (
    <div id={`step-${step.name}`} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <StatusIcon status={step.status} />
        <span className="flex-1 text-sm font-medium">{step.name}</span>
        {live && step.status === 'running' && <Chip tone="warning">Live</Chip>}
        {errors > 0 && <Chip tone="danger">{errors} error lines</Chip>}
        {warns > 0 && <Chip tone="warning">{warns} warning lines</Chip>}
        <span className="font-mono text-xs text-muted-foreground">
          {step.time}
        </span>
      </button>
      {open && (
        <div className="border-t bg-muted/20">
          <LogLines lines={step.lines} level={level} query={query} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

function RunView({ repo, run }: { repo: Repo; run: Run }) {
  // Re-running changes the outcome, so the run is held here.
  const [status, setStatus] = React.useState<RunStatus>(run.status)
  const detail = React.useMemo(
    () => detailFor(repo, { ...run, status }),
    [repo, run, status],
  )
  const [jobName, setJobName] = React.useState<string | null>(null)
  const failing = detail.jobs.find((j) => j.status === 'failure')
  const job: Job =
    detail.jobs.find((j) => j.name === jobName) ?? failing ?? detail.jobs[0]
  const [level, setLevel] = React.useState<LevelFilter>('all')
  const [query, setQuery] = React.useState('')
  const [closed, setClosed] = React.useState<Set<string>>(new Set())
  const [opened, setOpened] = React.useState<Set<string>>(new Set())
  const [copied, setCopied] = React.useState(false)
  const [live, setLive] = React.useState<Array<LogLine>>([])

  // A run in progress keeps writing to its current step.
  React.useEffect(() => {
    setLive([])
    if (status !== 'running') return
    let i = 0
    const t = setInterval(() => {
      i += 1
      setLive((l) => [
        ...l,
        {
          t: `test refs::case_${String(i).padStart(2, '0')} ... ok`,
          level: 'ok',
        },
      ])
      if (i >= 14) clearInterval(t)
    }, 900)
    return () => clearInterval(t)
  }, [status])

  const failure = failureOf(detail)
  const errors = detail.annotations.filter((a) => a.level === 'error')
  const warns = detail.annotations.filter((a) => a.level === 'warn')
  const stepsOf = job.steps.map((s) =>
    s.status === 'running' ? { ...s, lines: [...s.lines, ...live] } : s,
  )
  const isOpen = (s: Step) =>
    opened.has(`${job.name}/${s.name}`) ||
    (!closed.has(`${job.name}/${s.name}`) &&
      (s.status === 'failure' || s.status === 'running'))
  const toggle = (s: Step) => {
    const key = `${job.name}/${s.name}`
    if (isOpen(s)) {
      setOpened((o) => {
        const n = new Set(o)
        n.delete(key)
        return n
      })
      setClosed((c) => new Set(c).add(key))
    } else {
      setClosed((c) => {
        const n = new Set(c)
        n.delete(key)
        return n
      })
      setOpened((o) => new Set(o).add(key))
    }
  }
  const rerun = () => {
    setStatus('running')
    setTimeout(() => setStatus('success'), 4500)
  }
  const goTo = (a: { job: string; step: string }) => {
    setJobName(a.job)
    setOpened((o) => new Set(o).add(`${a.job}/${a.step}`))
    setClosed((c) => {
      const n = new Set(c)
      n.delete(`${a.job}/${a.step}`)
      return n
    })
    setTimeout(
      () =>
        document
          .getElementById(`step-${a.step}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    )
  }
  const allLines = stepsOf.flatMap((s) => [
    { t: `##[group]${s.name}`, level: 'cmd' as const },
    ...s.lines,
  ])

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Link
          to="/$handle/$repo/$tab"
          params={{ handle: repo.owner, repo: repo.name, tab: 'pipelines' }}
          className="inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All runs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">
              {run.title}{' '}
              <span className="font-normal text-muted-foreground">
                #{run.id}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <Chip tone={statusTone[status]}>{statusLabel[status]}</Chip>
              <span>{run.workflow}</span>
              <span>{run.branch}</span>
              <span className="font-mono text-xs">{run.sha}</span>
              <span>
                {run.trigger === 'schedule'
                  ? 'scheduled'
                  : `${run.trigger} by ${run.actor}`}
              </span>
              <span>{status === 'running' ? 'running now' : run.duration}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'failure' && (
              <WorkWithAgent
                repo={slugOf(repo)}
                subject={{
                  kind: 'run',
                  ref: `run:${run.id}`,
                  title: failure
                    ? `${run.workflow} failed in ${failure.step}`
                    : run.title,
                }}
                label="Fix with an agent"
              />
            )}
            {(status === 'running' || status === 'queued') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus('failure')}
              >
                <StopIcon className="size-3.5" />
                Cancel
              </Button>
            )}
            {status !== 'running' && status !== 'queued' && (
              <Button variant="outline" size="sm" onClick={rerun}>
                <ArrowPathIcon className="size-3.5" />
                {status === 'failure'
                  ? 'Re-run failed jobs'
                  : 'Re-run all jobs'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {detail.annotations.length > 0 && (
        <Panel className="overflow-hidden text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-2.5">
            <ExclamationTriangleIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">
              {errors.length > 0 &&
                `${errors.length} error${errors.length > 1 ? 's' : ''}`}
              {errors.length > 0 && warns.length > 0 && ', '}
              {warns.length > 0 &&
                `${warns.length} warning${warns.length > 1 ? 's' : ''}`}
            </span>
            <span className="text-muted-foreground">
              Click one to open the step it came from.
            </span>
          </div>
          <ul className="divide-y">
            {detail.annotations.map((a, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => goTo(a)}
                  className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      'mt-0.5 size-2 shrink-0 rounded-full',
                      a.level === 'error' ? 'bg-danger' : 'bg-warning',
                    )}
                  />
                  <span className="min-w-0 flex-1 font-mono text-xs break-words">
                    {a.text}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.job} · {a.step}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Jobs" className="space-y-1">
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            Jobs
          </h3>
          {detail.jobs.map((j) => (
            <button
              key={j.name}
              type="button"
              aria-current={j.name === job.name ? 'true' : undefined}
              onClick={() => setJobName(j.name)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60',
                j.name === job.name && 'bg-muted font-medium',
              )}
            >
              <StatusIcon status={j.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{j.name}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {j.runner}
                </span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {j.time}
              </span>
            </button>
          ))}
          <p className="px-2 pt-2 text-xs text-muted-foreground">
            Defined in <code className="font-mono">{detail.file}</code>
          </p>
        </nav>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Seg
              value={level}
              onChange={setLevel}
              options={[
                ['all', 'All lines'],
                ['warn', 'Warnings and errors'],
                ['error', 'Errors'],
              ]}
            />
            <label className="relative min-w-40 flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the log"
                aria-label="Search the log"
                className="h-9 w-full rounded-lg border bg-background pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(
                  allLines.map((l) => l.t).join('\n'),
                )
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <ClipboardDocumentIcon className="size-3.5" />
              {copied ? 'Copied' : 'Copy log'}
            </Button>
          </div>
          <Panel className="divide-y overflow-hidden">
            {stepsOf.map((s) => (
              <StepBlock
                key={s.name}
                step={s}
                open={isOpen(s)}
                onToggle={() => toggle(s)}
                level={level}
                query={query}
                live={status === 'running'}
              />
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}

export function PipelinesPage({ repo, n }: { repo: Repo; n?: number }) {
  const run = n ? runsFor(repo).find((r) => r.id === n) : undefined
  return run ? (
    <RunView key={`${repo.name}-${run.id}`} repo={repo} run={run} />
  ) : (
    <RunList key={repo.name} repo={repo} />
  )
}
