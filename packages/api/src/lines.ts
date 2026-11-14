/**
 * Following lines of text from one version of a file to the next: which line
 * a line became, or that it is gone. Blame uses it to find the version that
 * wrote a line, and comments use it to stay on the code they are about when
 * a new patch set arrives.
 *
 * Plain JavaScript with no dependencies, so the Convex functions use the
 * same code (`convex/` imports it as `@source-code/api/lines`).
 */

/** Past this many cells the middle of a diff is not aligned line by line. */
const MAX_CELLS = 4_000_000

export const splitLines = (text: string | null | undefined) =>
  text === null || text === undefined || text === ''
    ? []
    : text.replace(/\n$/, '').split('\n')

/**
 * For each line of `a` (0-based), the line of `b` it is when it is
 * unchanged, or null when it was removed or rewritten. Lines are matched by a
 * longest common subsequence, after the common start and end are taken off.
 */
export function mapLines(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: a.length }, () => null)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    out[start] = start
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
    out[endA] = endB
  }
  const n = endA - start
  const m = endB - start
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return out
  // dp[i][j]: the common subsequence of a[start+i..] and b[start+j..].
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        a[start + i] === b[start + j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      out[start + i] = start + j
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return out
}

/**
 * Which version wrote a line. `versions` run oldest first; `line` is 1-based
 * in the newest. Answers the index of the version whose text first had the
 * line as it is now, or -1 when it was already in the oldest version and
 * the oldest counts as "before" (`baseIsBefore`).
 */
export function blameLine(
  versions: ReadonlyArray<string | null>,
  line: number,
  baseIsBefore = false,
): number {
  let at = versions.length - 1
  let idx = line - 1
  while (at > 0) {
    const map = mapLines(splitLines(versions[at - 1]), splitLines(versions[at]))
    const from = map.indexOf(idx)
    if (from < 0) return at
    idx = from
    at--
  }
  return baseIsBefore ? -1 : 0
}

/**
 * Where a quoted piece of text is in a file, by its own lines and the lines
 * around it: the 1-based line its first line is on, nearest to `near` when
 * there are several, or null. A candidate must match the quote exactly; the
 * lines around it break ties, then distance does.
 */
export function findQuote(
  lines: ReadonlyArray<string>,
  quote: ReadonlyArray<string>,
  around: { before: ReadonlyArray<string>; after: ReadonlyArray<string> },
  near: number,
): number | null {
  if (!quote.length || quote.every((l) => l.trim() === '')) return null
  let best: { at: number; score: number; dist: number } | null = null
  for (let i = 0; i + quote.length <= lines.length; i++) {
    let hit = true
    for (let k = 0; k < quote.length && hit; k++)
      hit = lines[i + k].trim() === quote[k].trim()
    if (!hit) continue
    let score = 0
    for (let k = 1; k <= around.before.length; k++)
      if (
        lines[i - k]?.trim() === around.before[around.before.length - k]?.trim()
      )
        score++
    for (let k = 0; k < around.after.length; k++)
      if (lines[i + quote.length + k]?.trim() === around.after[k]?.trim())
        score++
    const dist = Math.abs(i + 1 - near)
    if (
      !best ||
      score > best.score ||
      (score === best.score && dist < best.dist)
    )
      best = { at: i + 1, score, dist }
  }
  return best?.at ?? null
}
