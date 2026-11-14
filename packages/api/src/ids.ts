/**
 * Public identifiers: a type prefix, then 10 characters of millisecond time
 * and 8 random ones, in an alphabet that sorts the same as the time does.
 * `chg_01k8r2m9x4q7ab12` was made after `chg_01k8r2m9x3zzzzzz`.
 *
 * They are ours. They are stored beside the database's own ID and never
 * derived from it, so the database can change without a public ID changing.
 */
export const idPrefixes = {
  account: 'acc',
  repo: 'rep',
  change: 'chg',
  issue: 'iss',
  finding: 'fnd',
  review: 'rev',
  check: 'chk',
  stack: 'stk',
  token: 'tok',
  operation: 'op',
  event: 'evt',
  request: 'req',
  comment: 'cmt',
  authorization: 'atz',
  webhook: 'whk',
  delivery: 'dlv',
  upload: 'upl',
  evidence: 'evd',
  mirror: 'mir',
  grant: 'grt',
  team: 'tem',
  run: 'run',
  invitation: 'inv',
  label: 'lbl',
  notification: 'ntf',
  release: 'rel',
  pipeline: 'pip',
  exception: 'pex',
  automation: 'aut',
} as const

export type IdKind = keyof typeof idPrefixes

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

// A busy server makes many ids in the same millisecond. Keep the last answer.
let lastMs = -1
let lastText = ''
function encodeTime(ms: number): string {
  if (ms === lastMs) return lastText
  let out = ''
  let n = ms
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[n % 32] + out
    n = Math.floor(n / 32)
  }
  lastMs = ms
  lastText = out
  return out
}

/**
 * Where random bytes come from. Tests and the docs generator swap it for a
 * seeded source so examples come out the same every time.
 */
export const randomSource = {
  bytes: (n: number): Uint8Array => randomBytes(n),
}

// Web Crypto, so the same code runs in Bun, Node and Convex.
function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

// Asking the operating system for randomness on every id costs more than the
// rest of a cached read. Take a pool at a time instead. Each id still gets
// fresh bytes; none is ever used twice.
const POOL = 4096
let pool: Uint8Array = new Uint8Array(0)
let at = 0
function take(length: number): Uint8Array {
  if (randomSource.bytes !== defaultBytes) return randomSource.bytes(length)
  if (at + length > pool.length) {
    pool = randomBytes(POOL)
    at = 0
  }
  const out = pool.subarray(at, at + length)
  at += length
  return out
}
const defaultBytes = randomSource.bytes

function randomChars(length: number): string {
  const bytes = take(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 32]
  return out
}

export function newId(kind: IdKind, when: number = Date.now()): string {
  return `${idPrefixes[kind]}_${encodeTime(when)}${randomChars(8)}`
}

/** A stable ID for sample data: same inputs, same ID. */
export function seededId(kind: IdKind, when: number, tag: string): string {
  let h = 2166136261
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[(h >>> (i * 4)) % 32]
    h = Math.imul(h ^ (h >>> 13), 1274126177)
  }
  return `${idPrefixes[kind]}_${encodeTime(when)}${out}`
}
