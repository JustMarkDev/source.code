import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
import { File } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  ArrowUpIcon,
  CheckBadgeIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  DocumentIcon,
  DocumentTextIcon,
  FolderIcon,
  LockClosedIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { AboutPanel } from './repo-about'
import { Who } from './repo-history'
import { ReadmeCard } from './markdown'
import { LineProvenance } from './line-provenance'
import type { RepoDoc } from './markdown'
import type { Repo } from '~/lib/model/data'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Button } from '~/components/ui/button'
import { Modal } from '~/components/ui/dialog'
import { useOp, useOpMaybe } from '~/lib/forge'
import { committerOf, timeAgo } from '~/lib/repo'
import { useIsDark } from '~/lib/theme'

type Entry = { name: string; kind: 'dir' | 'file'; path: string }

function entriesIn(paths: Array<string>, dir: string): Array<Entry> {
  const prefix = dir ? `${dir}/` : ''
  const found = new Map<string, Entry['kind']>()
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue
    const rest = p.slice(prefix.length)
    found.set(rest.split('/')[0], rest.includes('/') ? 'dir' : 'file')
  }
  return [...found.entries()]
    .map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` }))
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === 'dir'
          ? -1
          : 1,
    )
}

function iconFor(e: Entry) {
  if (e.kind === 'dir') return FolderIcon
  if (e.name.endsWith('.md')) return DocumentTextIcon
  if (e.path.includes('secrets') || e.name.endsWith('.env'))
    return LockClosedIcon
  return DocumentIcon
}

function Crumbs({ repo, path }: { repo: Repo; path: string }) {
  const parts = path ? path.split('/') : []
  return (
    <nav
      aria-label="Path"
      className="flex flex-wrap items-center gap-1 text-sm"
    >
      <Link
        to="/$handle/$repo/$tab"
        params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
        className={
          parts.length
            ? 'text-muted-foreground hover:text-foreground'
            : 'font-medium'
        }
      >
        {repo.name}
      </Link>
      {parts.map((part, i) => {
        const to = parts.slice(0, i + 1).join('/')
        const last = i === parts.length - 1
        return (
          <React.Fragment key={to}>
            <ChevronRightIcon className="size-3.5 text-muted-foreground/60" />
            {last ? (
              <span className="font-medium">{part}</span>
            ) : (
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
                search={{ path: to }}
                className="text-muted-foreground hover:text-foreground"
              >
                {part}
              </Link>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

/** Pierre's tree, as a quick way to jump to any file. */
function FilesPanel({
  repo,
  paths,
  onClose,
}: {
  repo: Repo
  paths: Array<string>
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { model } = useFileTree({
    paths,
    search: true,
    initialExpansion: 1,
    onSelectionChange: ([p]) => {
      if (p && paths.includes(p)) {
        onClose()
        void navigate({
          to: '/$handle/$repo/$tab',
          params: { handle: repo.owner, repo: repo.name, tab: 'code' },
          search: { path: p },
        })
      }
    },
  })
  return (
    <div className="pierre">
      <FileTree model={model} className="block h-96" />
    </div>
  )
}

export function CodeBrowser({
  repo,
  path = '',
  finding,
  onFinding,
}: {
  repo: Repo
  path?: string
  finding: boolean
  onFinding: (open: boolean) => void
}) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const at = { owner: repo.owner, repo: repo.name }
  const tree = useOp('git.tree', { ...at, recursive: 'true' })
  const paths = React.useMemo(() => tree.entries.map((e) => e.path), [tree])
  const [copied, setCopied] = React.useState(false)
  const [doc, setDoc] = React.useState<RepoDoc>('readme')
  // The line whose story is open, from a click on its number.
  const [why, setWhy] = React.useState<number | null>(null)

  const isFile = paths.includes(path)
  const isDir = !isFile && paths.some((p) => p.startsWith(`${path}/`))
  const dir = isDir
    ? path
    : isFile
      ? path.split('/').slice(0, -1).join('/')
      : ''
  const listing = useOpMaybe(
    'git.tree',
    { ...at, path: dir, last_commit: 'true' },
    !isFile,
  )
  const lastOf = React.useMemo(
    () => new Map(listing?.entries.map((e) => [e.path, e.last_commit]) ?? []),
    [listing],
  )
  const [latest] = useOp('git.commits', { ...at, limit: 1 }).data
  const total = useOp('repos.contributors', at).data.reduce(
    (n, c) => n + c.commits,
    0,
  )
  const blob = useOpMaybe('git.blob', { ...at, path, ref: tree.ref }, isFile)
  const contents =
    blob?.encoding === 'utf-8'
      ? blob.content
      : blob
        ? `Binary file, ${blob.size.toLocaleString('en')} bytes.`
        : ''

  return (
    <div className="space-y-4">
      {(isFile || isDir) && <Crumbs repo={repo} path={path} />}

      {!isFile && (
        <>
          <div
            className={cn(
              'grid grid-cols-1 gap-8',
              !dir && 'lg:grid-cols-[minmax(0,1fr)_300px]',
            )}
          >
            <div className="surface flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-5 py-3 text-sm">
                <Who who={committerOf(latest)} className="size-6 text-xs" />
                <b className="font-medium">{committerOf(latest).name}</b>
                <Link
                  to="/$handle/$repo/commit/$sha"
                  params={{
                    handle: repo.owner,
                    repo: repo.name,
                    sha: latest.sha,
                  }}
                  className="min-w-0 flex-1 py-0.5 text-muted-foreground hover:text-foreground hover:underline max-sm:basis-full sm:truncate"
                >
                  {latest.message.split('\n')[0]}
                </Link>
                {latest.checks === 'pass' ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckBadgeIcon className="size-4" /> checks passed
                  </span>
                ) : latest.checks === 'fail' ? (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <XCircleIcon className="size-4" /> checks failed
                  </span>
                ) : null}
                <span className="font-mono text-xs text-muted-foreground">
                  {latest.sha.slice(0, 7)}
                </span>
                <Link
                  to="/$handle/$repo/$tab"
                  params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
                  search={{ view: 'history' }}
                  className="inline-flex items-center gap-1.5 py-0.5 font-medium hover:underline"
                >
                  <ClockIcon className="size-4 text-muted-foreground" />
                  {total.toLocaleString('en')}
                  {total >= 1000 ? '+' : ''} commits
                </Link>
              </div>
              <ul className="flex flex-1 flex-col divide-y">
                {dir && (
                  <li>
                    <Link
                      to="/$handle/$repo/$tab"
                      params={{
                        handle: repo.owner,
                        repo: repo.name,
                        tab: 'code',
                      }}
                      search={{
                        path:
                          dir.split('/').slice(0, -1).join('/') || undefined,
                      }}
                      className="flex items-center gap-3 px-5 py-2.5 text-sm text-muted-foreground hover:bg-muted/50"
                    >
                      <ArrowUpIcon className="size-4" /> Up one folder
                    </Link>
                  </li>
                )}
                {entriesIn(paths, dir).map((e) => {
                  const Icon = iconFor(e)
                  const last = lastOf.get(e.path)
                  return (
                    <li key={e.path} className="flex-1">
                      <Link
                        to="/$handle/$repo/$tab"
                        params={{
                          handle: repo.owner,
                          repo: repo.name,
                          tab: 'code',
                        }}
                        search={{ path: e.path }}
                        className="flex h-full items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50"
                      >
                        <Icon
                          className={
                            e.kind === 'dir'
                              ? 'size-4 shrink-0 text-info'
                              : 'size-4 shrink-0 text-muted-foreground'
                          }
                        />
                        <span className="w-44 shrink-0 truncate font-medium">
                          {e.name}
                        </span>
                        <span className="hidden min-w-0 flex-1 truncate text-muted-foreground md:block">
                          {last?.message}
                        </span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                          {last && timeAgo(last.date)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>

            {!dir && (
              <AboutPanel repo={repo} onOpenLicense={() => setDoc('license')} />
            )}
          </div>

          {!dir && <ReadmeCard repo={repo} doc={doc} onDoc={setDoc} />}
        </>
      )}

      {isFile && (
        <div className="pierre surface overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">
              {path.split('/').at(-1)}
            </span>
            <span className="text-xs text-muted-foreground">
              {contents.split('\n').length} lines · click a line number to see
              why it is here
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(path)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <ClipboardDocumentIcon /> {copied ? 'Copied' : 'Copy path'}
            </Button>
          </div>
          <div className="max-h-[36rem] overflow-auto">
            <File
              key={path}
              file={{ name: path, contents }}
              options={{
                theme: codeTheme(dark),
                overflow,
                disableFileHeader: true,
                onLineNumberClick: ({ lineNumber }) => setWhy(lineNumber),
              }}
            />
          </div>
          <LineProvenance
            repo={repo}
            path={path}
            line={why}
            gitRef={tree.ref}
            onClose={() => setWhy(null)}
          />
        </div>
      )}

      <Modal
        open={finding}
        onClose={() => onFinding(false)}
        title="Go to file"
        description="Type to filter."
      >
        <FilesPanel
          repo={repo}
          paths={paths}
          onClose={() => onFinding(false)}
        />
      </Modal>
    </div>
  )
}
