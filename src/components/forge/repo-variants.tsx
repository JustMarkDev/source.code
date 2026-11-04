import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import {
  ArrowDownTrayIcon,
  BeakerIcon,
  ChevronDownIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, LangDot, Panel, SectionLabel } from './bits'
import { CodeBrowser } from './repo-code-browser'
import { HistoryView } from './repo-history'
import { DownloadButton, TargetPicker } from './download-button'
import { CopyField } from './repo-shell'
import type { Channel, Release, Repo } from '~/mock/data'
import { GitBranchIcon } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Segmented } from '~/components/ui/tabs'
import { Tip } from '~/components/ui/tooltip'
import { compact, latestStable, totalDownloads } from '~/mock/data'
import { availableOses, matchAsset, osLabel, useTarget } from '~/lib/platform'

const platformIcon = {
  macos: ComputerDesktopIcon,
  windows: ComputerDesktopIcon,
  linux: CommandLineIcon,
} as const

// ---------------------------------------------------------------------------
// Code: the file table, with the download button where the clone button lives.
// ---------------------------------------------------------------------------
/** Buttons that sit on the right of the repository tabs while on the Code tab. */
export function CodeActions({
  repo,
  onFind,
}: {
  repo: Repo
  onFind: () => void
}) {
  const release = latestStable(repo)
  return (
    <>
      <span className="mr-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <GitBranchIcon className="size-4" />
        main
      </span>
      <Tip label="Go to file">
        <Button size="icon" aria-label="Go to file" onClick={onFind}>
          <MagnifyingGlassIcon />
        </Button>
      </Tip>
      <ClonePopover repo={repo} />
      {release && <DownloadButton release={release} />}
    </>
  )
}

export function CodePage({
  repo,
  path,
  view,
  finding,
  onFinding,
}: {
  repo: Repo
  path?: string
  view?: 'history'
  finding: boolean
  onFinding: (open: boolean) => void
}) {
  return view === 'history' ? (
    <HistoryView repo={repo} />
  ) : (
    <CodeBrowser
      repo={repo}
      path={path}
      finding={finding}
      onFinding={onFinding}
    />
  )
}

function ClonePopover({ repo }: { repo: Repo }) {
  const path = `${repo.owner}/${repo.name}`
  return (
    <Popover.Root>
      <Popover.Trigger className="raised inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3.5 text-sm hover:bg-muted">
        <CommandLineIcon className="size-4" />
        Clone
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="overlay-popup w-96 space-y-3 rounded-xl border bg-popover p-3 shadow-xl outline-none">
            {(
              [
                ['HTTPS', `https://source.code/${path}.git`],
                ['SSH', `git@source.code:${path}.git`],
                ['CLI', `src clone ${path}`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {label}
                </div>
                <CopyField value={value} prefix="" />
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ReleaseNotes({ release }: { release: Release }) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">
          {release.version}: {release.title}
        </h3>
        <p className="text-xs text-muted-foreground">{release.date}</p>
      </div>
      {(
        [
          ['Added', release.notes.added, 'text-success'],
          ['Changed', release.notes.changed, 'text-info'],
          ['Fixed', release.notes.fixed, 'text-warning'],
        ] as const
      ).map(
        ([label, items, color]) =>
          items.length > 0 && (
            <div key={label}>
              <h4 className={cn('mb-1.5 font-mono text-xs font-medium', color)}>
                {label}
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Releases: detect the machine, say which file is for it, make verifying easy.
// ---------------------------------------------------------------------------
const channelChip = {
  stable: 'success',
  beta: 'warning',
  nightly: 'info',
} as const

const channelBlurb: Record<Channel, string> = {
  stable: 'Tested and signed. The one to use.',
  beta: 'Close to done, but still changing. Expect rough edges.',
  nightly: 'Built automatically from main. Unsigned, and can break.',
}

/** What to know before installing this particular version, if anything. */
function ReleaseNotice({
  release,
  latest,
  onOpen,
}: {
  release: Release
  latest: Release | undefined
  onOpen: (version: string) => void
}) {
  const open = latest && latest !== release && (
    <Button size="sm" onClick={() => onOpen(latest.version)}>
      View {latest.version}
    </Button>
  )
  const base =
    'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-6 py-3 text-sm'
  if (release.withdrawn)
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <ExclamationTriangleIcon className="size-5 shrink-0 text-danger" />
        <p className="min-w-0 flex-1">
          <b className="font-medium">Withdrawn.</b> {release.withdrawn}
        </p>
        {open}
      </div>
    )
  if (release.channel === 'nightly')
    return (
      <div className={cn(base, 'bg-info/10')}>
        <MoonIcon className="size-5 shrink-0 text-info" />
        <p className="min-w-0 flex-1">
          <b className="font-medium">Nightly.</b> {channelBlurb.nightly}
          {release.commit && (
            <>
              {' '}
              Built from <span className="font-mono">{release.commit}</span>.
            </>
          )}
        </p>
        {open}
      </div>
    )
  if (release.channel === 'beta')
    return (
      <div className={cn(base, 'bg-warning/10')}>
        <BeakerIcon className="size-5 shrink-0 text-warning" />
        <p className="min-w-0 flex-1">
          <b className="font-medium">Beta.</b> {channelBlurb.beta}
          {release.commit && (
            <>
              {' '}
              Built from <span className="font-mono">{release.commit}</span>.
            </>
          )}
        </p>
        {open}
      </div>
    )
  if (latest && latest !== release)
    return (
      <div className={cn(base, 'bg-muted/50')}>
        <p className="min-w-0 flex-1 text-muted-foreground">
          You are looking at an older version. The latest stable release is{' '}
          <span className="font-mono text-foreground">{latest.version}</span>.
        </p>
        {open}
      </div>
    )
  return null
}

export function ReleasesPage({ repo }: { repo: Repo }) {
  const { target } = useTarget()
  const [version, setVersion] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<'all' | Channel>('all')
  const [install, setInstall] = React.useState(0)
  const latest = latestStable(repo)
  const release =
    repo.releases.find((r) => r.version === version) ??
    latest ??
    repo.releases.at(0)
  const count = (c: Channel) =>
    repo.releases.filter((r) => r.channel === c).length

  // Anything but the newest stable gets commands pinned to that version.
  const pinned = release !== undefined && release !== latest
  const v = release?.version.replace(/^v/, '') ?? ''
  const installs = [
    [
      'curl',
      `curl -fsSL https://source.code/${repo.owner}/${repo.name}/install | sh${pinned ? ` -s -- --version ${release.version}` : ''}`,
    ],
    [
      'brew',
      `brew install ${repo.owner}/tap/${repo.name}${pinned ? `@${v.split(/[.-]/).slice(0, 2).join('.')}` : ''}`,
    ],
    ['cargo', `cargo install ${repo.name}${pinned ? ` --version ${v}` : ''}`],
    [
      'docker',
      `docker run --rm ghcr.io/${repo.owner}/${repo.name}${pinned ? `:${v}` : ''}`,
    ],
  ] as const

  if (!release) {
    return (
      <>
        <Panel className="p-10 text-center">
          <p className="font-medium">{repo.name} has no releases yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a project with downloads, like dana/gitfs, to see this page.
          </p>
        </Panel>
      </>
    )
  }

  const { asset: best, fit } = matchAsset(release, target)
  const maxDownloads = Math.max(...release.assets.map((a) => a.downloads))

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav
          aria-label="Sections"
          className="hidden space-y-0.5 text-sm lg:sticky lg:top-20 lg:block lg:self-start"
        >
          {[
            ['download', 'Download'],
            ['install', 'Install'],
            ['changelog', 'Changelog'],
            ['files', 'All files'],
            ['history', 'Version history'],
            ['verify', 'Verify'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </a>
          ))}
          <div className="!mt-6 space-y-2 border-t px-3 pt-4 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <ScaleIcon className="size-3.5" /> {repo.license}
            </div>
            <LangDot language={repo.language} className="flex" />
          </div>
        </nav>

        <div className="min-w-0 space-y-12">
          <section id="download" className="scroll-mt-20">
            <Panel className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
                <div
                  role="group"
                  aria-label="Release channel"
                  className="well flex rounded-xl bg-muted/70 p-1 text-sm"
                >
                  {(['stable', 'beta', 'nightly'] as const).map((c) => {
                    const n = count(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={n === 0}
                        aria-pressed={release.channel === c}
                        title={n === 0 ? `No ${c} builds yet` : channelBlurb[c]}
                        onClick={() =>
                          setVersion(
                            repo.releases.find((r) => r.channel === c)
                              ?.version ?? null,
                          )
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-muted-foreground capitalize transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground',
                          release.channel === c &&
                            'raised bg-card font-medium text-foreground',
                        )}
                      >
                        {c}
                        {n > 0 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {n}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {release.signed ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success">
                    <ShieldCheckIcon className="size-4" /> Signed and
                    checksummed
                  </span>
                ) : (
                  <Chip tone="warning">Unsigned build</Chip>
                )}
              </div>
              <ReleaseNotice
                release={release}
                latest={latest}
                onOpen={setVersion}
              />
              <div className="flex flex-wrap items-center justify-between gap-6 px-6 py-8">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-sm text-muted-foreground">
                    {release.date}
                    <Chip tone={channelChip[release.channel]}>
                      {release.channel}
                    </Chip>
                    {release === latest && <Chip tone="brand">Latest</Chip>}
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tighter">
                    {repo.name} {release.version}
                  </div>
                  <p className="mt-1 text-muted-foreground">{release.title}</p>
                </div>
                <div className="space-y-3">
                  <DownloadButton release={release} size="lg" />
                  {fit === 'none' && target && (
                    <p className="max-w-72 text-sm text-muted-foreground">
                      {release.version} has no {osLabel[target.os]} build. It is
                      available for{' '}
                      {availableOses(release)
                        .map((o) => osLabel[o])
                        .join(' and ')}
                      .
                    </p>
                  )}
                  {best && target && (
                    <p className="max-w-72 truncate font-mono text-xs text-muted-foreground">
                      {best.file}
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t bg-muted/30 px-6 py-3">
                <TargetPicker />
              </div>
            </Panel>
          </section>
          <section id="install" className="scroll-mt-20 space-y-3">
            <SectionLabel>Or use a package manager</SectionLabel>
            {pinned && (
              <p className="text-sm text-muted-foreground">
                These commands install{' '}
                <span className="font-mono text-foreground">
                  {release.version}
                </span>{' '}
                exactly, not the latest.
              </p>
            )}
            <div className="flex gap-1">
              {installs.map(([label], i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setInstall(i)}
                  className={cn(
                    'rounded-lg px-3 py-1 font-mono text-xs text-muted-foreground hover:bg-muted',
                    install === i && 'bg-muted text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <CopyField value={installs[install][1]} />
          </section>
          <section id="changelog" className="scroll-mt-20 space-y-3">
            <SectionLabel>Changelog</SectionLabel>
            <Panel className="p-5">
              <ReleaseNotes release={release} />
            </Panel>
          </section>
          <section id="files" className="scroll-mt-20 space-y-3">
            <SectionLabel>All files</SectionLabel>
            <Panel className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Platform</th>
                    <th className="px-4 py-2 font-medium">File</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Downloads</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {release.assets.map((a) => {
                    const Icon = platformIcon[a.platform]
                    const mine = a === best && target !== null
                    return (
                      <tr key={a.file} className={cn(mine && 'bg-brand/10')}>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <Icon className="size-4 text-muted-foreground" />
                            {osLabel[a.platform]}
                            <span className="text-xs text-muted-foreground">
                              {a.arch}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {a.file}
                          {mine && (
                            <Chip tone="brand" className="ml-2 font-sans">
                              For you
                            </Chip>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {a.size}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-1.5 rounded-full bg-brand-ink/70"
                              style={{
                                width: `${(a.downloads / maxDownloads) * 80}px`,
                              }}
                            />
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {compact(a.downloads)}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href="#download"
                            onClick={(e) => e.preventDefault()}
                            className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-muted"
                            aria-label={`Download ${a.file}`}
                          >
                            <ArrowDownTrayIcon className="size-4" />
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Panel>
          </section>
          <section id="history" className="scroll-mt-20 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>Version history</SectionLabel>
              {repo.releases.length > 1 && (
                <Segmented
                  label="Show channel"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    ['all', `All ${repo.releases.length}`],
                    ...(['stable', 'beta', 'nightly'] as const)
                      .filter((c) => count(c) > 0)
                      .map((c): ['all' | Channel, string] => [
                        c,
                        `${c[0].toUpperCase()}${c.slice(1)} ${count(c)}`,
                      ]),
                  ]}
                />
              )}
            </div>
            <p className="max-w-[65ch] text-sm text-muted-foreground">
              Every release, newest first. Pick one to see its downloads and
              changelog, or to install an older version if the latest breaks
              something for you.
            </p>
            <Panel className="divide-y overflow-hidden">
              {repo.releases
                .filter((r) => filter === 'all' || r.channel === filter)
                .map((r) => (
                  <button
                    key={r.version}
                    type="button"
                    aria-current={r === release ? 'true' : undefined}
                    onClick={() => {
                      setVersion(r.version)
                      document
                        .getElementById('download')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }}
                    className={cn(
                      'flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50',
                      r === release && 'bg-brand/10',
                    )}
                  >
                    <span
                      className={cn(
                        'w-52 shrink-0 truncate font-mono font-medium',
                        r.withdrawn && 'text-muted-foreground line-through',
                      )}
                    >
                      {r.version}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Chip tone={channelChip[r.channel]}>{r.channel}</Chip>
                      {r === latest && <Chip tone="brand">Latest</Chip>}
                      {r.withdrawn && <Chip tone="danger">Withdrawn</Chip>}
                      {!r.signed && <Chip>Unsigned</Chip>}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {r.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.date}
                    </span>
                    <span className="w-16 text-right text-xs tabular-nums">
                      {compact(totalDownloads(r))}
                    </span>
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {r === release ? 'Viewing' : ''}
                    </span>
                  </button>
                ))}
            </Panel>
          </section>
          <details
            id="verify"
            className="group scroll-mt-20 rounded-2xl border bg-card px-5 py-4"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-muted-foreground hover:text-foreground">
              Verify your download
              <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                SHA-256 for <span className="font-mono">{best?.file}</span>
              </p>
              <CopyField prefix="sha256" value={best?.sha ?? ''} />
              <CopyField
                value={`shasum -a 256 -c ${repo.name}-${release.version}.sha256`}
              />
            </div>
          </details>
        </div>
      </div>
    </>
  )
}
