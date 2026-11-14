import { createFileRoute } from '@tanstack/react-router'
import { llmsIndex } from '~/lib/llms'

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(llmsIndex(new URL(request.url).origin), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
    },
  },
})
