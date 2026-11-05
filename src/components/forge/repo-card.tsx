import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowTrendingUpIcon, StarIcon } from '@heroicons/react/24/outline'
import { LangDot, Tile } from './bits'
import type { Developer, Repo } from '~/mock/data'
import { GitForkIcon } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { availableOses, osLabel } from '~/lib/platform'
import { compact, latestStable } from '~/mock/data'

export const repoLink = (r: Repo, tab: string = 'code') =>
  ({
    to: '/$handle/$repo/$tab',
    params: { handle: r.owner, repo: r.name, tab },
  }) as const

function Counts({ repo, showToday }: { repo: Repo; showToday?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <LangDot language={repo.language} />
      <span className="inline-flex items-center gap-1 tabular-nums">
        <StarIcon className="size-3.5" />
        {compact(repo.stars)}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <GitForkIcon className="size-3.5" />
        {compact(repo.forks)}
      </span>
      {showToday && (
        <span className="inline-flex items-center gap-1 text-success tabular-nums">
          <ArrowTrendingUpIcon className="size-3.5" />+{repo.starsToday} today
        </span>
      )}
    </div>
  )
}

/** A compact tile for grids. */
export function RepoCard({ repo }: { repo: Repo }) {
  return (
    <article className="pop relative flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <Tile name={repo.name} className="size-8 text-xs" />
        <h3 className="min-w-0 truncate font-mono text-sm font-semibold">
          <Link
            {...repoLink(repo)}
            className="outline-none before:absolute before:inset-0 before:rounded-xl focus-visible:before:ring-2 focus-visible:before:ring-ring"
          >
            <span className="font-normal text-muted-foreground">
              {repo.owner}/
            </span>
            {repo.name}
          </Link>
        </h3>
      </div>
      <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
        {repo.description}
      </p>
      <Counts repo={repo} />
    </article>
  )
}

/** One line per project, for lists you scan. */
export function RepoRow({
  repo,
  showToday,
}: {
  repo: Repo
  showToday?: boolean
}) {
  const release = latestStable(repo)
  return (
    <article className="relative flex items-center gap-4 px-4 py-3.5 hover:bg-muted/50">
      <Tile name={repo.name} className="size-9" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm font-semibold">
            <Link
              {...repoLink(repo)}
              className="before:absolute before:inset-0"
            >
              <span className="font-normal text-muted-foreground">
                {repo.owner}/
              </span>
              {repo.name}
            </Link>
          </h3>
          {release && <Badge tone="outline">{release.version}</Badge>}
          {release && (
            <span className="text-xs text-muted-foreground">
              {availableOses(release)
                .map((os) => osLabel[os])
                .join(' · ')}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1">
          {repo.description}
        </p>
        <Counts repo={repo} showToday={showToday} />
      </div>
      {release ? (
        <Button
          size="sm"
          className="relative hidden shrink-0 sm:inline-flex"
          render={
            <Link
              {...repoLink(repo, 'releases')}
              aria-label={`Download ${repo.name}`}
            />
          }
          nativeButton={false}
        >
          Download
        </Button>
      ) : (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {repo.category}
        </span>
      )}
    </article>
  )
}

export function DeveloperRow({ dev }: { dev: Developer }) {
  const [following, setFollowing] = React.useState(false)
  return (
    <article className="relative flex items-center gap-4 px-4 py-3.5 hover:bg-muted/50">
      <Tile name={dev.name} hue={dev.hue} round className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          <Link
            to="/$handle"
            params={{ handle: dev.handle }}
            className="before:absolute before:inset-0"
          >
            {dev.name}
          </Link>
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            @{dev.handle}
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{dev.bio}</p>
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          {dev.languages.map((l) => (
            <LangDot key={l} language={l} />
          ))}
          <span className="tabular-nums">
            {dev.contributions.toLocaleString()} contributions
          </span>
        </div>
      </div>
      <Button
        size="sm"
        className="relative z-10"
        aria-pressed={following}
        onClick={() => setFollowing((f) => !f)}
      >
        {following ? 'Following' : 'Follow'}
      </Button>
    </article>
  )
}
