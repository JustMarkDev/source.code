import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { LinkProps } from '@tanstack/react-router'
import type { ProfileTab } from '~/components/forge/profile-view'
import { LangDot, Tile } from '~/components/forge/bits'
import { ProfileView, profileTabs } from '~/components/forge/profile-view'
import { TrendChart } from '~/components/charts'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Segmented } from '~/components/ui/tabs'
import { compact, repos, seeded } from '~/mock/data'

type Search = { view?: 'profile'; tab?: ProfileTab }

export const Route = createFileRoute('/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: s.view === 'profile' ? 'profile' : undefined,
    tab: profileTabs.find(([id]) => id === s.tab)?.[0],
  }),
  component: Dashboard,
})

type Item = {
  tone: 'brand' | 'warning' | 'danger' | 'info'
  title: string
  where: string
  note: string
  action: string
  link: LinkProps
}

const queue: Array<Item> = [
  {
    tone: 'brand',
    title: 'Review: Cache negative ref lookups',
    where: 'dana/gitfs · ch_7f3a',
    note: 'hollis approved. Greptile found 1 high-severity issue.',
    action: 'Open change',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'changes' },
      search: { n: 1 },
    },
  },
  {
    tone: 'danger',
    title: 'Mirror to GitLab stopped',
    where: 'dana/gitfs',
    note: 'The access token expired. 14 commits are waiting here, nothing lost.',
    action: 'Reconnect',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'settings' },
      search: { section: 'mirrors' },
    },
  },
  {
    tone: 'warning',
    title: 'Checks are failing on main',
    where: 'dana/gitfs · ci/test',
    note: 'windows-latest, since 2 hours ago.',
    action: 'See the run',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'actions' },
    },
  },
  {
    tone: 'info',
    title: 'Assigned: Panic on trailing-dot ref names',
    where: 'dana/gitfs · issue 4',
    note: 'An agent could take this one.',
    action: 'Open issue',
    link: {
      to: '/$handle/$repo/$tab',
      params: { handle: 'dana', repo: 'gitfs', tab: 'issues' },
      search: { n: 4 },
    },
  },
]

const dot = {
  brand: 'bg-brand',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
} as const

const recent = [
  ['hollis', 'approved', 'ch_7f3a', 'dana/gitfs', '1 hour ago'],
  [
    'claude via T3 Code',
    'opened a draft',
    'ch_81b2',
    'dana/gitfs',
    '3 hours ago',
  ],
  ['ines', 'starred', 'dana/gitfs', '', 'yesterday'],
  ['kofi', 'released', 'v0.9.1', 'kofi/spindle', 'yesterday'],
  ['mira', 'opened an issue on', 'dana/tern', '', '2 days ago'],
] as const

function DashboardView() {
  const mine = repos.filter((r) => r.owner === 'dana')
  const rand = seeded(42)
  const week = Array.from({ length: 28 }, (_, i) => ({
    label: `Day ${i + 1}`,
    value: Math.round(4 + rand() * 18 + Math.sin(i / 3) * 6 + i * 0.3),
  }))

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-12">
          <section aria-labelledby="needs">
            <h2 id="needs" className="mb-3 text-sm font-medium">
              Needs you
            </h2>
            <ul className="divide-y rounded-xl border bg-card">
              {queue.map((q) => (
                <li
                  key={q.title}
                  className="flex items-center gap-4 px-4 py-3.5"
                >
                  <span
                    className={cn('size-2 shrink-0 rounded-full', dot[q.tone])}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {q.title}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      <span className="font-mono text-xs">{q.where}</span>
                      <span className="mx-1.5">·</span>
                      {q.note}
                    </div>
                  </div>
                  <Link
                    {...q.link}
                    className="shrink-0 text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
                  >
                    {q.action}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="recent">
            <h2 id="recent" className="mb-3 text-sm font-medium">
              Recent activity
            </h2>
            <ul className="space-y-3 text-sm">
              {recent.map(([who, did, what, where, when]) => (
                <li key={`${who}${what}`} className="flex gap-3">
                  <Tile name={who} round className="size-6 text-[10px]" />
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    <b className="font-medium text-foreground">{who}</b> {did}{' '}
                    <span className="font-mono text-xs text-foreground">
                      {what}
                    </span>
                    {where && <> in {where}</>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {when}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-10">
          <section aria-labelledby="repos">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="repos" className="text-sm font-medium">
                Your repositories
              </h2>
              <Button
                size="sm"
                variant="ghost"
                render={<Link to="/new" />}
                nativeButton={false}
              >
                <PlusIcon /> New
              </Button>
            </div>
            <ul className="-mx-2">
              {mine.map((r) => (
                <li key={r.name}>
                  <Link
                    to="/$handle/$repo/$tab"
                    params={{ handle: r.owner, repo: r.name, tab: 'code' }}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                  >
                    <Tile name={r.name} className="size-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm">
                        {r.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <LangDot language={r.language} /> · {compact(r.stars)}{' '}
                        stars
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="safe" className="space-y-3">
            <h2 id="safe" className="text-sm font-medium">
              Your history
            </h2>
            <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
              <div className="flex items-start gap-2.5">
                <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
                <p>
                  Everything is stored here: commits, issues, reviews and
                  releases.
                </p>
              </div>
              <div className="flex items-start gap-2.5 text-muted-foreground">
                <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>
                  3 mirrors, <b className="text-foreground">1</b> needs
                  attention.
                </p>
              </div>
              <div className="flex items-start gap-2.5 text-muted-foreground">
                <ArrowPathIcon className="mt-0.5 size-4 shrink-0" />
                <p>2,410 past contributions are on your profile.</p>
              </div>
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: 'dana', repo: 'gitfs', tab: 'settings' }}
                search={{ section: 'mirrors' }}
                className="inline-block text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                Manage mirrors
              </Link>
            </div>
          </section>

          <section aria-labelledby="week" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="week" className="text-sm font-medium">
                Your last 4 weeks
              </h2>
              <Badge>All hosts</Badge>
            </div>
            <div className="h-28">
              <TrendChart data={week} axes={false} unit="Contributions" />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Dashboard() {
  const { view = 'dashboard', tab = 'overview' } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {view === 'profile' ? 'Your public profile' : 'Good morning, Dana'}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {view === 'profile'
              ? 'This is exactly what other people see.'
              : `${queue.length} things need you today.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {view === 'profile' && (
            <Link
              to="/$handle"
              params={{ handle: 'dana' }}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Open as a visitor
            </Link>
          )}
          <Segmented
            label="View"
            value={view}
            onChange={(v) =>
              void navigate({
                search: v === 'profile' ? { view: 'profile' } : {},
              })
            }
            options={[
              ['dashboard', 'Dashboard'],
              ['profile', 'Public profile'],
            ]}
          />
        </div>
      </header>

      {view === 'dashboard' ? (
        <DashboardView />
      ) : (
        <ProfileView
          handle="dana"
          tab={tab}
          tabLink={(id) => ({
            to: '/dashboard',
            search:
              id === 'overview'
                ? { view: 'profile' }
                : { view: 'profile', tab: id },
          })}
        />
      )}
    </div>
  )
}
