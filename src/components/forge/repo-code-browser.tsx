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
import type { RepoDoc } from './markdown'
import type { Repo } from '~/mock/data'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Modal } from '~/components/ui/dialog'
import { commitsFor } from '~/mock/commits'
import { useIsDark } from '~/lib/theme'

const rust = `pub struct Refs {
    disk: Disk,
    neg: NegCache,
}

impl Refs {
    pub fn lookup(&self, name: &str) -> Option<Oid> {
        if self.neg.contains(name) {
            return None;
        }
        self.disk
            .read_ref(name)
            .or_else(|| self.neg.put(name))
    }
}
`

const ts = `export class Queue {
  private jobs: Array<Job> = []

  push(job: Job) {
    this.jobs.push(job)
    void this.drain()
  }

  private async drain() {
    while (this.jobs.length) await retry(this.jobs.shift()!, { attempts: 3 })
  }
}
`

function filesFor(repo: Repo): Record<string, string> {
  const code = repo.language === 'Rust' ? rust : ts
  const ext = repo.language === 'Rust' ? 'rs' : 'ts'
  return {
    'README.md': `# ${repo.name}\n\n${repo.description}\n\n## Install\n\nDownload the build for your machine from the Releases tab.\n`,
    'SECURITY.md': `# Security policy\n\nReport vulnerabilities privately to security@${repo.owner}.dev. Do not open a public issue.\n`,
    'CONTRIBUTING.md': `# Contributing to ${repo.name}\n\nBug reports and small fixes are welcome. For anything larger, open an issue first.\n`,
    'CHANGELOG.md':
      '## 0.9.0\n\n- Faster ref lookups\n- Fix mount on empty directories\n',
    LICENSE: `${repo.license}\n`,
    '.env.schema':
      '# @defaultSensitive=true\n# ---\n# @required @type=url\nDATABASE_URL=\n\n# @public @type=port\nAPI_PORT=8080\n',
    '.source/policy/main.yml':
      'rules:\n  - id: core-paths\n    when: { paths: ["src/**"] }\n    require:\n      - approval: { min: 1, class: human }\n',
    '.source/secrets/production.env':
      'DATABASE_URL=enc:age:AGE-1q8xk…:Zmx1c2gtc2VjcmV0\nAPI_PORT=8080\n',
    '.github/workflows/ci.yml':
      'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: make test\n',
    'docs/retries.md':
      '# Retries\n\nFailed jobs retry up to three times with backoff.\n',
    'scripts/sign.sh':
      '#!/bin/sh\nset -eu\nfor f in dist/*; do cosign sign-blob "$f"; done\n',
    [`src/main.${ext}`]: code.split('\n').slice(0, 6).join('\n') + '\n',
    [`src/refs.${ext}`]: code,
    [`src/neg_cache.${ext}`]: code.split('\n').slice(0, 4).join('\n') + '\n',
    [`tests/refs_test.${ext}`]: code.split('\n').slice(4, 10).join('\n') + '\n',
  }
}

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

/** Written by an agent from the code; shown quietly next to each folder. */
const folderNotes: Record<string, string> = {
  '.github': 'CI workflows',
  '.source': 'Policies and encrypted secrets',
  docs: 'Guides and notes',
  scripts: 'Release tooling',
  src: 'The ref store and its caches',
  tests: 'Integration tests',
}

const messages = [
  'Cache negative ref lookups',
  'Memory-map pack index reads',
  'Document S3 retry behaviour',
  'Fix mount on empty directories',
  'Add a read-only mount mode',
]
const ages = [
  '2 days ago',
  '4 days ago',
  '6 days ago',
  '12 days ago',
  '3 weeks ago',
]
const pick = (name: string) =>
  [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % messages.length

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
  const ext = repo.language === 'Rust' ? 'rs' : 'ts'
  const { model } = useFileTree({
    paths,
    search: true,
    initialExpansion: 1,
    gitStatus: [
      { path: `src/refs.${ext}`, status: 'modified' },
      { path: `tests/refs_test.${ext}`, status: 'modified' },
      { path: `src/neg_cache.${ext}`, status: 'added' },
    ],
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
  const files = React.useMemo(() => filesFor(repo), [repo])
  const ext = repo.language === 'Rust' ? 'rs' : 'ts'
  const paths = React.useMemo(() => Object.keys(files).sort(), [files])
  const [copied, setCopied] = React.useState(false)
  const [doc, setDoc] = React.useState<RepoDoc>('readme')

  const isFile = path in files
  const isDir = !isFile && paths.some((p) => p.startsWith(`${path}/`))
  const dir = isDir
    ? path
    : isFile
      ? path.split('/').slice(0, -1).join('/')
      : ''
  const latest = React.useMemo(() => commitsFor(repo, 1)[0], [repo])
  const touched = [`src/refs.${ext}`, `tests/refs_test.${ext}`]

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
                <Who who={latest.author} className="size-6 text-xs" />
                <b className="font-medium">{latest.author.name}</b>
                <Link
                  to="/$handle/$repo/commit/$sha"
                  params={{
                    handle: repo.owner,
                    repo: repo.name,
                    sha: latest.sha,
                  }}
                  className="min-w-0 flex-1 py-0.5 text-muted-foreground hover:text-foreground hover:underline max-sm:basis-full sm:truncate"
                >
                  {latest.message}
                </Link>
                {latest.checks === 'pass' ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckBadgeIcon className="size-4" /> checks passed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <XCircleIcon className="size-4" /> checks failed
                  </span>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {latest.sha}
                </span>
                <Link
                  to="/$handle/$repo/$tab"
                  params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
                  search={{ view: 'history' }}
                  className="inline-flex items-center gap-1.5 py-0.5 font-medium hover:underline"
                >
                  <ClockIcon className="size-4 text-muted-foreground" />
                  214 commits
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
                  const n = pick(e.name)
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
                          {e.kind === 'dir' && folderNotes[e.name]
                            ? folderNotes[e.name]
                            : messages[n]}
                        </span>
                        {touched.includes(e.path) && (
                          <Badge tone="info">in #216</Badge>
                        )}
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                          {ages[n]}
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
            {touched.includes(path) && (
              <Badge tone="info">changed in #216</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {files[path].split('\n').length} lines
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
              file={{ name: path, contents: files[path] }}
              options={{
                theme: codeTheme(dark),
                overflow,
                disableFileHeader: true,
              }}
            />
          </div>
        </div>
      )}

      <Modal
        open={finding}
        onClose={() => onFinding(false)}
        title="Go to file"
        description="Type to filter. Badges mark files touched by open changes."
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
