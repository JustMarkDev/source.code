import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  ExclamationCircleIcon,
  LinkIcon,
  RocketLaunchIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { BadgeTone } from '~/components/ui/badge'
import type { Notification } from '~/mock/extra'
import { RequireAuth } from '~/components/forge/auth'
import { Stagger } from '~/components/motion'
import { GitMergeIcon } from '~/components/icons'
import { EmptyState } from '~/components/forge/bits'
import { Segmented } from '~/components/ui/tabs'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { notifications } from '~/mock/extra'

export const Route = createFileRoute('/inbox')({
  head: () => ({ meta: [{ title: 'Inbox · source.code' }] }),
  component: () => (
    <RequireAuth>
      <Inbox />
    </RequireAuth>
  ),
})

const icons = {
  review: GitMergeIcon,
  mention: ChatBubbleLeftIcon,
  release: RocketLaunchIcon,
  ci: XCircleIcon,
  issue: ExclamationCircleIcon,
  import: LinkIcon,
} as const

/** What each kind of item is, in words. The ones that ask something of you are coloured. */
const kinds: Record<Notification['kind'], { label: string; tone: BadgeTone }> =
  {
    review: { label: 'Review', tone: 'merged' },
    ci: { label: 'Failed', tone: 'danger' },
    issue: { label: 'Assigned', tone: 'info' },
    mention: { label: 'Mention', tone: 'muted' },
    release: { label: 'Release', tone: 'muted' },
    import: { label: 'Import', tone: 'muted' },
  }

const filters = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['review', 'Reviews'],
  ['release', 'Releases'],
] as const

function Inbox() {
  const [items, setItems] = React.useState<Array<Notification>>(notifications)
  const [filter, setFilter] = React.useState<(typeof filters)[number][0]>('all')
  const unread = items.filter((n) => n.unread).length
  const shown = items.filter(
    (n) =>
      filter === 'all' || (filter === 'unread' ? n.unread : n.kind === filter),
  )
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0}
          onClick={() =>
            setItems((all) => all.map((n) => ({ ...n, unread: false })))
          }
        >
          Mark all as read
        </Button>
      </div>
      <div className="mb-4">
        <Segmented
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={filters.map(([id, label]): [typeof id, string] => [
            id,
            id === 'unread' && unread > 0 ? `${label} ${unread}` : label,
          ])}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="You are all caught up">
          Nothing here right now.
        </EmptyState>
      ) : (
        <Stagger
          as="ul"
          className="surface divide-y overflow-hidden rounded-2xl border bg-card"
        >
          {shown.map((n) => {
            const Icon = icons[n.kind]
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() =>
                    setItems((all) =>
                      all.map((x) =>
                        x.id === n.id ? { ...x, unread: false } : x,
                      ),
                    )
                  }
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    {n.unread && (
                      <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-card" />
                    )}
                    <Icon className="size-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn('block text-sm', n.unread && 'font-medium')}
                    >
                      {n.unread && <span className="sr-only">Unread: </span>}
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {n.repo}, {n.when}
                    </span>
                  </span>
                  <Badge
                    tone={kinds[n.kind].tone}
                    className="shrink-0 self-center"
                  >
                    {kinds[n.kind].label}
                  </Badge>
                </button>
              </li>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}
