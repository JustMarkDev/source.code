/**
 * The source.code MCP server. Every tool runs the matching `sx` command with
 * --json, so an agent gets exactly what the CLI and the web page give a person:
 * same data, same blockers, same error codes and hints.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { run } from './main'
import { skillFile } from './skill'
import { schema } from './schema'
import { version } from './help'
import type { ApiClient } from './client'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const instructions = `source.code hosts git repositories, reviews changes and lands them under policy.
Call get_context first: it lists open changes, what blocks each, open issues and the env schema.
Every tool returns JSON. A failed call sets isError and returns {error:{code,message,hint}}: read the hint, do not retry blindly.
land_change fails with code policy_blocked when requirements are missing. Stop and report them; you cannot approve your own change.
Secret values are never returned. Only names and kinds.
Prefer dry_run before anything that changes state.`

async function sx(argv: Array<string>, client?: ApiClient) {
  let out = ''
  let err = ''
  const code = await run(
    [...argv, '--json'],
    { out: (s) => (out += s), err: (s) => (err += s) },
    { client },
  )
  return { code, out, err }
}

const repoArg = z
  .string()
  .optional()
  .describe('owner/name. Required unless the server was started in a clone.')

type Hint = {
  readOnly?: boolean
  idempotent?: boolean
  destructive?: boolean
  /** Exit codes that carry a successful answer, such as policy blocked (5). */
  allowExit?: Array<number>
}

/**
 * `client` is the caller's own: over HTTP it carries the token the request
 * arrived with, so every tool is checked against that token's scopes.
 */
export function createSxMcpServer(
  options: { client?: ApiClient } = {},
): McpServer {
  const server = new McpServer(
    { name: 'source.code', version },
    { instructions },
  )

  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    cb: (a: unknown) => Promise<CallToolResult>,
  ) => void

  const tool = <TShape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: TShape,
    argv: (a: z.infer<z.ZodObject<TShape>>) => Array<string>,
    hint: Hint = {},
  ) => {
    // The SDK's generic handler types do not survive a shared helper, so the
    // schema is the contract and the handler is checked by the tests.
    register(
      name,
      {
        description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: hint.readOnly ?? false,
          idempotentHint: hint.idempotent ?? hint.readOnly ?? false,
          destructiveHint: hint.destructive ?? false,
          openWorldHint: false,
        },
      },
      async (a: unknown): Promise<CallToolResult> => {
        const r = await sx(
          argv(a as z.infer<z.ZodObject<TShape>>),
          options.client,
        )
        if (r.code === 0 || (hint.allowExit?.includes(r.code) && r.out.trim() !== ''))
          return { content: [{ type: 'text' as const, text: r.out || r.err }] }
        return {
          isError: true,
          content: [{ type: 'text' as const, text: r.err || r.out }],
        }
      },
    )
  }

  const repo = (a: { repo?: string }) => (a.repo ? ['-R', a.repo] : [])
  const dry = (a: { dry_run?: boolean }) => (a.dry_run ? ['--dry-run'] : [])
  const dryArg = z
    .boolean()
    .optional()
    .describe('Report what would happen and change nothing.')

  tool(
    'list_accounts',
    'Every account you can act as (a person and their organizations) with your role in each. Commands act as the owner of the repository you name; set SX_ACCOUNT for the server to act as another.',
    {},
    () => ['account', 'list'],
    { readOnly: true },
  )
  tool(
    'get_context',
    'Start here. Repository, default branch, open changes with their blockers, open issues, policy summary and the env schema (names only).',
    { repo: repoArg },
    (a) => ['context', ...repo(a)],
    { readOnly: true },
  )
  tool(
    'list_changes',
    'Open changes in a repository. Set all to include landed ones.',
    { repo: repoArg, all: z.boolean().optional() },
    (a) => ['change', 'list', ...repo(a), ...(a.all ? ['--all'] : [])],
    { readOnly: true },
  )
  tool(
    'get_change',
    'One change and every requirement blocking it from landing. The same status the change page shows.',
    { repo: repoArg, id: z.string().describe('Change number, like 216.') },
    (a) => ['change', 'view', a.id, ...repo(a)],
    { readOnly: true },
  )
  tool(
    'create_change',
    'Create a change from a branch. Calling it again for the same branch adds a patch set instead of a duplicate.',
    {
      repo: repoArg,
      branch: z.string(),
      title: z.string(),
      draft: z.boolean().optional(),
      base: z.string().optional(),
      dry_run: dryArg,
    },
    (a) => [
      'change',
      'create',
      '--branch',
      a.branch,
      '--title',
      a.title,
      ...(a.draft ? ['--draft'] : []),
      ...(a.base ? ['--base', a.base] : []),
      ...repo(a),
      ...dry(a),
    ],
    { idempotent: true },
  )
  tool(
    'land_change',
    'Land a change if policy allows. Fails with policy_blocked and lists what is missing. Do not work around it.',
    { repo: repoArg, id: z.string(), dry_run: dryArg },
    (a) => ['change', 'land', a.id, ...repo(a), ...dry(a)],
    { destructive: true },
  )
  tool(
    'check_policy',
    'Whether a change meets every policy, and which requirement asks for what.',
    { repo: repoArg, change: z.string() },
    (a) => ['policy', 'explain', a.change, ...repo(a)],
    { readOnly: true, allowExit: [5] },
  )
  tool(
    'list_issues',
    'Issues, open by default.',
    { repo: repoArg, state: z.enum(['open', 'closed', 'all']).optional() },
    (a) => [
      'issue',
      'list',
      ...repo(a),
      ...(a.state ? ['--state', a.state] : []),
    ],
    { readOnly: true },
  )
  tool(
    'create_issue',
    'Open an issue. The same open title returns the existing issue.',
    {
      repo: repoArg,
      title: z.string(),
      labels: z.array(z.string()).optional(),
      dry_run: dryArg,
    },
    (a) => [
      'issue',
      'create',
      '--title',
      a.title,
      ...(a.labels?.length ? ['--label', a.labels.join(',')] : []),
      ...repo(a),
      ...dry(a),
    ],
    { idempotent: true },
  )
  tool(
    'close_issue',
    'Close an issue.',
    { repo: repoArg, number: z.number().int(), dry_run: dryArg },
    (a) => ['issue', 'close', String(a.number), ...repo(a), ...dry(a)],
    { idempotent: true },
  )
  tool(
    'list_env',
    'Environment variables: names, kinds and whether each environment has a value. Never values.',
    {
      repo: repoArg,
      env: z.enum(['development', 'preview', 'production']).optional(),
    },
    (a) => ['env', 'list', ...repo(a), ...(a.env ? ['--env', a.env] : [])],
    { readOnly: true },
  )
  tool(
    'list_env_grants',
    'Time-limited grants that let an agent run commands with development values. Shows state and expiry.',
    { repo: repoArg },
    (a) => ['env', 'grant', 'list', ...repo(a)],
    { readOnly: true },
  )
  tool(
    'request_env_grant',
    'Ask a person for development values. This never grants access by itself: it always returns needs_human until someone approves. After approval, run commands locally with `sx env run --env development -- <command>`; values reach the process, never you.',
    {
      repo: repoArg,
      reason: z
        .string()
        .describe('Why you need the values. Shown to the approver.'),
      max_runs: z.number().int().optional(),
    },
    (a) => [
      'env',
      'grant',
      'request',
      '--reason',
      a.reason,
      ...(a.max_runs ? ['--max-runs', String(a.max_runs)] : []),
      ...repo(a),
    ],
    { idempotent: true },
  )
  tool(
    'list_mirrors',
    'Copies of the repository on other hosts and whether each is in sync.',
    { repo: repoArg },
    (a) => ['mirror', 'list', ...repo(a)],
    { readOnly: true },
  )
  tool(
    'sync_mirror',
    'Sync one mirror now.',
    { repo: repoArg, id: z.string() },
    (a) => ['mirror', 'sync', a.id, ...repo(a)],
    { idempotent: true },
  )
  tool(
    'start_agent',
    'Build the prompt for an issue or change and the command that starts an agent on it.',
    {
      repo: repoArg,
      subject: z.string().describe('An issue or change number, like 4 or 216.'),
      target: z.enum(['t3', 'boat', 'e2b']).optional(),
      runtime: z.string().optional(),
    },
    (a) => [
      'agent',
      'start',
      a.subject,
      ...repo(a),
      ...(a.target ? ['--target', a.target] : []),
      ...(a.runtime ? ['--runtime', a.runtime] : []),
    ],
    { readOnly: true },
  )

  server.registerResource(
    'skill',
    'sx://skill',
    {
      title: 'How to use source.code and sx',
      description: 'The agent skill: rules, exit codes and the workflow.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: skillFile }],
    }),
  )
  server.registerResource(
    'commands',
    'sx://commands',
    {
      title: 'Every sx command',
      description: 'The CLI as JSON: arguments, examples and exit codes.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ commands: schema }, null, 2),
        },
      ],
    }),
  )

  return server
}

/** `sx mcp`: serve over stdio, for agents that start a local command. */
export async function serveStdio() {
  await createSxMcpServer().connect(new StdioServerTransport())
}
