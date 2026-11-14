import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  BookOpenIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  RocketLaunchIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { Avatar } from './bits'
import { CopyField, Languages } from './repo-shell'
import type { Repo } from '~/lib/model/data'
import { Segmented } from '~/components/ui/tabs'
import { latestStable } from '~/lib/model/data'
import { useOpMaybe } from '~/lib/forge'

const SHOWN_AVATARS = 6
const MONTH = 30 * 24 * 3_600_000

/** The handle behind a contributor's email when it is one of ours, else their name. */
const handleOf = (c: { name: string; email: string }) =>
  c.email.toLowerCase().endsWith('@users.source.code')
    ? c.email.split('@')[0]
    : c.name

const langInstall: Record<string, [string, (name: string) => string]> = {
  Rust: ['cargo', (n) => `cargo install ${n}`],
  TypeScript: ['npm', (n) => `npm install -g ${n}`],
  Go: ['go', (n) => `go install github.com/${n}@latest`],
  Python: ['pip', (n) => `pip install ${n}`],
}

/** Ways to install, built from what the repository ships. */
function installsFor(repo: Repo): Array<[string, string]> {
  const out: Array<[string, string]> = []
  out.push([
    'script',
    repo.install ??
      `curl -fsSL https://source.code/${repo.owner}/${repo.name}/install | sh`,
  ])
  out.push(['brew', `brew install ${repo.owner}/tap/${repo.name}`])
  const lang = langInstall[repo.language] as
    | [string, (n: string) => string]
    | undefined
  if (lang) out.push([lang[0], lang[1](repo.name)])
  out.push(['docker', `docker run --rm source.code/${repo.owner}/${repo.name}`])
  return out
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {aside && (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}

type Icon = React.ComponentType<{ className?: string }>

const linkClass =
  'inline-flex items-center gap-1.5 py-0.5 text-muted-foreground hover:text-foreground'

function ExternalLink({
  href,
  icon: Icon,
  children,
}: {
  href: string
  icon: Icon
  children: React.ReactNode
}) {
  return (
    <li>
      <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
        <Icon className="size-4" />
        {children}
      </a>
    </li>
  )
}

/** A file in the repository, opened in the code browser. */
function FileLink({
  repo,
  path,
  icon: Icon,
  children,
}: {
  repo: Repo
  path: string
  icon: Icon
  children: React.ReactNode
}) {
  return (
    <li>
      <Link
        to="/$handle/$repo/$tab"
        params={{ handle: repo.owner, repo: repo.name, tab: 'code' }}
        search={{ path }}
        className={linkClass}
      >
        <Icon className="size-4" />
        {children}
      </Link>
    </li>
  )
}

/**
 * The facts about a repository, kept out of the README. Everything here is
 * detected: the license from the LICENSE file, languages from the code, the
 * release from the latest tag.
 */
export function AboutPanel({
  repo,
  onOpenLicense,
}: {
  repo: Repo
  /** Switch the README card to its License tab instead of leaving the page. */
  onOpenLicense: () => void
}) {
  const installs = installsFor(repo)
  const [which, setWhich] = React.useState(installs[0][0])
  const current = installs.find(([k]) => k === which) ?? installs[0]
  const release = latestStable(repo)
  const contributors =
    useOpMaybe('repos.contributors', { owner: repo.owner, repo: repo.name })
      ?.data ?? []
  // Measured from the newest commit, so a quiet repository is not "0 active".
  const newest = Math.max(
    0,
    ...contributors.map((c) => Date.parse(c.last_commit_at)),
  )
  const active = contributors.filter(
    (c) => newest - Date.parse(c.last_commit_at) < MONTH,
  ).length
  const insights = {
    to: '/$handle/$repo/$tab',
    params: { handle: repo.owner, repo: repo.name, tab: 'insights' },
  } as const
  return (
    <aside className="surface flex min-w-0 flex-col divide-y overflow-hidden rounded-2xl border bg-card text-sm">
      <Section title="Install">
        <Segmented
          label="Install with"
          value={which}
          onChange={setWhich}
          options={installs.map(([k]): [string, string] => [k, k])}
        />
        <CopyField value={current[1]} prefix="$" />
      </Section>

      <Section title="Details">
        <ul className="space-y-2">
          {release && (
            <li className="flex items-center gap-2.5">
              <RocketLaunchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Link
                to="/$handle/$repo/$tab"
                params={{
                  handle: repo.owner,
                  repo: repo.name,
                  tab: 'releases',
                }}
                className="font-medium hover:underline"
              >
                {release.version}
              </Link>
              <span className="ml-auto text-xs text-muted-foreground">
                {release.date}
              </span>
            </li>
          )}
          <li className="flex items-center gap-2.5">
            <ScaleIcon className="size-4 shrink-0 text-muted-foreground" />
            <button
              type="button"
              onClick={onOpenLicense}
              className="font-medium hover:underline"
            >
              {repo.license}
            </button>
            <span className="ml-auto text-xs text-muted-foreground">
              license
            </span>
          </li>
        </ul>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2.5 text-xs">
          {repo.website && (
            <ExternalLink href={repo.website} icon={GlobeAltIcon}>
              Website
            </ExternalLink>
          )}
          {repo.docs && (
            <ExternalLink href={repo.docs} icon={BookOpenIcon}>
              Docs
            </ExternalLink>
          )}
          <FileLink repo={repo} path="SECURITY.md" icon={ShieldCheckIcon}>
            Security policy
          </FileLink>
          <FileLink repo={repo} path="CHANGELOG.md" icon={DocumentTextIcon}>
            Changelog
          </FileLink>
        </ul>
      </Section>

      {contributors.length > 0 && (
        <Section
          title="Contributors"
          aside={`${active} active in the last month`}
        >
          <Link
            {...insights}
            className="group -my-1 flex items-center gap-3 py-1"
          >
            <span className="flex -space-x-1.5">
              {contributors.slice(0, SHOWN_AVATARS).map((c) => (
                <Avatar
                  key={c.email}
                  handle={handleOf(c)}
                  className="size-7 text-xs ring-2 ring-card"
                />
              ))}
            </span>
            <span className="text-xs text-muted-foreground group-hover:text-foreground">
              <b className="font-medium text-foreground">
                {contributors.length}
              </b>{' '}
              in total
            </span>
          </Link>
        </Section>
      )}

      <Section title="Languages">
        <Languages repo={repo} />
      </Section>
    </aside>
  )
}
