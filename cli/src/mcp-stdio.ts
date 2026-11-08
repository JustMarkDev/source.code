import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createSxMcpServer } from './mcp'

/**
 * `sx mcp`: serve over stdio, for agents that start a local command. It lives
 * apart from `mcp.ts` so the hosted endpoint, which imports that file, never
 * loads the stdio transport.
 */
export async function serveStdio() {
  await createSxMcpServer().connect(new StdioServerTransport())
}
