import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import {
  LinkIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline'
import { api } from '../../../convex/_generated/api'
import { EmptyState, LangDot, Tile } from './bits'
import { RepoCard, RepoRow } from './repo-card'
import { ContributionGraph } from './repo-shell'
import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Repo } from '~/mock/data'
import { GitCommitIcon, GitMergeIcon } from '~/components/icons'
import {
  GroupedBars,
  ShapeRadar,
  ShareDonut,
  TrendChart,
} from '~/components/charts'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { LinkTabs } from '~/components/ui/tabs'
import {
  compact,
  developers,
  repos as mockRepos,
  seeded,
  totalDownloads,
} from '~/mock/data'
import { workShape } from '~/mock/platform'

export type ProfileTab = 'overview' | 'repositories' | 'activity'
export const profileTabs: Array<[ProfileTab, string]> = [
  ['overview', 'Overview'],
  ['repositories', 'Repositories'],
  ['activity', 'Activity'],
]

type FeedItem = {
  kind: 'release' | 'push' | 'review' | 'agent'
  title: string
  repo: string
  when: string
  month: string
}

const feedIcon = {
  release: RocketLaunchIcon,
  push: GitCommitIcon,
  review: GitMergeIcon,
  agent: GitMergeIcon,
} as const

function toRepo(
  handle: string,
  r: { name: string; description: string; stars: number },
): Repo {
  return (
    mockRepos.find((m) => m.owner === handle && m.name === r.name) ?? {
      owner: handle,
      name: r.name,
      description: r.description,
      category: 'Developer tools',
      language: 'TypeScript',
      languages: [['TypeScript', 100]],
      stars: r.stars,
      starsToday: 0,
      forks: 0,
      license: 'MIT',
      updated: 'recently',
      source: 'native',
      releases: [],
    }
  )
}

const seedOf = (handle: string) =>
  [...handle].reduce((n, c) => n + c.charCodeAt(0), 0)

const months = [
  'Dec',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
]
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A titled block. Titles are plain; the chart does the talking. */
function Block({
  title,
  note,
  children,
  className,
}: {
  title: string
  note?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** The public profile: what anyone sees when they open a person. */
export function ProfileView({
  handle,
  tab,
  tabLink,
}: {
  handle: string
  tab: ProfileTab
  tabLink: (tab: ProfileTab) => LinkProps
}) {
  const { data } = useQuery(convexQuery(api.profiles.get, { handle }))
  const dev = developers.find((d) => d.handle === handle)
  const isMe = handle === 'dana'
  const [following, setFollowing] = React.useState(false)

  const name = data?.user.name ?? dev?.name ?? handle
  const bio = data?.user.bio ?? dev?.bio ?? ''
  const now = data?.user.now
  const followers = dev?.followers ?? 128
  const contributions = dev?.contributions ?? 412

  const projects: Array<Repo> = React.useMemo(() => {
    const own = mockRepos.filter((r) => r.owner === handle)
    const fromConvex = data?.repos.map((r) => toRepo(handle, r)) ?? []
    const byName = new Map([...own, ...fromConvex].map((r) => [r.name, r]))
    return [...byName.values()].sort((a, b) => b.stars - a.stars)
  }, [handle, data])

  const seed = seedOf(handle)
  const charts = React.useMemo(() => {
    const rand = seeded(seed)
    const year = months.map((label, i) => ({
      label,
      value: Math.round(
        contributions / 14 + rand() * 90 + Math.sin(i / 2) * 40 + i * 6,
      ),
    }))
    const week = days.map((label, i) => ({
      label,
      commits: Math.round(20 + rand() * 60 - (i > 4 ? 25 : 0)),
      reviews: Math.round(8 + rand() * 30 - (i > 4 ? 12 : 0)),
    }))
    const shape = workShape(seed).map((s) => ({
      axis: s.label,
      value: s.value,
    }))
    const langWeights = new Map<string, number>()
    for (const p of projects)
      for (const [l, pct] of p.languages)
        langWeights.set(l, (langWeights.get(l) ?? 0) + pct * (p.stars + 50))
    const total = [...langWeights.values()].reduce((a, b) => a + b, 0) || 1
    const langs = [...langWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([lang, v]) => ({
        name: lang,
        value: Math.round((v / total) * 100),
      }))
    return {
      year,
      week,
      shape,
      langs,
      yearTotal: year.reduce((a, b) => a + b.value, 0),
    }
  }, [seed, contributions, projects])

  const downloads = projects.reduce(
    (sum, p) => sum + p.releases.reduce((s, r) => s + totalDownloads(r), 0),
    0,
  )
  const releases = projects.reduce((n, p) => n + p.releases.length, 0)

  const feed: Array<FeedItem> = React.useMemo(() => {
    const live: Array<FeedItem> = (data?.activity ?? []).map((e) => ({
      kind: e.kind === 'agent_session' ? 'agent' : e.kind,
      title: e.title,
      repo: e.repo ?? '',
      when: 'recently',
      month: 'This month',
    }))
    const first = projects.at(0)?.name ?? 'project'
    const second = projects.at(1)?.name ?? first
    const older: Array<FeedItem> = [
      {
        kind: 'push',
        title: 'Pushed 3 commits to main',
        repo: first,
        when: '3 weeks ago',
        month: 'October',
      },
      {
        kind: 'review',
        title: 'Reviewed 2 changes',
        repo: second,
        when: '3 weeks ago',
        month: 'October',
      },
      {
        kind: 'release',
        title: 'Published a release',
        repo: first,
        when: '1 month ago',
        month: 'October',
      },
      {
        kind: 'push',
        title: 'Pushed 7 commits to main',
        repo: second,
        when: '1 month ago',
        month: 'September',
      },
    ]
    return [...live, ...older]
  }, [data, projects])

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <Tile
          name={name}
          hue={dev?.hue ?? 160}
          round
          className="size-20 text-2xl"
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="font-mono text-sm text-muted-foreground">@{handle}</p>
        </div>
        {bio && <p className="text-sm">{bio}</p>}
        {now && <p className="text-sm text-muted-foreground">Now: {now}</p>}
        {isMe ? (
          <Button
            className="w-full"
            render={
              <Link to="/settings/$section" params={{ section: 'profile' }} />
            }
            nativeButton={false}
          >
            Edit profile
          </Button>
        ) : (
          <Button
            className="w-full"
            variant={following ? 'outline' : 'default'}
            aria-pressed={following}
            onClick={() => setFollowing((f) => !f)}
          >
            {following ? 'Following' : 'Follow'}
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{compact(followers)}</b>{' '}
          followers · <b className="font-semibold text-foreground">48</b>{' '}
          following
        </p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <MapPinIcon className="size-4" /> Lagos
          </li>
          <li className="flex items-center gap-2">
            <LinkIcon className="size-4" /> {handle}.dev
          </li>
        </ul>
        {dev && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {dev.languages.map((l) => (
              <LangDot key={l} language={l} />
            ))}
          </div>
        )}
      </aside>

      <div className="min-w-0 space-y-8">
        <LinkTabs
          label="Profile"
          tabs={profileTabs.map(([id, label]) => ({
            label,
            active: id === tab,
            count: id === 'repositories' ? projects.length : undefined,
            link: tabLink(id),
          }))}
        />

        {tab === 'overview' && (
          <div className="space-y-10">
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {[
                ['Contributions', contributions.toLocaleString(), 'past year'],
                ['Releases', String(releases), 'shipped'],
                ['Downloads', compact(downloads), 'all time'],
                ['With agents', '31%', 'of changes'],
              ].map(([k, v, h]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                    {v}
                  </dd>
                  <dd className="text-xs text-muted-foreground">{h}</dd>
                </div>
              ))}
            </dl>

            <Block
              title="Contributions"
              note="Everything counted, from every place this person has worked"
            >
              <div className="h-52 rounded-xl border bg-card p-3">
                <TrendChart
                  data={charts.year}
                  unit="Contributions"
                  className="h-full"
                />
              </div>
            </Block>

            <div className="grid gap-8 md:grid-cols-3">
              <Block title="What they work on">
                <div className="h-48">
                  <ShapeRadar data={charts.shape} />
                </div>
              </Block>
              <Block title="Languages">
                <div className="h-48">
                  <ShareDonut data={charts.langs} />
                </div>
              </Block>
              <Block title="Week by week">
                <div className="h-48">
                  <GroupedBars
                    data={charts.week}
                    series={[
                      { key: 'commits', label: 'Commits', color: 'green' },
                      { key: 'reviews', label: 'Reviews', color: 'blue' },
                    ]}
                  />
                </div>
              </Block>
            </div>

            {projects.length > 0 && (
              <Block title="Popular projects">
                <div className="grid gap-4 sm:grid-cols-2">
                  {projects.slice(0, 4).map((r) => (
                    <RepoCard key={r.name} repo={r} />
                  ))}
                </div>
              </Block>
            )}
          </div>
        )}

        {tab === 'repositories' && <Repositories projects={projects} />}

        {tab === 'activity' && (
          <div className="space-y-10">
            <Block title="Daily activity" note="Past 26 weeks">
              <div className="rounded-xl border bg-card p-4">
                <ContributionGraph seed={seed} weeks={26} />
              </div>
            </Block>
            <Feed items={feed} handle={handle} />
          </div>
        )}
      </div>
    </div>
  )
}

function Repositories({ projects }: { projects: Array<Repo> }) {
  const [q, setQ] = React.useState('')
  const shown = projects.filter((r) =>
    `${r.name} ${r.description}`.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a repository"
          aria-label="Find a repository"
          className="pl-8"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No repositories match" />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {shown.map((r) => (
            <RepoRow key={r.name} repo={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function Feed({ items, handle }: { items: Array<FeedItem>; handle: string }) {
  if (!items.length) return <EmptyState title="Nothing yet" />
  const groups = [...new Set(items.map((i) => i.month))]
  return (
    <div className="space-y-6">
      {groups.map((m) => (
        <Block key={m} title={m}>
          <ul className="space-y-3">
            {items
              .filter((i) => i.month === m)
              .map((e, idx) => {
                const Icon = feedIcon[e.kind]
                return (
                  <li key={idx} className="flex items-start gap-3 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      {e.title}
                      {e.repo && (
                        <Link
                          to="/$handle/$repo/$tab"
                          params={{ handle, repo: e.repo, tab: 'code' }}
                          className="ml-1.5 font-mono text-muted-foreground hover:underline"
                        >
                          {e.repo}
                        </Link>
                      )}
                      {e.kind === 'agent' && (
                        <Badge className="ml-2">agent session</Badge>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {e.when}
                    </span>
                  </li>
                )
              })}
          </ul>
        </Block>
      ))}
    </div>
  )
}
