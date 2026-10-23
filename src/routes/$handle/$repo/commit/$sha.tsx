import { Link, createFileRoute } from '@tanstack/react-router'
import { PatchDiff } from '@pierre/diffs/react'
import { getCommitView } from '~/git/server'

export const Route = createFileRoute('/$handle/$repo/commit/$sha')({
  loader: ({ params }) => getCommitView({ data: params }),
  component: CommitPage,
})

function CommitPage() {
  const { handle, repo } = Route.useParams()
  const { commit, diff } = Route.useLoaderData()

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
            options={{ theme: 'pierre-dark', diffStyle: 'unified' }}
          />
        </div>
      ))}
    </div>
  )
}
