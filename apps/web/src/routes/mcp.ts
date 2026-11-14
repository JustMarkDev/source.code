import { createFileRoute } from '@tanstack/react-router'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createSxMcpServer } from '@source-code/cli/mcp'
import { clientFor } from '@source-code/cli/client'
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
 * Streamable HTTP with no sessions: a fresh server per request, so it scales
 * and restarts cleanly. The bearer token is checked the same way the API checks it
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
  let client: ReturnType<typeof clientFor>
  let revoke: (() => void) | undefined
  if (found.record.audience.includes('api')) {
    client = clientFor(`${origin}${API_MOUNT}`, token, (req) => api.fetch(req))
  } else {
    // The MCP bridge calls the API as the same actor. A token narrowed to the
    // MCP audience is exchanged for a short API token, so tool calls work.
    const created = await api.port.svc.auth.create({
      name: 'mcp bridge',
      kind: 'oauth',
      handle: found.record.handle,
      actingAs: found.record.actingAs,
      class: found.record.class,
      scopes: [...found.record.scopes],
      repos: found.record.repos ? [...found.record.repos] : null,
      audience: ['api'],
      limitKey: found.record.id,
      ttlMs: 60_000,
    })
    client = clientFor(`${origin}${API_MOUNT}`, created.secret, (req) =>
      api.fetch(req),
    )
    revoke = () => void api.port.svc.auth.revoke(created.record.id)
  }
  // One handler per request: it serves the 2026-07-28 revision (no session,
  // the version in each request's _meta, the method in Mcp-Method) and answers
  // a 2025-era client statelessly, from the same tools.
  // A tool answers in one JSON body; it would stream only to send progress.
  const mcp = createMcpHandler(() => createSxMcpServer({ client }))
  try {
    const res = await mcp.fetch(request)
    // A subscriptions/listen stream outlives this call; anything else is done.
    if (!res.headers.get('content-type')?.includes('text/event-stream'))
      await mcp.close()
    return res
  } finally {
    revoke?.()
  }
}

export const Route = createFileRoute('/mcp')({
  server: { handlers: { GET: handle, POST: handle, DELETE: handle } },
})
