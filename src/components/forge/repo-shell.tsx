import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  CheckIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ExclamationCircleIcon,
  RocketLaunchIcon,
  StarIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import * as m from 'motion/react-m'
import { useSignInGate } from './auth'
import { Avatar } from './bits'
import type { Repo } from '~/mock/data'
import { GitCommitIcon, GitForkIcon, GitMergeIcon } from '~/components/icons'
import { PageTransition } from '~/components/motion'
import { LinkTabs } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { useDirectoryLookups } from '~/lib/auth/accounts'
import { compact, languageColors, seeded } from '~/mock/data'

export type RepoPage =
  | 'code'
  | 'issues'
  | 'pulls'
  | 'pipelines'
  | 'release'
  | 'insights'
  | 'settings'

/** Page id -> URL segment. */
export const tabSlug: Record<RepoPage, string> = {
  code: 'code',
  issues: 'issues',
  pulls: 'changes',
  pipelines: 'pipelines',
  release: 'releases',
  insights: 'insights',
  settings: 'settings',
}

const tabs: Array<[RepoPage, string]> = [
  ['code', 'Code'],
  ['issues', 'Issues'],
  ['pulls', 'Changes'],
  ['pipelines', 'Pipelines'],
  ['release', 'Releases'],
  ['insights', 'Insights'],
  ['settings', 'Settings'],
]

export const slugOf = (r: Repo) => `${r.owner}/${r.name}`

export function CopyField({
  value,
  className,
  prefix = '$',
}: {
  value: string
  className?: string
  prefix?: string
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-background py-1 pr-1 pl-3 font-mono text-xs',
        className,
      )}
    >
      {prefix && (
        <span className="text-muted-foreground select-none">{prefix}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-success" />
        ) : (
          <ClipboardDocumentIcon className="size-3.5" />
        )}
      </button>
    </div>
  )
}

type CountsApi = { setCounts: (c: Partial<Record<RepoPage, number>>) => void }
const FrameContext = React.createContext<CountsApi | null>(null)

/**
 * The repository chrome: header, tabs and page-level actions. It lives above
 * the tab pages so switching tabs only swaps the content below it. Nothing in
 * the header remounts, which keeps its state (Star) and lets the tab pill glide.
 */
export function RepoFrame({
  repo,
  active,
  counts,
  actions,
  children,
}: {
  repo: Repo
  active: RepoPage
  counts?: Partial<Record<RepoPage, number>>
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [live, setCounts] = React.useState<Partial<Record<RepoPage, number>>>(
    {},
  )
  const api = React.useMemo(() => ({ setCounts }), [])
  return (
    <FrameContext value={api}>
      <RepoHeader
        repo={repo}
        active={active}
        counts={{ ...counts, ...live }}
        actions={actions}
      />
      <PageTransition trigger={active}>{children}</PageTransition>
    </FrameContext>
  )
}

/** Let a page report a live count (open issues) to the tabs above it. */
export function useRepoCounts(counts: Partial<Record<RepoPage, number>>) {
  const api = React.use(FrameContext)
  const key = JSON.stringify(counts)
  React.useEffect(() => {
    api?.setCounts(JSON.parse(key) as Partial<Record<RepoPage, number>>)
  }, [api, key])
}

export function RepoHeader({
  repo,
  active,
  counts,
  actions,
}: {
  repo: Repo
  active: RepoPage
  counts?: Partial<Record<RepoPage, number>>
  /** Page-level controls, shown on the right of the tab row. */
  actions?: React.ReactNode
}) {
  const [starred, setStarred] = React.useState(false)
  const gate = useSignInGate()
  const { canManage, nameOf } = useDirectoryLookups()
  // Settings belong to whoever manages the account that owns it: the person,
  // or an owner or admin of the organization. Everyone else sees the public tabs.
  const mine = canManage(repo.owner)
  const numbers: Partial<Record<RepoPage, number>> = { ...counts }
  return (
    <header className="mb-5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar handle={repo.owner} className="size-9 text-sm" />
          <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xl leading-tight font-semibold tracking-tight">
            <Link
              to="/$handle"
              params={{ handle: repo.owner }}
              className="font-normal text-muted-foreground hover:text-foreground"
            >
              {nameOf(repo.owner)}
            </Link>
            <span aria-hidden className="font-normal text-muted-foreground/50">
              /
            </span>
            {repo.name}
            <Badge tone="outline">Public</Badge>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => gate()}>
            <GitForkIcon /> Fork
            <span className="text-muted-foreground tabular-nums">
              {compact(repo.forks)}
            </span>
          </Button>
          <Button
            size="sm"
            aria-pressed={starred}
            onClick={() => gate(() => setStarred((s) => !s))}
          >
            <m.span
              key={String(starred)}
              initial={starred ? { scale: 0.5, rotate: -30 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 14 }}
              className="inline-flex"
            >
              <StarIcon
                className={cn(starred && 'fill-brand text-brand-ink')}
              />
            </m.span>
            {starred ? 'Starred' : 'Star'}
            <span className="text-muted-foreground tabular-nums">
              {compact(repo.stars + (starred ? 1 : 0))}
            </span>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 max-sm:flex-col max-sm:items-stretch">
        <LinkTabs
          className="max-sm:order-2 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]"
          label="Repository"
          tabs={tabs
            .filter(([id]) => id !== 'settings' || mine)
            .map(([id, label]) => ({
              label,
              count: numbers[id],
              active: id === active,
              link: {
                to: '/$handle/$repo/$tab',
                params: {
                  handle: repo.owner,
                  repo: repo.name,
                  tab: tabSlug[id],
                },
              },
            }))}
        />
        {actions && (
          <div className="flex flex-wrap items-center gap-2 max-sm:order-1">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

export function Languages({ repo }: { repo: Repo }) {
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {repo.languages.map(([l, pct]) => (
          <span
            key={l}
            title={`${l} ${pct}%`}
            style={{
              width: `${pct}%`,
              background: languageColors[l] ?? '#71717a',
            }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {repo.languages.map(([l, pct]) => (
          <li key={l} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ background: languageColors[l] ?? '#71717a' }}
            />
            <span className="font-medium">{l}</span>
            <span className="text-muted-foreground tabular-nums">{pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const LEVELS = [
  'bg-muted',
  'bg-brand/25',
  'bg-brand/50',
  'bg-brand/80',
  'bg-brand',
]

/** Contribution heatmap. Totals are merged across everything linked to the account. */
export function ContributionGraph({
  seed,
  weeks = 26,
  className,
}: {
  seed: number
  weeks?: number
  className?: string
}) {
  const cells = React.useMemo(() => {
    const rand = seeded(seed)
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const burst = Math.sin(i / 23) + Math.sin(i / 7) * 0.5
      return rand() + burst * 0.18 > 0.55
        ? Math.min(4, Math.ceil(rand() * 4))
        : 0
    })
  }, [seed, weeks])
  return (
    <div className={className}>
      <div
        className="grid grid-flow-col grid-rows-7 gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
        role="img"
        aria-label="Contribution activity"
      >
        {cells.map((level, i) => (
          <span
            key={i}
            className={cn('aspect-square rounded-[2px]', LEVELS[level])}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        Less
        {LEVELS.map((l) => (
          <span key={l} className={cn('size-2.5 rounded-[2px]', l)} />
        ))}
        More
      </div>
    </div>
  )
}

type TimelineEvent = {
  kind: 'commit' | 'release' | 'pr' | 'issue'
  title: string
  when: string
  ref: string
}

const kindIcon = {
  commit: GitCommitIcon,
  release: RocketLaunchIcon,
  pr: GitMergeIcon,
  issue: ExclamationCircleIcon,
} as const

/** Commit rail: one history for the project, newest first. */
export function Timeline({ repo }: { repo: Repo }) {
  const latest = repo.releases.at(0)
  const events: Array<TimelineEvent> = [
    ...(latest
      ? [
          {
            kind: 'release',
            title: `Released ${latest.version}: ${latest.title}`,
            when: latest.date,
            ref: latest.version,
          } as const,
        ]
      : []),
    {
      kind: 'commit',
      title: 'Cache negative ref lookups',
      when: '2 days ago',
      ref: 'a41c9e2',
    },
    {
      kind: 'pr',
      title: 'Merged #214: Add a read-only mount mode',
      when: '4 days ago',
      ref: '#214',
    },
    {
      kind: 'commit',
      title: 'Memory-map pack index reads',
      when: '6 days ago',
      ref: '7be03d1',
    },
    {
      kind: 'issue',
      title: 'Closed #198: Panic on trailing-dot ref names',
      when: '9 days ago',
      ref: '#198',
    },
    {
      kind: 'commit',
      title: 'Document S3 retry behaviour',
      when: '12 days ago',
      ref: 'f02a8c6',
    },
  ]
  return (
    <ol className="rail space-y-5">
      {events.map((e, i) => {
        const Icon = kindIcon[e.kind]
        return (
          <li key={i} className="relative pl-9">
            <span className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border bg-card">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="text-sm">{e.title}</div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3" />
                {e.when}
              </span>
              <span className="font-mono">{e.ref}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
