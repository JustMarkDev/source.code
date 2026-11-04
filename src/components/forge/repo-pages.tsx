import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, EmptyState, Panel, SectionLabel, Seg, Tile } from './bits'
import { slugOf, useRepoCounts } from './repo-shell'
import { WorkWithAgent } from './work-with-agent'
import type { Repo } from '~/mock/data'
import type { Issue, Run } from '~/mock/extra'
import { compact, latestStable } from '~/mock/data'
import {
  contributorsFor,
  downloadsSeries,
  issuesFor,
  jobs,
  labelStyle,
  runs,
} from '~/mock/extra'
import { ShareDonut, TrendChart } from '~/components/charts'
import { Button } from '~/components/ui/button'

function Labels({ labels }: { labels: Array<string> }) {
  return (
    <>
      {labels.map((l) => (
        <span
          key={l}
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            labelStyle[l] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {l}
        </span>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
/** Open issues at first render, so the tab count is right before the page reports back. */
export const openIssueCount = (repo: Repo) =>
  issuesFor(repo).filter((i) => i.state === 'open').length

export function IssuesPage({ repo, n }: { repo: Repo; n?: number }) {
  const [issues, setIssues] = React.useState<Array<Issue>>(() =>
    issuesFor(repo),
  )
  const [state, setState] = React.useState<'open' | 'closed'>('open')
  const [q, setQ] = React.useState('')
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState({ title: '', body: '' })

  const open = issues.filter((i) => i.state === 'open').length
  useRepoCounts({ issues: open })
  const detail = n === undefined ? undefined : issues.find((i) => i.n === n)

  if (detail) {
    return (
      <>
        <IssueDetail
          repo={repo}
          issue={detail}
          onToggle={() =>
            setIssues((all) =>
              all.map((i) =>
                i.n === detail.n
                  ? { ...i, state: i.state === 'open' ? 'closed' : 'open' }
                  : i,
              ),
            )
          }
        />
      </>
    )
  }

  const shown = issues.filter(
    (i) =>
      i.state === state &&
      (!q ||
        `${i.title} ${i.labels.join(' ')}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  )

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex h-9 min-w-64 flex-1 items-center gap-2 rounded-lg border bg-card px-3 text-sm focus-within:border-foreground/40">
          <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter issues"
            aria-label="Filter issues"
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Seg
          value={state}
          onChange={setState}
          options={[
            ['open', `${open} open`],
            ['closed', `${issues.length - open} closed`],
          ]}
        />
        <Button
          variant="brand"
          size="lg"
          onClick={() => setComposing((c) => !c)}
        >
          New issue
        </Button>
      </div>

      {composing && (
        <Panel className="mb-4 space-y-3 p-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-9 w-full rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Description</span>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={4}
              className="w-full rounded-lg border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!draft.title.trim()}
              onClick={() => {
                setIssues((all) => [
                  {
                    n: Math.max(...all.map((i) => i.n)) + 1,
                    title: draft.title.trim(),
                    state: 'open',
                    labels: [],
                    author: 'dana',
                    comments: 0,
                    when: 'just now',
                    body: draft.body,
                  },
                  ...all,
                ])
                setDraft({ title: '', body: '' })
                setComposing(false)
                setState('open')
              }}
            >
              Submit issue
            </Button>
          </div>
        </Panel>
      )}

      {shown.length === 0 ? (
        <EmptyState title="No issues here">
          {q
            ? 'Nothing matches that filter.'
            : 'Nothing is waiting in this state.'}
        </EmptyState>
      ) : (
        <Panel className="divide-y overflow-hidden">
          {shown.map((i) => (
            <div
              key={i.n}
              className="relative flex gap-3 px-4 py-3 hover:bg-muted/40"
            >
              {i.state === 'open' ? (
                <ExclamationCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-merged" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/$handle/$repo/$tab"
                    params={{
                      handle: repo.owner,
                      repo: repo.name,
                      tab: 'issues',
                    }}
                    search={{ n: i.n }}
                    className="font-medium before:absolute before:inset-0 hover:underline"
                  >
                    {i.title}
                  </Link>
                  <Labels labels={i.labels} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  #{i.n} opened {i.when} by {i.author}
                </p>
              </div>
              {i.comments > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ChatBubbleLeftIcon className="size-3.5" />
                  {i.comments}
                </span>
              )}
            </div>
          ))}
        </Panel>
      )}
    </>
  )
}

function IssueDetail({
  repo,
  issue,
  onToggle,
}: {
  repo: Repo
  issue: Issue
  onToggle: () => void
}) {
  const [comments, setComments] = React.useState([
    {
      who: 'dana',
      when: '2 hours ago',
      text: 'Thanks for the report. I can reproduce this on main.',
    },
    {
      who: 'ines',
      when: '1 hour ago',
      text: 'Same here on macOS. Looks like the empty-file branch returns early without defaults.',
    },
  ])
  const [text, setText] = React.useState('')
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {issue.title}{' '}
              <span className="font-normal text-muted-foreground">
                #{issue.n}
              </span>
            </h2>
            <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
              <Chip tone={issue.state === 'open' ? 'success' : 'merged'}>
                {issue.state === 'open' ? 'Open' : 'Closed'}
              </Chip>
              {issue.author} opened this {issue.when}
            </div>
          </div>
          {issue.state === 'open' && (
            <WorkWithAgent
              repo={slugOf(repo)}
              subject={{
                kind: 'issue',
                ref: `#${issue.n}`,
                title: issue.title,
              }}
            />
          )}
        </div>
        {[
          { who: issue.author, when: issue.when, text: issue.body },
          ...comments,
        ].map((c, i) => (
          <Panel key={i} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
              <Tile name={c.who} round className="size-6 text-[10px]" />
              <b className="font-medium">{c.who}</b>
              <span className="text-muted-foreground">{c.when}</span>
            </div>
            <p className="px-4 py-3 text-sm">{c.text}</p>
          </Panel>
        ))}
        <Panel className="space-y-3 p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Leave a comment"
            aria-label="Comment"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onToggle}>
              {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
            </Button>
            <Button
              variant="brand"
              disabled={!text.trim()}
              onClick={() => {
                setComments((c) => [
                  ...c,
                  { who: 'dana', when: 'just now', text: text.trim() },
                ])
                setText('')
              }}
            >
              Comment
            </Button>
          </div>
        </Panel>
        <Link
          to="/$handle/$repo/$tab"
          params={{ handle: repo.owner, repo: repo.name, tab: 'issues' }}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to issues
        </Link>
      </div>
      <aside className="space-y-5 text-sm">
        <div className="space-y-2">
          <SectionLabel>Labels</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {issue.labels.length ? (
              <Labels labels={issue.labels} />
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
          </div>
        </div>
        <div className="space-y-2 border-t pt-4">
          <SectionLabel>Assignees</SectionLabel>
          <div className="flex items-center gap-2">
            <Tile name="dana" round className="size-6 text-[10px]" />
            dana
          </div>
        </div>
        <div className="space-y-2 border-t pt-4">
          <SectionLabel>Milestone</SectionLabel>
          <span className="text-muted-foreground">v0.10 release</span>
        </div>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function CheckIcon({
  status,
}: {
  status: 'pass' | 'fail' | 'pending' | Run['status']
}) {
  if (status === 'pass' || status === 'success')
    return <CheckCircleIcon className="size-4 text-success" />
  if (status === 'fail' || status === 'failure')
    return <XCircleIcon className="size-4 text-danger" />
  if (status === 'queued')
    return <ClockIcon className="size-4 text-muted-foreground" />
  return (
    <ArrowPathIcon className="size-4 animate-spin text-warning motion-reduce:animate-none" />
  )
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export function ActionsPage() {
  const [list, setList] = React.useState(runs)
  const [filter, setFilter] = React.useState<'all' | 'failure' | 'running'>(
    'all',
  )
  const [openId, setOpenId] = React.useState<number | null>(1842)
  const shown = list.filter(
    (r) =>
      filter === 'all' ||
      r.status === filter ||
      (filter === 'running' && r.status === 'queued'),
  )
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
        <Button>
          <PlayIcon className="size-4" />
          Run workflow
        </Button>
      </div>
      <Panel className="divide-y overflow-hidden">
        {shown.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No runs match.
          </div>
        )}
        {shown.map((r) => (
          <div key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
            >
              <CheckIcon status={r.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {r.workflow} #{r.id} · {r.branch} · {r.actor}
                </div>
              </div>
              <span className="hidden w-24 text-right text-xs text-muted-foreground md:block">
                {r.when}
              </span>
            </button>
            {openId === r.id && (
              <div className="border-t bg-muted/30 px-4 py-3">
                <ul className="grid gap-1 sm:grid-cols-2">
                  {jobs.map((j) => (
                    <li
                      key={j.name}
                      className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
                    >
                      <CheckIcon
                        status={
                          r.status === 'failure' && j.name.includes('windows')
                            ? 'failure'
                            : r.status === 'running'
                              ? 'running'
                              : r.status === 'queued'
                                ? 'queued'
                                : 'success'
                        }
                      />
                      <span className="flex-1">{j.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {j.time}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setList((all) =>
                        all.map((x) =>
                          x.id === r.id
                            ? {
                                ...x,
                                status: 'running',
                                duration: '0s',
                                when: 'just now',
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <ArrowPathIcon className="size-3.5" />
                    Re-run
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export function InsightsPage({ repo }: { repo: Repo }) {
  const series = downloadsSeries(repo)
  const release = latestStable(repo)
  const contributors = contributorsFor(repo)
  const topCommits = Math.max(...contributors.map((c) => c.commits))
  const weekly = series.map((value, i) => ({
    label: `W${i + 1}`,
    value,
  }))
  return (
    <>
      <div className="space-y-10">
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[
            ['Stars', compact(repo.stars), `+${repo.starsToday} today`],
            [
              'Downloads',
              compact(series.reduce((a, b) => a + b, 0)),
              'last 16 weeks',
            ],
            ['Contributors', '21', '6 this month'],
            ['Open issues', '5', '3 changes open'],
          ].map(([k, v, sub]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                {v}
              </dd>
              <dd className="text-xs text-muted-foreground">{sub}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Downloads per week</h2>
          <Panel className="h-56 p-3">
            <TrendChart data={weekly} unit="Downloads" className="h-full" />
          </Panel>
        </section>

        <div className="grid gap-10 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Downloads by platform</h2>
            {release ? (
              <div className="h-52">
                <ShareDonut
                  data={release.assets.map((a) => ({
                    name: `${a.platform} ${a.arch}`,
                    value: a.downloads,
                  }))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Publish a release to see platform data.
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Contributors</h2>
            <ul className="space-y-3">
              {contributors.map((c) => (
                <li key={c.name} className="flex items-center gap-3 text-sm">
                  <Tile name={c.name} round className="size-7 text-[11px]" />
                  <span className="w-16 font-medium">{c.name}</span>
                  <span
                    className="h-1.5 rounded-full bg-foreground/70"
                    style={{ width: `${(c.commits / topCommits) * 55}%` }}
                  />
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {c.commits}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Settings (owner only). This is the one repo screen that may mention an origin.
// ---------------------------------------------------------------------------

export { SwitchRow as Toggle } from '~/components/ui/switch'
