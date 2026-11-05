import { Link, createFileRoute } from '@tanstack/react-router'
import { PatchDiff } from '@pierre/diffs/react'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { CommitView } from '~/components/forge/repo-history'
import { RepoHeader } from '~/components/forge/repo-shell'
import { findRepo } from '~/mock/data'
import { getCommitView } from '~/git/server'
import { useIsDark } from '~/lib/theme'

export const Route = createFileRoute('/$handle/$repo/commit/$sha')({
  // Sample projects show a sample commit and never touch the backend.
  loader: ({ params }) =>
    findRepo(params.handle, params.repo)
      ? null
      : getCommitView({ data: params }),
  component: CommitPage,
})

function CommitPage() {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const { handle, repo } = Route.useParams()
  const data = Route.useLoaderData()
  const { sha } = Route.useParams()
  const sample = findRepo(handle, repo)
  if (sample)
    return (
      <>
        <RepoHeader repo={sample} active="code" />
        <CommitView repo={sample} sha={sha} />
      </>
    )
  if (!data) return null
  const { commit, diff } = data

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/$handle/$repo"
          params={{ handle, repo }}
          className="font-mono text-sm text-muted-foreground hover:underline"
        >
          {handle}/{repo}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{commit.message}</h1>
        <p className="font-mono text-sm text-muted-foreground">
          {commit.authorName} · {commit.date.toLocaleString()} ·{' '}
          {commit.sha.slice(0, 7)} ·{' '}
          <span className="text-emerald-400">+{diff.stats.additions}</span>{' '}
          <span className="text-red-400">−{diff.stats.deletions}</span>
        </p>
      </div>
      {diff.files.map((f) => (
        <div key={f.path} className="overflow-hidden rounded-lg border">
          <PatchDiff
            patch={f.raw}
            options={{
              theme: codeTheme(dark),
              overflow,
              diffStyle: 'unified',
            }}
          />
        </div>
      ))}
    </div>
  )
}
