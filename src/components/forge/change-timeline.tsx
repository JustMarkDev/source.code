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
import type { ChangeItem } from '~/mock/platform'
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

/** "3 days ago" and "yesterday" as hours, for the mock's own dates. */
function hoursOf(when: string) {
  const w = when.toLowerCase()
  if (w.includes('yesterday')) return 24
  const n = Number(/\d+/.exec(w)?.[0] ?? 0)
  if (w.includes('hour')) return n
  if (w.includes('day')) return n * 24
  if (w.includes('week')) return n * 168
  return 0
}

/** The history of a change: what was pushed, said and run, newest first. */
export function timelineFor(change: ChangeItem): Array<TimelineEvent> {
  if (change.id === '216') {
    return [
      {
        kind: 'opened',
        who: 'dana',
        actor: 'human',
        what: 'opened this change from neg-cache',
        hoursAgo: 72,
        clock: '09:12',
      },
      {
        kind: 'patchset',
        who: 'dana',
        actor: 'human',
        what: 'pushed patch set 1',
        detail: 'Initial version',
        hoursAgo: 72,
        clock: '09:12',
        patchSet: 1,
      },
      {
        kind: 'mirror',
        who: 'source.code',
        actor: 'bot',
        what: 'opened GitHub #231',
        detail: 'Pushed to sx/216-cache-negative-ref-lookups',
        hoursAgo: 71.9,
        clock: '09:13',
      },
      {
        kind: 'ci',
        who: 'ci/test',
        actor: 'bot',
        what: 'passed on tree 41ac9e2',
        hoursAgo: 71.5,
        clock: '09:40',
        tone: 'success',
      },
      {
        kind: 'finding',
        who: 'coderabbit',
        actor: 'bot',
        what: 'left a medium finding',
        detail: 'F-1: Lookup takes the cache lock on every call',
        hoursAgo: 71,
        clock: '10:05',
        tone: 'warning',
      },
      {
        kind: 'finding',
        who: 'greptile',
        actor: 'bot',
        what: 'left a high finding',
        detail: 'F-2: NegCache is unbounded',
        hoursAgo: 71,
        clock: '10:06',
        tone: 'danger',
      },
      {
        kind: 'review',
        who: 'hollis',
        actor: 'human',
        what: 'asked for a rename',
        detail:
          'hit() reads like a boolean, contains() matches the rest of the file.',
        hoursAgo: 50,
        clock: '07:30',
        tone: 'danger',
      },
      {
        kind: 'mirror',
        who: 'source.code',
        actor: 'bot',
        what: 'showed that review on GitHub #231',
        detail: 'As a request for changes',
        hoursAgo: 50,
        clock: '07:30',
      },
      {
        kind: 'patchset',
        who: 'dana',
        actor: 'human',
        what: 'pushed patch set 2',
        detail: 'Address review: rename hit() to contains()',
        hoursAgo: 48,
        clock: '10:02',
        patchSet: 2,
      },
      {
        kind: 'review',
        who: 'hollis',
        actor: 'human',
        what: 'approved patch set 2',
        hoursAgo: 47,
        clock: '10:20',
        tone: 'success',
      },
      {
        kind: 'mirror',
        who: 'ines',
        actor: 'human',
        what: 'commented on GitHub #231',
        detail: 'Looks good to me. Could the bench be part of CI?',
        hoursAgo: 40,
        clock: '17:44',
      },
      {
        kind: 'patchset',
        who: 'dana',
        actor: 'human',
        what: 'rebased onto main: patch set 3',
        detail: 'Rebased onto main and renamed remember() to put()',
        hoursAgo: 30,
        clock: '04:11',
        patchSet: 3,
      },
      {
        kind: 'review',
        who: 'source.code',
        actor: 'bot',
        what: 'carried hollis’s approval to patch set 3',
        detail: 'Only one call was renamed. The rest of the diff is the same.',
        hoursAgo: 30,
        clock: '04:11',
        tone: 'success',
      },
      {
        kind: 'evidence',
        who: 'claude',
        actor: 'agent',
        what: 'attached a before and after, and a test run',
        detail: 'From an E2B sandbox, on tree 9c4d7e1',
        hoursAgo: 28,
        clock: '06:02',
      },
      {
        kind: 'ci',
        who: 'ci/test',
        actor: 'bot',
        what: 'started on tree 9c4d7e1',
        hoursAgo: 27,
        clock: '07:00',
      },
    ]
  }
  const events: Array<TimelineEvent> = change.patchSets.flatMap((p, i) => {
    const h = hoursOf(p.when)
    return [
      ...(i === 0
        ? [
            {
              kind: 'opened',
              who: change.author.name,
              actor: change.author.kind,
              what: 'opened this change',
              hoursAgo: h,
            } as const,
          ]
        : []),
      {
        kind: 'patchset',
        who: change.author.name,
        actor: change.author.kind,
        what: `pushed patch set ${p.n}`,
        detail: p.note,
        hoursAgo: h,
        patchSet: p.n,
      } as const,
    ]
  })
  if (change.mirror)
    events.push({
      kind: 'mirror',
      who: 'source.code',
      actor: 'bot',
      what:
        change.mirror.origin === 'here'
          ? `opened GitHub #${change.mirror.number}`
          : `imported GitHub #${change.mirror.number}`,
      hoursAgo: hoursOf(change.patchSets[0].when),
    })
  return events
}

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
  change,
  live,
  onOpenPatchSet,
}: {
  change: ChangeItem
  live: Array<TimelineEvent>
  onOpenPatchSet: (n: number, sinceLast: boolean) => void
}) {
  const all = [...live, ...timelineFor(change)].sort(
    (a, b) => a.hoursAgo - b.hoursAgo,
  )
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
