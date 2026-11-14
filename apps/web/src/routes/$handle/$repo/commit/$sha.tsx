import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CommitView } from '~/components/forge/repo-history'
import { RepoHeader } from '~/components/forge/repo-shell'
import { loadOp, useOp } from '~/lib/forge'
import { toRepo } from '~/lib/repo'

export const Route = createFileRoute('/$handle/$repo/commit/$sha')({
  head: ({ params }) => ({
    meta: [
      {
        title: `${params.sha.slice(0, 7)} · ${params.handle}/${params.repo} · source.code`,
      },
    ],
  }),
  loader: ({ context, params }) =>
    loadOp(context.queryClient, 'repos.get', {
      owner: params.handle,
      repo: params.repo,
    }),
  component: CommitPage,
})

function CommitPage() {
  const { handle, repo: name, sha } = Route.useParams()
  const found = useOp('repos.get', { owner: handle, repo: name })
  const repo = React.useMemo(() => toRepo(found), [found])
  return (
    <>
      <RepoHeader repo={repo} active="code" />
      <CommitView repo={repo} sha={sha} />
    </>
  )
}
