import * as React from 'react'
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
import type { Committer } from '~/mock/commits'
import type { Repo } from '~/mock/data'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { GitBranchIcon } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectItem } from '~/components/ui/select'
import { commitsFor, committers, findCommit } from '~/mock/commits'
import { refsPatch, refsTestPatch } from '~/mock/platform'
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

/** Everything that happened, newest first: who did it, when, and whether it passed. */
export function HistoryView({ repo }: { repo: Repo }) {
  const all = React.useMemo(() => commitsFor(repo), [repo])
  const [author, setAuthor] = React.useState('')
  const [q, setQ] = React.useState('')
  const [shown, setShown] = React.useState(25)

  const filtered = all.filter(
    (c) =>
      (!author || c.author.name === author) &&
      (!q || c.message.toLowerCase().includes(q.toLowerCase())),
  )
  const page = filtered.slice(0, shown)
  const days = [...new Set(page.map((c) => c.day))]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <GitBranchIcon className="size-4" />
          main
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
          {committers.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {c.name}
            </SelectItem>
          ))}
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          214 commits on main
        </span>
      </div>

      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{day}</h2>
          <ul className="surface divide-y overflow-hidden rounded-2xl border bg-card">
            {page
              .filter((c) => c.day === day)
              .map((c) => (
                <li
                  key={c.sha}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                >
                  <Who who={c.author} />
                  <div className="min-w-0 flex-1">
                    <Link
                      {...commitLink(repo, c.sha)}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {c.message}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="text-foreground">{c.author.name}</span>
                      {kindBadge(c.author.kind)}
                      <span>committed {c.when}</span>
                      {c.change && (
                        <Link
                          to="/$handle/$repo/$tab"
                          params={{
                            handle: repo.owner,
                            repo: repo.name,
                            tab: 'changes',
                          }}
                          className="font-mono hover:text-foreground"
                        >
                          via {c.change}
                        </Link>
                      )}
                    </p>
                  </div>
                  {c.checks === 'pass' ? (
                    <CheckCircleIcon
                      className="size-4 shrink-0 text-success"
                      aria-label="Checks passed"
                    />
                  ) : (
                    <XCircleIcon
                      className="size-4 shrink-0 text-danger"
                      aria-label="Checks failed"
                    />
                  )}
                  <Link
                    {...commitLink(repo, c.sha)}
                    className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-accent"
                  >
                    {c.sha}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {page.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No commits match.
        </p>
      )}
      {filtered.length > shown && (
        <div className="flex justify-center">
          <Button onClick={() => setShown((n) => n + 25)}>
            Show older commits
          </Button>
        </div>
      )}
    </div>
  )
}

/** One commit: who, when, whether it passed, what changed. The diff is a sample. */
export function CommitView({ repo, sha }: { repo: Repo; sha: string }) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const c = findCommit(repo, sha)
  const [copied, setCopied] = React.useState(false)
  if (!c)
    return (
      <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No commit {sha} here.
      </p>
    )
  const patches: Array<[string, string]> = [
    ['src/refs.rs', refsPatch],
    ['tests/refs_test.rs', refsTestPatch],
  ]
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
        <h1 className="text-2xl font-semibold tracking-tight">{c.message}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Who who={c.author} />
            <span className="text-foreground">{c.author.name}</span>
            {kindBadge(c.author.kind)}
          </span>
          <span>committed {c.when}</span>
          <span className="inline-flex items-center gap-1">
            {c.checks === 'pass' ? (
              <CheckCircleIcon className="size-4 text-success" />
            ) : (
              <XCircleIcon className="size-4 text-danger" />
            )}
            checks {c.checks === 'pass' ? 'passed' : 'failed'}
          </span>
          {c.change && (
            <Link
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
              className="font-mono hover:text-foreground"
            >
              landed via {c.change}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-mono text-muted-foreground">
            commit <span className="text-foreground">{c.full}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(c.full)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <ClipboardDocumentIcon /> {copied ? 'Copied' : 'Copy'}
          </Button>
          <span className="font-mono text-muted-foreground">
            parent{' '}
            <Link
              {...commitLink(repo, c.parent)}
              className="text-foreground hover:underline"
            >
              {c.parent}
            </Link>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {c.files} files changed,{' '}
          <span className="text-success">+{c.additions}</span>{' '}
          <span className="text-danger">-{c.deletions}</span>. The diff below is
          a sample.
        </p>
      </div>
      {patches.map(([path, raw]) => (
        <div
          key={path}
          className="pierre surface overflow-hidden rounded-2xl border bg-card"
        >
          <PatchDiff
            patch={raw}
            options={{
              theme: codeTheme(dark),
              overflow,
              diffStyle: 'unified',
            }}
          />
        </div>
      ))}
    </div>
  )
}
