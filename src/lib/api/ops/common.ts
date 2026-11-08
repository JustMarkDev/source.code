import { z } from 'zod'
import { decodeCursor, encodeCursor, fingerprint } from '../cursor'
import { PAGE } from '../pipeline'
import type { CursorPosition } from '../cursor'

export const repoParams = z.object({
  owner: z
    .string()
    .describe(
      'Account handle. A repository `rep_` id can stand in for owner and repo.',
    ),
  repo: z.string().describe('Repository name'),
})
export const changeParams = repoParams.extend({
  number: z.string().describe('The change number, or its `chg_` id'),
})

/** `limit` and `cursor` for every list. */
export const pageShape = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE.max)
    .default(PAGE.default)
    .describe(`Items per page, 1 to ${PAGE.max}. Larger values are clamped.`),
  cursor: z
    .string()
    .optional()
    .describe('`next_cursor` from the previous page, exactly as returned'),
}

export function afterOf(
  cursor: string | undefined,
  fp: string,
): CursorPosition | null {
  return cursor ? decodeCursor(cursor, fp) : null
}

export const fp = (...parts: Array<string | undefined>) =>
  fingerprint(parts.map((p) => p ?? ''))

export function listOf<T>(
  items: Array<T>,
  next: CursorPosition | null,
  fingerprintOf: string,
) {
  return {
    object: 'list' as const,
    data: items,
    has_more: next !== null,
    next_cursor: next ? encodeCursor(next, fingerprintOf) : null,
  }
}

export function expandOf(
  value: string | undefined,
  allowed: ReadonlyArray<string>,
) {
  const parts = value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const bad = parts.filter((p) => !allowed.includes(p))
  if (bad.length) throw new Error(`unknown expand ${bad.join(',')}`)
  return parts
}

export const expandSchema = (allowed: ReadonlyArray<string>) =>
  z
    .string()
    .optional()
    .refine(
      (v) =>
        !v ||
        v
          .split(',')
          .map((s) => s.trim())
          .every((s) => allowed.includes(s)),
      { message: `Use a comma list of: ${allowed.join(', ')}.` },
    )
