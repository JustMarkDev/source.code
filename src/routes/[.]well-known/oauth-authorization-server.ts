import { createFileRoute } from '@tanstack/react-router'
import { getApi } from '~/lib/api/instance'

/** RFC 8414: how a client finds the authorization server. */
export const Route = createFileRoute('/.well-known/oauth-authorization-server')(
  {
    server: {
      handlers: {
        GET: ({ request }: { request: Request }) =>
          Response.json(getApi(request.url).oauth!.metadata(), {
            headers: {
              'cache-control': 'public, max-age=3600',
              'access-control-allow-origin': '*',
            },
          }),
      },
    },
  },
)
