/**
 * The repository screens were designed on sample data shaped as `mock/data`'s
 * `Repo`. This turns the API's repository into that shape, so a component
 * moves to the API by changing where its repository comes from, not how it
 * reads one.
 */
import type {
  Release as ApiRelease,
  Repo as ApiRepo,
  GitCommit,
} from '@source-code/sdk'
import type { Release, Repo, Source } from '~/lib/model/data'

/** "3 hours ago", "yesterday", "2 weeks ago", from an RFC 3339 time. */
export function timeAgo(iso: string, now = Date.now()): string {
  const h = (now - Date.parse(iso)) / 3_600_000
  if (h < 1) return 'just now'
  if (h < 24) {
    const n = Math.round(h)
    return `${n} hour${n === 1 ? '' : 's'} ago`
  }
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 60) return `${Math.round(d / 7)} weeks ago`
  return `${Math.round(d / 30)} months ago`
}

/** "Nov 2, 2026", in UTC so the server and the browser agree. */
export const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

const sourceOf = (r: ApiRepo): Source => r.upstream?.host ?? 'native'

export function toRepo(r: ApiRepo, releases?: Array<Release>): Repo {
  return {
    owner: r.owner,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    category: r.category ?? 'Developer tools',
    language: r.language ?? '',
    languages: r.languages.map((l) => [l.name, l.percent]),
    stars: r.stars,
    starsToday: r.stars_today,
    forks: r.forks,
    license: r.license ?? '',
    updated: timeAgo(r.updated_at),
    source: sourceOf(r),
    upstream: r.upstream
      ? `${
          {
            github: 'github.com',
            gitlab: 'gitlab.com',
            codeberg: 'codeberg.org',
            gitea: 'gitea.com',
          }[r.upstream.host]
        }/${r.upstream.slug}`
      : undefined,
    releases: releases ?? [],
    install: r.install ?? undefined,
    website: r.website ?? undefined,
    docs: r.docs_url ?? undefined,
  }
}

/** "14.2 MB", from bytes. */
const sizeOf = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

export function toRelease(r: ApiRelease): Release {
  return {
    version: r.tag,
    channel: r.channel,
    date: dayOf(r.published_at),
    signed: r.signed,
    title: r.title,
    notes: r.notes,
    assets: r.assets.map((a) => ({
      platform: a.platform,
      arch: a.arch,
      file: a.name,
      size: sizeOf(a.size),
      downloads: a.downloads,
      sha: a.sha256,
      stored: a.content_url !== null,
    })),
    commit: r.commit ?? undefined,
    withdrawn: r.withdrawn?.reason,
  }
}

/** Who wrote a commit: a person, an agent or a bot. */
export type Committer = { name: string; kind: 'human' | 'agent' | 'bot' }

/** Who wrote a commit, as the history screens show them. */
export function committerOf(c: GitCommit): Committer {
  if (!c.actor) return { name: c.author.name, kind: 'human' }
  return { name: c.actor.handle, kind: c.actor.class }
}
