/**
 * Keyset pages over an index whose last two fields are a sort key and the
 * public id. A cursor is the key and id of the last item sent, as the API's
 * cursors always were (`packages/api/src/cursor.ts`): the next page starts
 * after that item whatever was added or removed in between.
 *
 * An index range can hold one inequality, so "after (key, id)" is read as two
 * ranges: the rest of the rows with the same key, then the rows past it.
 * Reading stops one match past the page, to know whether there is more, and
 * never scans more than `maxScan` rows, so a sparse filter cannot read a
 * whole table.
 */
export type Position = { key: string | number; id: string }

export type Ranges<D> = {
  /** Rows with sort key `key` and id past `id`, in page order. */
  sameKey: (key: string | number, id: string) => AsyncIterable<D>
  /** Rows with a sort key past `key` (all rows when null), in page order. */
  beyond: (key: string | number | null) => AsyncIterable<D>
}

export async function keysetPage<D extends { publicId: string }>(
  ranges: Ranges<D>,
  keyOf: (d: D) => string | number,
  opts: {
    after: Position | null
    limit: number
    match?: (d: D) => boolean | Promise<boolean>
    maxScan?: number
  },
): Promise<{ items: Array<D>; next: Position | null }> {
  const items: Array<D> = []
  let more = false
  let scanned = 0
  const maxScan = opts.maxScan ?? 10_000
  const sources = opts.after
    ? [
        ranges.sameKey(opts.after.key, opts.after.id),
        ranges.beyond(opts.after.key),
      ]
    : [ranges.beyond(null)]
  outer: for (const source of sources)
    for await (const d of source) {
      if (++scanned > maxScan) break outer
      if (opts.match && !(await opts.match(d))) continue
      if (items.length === opts.limit) {
        more = true
        break outer
      }
      items.push(d)
    }
  const last = items.at(-1)
  return {
    items,
    next: more && last ? { key: keyOf(last), id: last.publicId } : null,
  }
}
