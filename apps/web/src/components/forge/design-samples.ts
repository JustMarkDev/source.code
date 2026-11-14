// Sample data for the design system page (`/design`), so each pattern can
// be shown without reading anything.
import type { Asset, Platform, Repo, Source } from '~/lib/model/data'

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

export const sampleRepos: Array<Repo> = [
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

export const sampleDeveloper: Developer = {
  handle: 'hollis',
  name: 'Hollis Reyes',
  bio: 'Local-first software, notes, and way too many keyboards.',
  followers: 12800,
  contributions: 5240,
  sources: ['codeberg', 'github'],
  languages: ['Rust', 'TypeScript'],
  hue: 20,
  featured: 'lumen',
}
