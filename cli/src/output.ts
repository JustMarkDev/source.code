/**
 * Output rules:
 *  - JSON when `--json` is passed or stdout is not a terminal, so scripts and
 *    agents get data without asking for it.
 *  - Human text otherwise, kept short.
 *  - Errors are always one JSON object on stderr when output is JSON, with a
 *    stable `code` and a `hint` that says what to run next.
 */

import type { ApiClient } from './client'

export const exit = {
  ok: 0,
  error: 1,
  usage: 2,
  notFound: 3,
  auth: 4,
  policy: 5,
  needsHuman: 6,
} as const

export class SxError extends Error {
  problem?: Record<string, unknown>
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string | undefined,
    readonly status: number = exit.error,
  ) {
    super(message)
  }
}

export type Ctx = {
  json: boolean
  out: (s: string) => void
  err: (s: string) => void
  /** The API client for this run. Made on first use. */
  api: () => ApiClient
}

export function wantsJson(flags: Record<string, string | boolean>) {
  return flags.json === true || !process.stdout.isTTY
}

export function print(ctx: Ctx, data: unknown, text: () => string) {
  ctx.out(ctx.json ? JSON.stringify(data, null, 2) : text())
}

export function table(
  rows: Array<Array<string>>,
  header?: Array<string>,
): string {
  const all = header ? [header, ...rows] : rows
  const widths = all[0].map((_, c) =>
    Math.max(...all.map((r) => (r.at(c) ?? '').length)),
  )
  return all
    .map((r) =>
      r
        .map((cell, c) => cell.padEnd(widths[c]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

export function fail(ctx: Ctx, e: unknown): number {
  const err =
    e instanceof SxError
      ? e
      : new SxError(
          'internal',
          e instanceof Error ? e.message : String(e),
          'This is a bug in sx. Re-run with SX_DEBUG=1 for a stack trace.',
        )
  if (ctx.json)
    ctx.err(
      JSON.stringify({
        error: { ...err.problem, code: err.code, message: err.message, hint: err.hint },
      }),
    )
  else ctx.err(`error: ${err.message}${err.hint ? `\nhint: ${err.hint}` : ''}`)
  return err.status
}
