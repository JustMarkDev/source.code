// Mock data for the discover and repo design previews. Everything here is fictional.

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

export const platforms: Record<Platform, { label: string; short: string }> = {
  macos: { label: 'macOS', short: 'Mac' },
  windows: { label: 'Windows', short: 'Win' },
  linux: { label: 'Linux', short: 'Linux' },
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

function assets(name: string, v: string, total: number): Array<Asset> {
  const sha = (n: number) =>
    Array.from({ length: 64 }, (_, i) =>
      ((i * 7 + n * 13 + name.length * 5) % 16).toString(16),
    ).join('')
  return [
    ['macos', 'arm64', 'aarch64-apple-darwin.dmg', '14.2 MB', 0.46],
    ['macos', 'x64', 'x86_64-apple-darwin.dmg', '15.1 MB', 0.12],
    ['windows', 'x64', 'x86_64-windows.msi', '16.8 MB', 0.17],
    ['linux', 'x64', 'x86_64-linux.tar.gz', '12.9 MB', 0.19],
    ['linux', 'arm64', 'aarch64-linux.tar.gz', '12.4 MB', 0.06],
  ].map(([platform, arch, suffix, size, share], i) => ({
    platform: platform as Platform,
    arch: arch as string,
    file: `${name}-${v}-${suffix as string}`,
    size: size as string,
    downloads: Math.round(total * (share as number)),
    sha: sha(i),
  }))
}

/** A release with the usual five builds. Nightlies skip Windows and arm64. */
function lumenRelease(
  version: string,
  channel: Channel,
  date: string,
  o: {
    title: string
    total: number
    notes: Release['notes']
    commit?: string
    signed?: boolean
    withdrawn?: string
  },
): Release {
  const all = assets('lumen', version, o.total)
  return {
    version,
    channel,
    date,
    signed: o.signed ?? true,
    title: o.title,
    notes: o.notes,
    commit: o.commit,
    withdrawn: o.withdrawn,
    assets:
      channel === 'nightly'
        ? all.filter(
            (a) =>
              (a.platform !== 'windows' && a.arch === 'x64') ||
              (a.platform === 'macos' && a.arch === 'arm64'),
          )
        : all,
  }
}

const gitfsNotes = {
  added: [
    'Negative ref cache: repeated lookups for missing refs no longer hit disk.',
    '`gitfs mount --readonly` for CI runners.',
  ],
  changed: ['Pack index reads are now memory-mapped on Linux and macOS.'],
  fixed: [
    'Panic when a ref name contained a trailing dot.',
    'Windows: handle UNC paths in `gitfs clone`.',
  ],
}

export const repos: Array<Repo> = [
  {
    owner: 'dana',
    name: 'gitfs',
    description:
      'Git over object storage. Mount any bucket as a repository and clone it from anywhere.',
    category: 'Developer tools',
    language: 'Rust',
    languages: [
      ['Rust', 88.4],
      ['Shell', 7.1],
      ['Nix', 4.5],
    ],
    stars: 2140,
    starsToday: 84,
    forks: 118,
    license: 'MIT',
    website: 'https://gitfs.dev',
    docs: 'https://gitfs.dev/docs',
    updated: '2 days ago',
    source: 'native',
    install: 'curl -fsSL https://source.code/dana/gitfs/install | sh',
    releases: [
      {
        version: 'v0.9.0',
        channel: 'stable',
        date: 'Oct 20, 2026',
        signed: true,
        title: 'Faster ref lookups',
        notes: gitfsNotes,
        assets: assets('gitfs', 'v0.9.0', 18420),
      },
      {
        version: 'v0.10.0-beta.2',
        channel: 'beta',
        date: 'Oct 29, 2026',
        signed: true,
        title: 'Read-only mounts',
        notes: { ...gitfsNotes, added: gitfsNotes.added.slice(1) },
        assets: assets('gitfs', 'v0.10.0-beta.2', 1330),
      },
      {
        version: 'v0.8.3',
        channel: 'stable',
        date: 'Sep 30, 2026',
        signed: true,
        title: 'Patch release',
        notes: {
          added: [],
          changed: [],
          fixed: ['Retry on S3 503 responses.'],
        },
        assets: assets('gitfs', 'v0.8.3', 41200),
      },
    ],
  },
  {
    owner: 'dana',
    name: 'tinyqueue',
    description:
      'Zero-dependency job queue with retries and exponential backoff.',
    category: 'Infrastructure',
    language: 'TypeScript',
    languages: [
      ['TypeScript', 96.2],
      ['JavaScript', 3.8],
    ],
    stars: 640,
    starsToday: 9,
    forks: 31,
    license: 'MIT',
    updated: '5 days ago',
    source: 'github',
    upstream: 'github.com/dana/tinyqueue',
    releases: [],
  },
  {
    // Owned by an organization, not by a person.
    owner: 'northwind',
    name: 'relay',
    description:
      'A small message relay with at-least-once delivery and a replayable log.',
    category: 'Infrastructure',
    language: 'Go',
    languages: [
      ['Go', 91.4],
      ['Shell', 8.6],
    ],
    stars: 310,
    starsToday: 6,
    forks: 18,
    license: 'Apache-2.0',
    updated: '1 day ago',
    source: 'native',
    releases: [],
  },
  {
    owner: 'hollis',
    name: 'lumen',
    description:
      'A fast, local-first markdown notebook. Plain files on disk, instant search, no account.',
    category: 'Apps',
    language: 'Rust',
    languages: [
      ['Rust', 61],
      ['TypeScript', 34],
      ['CSS', 5],
    ],
    stars: 18900,
    starsToday: 412,
    forks: 904,
    license: 'AGPL-3.0',
    website: 'https://lumen.app',
    docs: 'https://lumen.app/docs',
    updated: '3 hours ago',
    source: 'codeberg',
    upstream: 'codeberg.org/hollis/lumen',
    install: 'brew install lumen',
    releases: [
      lumenRelease('v2.5.0-nightly.20261104', 'nightly', 'Nov 4, 2026', {
        title: 'Built from main',
        total: 1900,
        commit: 'e91b3c4',
        signed: false,
        notes: {
          added: ['Encrypt a vault at rest (first cut, off by default).'],
          changed: ['Sync runs on a background thread.'],
          fixed: [],
        },
      }),
      lumenRelease('v2.4.1', 'stable', 'Nov 2, 2026', {
        title: 'Sync conflicts, finally readable',
        total: 212000,
        notes: {
          added: [
            'Side-by-side conflict view.',
            'Open vault from the terminal.',
          ],
          changed: ['Search index is 3x smaller.'],
          fixed: ['Cursor jump when pasting images.'],
        },
      }),
      lumenRelease('v2.5.0-beta.2', 'beta', 'Oct 28, 2026', {
        title: 'Vault encryption, second look',
        total: 8400,
        commit: '4ad07f2',
        notes: {
          added: ['Passphrase prompt on first open of an encrypted vault.'],
          changed: ['Encrypted vaults skip the search index until unlocked.'],
          fixed: ['Beta 1: crash when unlocking with an empty passphrase.'],
        },
      }),
      lumenRelease('v2.5.0-beta.1', 'beta', 'Oct 14, 2026', {
        title: 'Vault encryption, first look',
        total: 5100,
        commit: 'b7c215e',
        notes: {
          added: ['Encrypt a vault with a passphrase.'],
          changed: ['Settings are now stored per vault.'],
          fixed: [],
        },
      }),
      lumenRelease('v2.4.0', 'stable', 'Oct 6, 2026', {
        title: 'Plugins can add commands',
        total: 188000,
        notes: {
          added: [
            'Plugins can register commands in the palette.',
            'Pin notes.',
          ],
          changed: ['Faster cold start on Windows.'],
          fixed: ['Wrong word count for notes with front matter.'],
        },
      }),
      lumenRelease('v2.3.2', 'stable', 'Sep 11, 2026', {
        title: 'Patch: sync stalls',
        total: 94000,
        notes: {
          added: [],
          changed: ['Retry sync with backoff instead of failing.'],
          fixed: ['Sync stalled after the laptop woke from sleep.'],
        },
      }),
      lumenRelease('v2.3.1', 'stable', 'Aug 26, 2026', {
        title: 'Move notes between vaults',
        total: 12000,
        withdrawn:
          'Moving a note between vaults could overwrite a note with the same name. Use v2.3.2 or later.',
        notes: {
          added: ['Move notes between vaults.'],
          changed: [],
          fixed: ['Tag autocomplete lagged on large vaults.'],
        },
      }),
      lumenRelease('v2.3.0', 'stable', 'Aug 19, 2026', {
        title: 'Canvas view',
        total: 141000,
        notes: {
          added: ['Canvas view for laying notes out freely.'],
          changed: ['The graph view starts zoomed out.'],
          fixed: ['Backlinks missed links inside tables.'],
        },
      }),
      lumenRelease('v2.0.0', 'stable', 'Mar 12, 2026', {
        title: 'A new editor',
        total: 402000,
        notes: {
          added: ['A new editor with live preview.', 'Vaults on any folder.'],
          changed: ['The file format is unchanged: still plain markdown.'],
          fixed: [],
        },
      }),
    ],
  },
  {
    owner: 'ines',
    name: 'tern',
    description:
      'Typed schema migrations for Postgres. Plan, diff and roll back from one binary.',
    category: 'Databases',
    language: 'Go',
    languages: [
      ['Go', 94],
      ['SQL', 6],
    ],
    stars: 7320,
    starsToday: 133,
    forks: 288,
    license: 'Apache-2.0',
    website: 'https://tern.dev',
    docs: 'https://tern.dev/docs',
    updated: 'yesterday',
    source: 'gitlab',
    upstream: 'gitlab.com/ines/tern',
    install: 'go install tern.dev/cmd/tern@latest',
    releases: [
      {
        version: 'v1.12.0',
        channel: 'stable',
        date: 'Oct 31, 2026',
        signed: true,
        title: 'Plan mode',
        notes: {
          added: ['`tern plan` shows the SQL without running it.'],
          changed: [],
          fixed: ['Deadlock on concurrent `up` runs.'],
        },
        assets: assets('tern', 'v1.12.0', 64000),
      },
    ],
  },
  {
    owner: 'ines',
    name: 'inkwell',
    description:
      'Python library for typesetting beautiful PDFs from plain data.',
    category: 'Developer tools',
    language: 'Python',
    languages: [['Python', 100]],
    stars: 4470,
    starsToday: 38,
    forks: 201,
    license: 'BSD-3-Clause',
    updated: '2 days ago',
    source: 'gitlab',
    upstream: 'gitlab.com/sol/inkwell',
    install: 'pip install inkwell',
    releases: [],
  },
]

export type Developer = {
  handle: string
  name: string
  bio: string
  followers: number
  contributions: number
  sources: Array<Source>
  languages: Array<string>
  hue: number
  featured: string
}

export const developers: Array<Developer> = [
  {
    handle: 'dana',
    name: 'Dana Okafor',
    bio: 'Building small, fast dev tools. Rust + TS.',
    followers: 4210,
    contributions: 3180,
    sources: ['native', 'github', 'gitlab'],
    languages: ['Rust', 'TypeScript'],
    hue: 160,
    featured: 'gitfs',
  },
  {
    handle: 'hollis',
    name: 'Hollis Reyes',
    bio: 'Local-first software, notes, and way too many keyboards.',
    followers: 12800,
    contributions: 5240,
    sources: ['codeberg', 'github'],
    languages: ['Rust', 'TypeScript'],
    hue: 20,
    featured: 'lumen',
  },
  {
    handle: 'ines',
    name: 'Inês Barbosa',
    bio: 'Databases, migrations and the occasional compiler.',
    followers: 6930,
    contributions: 4010,
    sources: ['gitlab', 'github'],
    languages: ['Go', 'Python'],
    hue: 280,
    featured: 'tern',
  },
]

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

/**
 * The sample repositories name their owner once, as written. An organization
 * can be renamed, so the directory registers a way back from its current
 * address to the one written here.
 */
let originalOwner: (handle: string) => string | undefined = () => undefined
export function setOriginalOwner(fn: typeof originalOwner) {
  originalOwner = fn
}

/** The address the sample data knows an account by, even after it was renamed. */
export const ownerAsWritten = (handle: string) =>
  originalOwner(handle) ?? handle

/** The repositories an account owns, wherever it has been renamed to. */
export function reposOwnedBy(handle: string) {
  const written = ownerAsWritten(handle)
  return repos.filter((r) => r.owner === written || r.owner === handle)
}

export function findRepo(owner: string, name: string) {
  return reposOwnedBy(owner).find((r) => r.name === name)
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
