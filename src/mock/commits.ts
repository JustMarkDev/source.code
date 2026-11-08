// Sample commit history for the design previews. Deterministic, so it renders
// the same on the server and in the browser.
import type { Repo } from '~/mock/data'
import { seeded } from '~/mock/data'

export type Committer = { name: string; kind: 'human' | 'agent' | 'bot' }

export type Commit = {
  sha: string
  full: string
  parent: string
  message: string
  body?: string
  author: Committer
  /** Hours before the newest commit. */
  hoursAgo: number
  /** "Nov 2, 2026", in UTC so server and browser agree. */
  day: string
  when: string
  checks: 'pass' | 'fail'
  /** The change this landed through, if any. */
  change?: string
  files: number
  additions: number
  deletions: number
}

const now = Date.UTC(2026, 10, 4, 14, 0)

const people: Array<Committer> = [
  { name: 'dana', kind: 'human' },
  { name: 'hollis', kind: 'human' },
  { name: 'ines', kind: 'human' },
  { name: 'kofi', kind: 'human' },
  { name: 'yuki', kind: 'human' },
  { name: 'claude via T3 Code', kind: 'agent' },
  { name: 'dep-bot', kind: 'bot' },
]

const messages = [
  'Cache negative ref lookups',
  'Memory-map pack index reads',
  'Document S3 retry behaviour',
  'Fix mount on empty directories',
  'Add a read-only mount mode',
  'Respect XDG_CONFIG_HOME on Linux',
  'Bound the negative cache and evict LRU',
  'Handle UNC paths in clone on Windows',
  'Bump object-store client to 2.4',
  'Return a clear error when the config file is empty',
  'Speed up ref listing with a prefix index',
  'Sign release files with cosign',
  'Retry transient 503s from the bucket',
  'Add --json to gitfs status',
  'Reduce allocations in pack parsing',
  'Tidy error messages for bad credentials',
  'Fix a data race in the cache shutdown path',
  'Update the install script for ARM64',
]

const hex = (n: number, len: number) =>
  Array.from({ length: len }, (_, i) =>
    ((n * 2654435761 + i * 40503) >>> 0).toString(16).slice(-1),
  ).join('')

const fmt = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

function ago(h: number) {
  if (h < 1) return 'just now'
  if (h < 24)
    return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  return `${Math.round(d / 7)} weeks ago`
}

export function commitsFor(repo: Repo, count = 60): Array<Commit> {
  const seed = Array.from(repo.name).reduce((n, c) => n + c.charCodeAt(0), 7)
  const rand = seeded(seed)
  let hours = 2
  const list: Array<Commit> = []
  for (let i = 0; i < count; i++) {
    hours += 3 + rand() * 30
    const author = people[Math.floor(rand() ** 1.6 * people.length)]
    const message = messages[(i * 5 + seed) % messages.length]
    const ms = now - hours * 3_600_000
    list.push({
      sha: hex(seed + i, 7),
      full: hex(seed + i, 40),
      parent: hex(seed + i + 1, 7),
      message,
      author,
      hoursAgo: hours,
      day: fmt(ms),
      when: ago(hours),
      checks: rand() > 0.94 ? 'fail' : 'pass',
      change: rand() > 0.55 ? String(100 + ((seed + i * 3) % 110)) : undefined,
      files: 1 + Math.floor(rand() * 6),
      additions: 3 + Math.floor(rand() * 90),
      deletions: Math.floor(rand() * 30),
    })
  }
  return list
}

export function findCommit(repo: Repo, sha: string): Commit | undefined {
  return commitsFor(repo).find(
    (c) => c.sha.startsWith(sha) || sha.startsWith(c.sha),
  )
}

export const committers = people
