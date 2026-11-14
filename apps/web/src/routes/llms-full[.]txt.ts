import { createFileRoute } from '@tanstack/react-router'
import { llmsFull } from '~/lib/llms'

export const Route = createFileRoute('/llms-full.txt')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(llmsFull(new URL(request.url).origin), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
    },
  },
})
