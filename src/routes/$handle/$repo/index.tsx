import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { File } from '@pierre/diffs/react'
import { getRepoTree } from '~/git/server'
import { useIsDark } from '~/lib/theme'
import { findRepo } from '~/mock/data'

export const Route = createFileRoute('/$handle/$repo/')({
  // Sample projects live on the design screens and do not need the backend.
  beforeLoad: ({ params }) => {
    if (findRepo(params.handle, params.repo))
      throw redirect({
        to: '/$handle/$repo/$tab',
        params: { ...params, tab: 'code' },
      })
  },
  validateSearch: (s: Record<string, unknown>): { path?: string } =>
    typeof s.path === 'string' ? { path: s.path } : {},
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getRepoTree({ data: { ...params, path: deps.path } }),
  component: RepoPage,
})

function RepoPage() {
  const { handle, repo } = Route.useParams()
  const { paths, commits, file } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const dark = useIsDark()
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: file ? [file.name] : [],
    onSelectionChange: ([path]) => {
      if (path && paths.includes(path)) void navigate({ search: { path } })
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg">
        <Link
          to="/$handle"
          params={{ handle }}
          className="text-muted-foreground hover:underline"
        >
          {handle}
        </Link>
        /<b>{repo}</b>
      </h1>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <FileTree model={model} className="block h-96 rounded-lg border" />
        <div className="min-w-0 overflow-hidden rounded-lg border">
          {file ? (
            <File
              file={file}
              options={{ theme: dark ? 'pierre-dark' : 'pierre-light' }}
            />
          ) : (
            <p className="p-4">Empty repository</p>
          )}
        </div>
      </div>
      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          History
        </h2>
        <ul className="divide-y rounded-lg border text-sm">
          {commits.map((c) => (
            <li key={c.sha}>
              <Link
                to="/$handle/$repo/commit/$sha"
                params={{ handle, repo, sha: c.sha }}
                className="flex justify-between gap-4 px-3 py-2 hover:bg-muted"
              >
                <span>{c.message}</span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {c.authorName} · {c.date.toLocaleDateString()} ·{' '}
                  {c.sha.slice(0, 7)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
