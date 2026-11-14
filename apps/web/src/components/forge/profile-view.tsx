import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import {
  MagnifyingGlassIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline'
import { api } from '../../../../../convex/_generated/api'
import { useSignInGate } from './auth'
import { CopyAddress, EmptyState, LangDot, Tile } from './bits'
import { RepoCard, RepoRow } from './repo-card'
import { ContributionGraph } from './repo-shell'
import { profileTabs } from './profile-tabs'
import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Repo } from '~/lib/model/data'
import type { ProfileTab } from './profile-tabs'
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
import { compact } from '~/lib/model/data'
import { Stagger } from '~/components/motion'
import { authClient } from '~/lib/auth/client'
import { timeAgo, toRepo } from '~/lib/repo'
import { useOpMaybe, useWrite } from '~/lib/forge'

export type { ProfileTab }

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

const seedOf = (handle: string) =>
  Array.from(handle).reduce((n, c) => n + c.charCodeAt(0), 0)

/** `2026-03` as `Mar`. */
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en', {
    month: 'short',
    timeZone: 'UTC',
  })

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
  embedded = false,
}: {
  /** Shown inside another page that already has the h1. */
  embedded?: boolean
  handle: string
  tab: ProfileTab
  tabLink: (tab: ProfileTab) => LinkProps
}) {
  const { data } = useQuery(convexQuery(api.profiles.get, { handle }))
  const profile = useOpMaybe('accounts.profile', { handle })
  const write = useWrite()
  const Name = embedded ? 'h2' : 'h1'
  const { data: session } = authClient.useSession()
  const gate = useSignInGate()
  const isMe = session?.user.handle === handle
  const following = profile?.viewer_follows ?? false

  const name =
    data?.account.name ?? profile?.name ?? (isMe ? session.user.name : handle)
  const bio = data?.account.bio ?? profile?.bio ?? ''
  const now = data?.account.now
  const followers = profile?.followers ?? 0
  const contributions = profile?.contributions.total ?? 0

  const listed = useOpMaybe('repos.list', { owner: handle, limit: 100 })
  const projects: Array<Repo> = React.useMemo(
    () =>
      (listed?.data ?? [])
        .map((r) => toRepo(r))
        .sort((a, b) => b.stars - a.stars),
    [listed],
  )

  const seed = seedOf(handle)
  const charts = React.useMemo(() => {
    const year = (profile?.contributions.by_month ?? []).map((m) => ({
      label: monthName(m.month),
      value: m.count,
    }))
    const week = (profile?.contributions.by_weekday ?? []).map((d) => ({
      label: d.day,
      commits: d.commits,
      reviews: d.reviews,
    }))
    const shape = (profile?.work ?? []).map((w) => ({
      axis: w.axis,
      value: w.value,
    }))
    const langs = (profile?.languages ?? []).slice(0, 4).map((l) => ({
      name: l.name,
      value: l.percent,
    }))
    return { year, week, shape, langs }
  }, [profile])

  const downloads = profile?.downloads ?? 0
  const releases = profile?.releases ?? 0

  const feed: Array<FeedItem> = React.useMemo(() => {
    const done: Array<FeedItem> = (profile?.activity ?? []).map((e) => ({
      kind: e.kind === 'change' || e.kind === 'issue' ? 'review' : e.kind,
      title: e.title,
      repo: e.repo,
      when: timeAgo(e.at),
      month: new Date(e.at).toLocaleString('en', {
        month: 'long',
        year: 'numeric',
      }),
    }))
    return done
  }, [profile])

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <Tile name={name} hue={seed % 360} round className="size-20 text-2xl" />
        <div>
          <Name className="text-xl font-semibold tracking-tight">{name}</Name>
          <CopyAddress handle={handle} />
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
            onClick={() =>
              gate(
                () =>
                  void write(following ? 'follows.remove' : 'follows.add', {
                    handle,
                  }),
              )
            }
          >
            {following ? 'Following' : 'Follow'}
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{compact(followers)}</b>{' '}
          {followers === 1 ? 'follower' : 'followers'} ·{' '}
          <b className="font-semibold text-foreground">
            {compact(profile?.following ?? 0)}
          </b>{' '}
          following
        </p>
        {charts.langs.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {charts.langs.map((l) => (
              <LangDot key={l.name} language={l.name} />
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
                [
                  'With agents',
                  profile?.agent_share === null ||
                  profile?.agent_share === undefined
                    ? 'n/a'
                    : `${profile.agent_share}%`,
                  'of changes reviewed',
                ],
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
              note={
                profile?.contributions.private
                  ? `Past year, ${profile.contributions.private} of them in private repositories`
                  : 'Past year: commits, reviews, changes, issues and releases'
              }
            >
              <div className="h-52 rounded-xl border bg-card p-3">
                <TrendChart
                  data={charts.year}
                  unit="Contributions"
                  className="h-full"
                />
              </div>
            </Block>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
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
                <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {projects.slice(0, 4).map((r) => (
                    <RepoCard key={r.name} repo={r} />
                  ))}
                </Stagger>
              </Block>
            )}
          </div>
        )}

        {tab === 'repositories' && <Repositories projects={projects} />}

        {tab === 'activity' && (
          <div className="space-y-10">
            <Block title="Daily activity" note="Past 26 weeks">
              <div className="rounded-xl border bg-card p-4">
                {profile?.activity_hidden ? (
                  <p className="text-sm text-muted-foreground">
                    {name} keeps their activity private.
                  </p>
                ) : (
                  <ContributionGraph
                    seed={seed}
                    counts={profile?.contributions.by_day}
                    weeks={26}
                  />
                )}
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
