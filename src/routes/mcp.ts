import { createFileRoute } from '@tanstack/react-router'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createSxMcpServer } from '../../cli/src/mcp'
import { clientFor } from '../../cli/src/client'
import { API_MOUNT, getApi } from '~/lib/api/instance'

const unauthorized = (metadata: string, message: string) =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        // RFC 9728: tell the client where to learn how to sign in.
        'www-authenticate': `Bearer realm="source.code", resource_metadata="${metadata}"`,
      },
    },
  )

/**
 * Streamable HTTP, stateless: a fresh server per request, so it scales and
 * restarts cleanly. The bearer token is checked the same way the API checks it
 * (one token works for both), and every tool then calls the API as that token,
 * so a tool can do no more than the token's scopes allow.
 */
async function handle({ request }: { request: Request }) {
  const api = getApi(request.url)
  const origin = new URL(request.url).origin
  const metadata = `${process.env.SX_PUBLIC_URL ?? origin}/.well-known/oauth-protected-resource/mcp`
  const token = /^Bearer (\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  if (!token)
    return unauthorized(
      metadata,
      'Sign in required. Send "Authorization: Bearer <token>", or sign in with OAuth.',
    )
  const found = await api.verifyToken(token, 'mcp')
  if (!found.ok)
    return unauthorized(
      metadata,
      found.reason === 'expired'
        ? 'The token expired.'
        : found.reason === 'revoked'
          ? 'The token was revoked.'
          : 'The token is not valid for this server.',
    )
  const client = clientFor(`${origin}${API_MOUNT}`, token, (req) =>
    api.fetch(req),
  )
  const server = createSxMcpServer({ client })
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
