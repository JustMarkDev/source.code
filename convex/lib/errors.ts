import { ConvexError } from 'convex/values'

/**
 * How a forge function refuses. The API turns `code` back into the same
 * problem it has always answered (`packages/api/src/problem.ts`), so a refusal
 * reads the same wherever it came from.
 *
 * Anything carried along (`extra`) travels as JSON text: Convex would sort
 * an object's keys, and an answer's keys stay in the order they were written.
 */
export type Refusal = {
  code: string
  detail: string
  /** JSON text of the rest: hint, errors, extra, retryAfter, headers, retryable. */
  more?: string
}

/** The same options the API's `apiError` takes. */
export type More = {
  hint?: string
  errors?: ReadonlyArray<{ pointer: string; code: string; message: string }>
  extra?: Record<string, unknown>
  retryAfter?: number
  headers?: Record<string, string>
  retryable?: boolean
}

export function fail(code: string, detail: string, more: More = {}): never {
  const data: Refusal = { code, detail }
  if (Object.keys(more).length) data.more = JSON.stringify(more)
  throw new ConvexError(data)
}

/** A repository that answers at a new address. The API redirects. */
export function moved(from: string, to: string): never {
  throw new ConvexError({
    code: 'moved',
    detail: `${from} moved to ${to}`,
    from,
    to,
  })
}

/**
 * Forge functions answer JSON text, the answer exactly as the API sends it.
 * Convex values sort object keys and refuse some key names (a file path, a
 * key starting with `_`); text keeps the answer as written.
 */
export function out(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/**
 * Ends a write. On a dry run the whole write has already happened inside the
 * transaction; throwing rolls every bit of it back, and the would-be answer
 * travels in the error. So a dry run makes exactly the checks the real write
 * makes and can never leave anything behind.
 */
export function finish(dry: boolean | undefined, value: unknown): string {
  const text = out(value)
  if (dry)
    throw new ConvexError({ code: 'dry_run', detail: 'dry run', value: text })
  return text
}
