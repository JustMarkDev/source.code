// Applying a reviewer's suggested change to a file. Reviewers point at a line
// number, but the number stops being true the moment another suggestion lands
// above it. So a suggestion carries the text it replaces and is found by that
// text. If the text is gone, the suggestion no longer applies and says so.

export type Suggestion = {
  /** What the change does, in a few words. */
  summary: string
  file: string
  /**
   * The lines to replace, exactly as they are now. Empty for a pure insertion,
   * which goes after `after`.
   */
  replace: Array<string>
  /** The line an insertion follows. Only used when `replace` is empty. */
  after?: string
  /** The new lines. Empty to delete. */
  lines: Array<string>
}

export type Applied =
  | { ok: true; contents: string; at: number }
  | { ok: false; reason: 'moved' | 'ambiguous' }

const split = (contents: string) => {
  const trailing = contents.endsWith('\n')
  const lines = (trailing ? contents.slice(0, -1) : contents).split('\n')
  return { lines, trailing }
}

/** Where a block of lines starts in a file, one-based, or what went wrong. */
function find(lines: Array<string>, block: Array<string>) {
  const hits: Array<number> = []
  for (let i = 0; i + block.length <= lines.length; i++)
    if (block.every((l, j) => lines[i + j] === l)) hits.push(i)
  if (hits.length === 0) return { ok: false, reason: 'moved' } as const
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' } as const
  return { ok: true, index: hits[0] } as const
}

export function applySuggestion(contents: string, s: Suggestion): Applied {
  const { lines, trailing } = split(contents)
  const insert = s.replace.length === 0
  const target = insert ? [s.after ?? ''] : s.replace
  const hit = find(lines, target)
  if (!hit.ok) return hit
  const from = insert ? hit.index + 1 : hit.index
  const next = [
    ...lines.slice(0, from),
    ...s.lines,
    ...lines.slice(from + s.replace.length),
  ]
  return {
    ok: true,
    contents: next.join('\n') + (trailing ? '\n' : ''),
    at: from + 1,
  }
}

/** Whether a suggestion still applies to a file as it is now. */
export const canApply = (contents: string, s: Suggestion) =>
  applySuggestion(contents, s).ok

/**
 * The line a comment sits on now. The comment remembers the text of its line,
 * so it follows the code when lines are added above it.
 */
export function lineOf(contents: string, text: string, fallback: number) {
  const { lines } = split(contents)
  const hits = lines.flatMap((l, i) => (l === text ? [i + 1] : []))
  return hits.length === 1 ? hits[0] : fallback
}
