import { apiError } from './problem'

/**
 * A list cursor is the sort key and ID of the last item sent, plus a short
 * fingerprint of the filter and sort. That makes it keyset pagination: the next
 * page starts after that item, whatever was added or removed in between. It
 * does not expire. Changing the filter or sort makes it fail loudly instead of
 * returning a page from the wrong list.
 */
export type CursorPosition = { key: string | number; id: string }

export function fingerprint(parts: ReadonlyArray<string>): string {
  let h = 5381
  const text = parts.join('\u0000')
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i)
  return (h >>> 0).toString(36)
}

export function encodeCursor(position: CursorPosition, fp: string): string {
  const json = JSON.stringify([position.key, position.id, fp])
  return `c_${Buffer.from(json).toString('base64url')}`
}

export function decodeCursor(cursor: string, fp: string): CursorPosition {
  try {
    if (!cursor.startsWith('c_')) throw new Error('prefix')
    const [key, id, was] = JSON.parse(
      Buffer.from(cursor.slice(2), 'base64url').toString(),
    ) as [string | number, string, string]
    if (typeof id !== 'string' || typeof was !== 'string') throw new Error('x')
    if (was !== fp)
      throw apiError(
        'cursor_mismatch',
        'This cursor was made for a different filter or sort.',
      )
    return { key, id }
  } catch (e) {
    if (e instanceof Error && e.name === 'ApiError') throw e
    throw apiError('invalid_request', 'The cursor is not valid.', {
      errors: [
        {
          pointer: '/query/cursor',
          code: 'invalid_cursor',
          message: 'Use next_cursor exactly as returned.',
        },
      ],
    })
  }
}

export type Page<T> = { items: Array<T>; next: CursorPosition | null }

/**
 * Pages through an array already in key order. `stored` is the order the array
 * is kept in and `desc` the order the caller wants; if they differ the array is
 * read backwards, so no copy is made. Binary search finds the start, so a deep
 * cursor costs the same as the first page, and a page costs no more than the
 * items it returns plus the ones a filter skips.
 */
export function pageSorted<T>(
  arr: ReadonlyArray<T>,
  key: (item: T) => string | number,
  id: (item: T) => string,
  options: {
    limit: number
    after: CursorPosition | null
    desc: boolean
    stored?: 'asc' | 'desc'
    match?: (item: T) => boolean
  },
): Page<T> {
  const stored = options.stored ?? (options.desc ? 'desc' : 'asc')
  const forward = (stored === 'desc') === options.desc
  const sign = options.desc ? -1 : 1
  const n = arr.length
  const after = options.after
  // Is this item strictly after the cursor, in the order the caller wants?
  const isAfter = (t: T) => {
    const k = key(t)
    const c = k < after!.key ? -1 : k > after!.key ? 1 : id(t) < after!.id ? -1 : id(t) > after!.id ? 1 : 0
    return sign * c > 0
  }
  let start = forward ? 0 : n - 1
  if (after) {
    let lo = 0
    let hi = n
    if (forward) {
      // false ... false true ... true: the first true.
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (isAfter(arr[mid])) hi = mid
        else lo = mid + 1
      }
      start = lo
    } else {
      // true ... true false ... false: the last true.
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (isAfter(arr[mid])) lo = mid + 1
        else hi = mid
      }
      start = lo - 1
    }
  }
  const step = forward ? 1 : -1
  const items: Array<T> = []
  let more = false
  for (let i = start; i >= 0 && i < n; i += step) {
    const item = arr[i]
    if (options.match && !options.match(item)) continue
    if (items.length === options.limit) {
      more = true
      break
    }
    items.push(item)
  }
  const last = items.at(-1)
  return { items, next: more && last ? { key: key(last), id: id(last) } : null }
}
