import * as React from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import type { RepoPage } from '~/components/forge/repo-shell'
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
  component: RepoTab,
})

function RepoTab() {
  const { handle, repo: name, tab } = Route.useParams()
  const { n, section, path, view } = Route.useSearch()
  const repo = findRepo(handle, name)
  const [finding, setFinding] = React.useState(false)
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
      return <RepoSettings repo={repo} section={section} />
    default:
      throw notFound()
  }
}
