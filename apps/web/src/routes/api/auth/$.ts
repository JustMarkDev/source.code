import { createFileRoute } from '@tanstack/react-router'
import { handler } from '~/lib/auth/server'

/**
 * Sign-in's endpoints. They run on Convex (`convex/auth.ts`); this forwards
 * to them so the session cookie belongs to this site.
 */
const handle = ({ request }: { request: Request }) => handler(request)

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
