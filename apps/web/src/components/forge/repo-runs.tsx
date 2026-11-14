import * as React from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
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
import type { Repo } from '~/lib/model/data'
import type {
  Job,
  Level,
  LogLine,
  RunDetail,
  RunStatus,
  Step,
  StepStatus,
} from '~/lib/model/pipelines'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { failureOf } from '~/lib/model/pipelines'
import { opQuery, useOp, useWrite } from '~/lib/forge'
import { toRun, toRunDetail } from '~/lib/pipeline'

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
  if (status === 'skipped' || status === 'canceled')
    return (
      <MinusCircleIcon
        aria-label={status === 'canceled' ? 'Canceled' : 'Skipped'}
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
  canceled: 'Canceled',
}

const statusTone = {
  success: 'success',
  failure: 'danger',
  running: 'warning',
  queued: 'muted',
  canceled: 'muted',
} as const

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type Filter = 'all' | 'running' | 'failure'

function RunList({ repo }: { repo: Repo }) {
  const list = useOp('pipelines.list', {
    owner: repo.owner,
    repo: repo.name,
    limit: 100,
  }).data.map(toRun)
  const write = useWrite()
  const navigate = useNavigate()
  const [error, setError] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('all')
  const [workflow, setWorkflow] = React.useState(list[0]?.workflow ?? '')
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
  const workflows = [...new Set(list.map((r) => r.workflow))]
  // A workflow on the newest commit of the default branch, queued for a runner.
  const start = (name: string) =>
    void write('pipelines.start', {
      owner: repo.owner,
      repo: repo.name,
      body: { workflow: name },
    }).then((r) => {
      if (r.error) return setError(r.error.message)
      void navigate({
        to: '/$handle/$repo/$tab',
        params: { handle: repo.owner, repo: repo.name, tab: 'pipelines' },
        search: { n: r.data.number },
      })
    })
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
        <div className="flex items-center gap-2">
          <Select
            value={workflow}
            onValueChange={(v) => setWorkflow(String(v))}
          >
            {workflows.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </Select>
          <Button
            onClick={() => start(workflow)}
            title={`Run ${workflow} on the default branch`}
          >
            <PlayIcon className="size-4" />
            Run workflow
          </Button>
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
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

/** A run with every step's log, read before it draws. */
function RunLoader({ repo, n }: { repo: Repo; n: number }) {
  const at = { owner: repo.owner, repo: repo.name, run: n }
  const api = useOp('pipelines.get', at)
  const steps = (api.jobs ?? []).flatMap((j, ji) =>
    j.steps.map((_, si) => ({ job: ji + 1, step: si + 1 })),
  )
  const logs = useSuspenseQueries({
    queries: steps.map((s) => opQuery('pipelines.log', { ...at, ...s })),
  }).map((q) => q.data)
  return (
    <RunView
      key={`${api.number}.${api.version}`}
      repo={repo}
      detail={toRunDetail(api, logs)}
    />
  )
}

function RunView({ repo, detail }: { repo: Repo; detail: RunDetail }) {
  const run = detail.run
  const status = run.status
  const write = useWrite()
  const navigate = useNavigate()
  const [error, setError] = React.useState('')
  const [jobName, setJobName] = React.useState<string | null>(null)
  const failing = detail.jobs.find((j) => j.status === 'failure')
  const job: Job | undefined =
    detail.jobs.find((j) => j.name === jobName) ?? failing ?? detail.jobs.at(0)
  const [level, setLevel] = React.useState<LevelFilter>('all')
  const [query, setQuery] = React.useState('')
  const [closed, setClosed] = React.useState<Set<string>>(new Set())
  const [opened, setOpened] = React.useState<Set<string>>(new Set())
  const [copied, setCopied] = React.useState(false)
  const at = { owner: repo.owner, repo: repo.name, run: run.id }

  const failure = failureOf(detail)
  const errors = detail.annotations.filter((a) => a.level === 'error')
  const warns = detail.annotations.filter((a) => a.level === 'warn')
  const stepsOf = job?.steps ?? []
  const jobKey = job?.name ?? ''
  const isOpen = (s: Step) =>
    opened.has(`${jobKey}/${s.name}`) ||
    (!closed.has(`${jobKey}/${s.name}`) &&
      (s.status === 'failure' || s.status === 'running'))
  const toggle = (s: Step) => {
    const key = `${jobKey}/${s.name}`
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
  const rerun = () =>
    void write('pipelines.rerun', at).then((r) => {
      if (r.error) return setError(r.error.message)
      void navigate({
        to: '/$handle/$repo/$tab',
        params: { handle: repo.owner, repo: repo.name, tab: 'pipelines' },
        search: { n: r.data.number },
      })
    })
  const cancel = () =>
    void write('pipelines.cancel', at).then((r) =>
      setError(r.error?.message ?? ''),
    )
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
              {error && <span className="text-danger">{error}</span>}
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
              <Button variant="outline" size="sm" onClick={cancel}>
                <StopIcon className="size-3.5" />
                Cancel
              </Button>
            )}
            {status !== 'running' && status !== 'queued' && (
              <Button variant="outline" size="sm" onClick={rerun}>
                <ArrowPathIcon className="size-3.5" />
                Run again
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
              aria-current={j.name === job?.name ? 'true' : undefined}
              onClick={() => setJobName(j.name)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60',
                j.name === job?.name && 'bg-muted font-medium',
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
  return n ? (
    <RunLoader key={`${repo.name}-${n}`} repo={repo} n={n} />
  ) : (
    <RunList key={repo.name} repo={repo} />
  )
}
