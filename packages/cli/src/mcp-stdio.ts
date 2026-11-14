import { serveStdio as serve } from '@modelcontextprotocol/server/stdio'
import { createSxMcpServer } from './mcp'

/**
 * `sx mcp`: serve over stdio, for agents that start a local command. The
 * opening message picks the protocol revision, 2026-07-28 or a 2025 one, and
 * the same tools serve both. It lives apart from `mcp.ts` so the hosted
 * endpoint, which imports that file, never loads the stdio transport.
 */
export function serveStdio() {
  serve(() => createSxMcpServer())
  return Promise.resolve()
}
