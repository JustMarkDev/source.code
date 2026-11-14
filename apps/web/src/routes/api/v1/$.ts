import { createFileRoute } from '@tanstack/react-router'
import { getApi } from '~/lib/api/instance'

/**
 * The HTTP API, mounted at /api/v1. It answers from sample data in this
 * preview; the operations, the contract and the errors are the real ones.
 */
const handle = ({ request }: { request: Request }) =>
  getApi(request.url).fetch(request)

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      PUT: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
})
