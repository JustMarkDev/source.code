import * as React from 'react'
import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import type { RepoPage } from '~/components/forge/repo-shell'
import { RequireAuth } from '~/components/forge/auth'
import {
  ActionsPage,
  InsightsPage,
  IssuesPage,
  openIssueCount,
} from '~/components/forge/repo-pages'
import { ChangesPage } from '~/components/forge/repo-changes'
import {
  CodeActions,
  CodePage,
  ReleasesPage,
} from '~/components/forge/repo-variants'
import { RepoFrame } from '~/components/forge/repo-shell'
import { RepoSettings } from '~/components/forge/repo-settings'
import { directory, useDirectoryLookups } from '~/lib/auth/accounts'
import { findRepo } from '~/mock/data'

/** URL segment -> the tab it highlights. */
const activeOf: Partial<Record<string, RepoPage>> = {
  code: 'code',
  issues: 'issues',
  changes: 'pulls',
  actions: 'actions',
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
  // An address an account used to have leads to the one it has now.
  loader: ({ params }) => {
    if (typeof window === 'undefined') return
    directory.load()
    const to = directory.resolveAlias(params.handle)
    if (to)
      throw redirect({
        to: '/$handle/$repo/$tab',
        params: { ...params, handle: to },
        search: true,
      })
  },
  component: RepoTab,
})

function RepoTab() {
  const { handle, repo: name, tab } = Route.useParams()
  const search = Route.useSearch()
  const { n, section, path, view } = search
  const navigate = useNavigate()
  const { resolveAlias, ready } = useDirectoryLookups()
  const repo = findRepo(handle, name)
  const [finding, setFinding] = React.useState(false)
  // An old address leads to the new one. The loader cannot do this on a first
  // page load (rendered on the server), so the page does it once the
  // browser's accounts are read.
  const alias = resolveAlias(handle)
  React.useEffect(() => {
    if (alias)
      void navigate({
        to: '/$handle/$repo/$tab',
        params: { handle: alias, repo: name, tab },
        search,
        replace: true,
      })
  }, [alias, navigate, name, tab, search])
  if (alias || (!repo && !ready)) return null
  if (!repo) throw notFound()
  const active = activeOf[tab]
  if (!active) throw notFound()

  return (
    // The frame is keyed by repository only, so switching tabs keeps the
    // header mounted and swaps just the page below it.
    <RepoFrame
      key={repo.name}
      repo={repo}
      active={active}
      counts={{ issues: openIssueCount(repo) }}
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
  repo: NonNullable<ReturnType<typeof findRepo>>
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
    case 'actions':
      return <ActionsPage />
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
