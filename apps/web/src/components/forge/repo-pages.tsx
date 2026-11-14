import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, EmptyState, Panel, SectionLabel, Seg, Tile } from './bits'
import { slugOf, useRepoCounts } from './repo-shell'
import { WorkWithAgent } from './work-with-agent'
import type { Repo } from '~/lib/model/data'
import type { Label } from '@source-code/sdk'
import { compact, latestStable } from '~/lib/model/data'
import { useOp, useOpMaybe, useWrite } from '~/lib/forge'
import { toMedia } from '~/lib/change'
import { EvidenceSection } from './evidence'
import { IssueHistory } from './issue-history'
import { Viewers, usePresence } from './presence'
import { manages, useAccount, useMe } from '~/lib/auth/accounts'
import { timeAgo } from '~/lib/repo'
import { ShareDonut, TrendChart } from '~/components/charts'
import { Button } from '~/components/ui/button'

type LabelColor = Label['color']

const labelTone: Record<LabelColor, string> = {
  gray: 'bg-muted text-muted-foreground',
  red: 'bg-danger/15 text-danger',
  orange: 'bg-brand/30 text-foreground',
  yellow: 'bg-warning/15 text-warning',
  green: 'bg-success/15 text-success',
  blue: 'bg-info/15 text-info',
  purple: 'bg-merged/15 text-merged',
}

/** A repository's labels by name, for their colours. */
function useLabelColors(repo: Repo) {
  const labels = useOpMaybe('labels.list', {
    owner: repo.owner,
    repo: repo.name,
  })
  return React.useMemo(
    () => new Map(labels?.data.map((l) => [l.name, l.color]) ?? []),
    [labels],
  )
}

function Labels({
  labels,
  colors,
}: {
  labels: Array<string>
  colors: Map<string, LabelColor>
}) {
  return (
    <>
      {labels.map((l) => (
        <span
          key={l}
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            labelTone[colors.get(l) ?? 'gray'],
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
const ISSUES_PAGE = 100

export function IssuesPage({ repo, n }: { repo: Repo; n?: number }) {
  if (n !== undefined) return <IssueDetail key={n} repo={repo} n={n} />
  return <IssueList repo={repo} />
}

function IssueList({ repo }: { repo: Repo }) {
  const at = { owner: repo.owner, repo: repo.name }
  const lists = {
    open: useOp('issues.list', { ...at, state: 'open', limit: ISSUES_PAGE }),
    closed: useOp('issues.list', {
      ...at,
      state: 'closed',
      limit: ISSUES_PAGE,
    }),
  }
  const colors = useLabelColors(repo)
  const me = useMe()
  const write = useWrite()
  const navigate = useNavigate()
  const [state, setState] = React.useState<'open' | 'closed'>('open')
  const [q, setQ] = React.useState('')
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState({ title: '', body: '' })
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const count = (l: typeof lists.open) =>
    `${l.data.length}${l.has_more ? '+' : ''}`
  useRepoCounts({ issues: lists.open.data.length })

  const shown = lists[state].data.filter(
    (i) =>
      !q ||
      `${i.title} ${i.labels.join(' ')}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  )

  async function submit() {
    setBusy(true)
    const r = await write('issues.create', {
      ...at,
      body: { title: draft.title.trim(), body: draft.body },
    })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    setDraft({ title: '', body: '' })
    setComposing(false)
    void navigate({
      to: '/$handle/$repo/$tab',
      params: { handle: repo.owner, repo: repo.name, tab: 'issues' },
      search: { n: r.data.number },
    })
  }

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
            className="h-7 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Seg
          value={state}
          onChange={setState}
          options={[
            ['open', `${count(lists.open)} open`],
            ['closed', `${count(lists.closed)} closed`],
          ]}
        />
        {me && (
          <Button
            variant="brand"
            size="lg"
            onClick={() => setComposing((c) => !c)}
          >
            New issue
          </Button>
        )}
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
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!draft.title.trim() || busy}
              onClick={() => void submit()}
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
              key={i.number}
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
                    search={{ n: i.number }}
                    className="font-medium before:absolute before:inset-0 hover:underline"
                  >
                    {i.title}
                  </Link>
                  <Labels labels={i.labels} colors={colors} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  #{i.number} opened {timeAgo(i.created_at)} by{' '}
                  {i.author.handle}
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

function IssueDetail({ repo, n }: { repo: Repo; n: number }) {
  const at = { owner: repo.owner, repo: repo.name, number: n }
  const issue = useOp('issues.get', at)
  const comments = useOp('comments.list', { ...at, limit: 200 }).data
  const evidence = useOp('issue_evidence.list', at).data
  const [attaching, setAttaching] = React.useState('')
  const colors = useLabelColors(repo)
  const me = useMe()
  // The API decides; this only hides a button that would be refused.
  const canClose = manages(useAccount(repo.owner))
  const write = useWrite()
  const [text, setText] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  /** Upload a file to its signed address, then attach it to the issue. */
  async function attach(file: File) {
    setError('')
    const types = [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
    ] as const
    const type = types.find((t) => t === file.type)
    if (!type) return setError(`${file.name} is not an image or a video.`)
    const up = await write('uploads.create', {
      body: { filename: file.name, content_type: type, size: file.size },
    })
    if (up.error) return setError(up.error.message)
    const sent = await fetch(up.data.upload_url ?? '', {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    })
    if (!sent.ok) return setError(`${file.name} did not upload.`)
    const r = await write('issue_evidence.create', {
      ...at,
      body: {
        upload: up.data.id,
        kind: file.type.startsWith('video/') ? 'recording' : 'image',
        caption: text.trim().slice(0, 300) || file.name,
      },
    })
    if (r.error) setError(r.error.message)
  }

  async function run(go: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true)
    setError('')
    const r = await go()
    setBusy(false)
    if (r.error) setError(r.error.message)
    return !r.error
  }

  const viewers = usePresence(
    'issue',
    { owner: repo.owner, repo: repo.name, number: String(n) },
    null,
    Boolean(me),
  )

  const thread = [
    {
      id: 'body',
      who: issue.author.handle,
      when: issue.created_at,
      text: issue.body,
    },
    ...comments.map((c) => ({
      id: c.id,
      who: c.author.handle,
      when: c.created_at,
      text: c.body,
    })),
  ].filter((c) => c.id !== 'body' || c.text)

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {issue.title}{' '}
              <span className="font-normal text-muted-foreground">
                #{issue.number}
              </span>
            </h2>
            <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
              <Chip tone={issue.state === 'open' ? 'success' : 'merged'}>
                {issue.state === 'open' ? 'Open' : 'Closed'}
              </Chip>
              {issue.author.handle} opened this {timeAgo(issue.created_at)}
            </div>
            <div className="mt-2">
              <Viewers viewers={viewers} />
            </div>
          </div>
          {issue.state === 'open' && (
            <WorkWithAgent
              repo={slugOf(repo)}
              subject={{
                kind: 'issue',
                ref: `#${issue.number}`,
                title: issue.title,
              }}
            />
          )}
        </div>
        {thread.map((c) => (
          <Panel key={c.id} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
              <Tile name={c.who} round className="size-6 text-xs" />
              <b className="font-medium">{c.who}</b>
              <span className="text-muted-foreground">{timeAgo(c.when)}</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm whitespace-pre-wrap">{c.text}</p>
            </div>
          </Panel>
        ))}
        <EvidenceSection title="What people saw" items={toMedia(evidence)} />
        <IssueHistory repo={repo} n={n} />
        {me ? (
          <Panel className="space-y-3 p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Leave a comment"
              aria-label="Comment"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="mr-auto inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <PhotoIcon className="size-4" />
                {attaching || 'Attach an image or recording'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
                  aria-label="Attach an image or recording"
                  className="sr-only"
                  disabled={!!attaching}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    setAttaching(`Uploading ${file.name}…`)
                    void attach(file).finally(() => setAttaching(''))
                  }}
                />
              </label>
              {canClose && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      write('issues.update', {
                        ...at,
                        body: {
                          state: issue.state === 'open' ? 'closed' : 'open',
                        },
                      }),
                    )
                  }
                >
                  {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
                </Button>
              )}
              <Button
                variant="brand"
                disabled={!text.trim() || busy}
                onClick={() =>
                  void run(() =>
                    write('comments.create', {
                      ...at,
                      body: { body: text.trim() },
                    }),
                  ).then((ok) => ok && setText(''))
                }
              >
                Comment
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel className="p-4 text-sm text-muted-foreground">
            <Link to="/sign-in" className="text-foreground underline">
              Sign in
            </Link>{' '}
            to comment.
          </Panel>
        )}
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
              <Labels labels={issue.labels} colors={colors} />
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
          </div>
        </div>
        <div className="space-y-2 border-t pt-4">
          <SectionLabel>Assignees</SectionLabel>
          {issue.assignees.length ? (
            issue.assignees.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Tile name={a.handle} round className="size-6 text-xs" />
                {a.handle}
              </div>
            ))
          ) : (
            <span className="text-muted-foreground">No one yet</span>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export function InsightsPage({ repo }: { repo: Repo }) {
  const at = { owner: repo.owner, repo: repo.name }
  const ins = useOp('repos.insights', at)
  const people = useOp('repos.contributors', at).data.slice(0, 8)
  const release = latestStable(repo)
  const topCommits = Math.max(1, ...people.map((c) => c.commits))
  const daily = ins.downloads.daily.map((value, i) => ({
    label: `Day ${i + 1}`,
    value,
  }))
  const weekly = ins.commits.by_week.map((value, i) => ({
    label: `W${i + 1}`,
    value,
  }))
  const { human, agent, bot } = ins.commits.by_class
  return (
    <>
      <div className="space-y-10">
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[
            ['Stars', compact(ins.stars.total), `+${ins.stars.today} today`],
            [
              'Downloads',
              compact(ins.downloads.total),
              `${compact(ins.downloads.daily.reduce((a, b) => a + b, 0))} in 30 days`,
            ],
            [
              'Contributors',
              String(ins.contributors),
              `${ins.commits.total} commits`,
            ],
            [
              'Open issues',
              String(ins.issues.open),
              `${ins.changes.open} changes open`,
            ],
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
          <h2 className="text-sm font-medium">Downloads per day</h2>
          <Panel className="h-56 p-3">
            <TrendChart data={daily} unit="Downloads" className="h-full" />
          </Panel>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            Commits per week, by people, agents and bots
          </h2>
          <Panel className="h-56 p-3">
            <TrendChart data={weekly} unit="Commits" className="h-full" />
          </Panel>
          <div className="h-44">
            <ShareDonut
              data={[
                { name: 'People', value: human },
                { name: 'Agents', value: agent },
                { name: 'Bots', value: bot },
              ].filter((x) => x.value > 0)}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
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
              {people.map((c) => (
                <li key={c.email} className="flex items-center gap-3 text-sm">
                  <Tile name={c.name} round className="size-7 text-xs" />
                  <span className="w-28 truncate font-medium">{c.name}</span>
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
