import { Link } from '@tanstack/react-router'
import { Tile } from './bits'
import type { Repo } from '~/lib/model/data'
import { Button } from '~/components/ui/button'
import { availableOses, osLabel, useTarget } from '~/lib/platform'
import { latestStable } from '~/lib/model/data'

/**
 * A piece of software someone can download, for people who are not here to
 * read code: what it is, which systems it runs on, and one button that says
 * which system we think they are on.
 */
export function SoftwareCard({ repo }: { repo: Repo }) {
  const { target } = useTarget()
  const release = latestStable(repo)
  const oses = release ? availableOses(release) : []
  const mine = target !== null && oses.includes(target.os)
  return (
    <article className="surface relative flex flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/25">
      <div className="flex items-center gap-3">
        <Tile name={repo.name} className="size-11 text-lg" />
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight">
            <Link
              to="/$handle/$repo/$tab"
              params={{
                handle: repo.owner,
                repo: repo.name,
                tab: 'releases',
              }}
              className="before:absolute before:inset-0"
            >
              {repo.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            by {repo.owner}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
        {repo.description}
      </p>
      <div className="space-y-3">
        {oses.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {oses.map((os) => osLabel[os]).join(' · ')}
          </p>
        )}
        <Button
          size="sm"
          className="relative w-full"
          render={
            <Link
              to="/$handle/$repo/$tab"
              params={{
                handle: repo.owner,
                repo: repo.name,
                tab: 'releases',
              }}
            />
          }
          nativeButton={false}
        >
          {mine ? `Download for ${osLabel[target.os]}` : 'Download'}
        </Button>
      </div>
    </article>
  )
}
