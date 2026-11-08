/** Latency histogram with 2% buckets from 1 µs, mergeable across processes. */
const GROWTH = 1.02
const LOG = Math.log(GROWTH)
export const BUCKETS = 1200

export class Histogram {
  counts = Array.from<number>({ length: BUCKETS }).fill(0)
  total = 0
  max = 0

  add(ms: number) {
    const us = Math.max(1, ms * 1000)
    const i = Math.min(BUCKETS - 1, Math.floor(Math.log(us) / LOG))
    this.counts[i]++
    this.total++
    if (ms > this.max) this.max = ms
  }

  merge(o: { counts: Array<number>; total: number; max: number }) {
    for (let i = 0; i < BUCKETS; i++) this.counts[i] += o.counts[i] ?? 0
    this.total += o.total
    this.max = Math.max(this.max, o.max)
  }

  /** Milliseconds at a percentile (0..1), as the upper edge of its bucket. */
  at(p: number) {
    if (this.total === 0) return 0
    const want = Math.ceil(this.total * p)
    let seen = 0
    for (let i = 0; i < BUCKETS; i++) {
      seen += this.counts[i]
      if (seen >= want) return Math.pow(GROWTH, i + 1) / 1000
    }
    return this.max
  }
}
