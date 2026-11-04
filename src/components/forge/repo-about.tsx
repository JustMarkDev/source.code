import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  RocketLaunchIcon,
  ScaleIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { CopyField, Languages } from './repo-shell'
import type { Repo } from '~/mock/data'
import { Segmented } from '~/components/ui/tabs'
import { latestStable } from '~/mock/data'

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
    [string, (n: string) => string] | undefined
  if (lang) out.push([lang[0], lang[1](repo.name)])
  out.push(['docker', `docker run --rm source.code/${repo.owner}/${repo.name}`])
  return out
}

/**
 * The facts about a repository, kept out of the README. Everything here is
 * detected: the license from the LICENSE file, languages from the code, the
 * release from the latest tag.
 */
export function AboutPanel({ repo }: { repo: Repo }) {
  const installs = installsFor(repo)
  const [which, setWhich] = React.useState(installs[0][0])
  const current = installs.find(([k]) => k === which) ?? installs[0]
  const release = latestStable(repo)
  return (
    <aside className="space-y-6 text-sm">
      <section className="space-y-2">
        <h2 className="font-medium">About</h2>
        <p className="text-muted-foreground">{repo.description}</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Install</h2>
        <Segmented
          label="Install with"
          value={which}
          onChange={setWhich}
          options={installs.map(([k]): [string, string] => [k, k])}
        />
        <CopyField value={current[1]} prefix="$" />
      </section>

      <ul className="space-y-2.5 text-muted-foreground">
        <li className="flex items-center gap-2.5">
          <ScaleIcon className="size-4 shrink-0" />
          <span>
            <span className="text-foreground">{repo.license} license</span>{' '}
            <span className="text-xs">from LICENSE</span>
          </span>
        </li>
        {release && (
          <li className="flex items-center gap-2.5">
            <RocketLaunchIcon className="size-4 shrink-0" />
            <Link
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'releases' }}
              className="text-foreground hover:underline"
            >
              {release.version}
            </Link>
            <span className="text-xs">{release.date}</span>
          </li>
        )}
        <li className="flex items-center gap-2.5">
          <UsersIcon className="size-4 shrink-0" />
          <Link
            to="/$handle/$repo/$tab"
            params={{ handle: repo.owner, repo: repo.name, tab: 'insights' }}
            className="hover:text-foreground"
          >
            21 contributors
          </Link>
        </li>
      </ul>

      <section className="space-y-2">
        <h2 className="font-medium">Languages</h2>
        <Languages repo={repo} />
      </section>
    </aside>
  )
}
