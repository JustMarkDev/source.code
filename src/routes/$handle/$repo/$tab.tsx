import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  ActionsPage,
  InsightsPage,
  IssuesPage,
} from '~/components/forge/repo-pages'
import { ChangesPage } from '~/components/forge/repo-changes'
import { CodePage, ReleasesPage } from '~/components/forge/repo-variants'
import { RepoSettings } from '~/components/forge/repo-settings'
import { findRepo } from '~/mock/data'

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
  if (!repo) throw notFound()

  switch (tab) {
    case 'code':
      return <CodePage repo={repo} path={path} view={view} />
    case 'issues':
      return <IssuesPage key={repo.name} repo={repo} n={n} />
    case 'changes':
      return <ChangesPage key={repo.name} repo={repo} n={n} />
    case 'actions':
      return <ActionsPage repo={repo} />
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
