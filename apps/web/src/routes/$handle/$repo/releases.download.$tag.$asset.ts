import { createFileRoute } from '@tanstack/react-router'

/**
 * A release file, as the person signed in: the download is counted, then the
 * file is sent. A file the release only describes (kept elsewhere) is a 404
 * that says so.
 */
export const Route = createFileRoute(
  '/$handle/$repo/releases/download/$tag/$asset',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { rawAsCaller } = await import('~/lib/effect/services/forge')
        const at = `/repos/${encodeURIComponent(params.handle)}/${encodeURIComponent(params.repo)}/releases/${encodeURIComponent(params.tag)}/assets/${encodeURIComponent(params.asset)}`
        const counted = await rawAsCaller(request, `${at}/download`, {
          method: 'POST',
        })
        if (!counted.ok)
          return new Response(`No file ${params.asset} in ${params.tag}.`, {
            status: counted.status === 409 ? 410 : 404,
          })
        const d = (await counted.json()) as { content_url: string | null }
        if (!d.content_url)
          return new Response(
            `${params.asset} is listed in ${params.tag} but its file is kept elsewhere.`,
            { status: 404 },
          )
        const path = new URL(d.content_url).pathname.replace(/^.*?\/v1/, '')
        return rawAsCaller(request, path)
      },
    },
  },
})
