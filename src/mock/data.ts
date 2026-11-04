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
    updated: '3 hours ago',
    source: 'codeberg',
    upstream: 'codeberg.org/hollis/lumen',
    install: 'brew install lumen',
    releases: [
      {
        version: 'v2.4.1',
        channel: 'stable',
        date: 'Nov 2, 2026',
        signed: true,
        title: 'Sync conflicts, finally readable',
        notes: {
          added: [
            'Side-by-side conflict view.',
            'Open vault from the terminal.',
          ],
          changed: ['Search index is 3x smaller.'],
          fixed: ['Cursor jump when pasting images.'],
        },
        assets: assets('lumen', 'v2.4.1', 212000),
      },
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
    owner: 'kofi',
    name: 'spindle',
    description: 'Zig HTTP server that serves a static site in 600 KB of RAM.',
    category: 'Developer tools',
    language: 'Zig',
    languages: [['Zig', 100]],
    stars: 3410,
    starsToday: 61,
    forks: 87,
    license: 'MIT',
    updated: '4 days ago',
    source: 'native',
    install: 'curl -fsSL https://source.code/kofi/spindle/install | sh',
    releases: [
      {
        version: 'v0.5.0',
        channel: 'stable',
        date: 'Oct 28, 2026',
        signed: false,
        title: 'HTTP/2',
        notes: { added: ['HTTP/2 support.'], changed: [], fixed: [] },
        assets: assets('spindle', 'v0.5.0', 9100).filter(
          (a) => a.platform !== 'windows',
        ),
      },
    ],
  },
  {
    owner: 'mira',
    name: 'pocket-synth',
    description:
      'A tiny polyphonic synth for macOS menu bars. 4 oscillators, 1 knob, infinite vibes.',
    category: 'Audio and media',
    language: 'Swift',
    languages: [
      ['Swift', 92],
      ['C', 8],
    ],
    stars: 5280,
    starsToday: 207,
    forks: 140,
    license: 'GPL-3.0',
    updated: '1 hour ago',
    source: 'github',
    upstream: 'github.com/mira/pocket-synth',
    releases: [
      {
        version: 'v1.3.0',
        channel: 'stable',
        date: 'Nov 3, 2026',
        signed: true,
        title: 'MIDI learn',
        notes: {
          added: ['MIDI learn for every knob.'],
          changed: [],
          fixed: ['Crackle at 44.1 kHz.'],
        },
        assets: assets('pocket-synth', 'v1.3.0', 38400).slice(0, 2),
      },
    ],
  },
  {
    owner: 'otto',
    name: 'pulse',
    description:
      'Self-hosted uptime monitor with a status page you will not be embarrassed by.',
    category: 'Infrastructure',
    language: 'Go',
    languages: [
      ['Go', 71],
      ['TypeScript', 27],
      ['Dockerfile', 2],
    ],
    stars: 12100,
    starsToday: 95,
    forks: 610,
    license: 'MIT',
    updated: '6 hours ago',
    source: 'gitea',
    upstream: 'gitea.com/otto/pulse',
    install: 'docker run -p 8080:8080 ghcr.io/otto/pulse',
    releases: [
      {
        version: 'v3.0.2',
        channel: 'stable',
        date: 'Nov 1, 2026',
        signed: true,
        title: 'Maintenance',
        notes: {
          added: [],
          changed: ['Faster dashboards.'],
          fixed: ['Memory leak in probes.'],
        },
        assets: assets('pulse', 'v3.0.2', 77000),
      },
    ],
  },
  {
    owner: 'priya',
    name: 'weft',
    description:
      'Elixir framework for collaborative apps: presence, CRDTs and offline sync built in.',
    category: 'Infrastructure',
    language: 'Elixir',
    languages: [
      ['Elixir', 97],
      ['JavaScript', 3],
    ],
    stars: 1980,
    starsToday: 22,
    forks: 64,
    license: 'Apache-2.0',
    updated: '3 days ago',
    source: 'native',
    releases: [],
  },
  {
    owner: 'sol',
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
  {
    owner: 'tomas',
    name: 'beacon',
    description:
      'Desktop app that turns any folder into a shareable link in one click.',
    category: 'Apps',
    language: 'TypeScript',
    languages: [
      ['TypeScript', 78],
      ['Rust', 22],
    ],
    stars: 9040,
    starsToday: 174,
    forks: 355,
    license: 'MPL-2.0',
    updated: 'yesterday',
    source: 'codeberg',
    upstream: 'codeberg.org/tomas/beacon',
    releases: [
      {
        version: 'v0.14.0',
        channel: 'stable',
        date: 'Oct 30, 2026',
        signed: true,
        title: 'Resumable transfers',
        notes: {
          added: ['Resume interrupted transfers.'],
          changed: [],
          fixed: [],
        },
        assets: assets('beacon', 'v0.14.0', 51000),
      },
    ],
  },
  {
    owner: 'vera',
    name: 'kiln',
    description: 'A build system that reads your mind (and your lockfile).',
    category: 'Developer tools',
    language: 'Rust',
    languages: [
      ['Rust', 99],
      ['Starlark', 1],
    ],
    stars: 6150,
    starsToday: 71,
    forks: 233,
    license: 'Apache-2.0',
    updated: '12 hours ago',
    source: 'native',
    install: 'cargo install kiln',
    releases: [
      {
        version: 'v0.31.0',
        channel: 'stable',
        date: 'Nov 2, 2026',
        signed: true,
        title: 'Remote cache',
        notes: {
          added: ['Remote cache over HTTP.'],
          changed: [],
          fixed: ['Cache key drift on Windows.'],
        },
        assets: assets('kiln', 'v0.31.0', 22800),
      },
    ],
  },
  {
    owner: 'yuki',
    name: 'sumi',
    description:
      'Minimal terminal emulator with ligatures, sixels and a 2 ms input path.',
    category: 'Apps',
    language: 'C',
    languages: [
      ['C', 83],
      ['Lua', 17],
    ],
    stars: 15300,
    starsToday: 260,
    forks: 502,
    license: 'ISC',
    updated: '8 hours ago',
    source: 'github',
    upstream: 'github.com/yuki/sumi',
    releases: [
      {
        version: 'v4.2.0',
        channel: 'stable',
        date: 'Nov 3, 2026',
        signed: true,
        title: 'Sixel graphics',
        notes: {
          added: ['Sixel image protocol.'],
          changed: [],
          fixed: ['Ligature flicker.'],
        },
        assets: assets('sumi', 'v4.2.0', 131000),
      },
    ],
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
  {
    handle: 'mira',
    name: 'Mira Takahashi',
    bio: 'Audio plugins and tiny macOS apps.',
    followers: 3550,
    contributions: 2290,
    sources: ['github'],
    languages: ['Swift', 'C'],
    hue: 330,
    featured: 'pocket-synth',
  },
  {
    handle: 'kofi',
    name: 'Kofi Mensah',
    bio: 'Systems programmer. Zig evangelist. Small binaries only.',
    followers: 2780,
    contributions: 1760,
    sources: ['native', 'codeberg'],
    languages: ['Zig', 'C'],
    hue: 90,
    featured: 'spindle',
  },
  {
    handle: 'yuki',
    name: 'Yuki Arai',
    bio: 'Terminals, text rendering, latency.',
    followers: 9120,
    contributions: 6100,
    sources: ['github', 'gitea'],
    languages: ['C', 'Lua'],
    hue: 210,
    featured: 'sumi',
  },
]

export const categories = [
  'Developer tools',
  'Apps',
  'Infrastructure',
  'Databases',
  'Audio and media',
] as const

export function compact(n: number) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function findRepo(owner: string, name: string) {
  return repos.find((r) => r.owner === owner && r.name === name)
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
