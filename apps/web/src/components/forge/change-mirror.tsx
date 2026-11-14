import { Link } from '@tanstack/react-router'
import {
  ArrowsRightLeftIcon,
  CheckIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Panel } from './bits'
import type { Repo } from '~/lib/model/data'
import type { ChangeItem } from '~/lib/model/platform'
import {
  branchFor,
  compatibility,
  hostName,
  hostTerms,
} from '~/lib/change-sync'

/**
 * Where a change lives on another host, and what of it travels. A host only
 * sees what it has a place for. The rest is shown here as native, so nobody
 * expects it to appear on the other side.
 */
export function MirrorCard({
  repo,
  change,
}: {
  repo: Repo
  change: ChangeItem
}) {
  const m = change.mirror
  if (!m) {
    return (
      <Panel className="space-y-2 p-4 text-sm">
        <h3 className="font-medium">Not mirrored</h3>
        <p className="text-muted-foreground">
          This change exists only on source.code. Add a two-way mirror to open a
          pull request for it on another host.
        </p>
        <Link
          to="/$handle/$repo/$tab"
          params={{ handle: repo.owner, repo: repo.name, tab: 'settings' }}
          search={{ section: 'mirrors' }}
          className="inline-block py-0.5 text-xs underline underline-offset-4"
        >
          Mirrors and sync
        </Link>
      </Panel>
    )
  }
  const terms = hostTerms[m.host]
  const fit = compatibility(m.host)
  const latest = change.patchSets.at(-1)
  return (
    <Panel className="divide-y overflow-hidden text-sm">
      <div className="space-y-1.5 p-4">
        <div className="flex items-center gap-2">
          <ArrowsRightLeftIcon className="size-4 text-muted-foreground" />
          <h3 className="font-medium">
            {hostName[m.host]} {terms.ref(m.number)}
          </h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {m.origin === 'here'
              ? 'Opened here'
              : `Opened on ${hostName[m.host]}`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Change #{change.id} is {terms.unit === 'merge request' ? 'a' : 'a'}{' '}
          {terms.unit} here. Each patch set is a push to{' '}
          <code className="font-mono">
            {branchFor(Number(change.id), change.title)}
          </code>
          {latest && (
            <>
              , now at <code className="font-mono">{latest.tree}</code>
            </>
          )}
          .
        </p>
      </div>

      <Group
        title="Travels both ways"
        icon={<CheckIcon className="size-3.5 text-success" />}
        rows={fit.syncs.map((f) => ({ id: f.id, label: f.label }))}
      />
      {fit.partial.length > 0 && (
        <Group
          title="Travels in part"
          icon={<span className="size-1.5 rounded-full bg-warning" />}
          rows={fit.partial.map((f) => ({
            id: f.id,
            label: f.label,
            note: f.note,
          }))}
        />
      )}
      <Group
        title={`Stays on source.code`}
        icon={<LockClosedIcon className="size-3.5 text-muted-foreground" />}
        rows={fit.native.map((f) => ({ id: f.id, label: f.label }))}
      />
    </Panel>
  )
}

function Group({
  title,
  icon,
  rows,
}: {
  title: string
  icon: React.ReactNode
  rows: Array<{ id: string; label: string; note?: string }>
}) {
  return (
    <details className="group px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="flex size-4 items-center justify-center">{icon}</span>
        {title}
        <span className="tabular-nums">{rows.length}</span>
        <span className="ml-auto transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ul className="mt-2.5 space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <div>{r.label}</div>
            {r.note && (
              <div className="text-xs text-muted-foreground">{r.note}</div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

const stateChip = {
  open: ['Open', 'success'],
  draft: ['Draft', 'muted'],
  landed: ['Landed', 'merged'],
  abandoned: ['Abandoned', 'muted'],
} as const

/**
 * The changes stacked together, bottom first. The bottom one lands first, and
 * the others are rebased onto it. On a host the same stack is a chain of
 * requests, so each row also shows the request it maps to.
 */
export function StackCard({
  repo,
  change,
  all,
}: {
  repo: Repo
  change: ChangeItem
  all: Array<ChangeItem>
}) {
  if (!change.stack) return null
  const members = all
    .filter((c) =>
      change.stackId
        ? c.stackId === change.stackId
        : c.stack?.of === change.stack?.of,
    )
    .sort((a, b) => (a.stack?.index ?? 0) - (b.stack?.index ?? 0))
  return (
    <Panel className="overflow-hidden text-sm">
      <div className="flex items-baseline justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
        <h3 className="font-medium">Stack of {members.length}</h3>
        <span className="text-xs text-muted-foreground">
          Lands in order, bottom first
        </span>
      </div>
      <ol className="divide-y">
        {members.map((m) => {
          const here = m.id === change.id
          const [label, tone] = stateChip[m.state]
          return (
            <li key={m.id}>
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
                search={{ n: Number(m.id) }}
                aria-current={here ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50',
                  here && 'bg-muted/60',
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-[10px] tabular-nums">
                  {m.stack?.index}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  #{m.id}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    here && 'font-medium',
                  )}
                >
                  {m.title}
                </span>
                {m.mirror && (
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                    {hostTerms[m.mirror.host].ref(m.mirror.number)}
                  </span>
                )}
                <Chip tone={tone}>{label}</Chip>
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
