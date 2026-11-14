// How the screens see a repository and its releases, and small helpers for
// showing them. `lib/repo.ts` builds these from the API's objects.

export type Source = 'native' | 'github' | 'gitlab' | 'codeberg' | 'gitea'
export type Platform = 'macos' | 'windows' | 'linux'
export type Channel = 'stable' | 'beta' | 'nightly'
export type Category = (typeof categories)[number]

export const sources: Record<
  Source,
  { label: string; dot: string; host: string }
> = {
  native: { label: 'source.code', dot: 'bg-emerald-400', host: 'source.code' },
  github: { label: 'GitHub', dot: 'bg-zinc-200', host: 'github.com' },
  gitlab: { label: 'GitLab', dot: 'bg-orange-400', host: 'gitlab.com' },
  codeberg: { label: 'Codeberg', dot: 'bg-sky-400', host: 'codeberg.org' },
  gitea: { label: 'Gitea', dot: 'bg-lime-400', host: 'gitea.com' },
}

export const languageColors: Record<string, string> = {
  Rust: '#dea584',
  TypeScript: '#3178c6',
  Go: '#00add8',
  Python: '#3572a5',
  Zig: '#ec915c',
  C: '#9aa0a6',
  Swift: '#f05138',
  Elixir: '#8b5cf6',
  JavaScript: '#f1e05a',
  Shell: '#89e051',
  Nix: '#7e7eff',
  SQL: '#e38c00',
  CSS: '#7c5cff',
  Dockerfile: '#384d54',
  Lua: '#51a0cf',
  Starlark: '#76d275',
}

export type Asset = {
  platform: Platform
  arch: string
  file: string
  size: string
  downloads: number
  sha: string
  /** The file is kept here and can be downloaded, not only counted. */
  stored?: boolean
}

export type Release = {
  version: string
  channel: Channel
  date: string
  signed: boolean
  title: string
  notes: { added: Array<string>; changed: Array<string>; fixed: Array<string> }
  assets: Array<Asset>
  /** The commit a beta or nightly was built from. */
  commit?: string
  /** Set when a release was pulled. The reason is shown on its page. */
  withdrawn?: string
}

export type Repo = {
  owner: string
  name: string
  description: string
  /** Public when absent: the sample repositories are all public. */
  visibility?: 'public' | 'private'
  category: Category
  language: string
  languages: Array<[string, number]>
  stars: number
  starsToday: number
  forks: number
  license: string
  updated: string
  source: Source
  /** Where the code really lives when it is mirrored here. */
  upstream?: string
  releases: Array<Release>
  install?: string
  /** The project's own site and documentation, when it has them. */
  website?: string
  docs?: string
}

export const categories = [
  'Developer tools',
  'Apps',
  'Infrastructure',
  'Databases',
] as const

/** "3 hours ago", "yesterday", "2 weeks ago" as hours, so a list can be sorted by it. */
export function hoursAgo(text: string): number {
  if (text === 'yesterday') return 24
  const m = /^(\d+) (minute|hour|day|week|month|year)s? ago$/.exec(text)
  if (!m) return Number.MAX_SAFE_INTEGER
  const unit = {
    minute: 1 / 60,
    hour: 1,
    day: 24,
    week: 168,
    month: 720,
    year: 8760,
  }
  return Number(m[1]) * unit[m[2] as keyof typeof unit]
}

export function compact(n: number) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function latestStable(repo: Repo) {
  return repo.releases.find((r) => r.channel === 'stable')
}

export function totalDownloads(release: Release) {
  return release.assets.reduce((sum, a) => sum + a.downloads, 0)
}

// Deterministic pseudo-random so the contribution graph is stable across SSR and client.
export function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
