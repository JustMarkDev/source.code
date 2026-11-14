/**
 * Which issues a change names in its title or description, so the issue's
 * timeline can show the change. `Fixes #4`, `Closes #4` and `Resolves #4`
 * say the change fixes it; `Refs #4`, `Part of #4` and `Related to #4` link
 * it without saying so. A bare `#4` is a mention, not a link.
 *
 * Plain JavaScript, so the Convex functions read changes the same way.
 */
const LINK =
  /\b(fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?|part of|related to)[:\s]+#(\d+)\b/gi

export function issueRefs(
  text: string,
): Array<{ issue: number; closes: boolean }> {
  const out = new Map<number, boolean>()
  for (const m of text.matchAll(LINK)) {
    const issue = Number(m[2])
    const closes = /^(fix|close|resolve)/i.test(m[1])
    out.set(issue, (out.get(issue) ?? false) || closes)
  }
  return [...out].map(([issue, closes]) => ({ issue, closes }))
}
