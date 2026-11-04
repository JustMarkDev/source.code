import type { Command } from './types'

/** Started by an agent client as a subprocess. Logs go to stderr; stdout is the protocol. */
export const mcp: Command = async () => {
  const { serveStdio } = await import('../mcp')
  await serveStdio()
}
