import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, LangDot, Panel, SectionLabel } from './bits'
import { CodeBrowser } from './repo-code-browser'
import { HistoryView } from './repo-history'
import { DownloadButton, TargetPicker } from './download-button'
import { CopyField, RepoHeader } from './repo-shell'
import type { Channel, Release, Repo } from '~/mock/data'
import { GitBranchIcon } from '~/components/icons'
import { Button } from '~/components/ui/button'
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
export function CodePage({
  repo,
  path,
  view,
}: {
  repo: Repo
  path?: string
  view?: 'history'
}) {
  const release = latestStable(repo)
  const [finding, setFinding] = React.useState(false)
  return (
    <>
      <RepoHeader
        repo={repo}
        active="code"
        actions={
          view === 'history' ? undefined : (
            <>
              <span className="mr-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <GitBranchIcon className="size-4" />
                main
              </span>
              <Tip label="Go to file">
                <Button
                  size="icon"
                  aria-label="Go to file"
                  onClick={() => setFinding(true)}
                >
                  <MagnifyingGlassIcon />
                </Button>
              </Tip>
              <ClonePopover repo={repo} />
              {release && <DownloadButton release={release} />}
            </>
          )
        }
      />
      {view === 'history' ? (
        <HistoryView repo={repo} />
      ) : (
        <CodeBrowser
          repo={repo}
          path={path}
          finding={finding}
          onFinding={setFinding}
        />
      )}
    </>
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
          <Popover.Popup className="w-96 space-y-3 rounded-xl border bg-popover p-3 shadow-xl outline-none">
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
export function ReleasesPage({ repo }: { repo: Repo }) {
  const { target } = useTarget()
  const [channel, setChannel] = React.useState<Channel>('stable')
  const [install, setInstall] = React.useState(0)
  const release =
    repo.releases.find((r) => r.channel === channel) ?? latestStable(repo)

  const installs = [
    [
      'curl',
      `curl -fsSL https://source.code/${repo.owner}/${repo.name}/install | sh`,
    ],
    ['brew', `brew install ${repo.owner}/tap/${repo.name}`],
    ['cargo', `cargo install ${repo.name}`],
    ['docker', `docker run --rm ghcr.io/${repo.owner}/${repo.name}`],
  ] as const

  if (!release) {
    return (
      <>
        <RepoHeader repo={repo} active="release" />
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
      <RepoHeader repo={repo} active="release" />
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
                <div className="well flex rounded-xl bg-muted/70 p-1 text-sm">
                  {(['stable', 'beta', 'nightly'] as const).map((c) => {
                    const exists = repo.releases.some((r) => r.channel === c)
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!exists}
                        onClick={() => setChannel(c)}
                        className={cn(
                          'rounded-lg px-3 py-1 text-muted-foreground capitalize disabled:opacity-40',
                          release.channel === c &&
                            'raised bg-card font-medium text-foreground',
                        )}
                      >
                        {c}
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
              <div className="flex flex-wrap items-center justify-between gap-6 px-6 py-8">
                <div>
                  <div className="font-mono text-sm text-muted-foreground">
                    {release.date}
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
            <SectionLabel>Version history</SectionLabel>
            <Panel className="divide-y">
              {repo.releases.map((r) => (
                <div
                  key={r.version}
                  className="flex items-center gap-4 px-4 py-3 text-sm"
                >
                  <span className="w-36 font-mono font-medium">
                    {r.version}
                  </span>
                  <Chip tone={r.channel === 'stable' ? 'success' : 'warning'}>
                    {r.channel}
                  </Chip>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {r.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.date}
                  </span>
                  <span className="w-16 text-right text-xs tabular-nums">
                    {compact(totalDownloads(r))}
                  </span>
                </div>
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
