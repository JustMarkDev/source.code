import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { CopyField } from './repo-shell'
import { LangDot, Tile } from './bits'
import type { BadgeTone } from '~/components/ui/badge'
import type {
  ActivityKind,
  DashboardData,
  Severity,
} from '~/lib/model/dashboard'
import { BrandLogo } from '~/components/brand'
import { TrendChart } from '~/components/charts'
import { Sparkline } from '~/components/dither-kit'
import { Stagger } from '~/components/motion'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Segmented } from '~/components/ui/tabs'
import { compact } from '~/lib/model/data'

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function Heading({
  id,
  title,
  count,
  children,
}: {
  id: string
  title: string
  count?: number
  children?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        {count !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {children}
    </div>
  )
}

/** "+18%" in green when up, quiet when down. A change is never alarming on its own. */
function Delta({ value }: { value: number }) {
  return (
    <Badge tone={value >= 0 ? 'success' : 'muted'}>
      {value >= 0 ? '+' : ''}
      {value}%
    </Badge>
  )
}

function Stat({
  label,
  value,
  context,
  badge,
  dot,
  spark,
}: {
  label: string
  value: React.ReactNode
  context: React.ReactNode
  badge?: React.ReactNode
  dot?: string
  spark?: React.ReactNode
}) {
  return (
    <div className="space-y-1.5 bg-card px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        {dot && <span className={cn('size-2 rounded-full', dot)} />}
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {badge}
      </div>
      <div className="text-xs text-muted-foreground">{context}</div>
      {spark && <div className="h-8 pt-1">{spark}</div>}
    </div>
  )
}

/** Four numbers that answer "how are things" before anything is read. */
export function SummaryStrip({ data }: { data: DashboardData }) {
  const health = Object.values(data.health).filter((h) => h !== undefined)
  const failing = health.filter((h) => h.checks === 'failing').length
  const changes = health.reduce((n, h) => n + h.openChanges, 0)
  const waitingOnYou = data.needsYou.filter(
    (n) => n.severity === 'review',
  ).length
  return (
    <div className="surface grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      <Stat
        label="Open changes"
        value={changes}
        context={`${waitingOnYou} waiting on you, ${data.inProgress.length} in progress`}
      />
      <Stat
        label="Checks on main"
        value={failing > 0 ? `${failing} failing` : 'All passing'}
        dot={failing > 0 ? 'bg-danger' : 'bg-success'}
        context={`${health.length - failing} of ${health.length} ${health.length === 1 ? 'repository is' : 'repositories are'} green`}
      />
      <Stat
        label="Downloads, 30 days"
        value={compact(data.downloads.total)}
        badge={<Delta value={data.downloads.change} />}
        context="Across all releases"
        spark={
          <Sparkline data={data.downloads.daily} color="green" bloom="low" />
        }
      />
      <Stat
        label="Stars"
        value={compact(data.stars.total)}
        context={`${data.stars.today} new today`}
      />
    </div>
  )
}

const severity: Record<Severity, { label: string; tone: BadgeTone }> = {
  stopped: { label: 'Stopped', tone: 'danger' },
  failing: { label: 'Failing', tone: 'warning' },
  review: { label: 'Review', tone: 'merged' },
  assigned: { label: 'Assigned', tone: 'info' },
}

/** What needs a decision, most costly first. Only the first action is lime. */
export function NeedsYou({ data }: { data: DashboardData }) {
  const items = data.needsYou
  return (
    <section aria-labelledby="needs">
      <Heading id="needs" title="Needs you" count={items.length} />
      {items.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing needs a decision. New reviews, failures and assignments appear
          here first.
        </p>
      )}
      <Stagger
        as="ul"
        className="divide-y rounded-xl border bg-card empty:hidden"
      >
        {items.map((q, i) => (
          <li key={q.title} className="flex items-start gap-4 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severity[q.severity].tone}>
                  {severity[q.severity].label}
                </Badge>
                <span className="text-sm font-medium">{q.title}</span>
              </div>
              <p className="text-sm text-muted-foreground">{q.note}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {q.where} · {q.age}
              </p>
            </div>
            <Button
              size="sm"
              variant={i === 0 ? 'brand' : 'outline'}
              render={<Link {...q.link} />}
              nativeButton={false}
              className="shrink-0"
            >
              {q.action}
            </Button>
          </li>
        ))}
      </Stagger>
    </section>
  )
}

/** Work moving without you. No decision is asked of the reader here. */
export function InProgress({ data }: { data: DashboardData }) {
  if (data.inProgress.length === 0) return null
  return (
    <section aria-labelledby="progress">
      <Heading id="progress" title="In progress" count={data.inProgress.length}>
        <span className="text-xs text-muted-foreground">
          Nothing here needs you yet
        </span>
      </Heading>
      <ul className="divide-y rounded-xl border bg-card">
        {data.inProgress.map((p) => (
          <li key={p.title}>
            <Link
              {...p.link}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{p.where}</span>
                  <span className="mx-1.5">·</span>
                  {p.detail}
                </div>
              </div>
              <Badge tone={p.tone}>{p.status}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const filters: Array<['all' | ActivityKind, string]> = [
  ['all', 'All'],
  ['review', 'Reviews'],
  ['agent', 'Agents'],
  ['release', 'Releases'],
]

export function ActivityFeed({ data }: { data: DashboardData }) {
  const [filter, setFilter] = React.useState<'all' | ActivityKind>('all')
  const shown = data.activity.filter(
    (a) => filter === 'all' || a.kind === filter,
  )
  const days = [...new Set(shown.map((a) => a.day))]
  if (data.activity.length === 0) return null
  return (
    <section aria-labelledby="recent">
      <Heading id="recent" title="Recent activity">
        <Segmented
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          options={filters}
        />
      </Heading>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing of this kind yet.
        </p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day} className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                {day}
              </h3>
              <ul className="space-y-3 text-sm">
                {shown
                  .filter((a) => a.day === day)
                  .map((a) => (
                    <li
                      key={`${a.who}${a.what}${a.did}`}
                      className="flex gap-3"
                    >
                      <Tile name={a.who} round className="size-6 text-xs" />
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        <b className="font-medium text-foreground">{a.who}</b>{' '}
                        {a.did}{' '}
                        <span className="font-mono text-xs text-foreground">
                          {a.what}
                        </span>
                        {a.where && <> in {a.where}</>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {a.when}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Repositories({ data }: { data: DashboardData }) {
  return (
    <section aria-labelledby="repos">
      <Heading id="repos" title="Repositories" count={data.repos.length}>
        <Button
          size="sm"
          variant="ghost"
          render={<Link to="/new" />}
          nativeButton={false}
        >
          <PlusIcon /> New
        </Button>
      </Heading>
      <ul className="-mx-2">
        {data.repos.map((r) => {
          const h = data.health[r.name]
          return (
            <li key={r.name}>
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: r.owner, repo: r.name, tab: 'code' }}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted"
              >
                <Tile name={r.name} className="size-9 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">
                    {r.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <LangDot language={r.language} /> · {compact(r.stars)} stars
                  </span>
                </span>
                {h && (
                  <span className="shrink-0 text-right text-xs">
                    <span
                      className={cn(
                        'block font-medium',
                        h.checks === 'failing'
                          ? 'text-danger'
                          : 'text-muted-foreground',
                      )}
                    >
                      {h.checks === 'failing' ? 'Checks failing' : 'Passing'}
                    </span>
                    <span className="block text-muted-foreground tabular-nums">
                      {plural(h.openChanges, 'change')} ·{' '}
                      {plural(h.openIssues, 'issue')}
                    </span>
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Is everything safe: how full the storage is and whether each mirror is syncing. */
export function History({
  data,
  organization,
}: {
  data: DashboardData
  organization: boolean
}) {
  const pct = Math.round((data.storage.usedGb / data.storage.limitGb) * 100)
  return (
    <section aria-labelledby="safe">
      <Heading id="safe" title={organization ? 'History' : 'Your history'}>
        {!organization && (
          <Link
            to="/settings/$section"
            params={{ section: 'accounts' }}
            className="-my-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Linked accounts
          </Link>
        )}
      </Heading>
      <div className="space-y-4 rounded-xl border bg-card p-4 text-sm">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">Stored here</span>
            <span className="text-muted-foreground tabular-nums">
              {data.storage.usedGb} of {data.storage.limitGb} GB
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Storage used"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Commits, issues, reviews and releases.
          </p>
        </div>
        {data.mirrors.length > 0 ? (
          <ul className="divide-y border-t">
            {data.mirrors.map((m) => (
              <li key={m.host} className="flex items-center gap-3 py-2.5">
                <BrandLogo id={m.host} className="size-4" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div
                    className={cn(
                      'text-xs',
                      m.state === 'stopped'
                        ? 'text-danger'
                        : 'text-muted-foreground',
                    )}
                  >
                    {m.note}
                  </div>
                </div>
                {m.state === 'stopped' ? (
                  <Button
                    size="sm"
                    render={
                      <Link
                        to="/$handle/$repo/$tab"
                        params={{
                          handle: 'dana',
                          repo: 'gitfs',
                          tab: 'settings',
                        }}
                        search={{ section: 'mirrors' }}
                      />
                    }
                    nativeButton={false}
                  >
                    Reconnect
                  </Button>
                ) : (
                  <span className="size-2 rounded-full bg-success" />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            No mirrors. Everything lives here, and nothing depends on another
            host.
          </p>
        )}
        {data.imported > 0 && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            <b className="font-medium text-foreground tabular-nums">
              {data.imported.toLocaleString('en-US')}
            </b>{' '}
            past contributions from other hosts are on your profile.
          </p>
        )}
      </div>
    </section>
  )
}

export function LastWeeks({ data }: { data: DashboardData }) {
  const contributions = data.contributions
  const parts: Array<[string, number]> = [
    ['Commits', contributions.commits],
    ['Reviews', contributions.reviews],
    ['Changes', contributions.changes],
  ]
  return (
    <section aria-labelledby="week" className="space-y-3">
      <Heading id="week" title="Last 4 weeks">
        <Delta value={contributions.change} />
      </Heading>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {contributions.total}
        </span>
        <span className="text-sm text-muted-foreground">contributions</span>
      </div>
      <div className="h-24">
        <TrendChart
          data={contributions.daily}
          axes={false}
          unit="Contributions"
        />
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
        {parts.map(([label, n]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Compared with the 4 weeks before.
        {data.imported > 0 && ' Includes work imported from other hosts.'}
      </p>
    </section>
  )
}

/** What a brand-new account sees instead of empty charts: the next few things worth doing. */
export function GettingStarted({
  account,
}: {
  account: { kind: 'person' | 'organization'; handle: string; name: string }
}) {
  const org = account.kind === 'organization'
  const steps: Array<{
    title: string
    body: string
    action: React.ReactNode
  }> = [
    {
      title: org
        ? 'Create or import its first repository'
        : 'Create or import a repository',
      body: org
        ? `Repositories you create here belong to ${account.name}, not to you.`
        : 'Start something new, or bring a project and its history from GitHub, GitLab, Codeberg or Gitea.',
      action: (
        <Button
          variant="brand"
          render={<Link to="/new" />}
          nativeButton={false}
        >
          <PlusIcon /> New repository
        </Button>
      ),
    },
    org
      ? {
          title: 'Invite your team',
          body: 'People join with a role. Owners manage everything, admins manage people, members work in the repositories.',
          action: (
            <Button
              render={
                <Link
                  to="/organizations/$handle/$section"
                  params={{ handle: account.handle, section: 'members' }}
                />
              }
              nativeButton={false}
            >
              Invite people
            </Button>
          ),
        }
      : {
          title: 'Install the CLI',
          body: 'It never asks a question and every command speaks JSON, so scripts and agents can use it.',
          action: <CopyField value="bun add -g @source-code/cli" />,
        },
    org
      ? {
          title: 'Act as it from the CLI',
          body: 'One login, any account. Switch once and every sx command works as the organization.',
          action: <CopyField value={`sx account switch ${account.handle}`} />,
        }
      : {
          title: 'Teach your agents',
          body: 'One command makes any coding agent fluent in sx, with scoped access and no secret values.',
          action: <CopyField value="sx skill install" />,
        },
  ]
  if (!org)
    steps.push({
      title: 'Work for a company or a team?',
      body: 'Make an organization. It owns its repositories, so they stay with the team when people come and go.',
      action: (
        <Button render={<Link to="/organizations/new" />} nativeButton={false}>
          New organization
        </Button>
      ),
    })
  return (
    <section aria-labelledby="start">
      <Heading id="start" title="Get started" />
      <ol className="divide-y rounded-xl border bg-card">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 basis-64 space-y-0.5">
              <div className="text-sm font-medium">{step.title}</div>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
            <div className="w-full sm:w-80">{step.action}</div>
          </li>
        ))}
      </ol>
    </section>
  )
}
