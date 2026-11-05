import * as React from 'react'
import {
  CheckCircleIcon,
  CpuChipIcon,
  MinusCircleIcon,
  PlayCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Panel, Seg } from './bits'
import type {
  Media,
  Origin,
  TestCase,
  TestResult,
  TestRun,
} from '~/mock/evidence'

type Mode = 'side' | 'slider' | 'toggle'

/**
 * Two images of the same thing, so a person sees what changed instead of
 * reading about it. Side by side is the default. The slider and the toggle
 * are for small differences.
 */
function CompareImage({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
  title,
}: {
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
  title: string
}) {
  const [mode, setMode] = React.useState<Mode>('side')
  const [split, setSplit] = React.useState(50)
  const [showAfter, setShowAfter] = React.useState(true)
  return (
    <div className="space-y-3">
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          ['side', 'Side by side'],
          ['slider', 'Slider'],
          ['toggle', 'Toggle'],
        ]}
      />
      {mode === 'side' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(
            [
              [beforeLabel, before],
              [afterLabel, after],
            ] as const
          ).map(([label, src]) => (
            <figure key={label} className="min-w-0 space-y-1.5">
              <figcaption className="text-xs font-medium text-muted-foreground">
                {label}
              </figcaption>
              <img
                src={src}
                alt={`${title}: ${label}`}
                className="w-full rounded-lg border"
              />
            </figure>
          ))}
        </div>
      )}
      {mode === 'slider' && (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg border">
            <img
              src={after}
              alt={`${title}: ${afterLabel}`}
              className="w-full"
            />
            <img
              src={before}
              alt={`${title}: ${beforeLabel}`}
              className="absolute inset-0 w-full"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-0.5 bg-brand"
              style={{ left: `${split}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{beforeLabel}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              aria-label={`Show ${beforeLabel} on the left and ${afterLabel} on the right`}
              className="flex-1 accent-[var(--brand-ink)]"
            />
            <span>{afterLabel}</span>
          </div>
        </div>
      )}
      {mode === 'toggle' && (
        <button
          type="button"
          onClick={() => setShowAfter((v) => !v)}
          aria-label={`Showing ${showAfter ? afterLabel : beforeLabel}. Click to switch.`}
          className="block w-full space-y-1.5 text-left"
        >
          <span className="text-xs font-medium text-muted-foreground">
            {showAfter ? afterLabel : beforeLabel}{' '}
            <span className="font-normal">(click to switch)</span>
          </span>
          <img
            src={showAfter ? after : before}
            alt={`${title}: ${showAfter ? afterLabel : beforeLabel}`}
            className="w-full rounded-lg border"
          />
        </button>
      )}
    </div>
  )
}

function OriginChip({ o }: { o: Origin }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {o.kind !== 'human' && <CpuChipIcon className="size-3.5" />}
      {o.kind === 'human'
        ? 'Added by'
        : o.kind === 'agent'
          ? 'Captured by'
          : 'Recorded by'}{' '}
      <b className="font-medium text-foreground">{o.by}</b>
      {o.via && <span>· {o.via}</span>}
    </span>
  )
}

/** One piece of evidence: a pair of images, a single image, or a live frame. */
export function MediaCard({ m }: { m: Media }) {
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h4 className="text-sm font-medium">{m.title}</h4>
          {m.caption && (
            <p className="text-xs text-muted-foreground">{m.caption}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {m.kind === 'frame' && (
            <Chip tone="info">
              <PlayCircleIcon className="mr-1 size-3.5" />
              {m.label}
            </Chip>
          )}
          <OriginChip o={m.origin} />
        </div>
      </div>
      {m.kind === 'compare' && (
        <CompareImage
          title={m.title}
          before={m.before}
          after={m.after}
          beforeLabel={m.beforeLabel}
          afterLabel={m.afterLabel}
        />
      )}
      {m.kind === 'image' && (
        <img src={m.src} alt={m.title} className="w-full rounded-lg border" />
      )}
      {m.kind === 'frame' && (
        // Sandboxed: the page can run its own script but cannot reach ours.
        <iframe
          title={m.title}
          srcDoc={m.html}
          sandbox="allow-scripts"
          className="h-64 w-full rounded-lg border bg-[#0b0d10]"
        />
      )}
    </Panel>
  )
}

export function EvidenceSection({
  title = 'What changed, to look at',
  items,
}: {
  title?: string
  items: Array<Media>
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="space-y-3">
        {items.map((m) => (
          <MediaCard key={m.id} m={m} />
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function ResultIcon({ r }: { r: TestResult | 'missing' }) {
  if (r === 'pass')
    return (
      <CheckCircleIcon aria-label="Passes" className="size-4 text-success" />
    )
  if (r === 'fail')
    return <XCircleIcon aria-label="Fails" className="size-4 text-danger" />
  if (r === 'skipped')
    return (
      <MinusCircleIcon
        aria-label="Skipped"
        className="size-4 text-muted-foreground"
      />
    )
  return (
    <span aria-label="Not there yet" className="text-muted-foreground">
      ·
    </span>
  )
}

type Filter = 'all' | 'new' | 'problems'

const isNew = (c: TestCase) => c.base === 'missing' || c.base === 'fail'
const isProblem = (c: TestCase) => c.head === 'fail' || c.head === 'skipped'

/**
 * Which tests ran, and how each behaved on the base and on this change. A test
 * that fails on the base and passes here is the strongest evidence a change
 * does what it says. Tests that took screenshots show them before and after.
 */
export function TestReport({ run }: { run: TestRun }) {
  const [filter, setFilter] = React.useState<Filter>('all')
  const [open, setOpen] = React.useState<string | null>(
    run.cases.find((c) => c.shot)?.name ?? null,
  )
  const pass = run.cases.filter((c) => c.head === 'pass').length
  const fail = run.cases.filter((c) => c.head === 'fail').length
  const skipped = run.cases.filter((c) => c.head === 'skipped').length
  const fixed = run.cases.filter(
    (c) => c.base === 'fail' && c.head === 'pass',
  ).length
  const shown = run.cases.filter((c) =>
    filter === 'all' ? true : filter === 'new' ? isNew(c) : isProblem(c),
  )
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">Tests</h3>
        <OriginChip o={run.origin} />
      </div>
      <Panel className="overflow-hidden text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
          <p>
            <b className="font-medium">{pass}</b> of {run.cases.length} pass
            {fail > 0 && <span className="text-danger">, {fail} fail</span>}
            {skipped > 0 && (
              <span className="text-muted-foreground">, {skipped} skipped</span>
            )}
            {fixed > 0 && (
              <span className="text-muted-foreground">
                . {fixed} fail on the base and pass here.
              </span>
            )}
          </p>
          <Seg
            value={filter}
            onChange={setFilter}
            options={[
              ['all', 'All'],
              ['new', 'New or fixed'],
              ['problems', 'Not passing'],
            ]}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_3.5rem] gap-x-2 border-b px-4 py-1.5 text-xs text-muted-foreground max-sm:hidden">
          <span>Test</span>
          <span className="text-center">Base</span>
          <span className="text-center">Here</span>
          <span className="text-right">Time</span>
        </div>
        <ul className="divide-y">
          {shown.map((c) => {
            const key = `${c.suite}::${c.name}`
            const expanded = open === c.name && Boolean(c.shot)
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!c.shot}
                  aria-expanded={c.shot ? expanded : undefined}
                  onClick={() => setOpen(expanded ? null : c.name)}
                  className={cn(
                    'grid w-full grid-cols-[minmax(0,1fr)_4rem_4rem_3.5rem] items-center gap-x-2 px-4 py-2 text-left',
                    c.shot && 'hover:bg-muted/50',
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">{c.suite}::</span>
                    <span className="font-mono text-xs">{c.name}</span>
                    {c.shot && (
                      <Chip tone="info" className="ml-2">
                        screenshots
                      </Chip>
                    )}
                  </span>
                  <span className="flex justify-center">
                    <ResultIcon r={c.base} />
                  </span>
                  <span className="flex justify-center">
                    <ResultIcon r={c.head} />
                  </span>
                  <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {c.ms ? `${c.ms} ms` : '-'}
                  </span>
                </button>
                {expanded && c.shot && (
                  <div className="space-y-2 border-t bg-muted/30 px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      {c.shot.note}
                    </p>
                    <CompareImage
                      title={c.name}
                      before={c.shot.before}
                      after={c.shot.after}
                      beforeLabel="On main"
                      afterLabel="On this change"
                    />
                  </div>
                )}
              </li>
            )
          })}
          {shown.length === 0 && (
            <li className="px-4 py-6 text-center text-muted-foreground">
              Nothing in this view.
            </li>
          )}
        </ul>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {run.runner}, run #{run.run}, on tree{' '}
          <code className="font-mono">{run.tree}</code>.
        </p>
      </Panel>
    </section>
  )
}
