import * as React from 'react'
import {
  ArrowUpTrayIcon,
  ArrowsRightLeftIcon,
  BeakerIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  PlusCircleIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Tile } from './bits'
import { Badge } from '~/components/ui/badge'

export type TimelineKind =
  | 'opened'
  | 'patchset'
  | 'review'
  | 'finding'
  | 'ci'
  | 'mirror'
  | 'evidence'
  | 'agent'
  | 'land'

export type TimelineEvent = {
  kind: TimelineKind
  who: string
  actor: 'human' | 'agent' | 'bot'
  what: string
  detail?: string
  /** How long ago, so events sort and group. Zero is just now. */
  hoursAgo: number
  /** Time of day, when it is known. */
  clock?: string
  patchSet?: number
  tone?: 'success' | 'danger' | 'warning'
}

const icon: Record<
  TimelineKind,
  React.ComponentType<{ className?: string }>
> = {
  opened: PlusCircleIcon,
  patchset: ArrowUpTrayIcon,
  review: ChatBubbleLeftRightIcon,
  finding: ExclamationTriangleIcon,
  ci: BeakerIcon,
  mirror: ArrowsRightLeftIcon,
  evidence: PhotoIcon,
  agent: CpuChipIcon,
  land: RocketLaunchIcon,
}

const toneClass = {
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
} as const

/** The history of a change: what was pushed, said and run, newest first. */

function dayLabel(hours: number) {
  if (hours < 24) return hours === 0 ? 'Just now' : 'Today'
  if (hours < 48) return 'Yesterday'
  return `${Math.floor(hours / 24)} days ago`
}

const ago = (h: number) =>
  h === 0
    ? 'just now'
    : h < 1
      ? 'minutes ago'
      : h < 24
        ? `${Math.round(h)}h ago`
        : ''

export function Timeline({
  events,
  live,
  onOpenPatchSet,
}: {
  /** What has happened, read from the change. */
  events: Array<TimelineEvent>
  /** What happened on this page since it opened. */
  live: Array<TimelineEvent>
  onOpenPatchSet: (n: number, sinceLast: boolean) => void
}) {
  const all = [...live, ...events].sort((a, b) => a.hoursAgo - b.hoursAgo)
  const days: Array<{ label: string; items: Array<TimelineEvent> }> = []
  for (const e of all) {
    const label = dayLabel(e.hoursAgo)
    const last = days.at(-1)
    if (last?.label === label) last.items.push(e)
    else days.push({ label, items: [e] })
  }
  return (
    <div className="max-w-3xl space-y-6">
      {days.map((d) => (
        <section key={d.label} className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            {d.label}
          </h3>
          <ol className="rail space-y-4">
            {d.items.map((e, i) => {
              const Icon = icon[e.kind]
              return (
                <li key={i} className="relative pl-10">
                  <span
                    className={cn(
                      'absolute top-0 left-0 flex size-7 items-center justify-center rounded-full border bg-card',
                      e.tone && toneClass[e.tone],
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="flex items-start gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {e.actor === 'human' && (
                          <Tile
                            name={e.who}
                            round
                            className="size-5 text-[10px]"
                          />
                        )}
                        <b className="font-medium">{e.who}</b>
                        <span className="text-muted-foreground">{e.what}</span>
                        {e.actor !== 'human' && (
                          <Badge>{e.actor === 'agent' ? 'agent' : 'bot'}</Badge>
                        )}
                      </div>
                      {e.detail && (
                        <p className="mt-0.5 text-muted-foreground">
                          {e.detail}
                        </p>
                      )}
                      {e.patchSet && (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <button
                            type="button"
                            onClick={() => onOpenPatchSet(e.patchSet!, false)}
                            className="py-0.5 underline decoration-border underline-offset-4 hover:decoration-foreground"
                          >
                            View patch set {e.patchSet}
                          </button>
                          {e.patchSet > 1 && (
                            <button
                              type="button"
                              onClick={() => onOpenPatchSet(e.patchSet!, true)}
                              className="py-0.5 underline decoration-border underline-offset-4 hover:decoration-foreground"
                            >
                              Only what changed since {e.patchSet - 1}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                      {e.clock ?? ago(e.hoursAgo)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
