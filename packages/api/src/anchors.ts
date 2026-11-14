import { findQuote, mapLines, splitLines } from './lines'

/**
 * Comments that follow the code they are about.
 *
 * A comment on a line keeps what it was about: the quoted text and three
 * lines on each side (its anchor). When a patch set arrives, each thread is
 * placed in it:
 *
 *  1. the line is mapped through the diff between the patch set the thread
 *     was last placed in and the new one;
 *  2. if the text there no longer matches the quote, the new file is searched
 *     for the quote and the lines around it, and the nearest match wins;
 *  3. if nothing matches, the thread is outdated in that patch set.
 *
 * `line` keeps its meaning: the line in the patch set the comment was
 * written on. A change has tens of comments, so this runs in the same
 * transaction as the patch set.
 *
 * Plain JavaScript with no dependencies: the Convex functions import it too.
 */

export const CONTEXT_LINES = 3

export type Anchor = {
  /** The commented text, one entry per line. */
  quote: Array<string>
  before: Array<string>
  after: Array<string>
  side: 'head' | 'base'
}

export type Placement = { line: number } | 'outdated'

type CommentLike = {
  file: string | null
  line: number | null
  patchSet: number
  replyTo: string | null
  anchor?: Anchor | null
  placements?: Record<string, Placement>
}

type PatchSetLike = { n: number; contents?: Record<string, string | null> }

/**
 * The anchor for a comment on `line` of `text`. A `quote` the commenter sent
 * names the text; without one the line itself is the quote.
 */
export function anchorAt(
  text: string | null | undefined,
  line: number,
  quote?: string,
): Anchor | null {
  const lines = splitLines(text)
  if (line < 1 || line > lines.length) return null
  const q = quote !== undefined ? splitLines(quote) : [lines[line - 1]]
  const end = line - 1 + Math.max(1, q.length)
  return {
    quote: q.length ? q : [lines[line - 1]],
    before: lines.slice(Math.max(0, line - 1 - CONTEXT_LINES), line - 1),
    after: lines.slice(end, end + CONTEXT_LINES),
    side: 'head',
  }
}

/**
 * Where a thread's start was last seen before patch set `n`: the patch set
 * and line, and whether that line can be mapped forward (it cannot when the
 * thread was outdated there; its quote is searched for instead).
 */
function lastPlaced(
  c: CommentLike & { line: number },
  n: number,
): { patchSet: number; line: number; mappable: boolean } {
  let out = { patchSet: c.patchSet, line: c.line, mappable: true }
  for (const [k, v] of Object.entries(c.placements ?? {})
    .map(([key, p]) => [Number(key), p] as const)
    .sort(([x], [y]) => x - y)) {
    if (k <= c.patchSet || k >= n) continue
    out =
      v === 'outdated'
        ? { patchSet: k, line: out.line, mappable: false }
        : { patchSet: k, line: v.line, mappable: true }
  }
  return out
}

/**
 * Places every thread that starts on a line in patch set `ps`. Answers how
 * many placements changed. Threads written on `ps` itself, and patch sets
 * that came without their files, are left alone.
 */
export function placeThreads(
  comments: Array<CommentLike>,
  patchSets: ReadonlyArray<PatchSetLike>,
  ps: PatchSetLike,
): number {
  if (!ps.contents) return 0
  let changed = 0
  for (const c of comments) {
    if (c.replyTo || c.file === null || c.line === null || !c.anchor) continue
    if (c.patchSet >= ps.n) continue
    const from = lastPlaced({ ...c, line: c.line }, ps.n)
    const next = place(c, c.anchor, from, patchSets, ps)
    const key = String(ps.n)
    const had = c.placements?.[key]
    if (JSON.stringify(had) === JSON.stringify(next)) continue
    c.placements = { ...c.placements, [key]: next }
    changed++
  }
  return changed
}

function place(
  c: CommentLike,
  anchor: Anchor,
  from: { patchSet: number; line: number; mappable: boolean },
  patchSets: ReadonlyArray<PatchSetLike>,
  ps: PatchSetLike,
): Placement {
  const file = c.file!
  const now = splitLines(ps.contents![file])
  if (!now.length) return 'outdated'
  const was = patchSets.find((x) => x.n === from.patchSet)?.contents?.[file]
  const matches = (at: number) =>
    anchor.quote.every((q, k) => now[at - 1 + k]?.trim() === q.trim())
  if (from.mappable && was !== undefined) {
    const mapped = mapLines(splitLines(was), now).at(from.line - 1)
    if (typeof mapped === 'number' && matches(mapped + 1))
      return { line: mapped + 1 }
  }
  const found = findQuote(now, anchor.quote, anchor, from.line)
  return found === null ? 'outdated' : { line: found }
}

/**
 * Where a comment is at the head patch set: its line there, or that its code
 * is gone. A reply is wherever its thread is. Unknown (a patch set without
 * its files) reads as the last place it was seen.
 */
export function currentPosition(
  c: CommentLike,
  root: CommentLike | undefined,
  head: number,
): { current_line: number | null; outdated: boolean } {
  const start = c.replyTo ? (root ?? c) : c
  if (start.line === null) return { current_line: null, outdated: false }
  if (start.patchSet >= head)
    return { current_line: start.line, outdated: false }
  let line: number | null = start.line
  let outdated = false
  let at = start.patchSet
  for (const [k, v] of Object.entries(start.placements ?? {})
    .map(([key, p]) => [Number(key), p] as const)
    .sort(([x], [y]) => x - y)) {
    if (k <= at || k > head) continue
    at = k
    if (v === 'outdated') {
      line = null
      outdated = true
    } else {
      line = v.line
      outdated = false
    }
  }
  return { current_line: line, outdated }
}

/** An anchor as the API shows it. */
export function presentAnchor(a: Anchor) {
  return {
    quote: a.quote.join('\n'),
    before: a.before,
    after: a.after,
    side: a.side,
  }
}

// ---- fixes that answer comments ---------------------------------------------

export type Addressed = {
  patchSet: number
  by: { id: string; handle: string; class: 'human' | 'agent' | 'bot' }
  note: string
  at: number
}

type Fail = (
  code: string,
  detail: string,
  more?: {
    errors?: Array<{ pointer: string; code: string; message: string }>
  },
) => never

/**
 * Marks threads as answered by patch set `patchSet`. Each must start a thread
 * on this change and be older than the fix. Marking does not resolve: the
 * thread stays open until someone settles it. Answers who to tell. With
 * `apply` false it only checks.
 */
export function addressThreads(
  comments: Array<
    CommentLike & {
      id: string
      author: { handle: string }
      addressed?: Addressed | null
      version: number
      updated: number
    }
  >,
  items: ReadonlyArray<{ comment: string; note?: string }>,
  patchSet: number,
  by: Addressed['by'],
  at: number,
  fail: Fail,
  pointer: string,
  apply: boolean,
): Array<{ comment: string; author: string; patch_set: number; note: string }> {
  const out = []
  for (const [k, item] of items.entries()) {
    const c = comments.find((x) => x.id === item.comment)
    const where = items.length > 1 ? `${pointer}/${k}/comment` : pointer
    if (!c)
      fail('invalid_request', `No comment ${item.comment} on this change.`, {
        errors: [
          {
            pointer: where,
            code: 'unknown',
            message: 'Name a comment on this change.',
          },
        ],
      })
    if (c.replyTo)
      fail('invalid_request', `${item.comment} is a reply.`, {
        errors: [
          {
            pointer: where,
            code: 'not_thread_start',
            message: 'Address the comment that starts the thread.',
          },
        ],
      })
    if (patchSet <= c.patchSet)
      fail(
        'invalid_request',
        `${item.comment} was written on patch set ${c.patchSet}; a fix comes after it.`,
        {
          errors: [
            {
              pointer: where,
              code: 'out_of_range',
              message: `Name a patch set after ${c.patchSet}.`,
            },
          ],
        },
      )
    const note = item.note ?? ''
    if (apply) {
      c.addressed = { patchSet, by, note, at }
      c.version++
      c.updated = at
    }
    out.push({
      comment: c.id,
      author: c.author.handle,
      patch_set: patchSet,
      note,
    })
  }
  return out
}
