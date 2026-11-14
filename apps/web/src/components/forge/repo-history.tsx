import * as React from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { PatchDiff } from '@pierre/diffs/react'
import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { Avatar } from './bits'
import type { Repo } from '~/lib/model/data'
import type { Committer } from '~/lib/repo'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { GitBranchIcon } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectItem } from '~/components/ui/select'
import { committerOf, dayOf, timeAgo } from '~/lib/repo'
import { op, opQuery, useOp, useOpMaybe } from '~/lib/forge'
import { useIsDark } from '~/lib/theme'

export function Who({
  who,
  className = 'size-7 text-xs',
}: {
  who: Committer
  className?: string
}) {
  return who.kind === 'human' ? (
    <Avatar handle={who.name} className={className} />
  ) : (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted',
        className,
      )}
    >
      <CpuChipIcon className="size-4" />
    </span>
  )
}

function kindBadge(k: Committer['kind']) {
  return k === 'human' ? null : <Badge>{k === 'agent' ? 'agent' : 'bot'}</Badge>
}

const commitLink = (repo: Repo, sha: string) =>
  ({
    to: '/$handle/$repo/commit/$sha',
    params: { handle: repo.owner, repo: repo.name, sha },
  }) as const

const PAGE = 50

function Checks({ checks }: { checks: 'pass' | 'fail' | null }) {
  if (checks === 'pass')
    return (
      <CheckCircleIcon
        className="size-4 shrink-0 text-success"
        aria-label="Checks passed"
      />
    )
  if (checks === 'fail')
    return (
      <XCircleIcon
        className="size-4 shrink-0 text-danger"
        aria-label="Checks failed"
      />
    )
  return null
}

/**
 * Everything that happened, newest first: who did it, when, and whether it
 * passed. Pages through `git.commits`; the filters narrow what is loaded.
 */
export function HistoryView({ repo }: { repo: Repo }) {
  const at = { owner: repo.owner, repo: repo.name }
  const [author, setAuthor] = React.useState('')
  const [q, setQ] = React.useState('')
  const first = useOp('git.commits', { ...at, limit: PAGE })
  const pages = useInfiniteQuery({
    queryKey: ['sx', 'git.commits', at, 'pages'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      pageParam === undefined
        ? Promise.resolve(first)
        : op('git.commits', { ...at, limit: PAGE, cursor: pageParam }),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    initialData: { pages: [first], pageParams: [undefined] },
  })
  const people = useQuery(opQuery('repos.contributors', at)).data?.data ?? []
  const total = people.reduce((n, c) => n + c.commits, 0)

  const all = pages.data.pages.flatMap((p) => p.data)
  const filtered = all.filter(
    (c) =>
      (!author || c.author.email.toLowerCase() === author) &&
      (!q || c.message.toLowerCase().includes(q.toLowerCase())),
  )
  const days = [...new Set(filtered.map((c) => dayOf(c.date)))]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <GitBranchIcon className="size-4" />
          {first.data[0] ? 'main' : 'No commits yet'}
        </span>
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter commits"
            aria-label="Filter commits"
            className="pl-8"
          />
        </div>
        <Select
          value={author}
          onValueChange={(v) => setAuthor(v)}
          aria-label="Author"
          className="w-52"
        >
          <SelectItem value="">Everyone</SelectItem>
          {people.map((c) => (
            <SelectItem key={c.email} value={c.email.toLowerCase()}>
              {c.name}
            </SelectItem>
          ))}
        </Select>
        {total > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {total.toLocaleString('en')}
            {total >= 1000 ? '+' : ''} commit{total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{day}</h2>
          <ul className="surface divide-y overflow-hidden rounded-2xl border bg-card">
            {filtered
              .filter((c) => dayOf(c.date) === day)
              .map((c) => {
                const who = committerOf(c)
                return (
                  <li
                    key={c.sha}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                  >
                    <Who who={who} />
                    <div className="min-w-0 flex-1">
                      <Link
                        {...commitLink(repo, c.sha)}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {c.message.split('\n')[0]}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="text-foreground">{who.name}</span>
                        {kindBadge(who.kind)}
                        <span>committed {timeAgo(c.date)}</span>
                        {c.change !== null && (
                          <Link
                            to="/$handle/$repo/$tab"
                            params={{
                              handle: repo.owner,
                              repo: repo.name,
                              tab: 'changes',
                            }}
                            className="font-mono hover:text-foreground"
                          >
                            via #{c.change}
                          </Link>
                        )}
                      </p>
                    </div>
                    <Checks checks={c.checks} />
                    <Link
                      {...commitLink(repo, c.sha)}
                      className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-accent"
                    >
                      {c.sha.slice(0, 7)}
                    </Link>
                  </li>
                )
              })}
          </ul>
        </section>
      ))}

      {filtered.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {all.length === 0
            ? 'Nothing has been pushed yet.'
            : 'No commits match.'}
        </p>
      )}
      {pages.hasNextPage && (
        <div className="flex justify-center">
          <Button
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? 'Loading…' : 'Show older commits'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** One commit: who, when, whether it passed, what changed. */
export function CommitView({ repo, sha }: { repo: Repo; sha: string }) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const at = { owner: repo.owner, repo: repo.name, sha }
  const c = useOpMaybe('git.commit', at)
  const diff = useOpMaybe('git.diff', at, !!c)
  const [copied, setCopied] = React.useState(false)
  if (c === undefined)
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
    )
  if (c === null)
    return (
      <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No commit {sha} here.
      </p>
    )
  const who = committerOf(c)
  const [title, ...rest] = c.message.split('\n')
  const more = rest.join('\n').trim()
  const parent = c.parents[0]
  return (
    <div className="space-y-6">
      <Link
        to="/$handle/$repo/$tab"
        params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
        search={{ view: 'history' }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        All commits
      </Link>
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {more && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {more}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Who who={who} />
            <span className="text-foreground">{who.name}</span>
            {kindBadge(who.kind)}
          </span>
          <span>committed {timeAgo(c.date)}</span>
          {c.checks && (
            <span className="inline-flex items-center gap-1">
              <Checks checks={c.checks} />
              checks {c.checks === 'pass' ? 'passed' : 'failed'}
            </span>
          )}
          {c.change !== null && (
            <Link
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
              className="font-mono hover:text-foreground"
            >
              landed via #{c.change}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-mono text-muted-foreground">
            commit <span className="text-foreground">{c.sha}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(c.sha)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <ClipboardDocumentIcon /> {copied ? 'Copied' : 'Copy'}
          </Button>
          {parent && (
            <span className="font-mono text-muted-foreground">
              parent{' '}
              <Link
                {...commitLink(repo, parent)}
                className="text-foreground hover:underline"
              >
                {parent.slice(0, 7)}
              </Link>
            </span>
          )}
        </div>
        {diff && (
          <p className="text-sm text-muted-foreground">
            {diff.stats.files} file{diff.stats.files === 1 ? '' : 's'} changed,{' '}
            <span className="text-success">+{diff.stats.additions}</span>{' '}
            <span className="text-danger">-{diff.stats.deletions}</span>
          </p>
        )}
      </div>
      {diff === undefined && (
        <p className="text-sm text-muted-foreground">Loading the diff…</p>
      )}
      {diff?.files.map((f) => (
        <div
          key={f.path}
          className="pierre surface overflow-hidden rounded-2xl border bg-card"
        >
          {f.patch ? (
            <PatchDiff
              patch={patchOf(f)}
              options={{
                theme: codeTheme(dark),
                overflow,
                diffStyle: 'unified',
              }}
            />
          ) : (
            <p className="px-4 py-3 font-mono text-sm">
              {f.path}{' '}
              <span className="text-muted-foreground">
                ({f.state}, no text changes)
              </span>
            </p>
          )}
          {f.truncated && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              This diff is cut at 64 KB.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

/** `PatchDiff` wants a whole file patch; the API sends the hunks. */
function patchOf(f: { path: string; state: string; patch: string }) {
  if (f.patch.startsWith('diff --git') || f.patch.startsWith('---'))
    return f.patch
  const from = f.state === 'added' ? '/dev/null' : `a/${f.path}`
  const to = f.state === 'deleted' ? '/dev/null' : `b/${f.path}`
  return `diff --git a/${f.path} b/${f.path}\n--- ${from}\n+++ ${to}\n${f.patch}`
}
