import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { RunView } from '~/components/forge/run-view'
import { RepoHeader } from '~/components/forge/repo-shell'
import { loadOp, useOp } from '~/lib/forge'
import { toRepo } from '~/lib/repo'

export const Route = createFileRoute('/$handle/$repo/run/$id')({
  head: ({ params }) => ({
    meta: [
      {
        title: `Run ${params.id.slice(0, 12)} · ${params.handle}/${params.repo} · source.code`,
      },
    ],
  }),
  loader: ({ context, params }) =>
    loadOp(context.queryClient, 'repos.get', {
      owner: params.handle,
      repo: params.repo,
    }),
  component: RunPage,
})

function RunPage() {
  const { handle, repo: name, id } = Route.useParams()
  const found = useOp('repos.get', { owner: handle, repo: name })
  const repo = React.useMemo(() => toRepo(found), [found])
  return (
    <>
      <RepoHeader repo={repo} active="code" />
      <RunView repo={repo} id={id} />
    </>
  )
}
