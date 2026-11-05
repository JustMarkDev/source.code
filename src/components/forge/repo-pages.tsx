import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, EmptyState, Panel, SectionLabel, Seg, Tile } from './bits'
import { EvidenceSection } from './evidence'
import { slugOf, useRepoCounts } from './repo-shell'
import { WorkWithAgent } from './work-with-agent'
import type { Repo } from '~/mock/data'
import type { Issue } from '~/mock/extra'
import { compact, latestStable } from '~/mock/data'
import { mediaForIssue } from '~/mock/evidence'
import {
  contributorsFor,
  downloadsSeries,
  issuesFor,
  labelStyle,
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
            'rounded-full px-2 py-0.5 text-xs font-medium',
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
            className="h-7 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
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

type Attached = { name: string; type: string; url: string }
type Comment = {
  who: string
  when: string
  text: string
  files?: Array<Attached>
}

/** Files picked for a comment, shown from the browser until it is posted. */
function useAttachments() {
  const [files, setFiles] = React.useState<Array<Attached>>([])
  const posted = React.useRef<Array<string>>([])
  const pending = React.useRef<Array<string>>([])
  React.useEffect(
    () => () => {
      for (const u of [...pending.current, ...posted.current])
        URL.revokeObjectURL(u)
    },
    [],
  )
  return {
    files,
    add(list: FileList | null) {
      const next = Array.from(list ?? [])
        .filter(
          (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
        )
        .map((f) => ({
          name: f.name || 'pasted image',
          type: f.type,
          url: URL.createObjectURL(f),
        }))
      pending.current.push(...next.map((n) => n.url))
      if (next.length) setFiles((all) => [...all, ...next])
    },
    remove(url: string) {
      URL.revokeObjectURL(url)
      pending.current = pending.current.filter((u) => u !== url)
      setFiles((all) => all.filter((f) => f.url !== url))
    },
    /** The comment is posted: the files now belong to it. */
    release() {
      posted.current.push(...pending.current)
      pending.current = []
      setFiles([])
    },
  }
}

function AttachmentGrid({
  files,
  onRemove,
}: {
  files: Array<Attached>
  onRemove?: (url: string) => void
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {files.map((f) => (
        <li key={f.url} className="relative min-w-0">
          {f.type.startsWith('video/') ? (
            <video
              src={f.url}
              controls
              className="max-h-64 w-full rounded-lg border bg-black"
            />
          ) : (
            <img
              src={f.url}
              alt={f.name}
              className="max-h-64 w-full rounded-lg border object-contain"
            />
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={() => onRemove(f.url)}
              className="absolute top-1.5 right-1.5 rounded-full bg-background/90 p-1 shadow hover:bg-background"
            >
              <XMarkIcon className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
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
  const [comments, setComments] = React.useState<Array<Comment>>([
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
  const attach = useAttachments()
  const media = mediaForIssue(issue.n)
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
          <React.Fragment key={i}>
            <Panel className="overflow-hidden">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
                <Tile name={c.who} round className="size-6 text-xs" />
                <b className="font-medium">{c.who}</b>
                <span className="text-muted-foreground">{c.when}</span>
              </div>
              <div className="space-y-3 px-4 py-3">
                <p className="text-sm">{c.text}</p>
                {'files' in c && c.files && <AttachmentGrid files={c.files} />}
              </div>
            </Panel>
            {i === 0 && <EvidenceSection title="Attachments" items={media} />}
          </React.Fragment>
        ))}
        <Panel
          className="space-y-3 p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            attach.add(e.dataTransfer.files)
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => attach.add(e.clipboardData.files)}
            rows={3}
            placeholder="Leave a comment. Paste or drop images and videos to show what you mean."
            aria-label="Comment"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {attach.files.length > 0 && (
            <AttachmentGrid files={attach.files} onRemove={attach.remove} />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="mr-auto inline-flex cursor-pointer items-center gap-1.5 py-1 text-sm text-muted-foreground hover:text-foreground">
              <PaperClipIcon className="size-4" />
              Attach images or video
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                className="sr-only"
                onChange={(e) => {
                  attach.add(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            <Button variant="outline" onClick={onToggle}>
              {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
            </Button>
            <Button
              variant="brand"
              disabled={!text.trim() && attach.files.length === 0}
              onClick={() => {
                setComments((c) => [
                  ...c,
                  {
                    who: 'dana',
                    when: 'just now',
                    text: text.trim(),
                    files: attach.files,
                  },
                ])
                setText('')
                attach.release()
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
            <Tile name="dana" round className="size-6 text-xs" />
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
              {contributors.map((c) => (
                <li key={c.name} className="flex items-center gap-3 text-sm">
                  <Tile name={c.name} round className="size-7 text-xs" />
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
