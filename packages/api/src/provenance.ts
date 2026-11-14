import { blameLine, splitLines } from './lines'

/**
 * From a line of code to the conversation that produced it. This file holds
 * the parts both domains share; the operation is `repos.provenance`.
 */

/** How a refusal is thrown: `apiError` in the API, `fail` in Convex. */
export type Fail = (
  code: string,
  detail: string,
  more?: {
    hint?: string
    errors?: Array<{ pointer: string; code: string; message: string }>
  },
) => never

type ChangeLike = {
  number: number
  baseFiles?: Record<string, string | null>
  patchSets: Array<{ n: number; contents?: Record<string, string | null> }>
}

/**
 * Which patch set of a change wrote a line of a file at its head, or `base`
 * when the line was on the base already. Patch sets without their files are
 * read as unchanged from the one before.
 */
export function changeBlame(
  c: ChangeLike,
  path: string,
  line: number,
  fail: Fail,
): number | 'base' {
  const head = c.patchSets[c.patchSets.length - 1]
  if (!head.contents)
    fail(
      'invalid_state',
      `Change #${c.number} came without its files, so its lines cannot be traced.`,
      { hint: 'Ask about the commit it landed as, with ref, instead.' },
    )
  if (!(path in head.contents))
    fail('not_found', `${path} is not in patch set ${head.n} of #${c.number}.`)
  const versions: Array<string | null> = [c.baseFiles?.[path] ?? null]
  for (const ps of c.patchSets)
    versions.push(
      ps.contents ? (ps.contents[path] ?? null) : versions[versions.length - 1],
    )
  const lines = splitLines(versions[versions.length - 1])
  if (line > lines.length)
    fail(
      'invalid_request',
      `${path} has ${lines.length} lines in patch set ${head.n}.`,
      {
        errors: [
          {
            pointer: '/query/line',
            code: 'out_of_range',
            message: `Lines run from 1 to ${lines.length}.`,
          },
        ],
      },
    )
  const at = blameLine(versions, line, true)
  return at < 0 ? 'base' : at
}
