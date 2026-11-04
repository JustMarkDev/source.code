import { createFileRoute } from '@tanstack/react-router'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createSxMcpServer } from '../../cli/src/mcp'

const unauthorized = () =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Authorization required. Send "Authorization: Bearer <token>". Create a token in Settings, Agents and tokens.',
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="source.code"',
      },
    },
  )

/**
 * Streamable HTTP, stateless: a fresh server per request, so it scales and
 * restarts cleanly. In this preview any bearer token is accepted and the tools
 * answer from sample data; real tokens and scopes come with the hosted API.
 */
async function handle({ request }: { request: Request }) {
  if (!request.headers.get('authorization')?.startsWith('Bearer '))
    return unauthorized()
  const server = createSxMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export const Route = createFileRoute('/mcp')({
  server: { handlers: { GET: handle, POST: handle, DELETE: handle } },
})
