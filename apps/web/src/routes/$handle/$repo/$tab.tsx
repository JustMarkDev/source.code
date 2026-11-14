import * as React from 'react'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import type { RepoPage } from '~/components/forge/repo-shell'
import { RequireAuth } from '~/components/forge/auth'
import { InsightsPage, IssuesPage } from '~/components/forge/repo-pages'
import { ChangesPage } from '~/components/forge/repo-changes'
import { PipelinesPage } from '~/components/forge/repo-runs'
import {
  CodeActions,
  CodePage,
  ReleasesPage,
} from '~/components/forge/repo-variants'
import { RepoFrame } from '~/components/forge/repo-shell'
import { RepoSettings } from '~/components/forge/repo-settings'
import type { Repo } from '~/lib/model/data'
import { ForgeRefused, loadOp, useOp } from '~/lib/forge'
import { toRelease, toRepo } from '~/lib/repo'

/** URL segment -> the tab it highlights. */
const activeOf: Partial<Record<string, RepoPage>> = {
  code: 'code',
  issues: 'issues',
  changes: 'pulls',
  pipelines: 'pipelines',
  releases: 'release',
  insights: 'insights',
  settings: 'settings',
}

type TabSearch = {
  n?: number
  section?: string
  path?: string
  view?: 'history'
}

export const Route = createFileRoute('/$handle/$repo/$tab')({
  // The tab was called Actions. Old links lead to the same page under its name.
  beforeLoad: ({ params }) => {
    if (params.tab === 'actions')
      throw redirect({
        to: '/$handle/$repo/$tab',
        params: { ...params, tab: 'pipelines' },
        search: true,
      })
  },
  head: ({ params }) => ({
    meta: [{ title: `${params.handle}/${params.repo} · source.code` }],
  }),
  validateSearch: (s: Record<string, unknown>): TabSearch => ({
    n:
      typeof s.n === 'number'
        ? s.n
        : typeof s.n === 'string' && s.n
          ? Number(s.n)
          : undefined,
    section: typeof s.section === 'string' ? s.section : undefined,
    path: typeof s.path === 'string' && s.path ? s.path : undefined,
    view: s.view === 'history' ? 'history' : undefined,
  }),
  // A repository that does not exist, or that this person may not read, is
  // the router's 404.
  loader: ({ context, params }) =>
    // A repository that moved (renamed or transferred) sends people to where
    // it is now, as the API's 308 does.
    Promise.all([
      loadOp(context.queryClient, 'repos.get', {
        owner: params.handle,
        repo: params.repo,
      }),
      loadOp(context.queryClient, 'releases.list', {
        owner: params.handle,
        repo: params.repo,
        limit: 50,
      }),
    ]).catch((e: unknown) => {
      const to =
        e instanceof ForgeRefused && e.code === 'moved' ? e.moved_to : null
      if (!to) throw e
      const [handle, repo] = to.split('/')
      throw redirect({
        to: '/$handle/$repo/$tab',
        params: { handle, repo, tab: params.tab },
        statusCode: 308,
      })
    }),
  component: RepoTab,
})

function RepoTab() {
  const { handle, repo: name, tab } = Route.useParams()
  const { n, section, path, view } = Route.useSearch()
  const found = useOp('repos.get', { owner: handle, repo: name })
  const releases = useOp('releases.list', {
    owner: handle,
    repo: name,
    limit: 50,
  }).data
  const repo = React.useMemo(
    () => toRepo(found, releases.map(toRelease)),
    [found, releases],
  )
  const [finding, setFinding] = React.useState(false)
  const active = activeOf[tab]
  if (!active) throw notFound()

  return (
    // The frame is keyed by repository only, so switching tabs keeps the
    // header mounted and swaps just the page below it.
    <RepoFrame
      key={repo.name}
      repo={repo}
      active={active}
      counts={{
        issues: found.open_issues,
        pulls: found.open_changes,
      }}
      actions={
        tab === 'code' && view !== 'history' ? (
          <CodeActions repo={repo} onFind={() => setFinding(true)} />
        ) : undefined
      }
    >
      <RepoTabPage
        tab={tab}
        repo={repo}
        n={n}
        section={section}
        path={path}
        view={view}
        finding={finding}
        onFinding={setFinding}
      />
    </RepoFrame>
  )
}

function RepoTabPage({
  tab,
  repo,
  n,
  section,
  path,
  view,
  finding,
  onFinding,
}: {
  tab: string
  repo: Repo
  n?: number
  section?: string
  path?: string
  view?: 'history'
  finding: boolean
  onFinding: (open: boolean) => void
}) {
  switch (tab) {
    case 'code':
      return (
        <CodePage
          repo={repo}
          path={path}
          view={view}
          finding={finding}
          onFinding={onFinding}
        />
      )
    case 'issues':
      return <IssuesPage key={repo.name} repo={repo} n={n} />
    case 'changes':
      return <ChangesPage key={repo.name} repo={repo} n={n} />
    case 'pipelines':
      return <PipelinesPage key={repo.name} repo={repo} n={n} />
    case 'releases':
      return <ReleasesPage repo={repo} />
    case 'insights':
      return <InsightsPage repo={repo} />
    case 'settings':
      return (
        <RequireAuth>
          <RepoSettings repo={repo} section={section} />
        </RequireAuth>
      )
    default:
      throw notFound()
  }
}
