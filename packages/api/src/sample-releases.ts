/**
 * The sample repositories' releases: what the Releases tab, the download
 * button and the about panel show. Sizes are bytes, dates are UTC midnight.
 */
import type { ReleaseRec } from './domain/records'

type Seed = Omit<ReleaseRec, 'id' | 'author' | 'version'>

/** The usual five builds of a release; nightlies skip Windows and arm64 Linux. */
const builds: Array<[string, string, string, number, number]> = [
  // platform, arch, file suffix, MB, share of the release's downloads
  ['macos', 'arm64', 'aarch64-apple-darwin.dmg', 14.2, 0.46],
  ['macos', 'x64', 'x86_64-apple-darwin.dmg', 15.1, 0.12],
  ['windows', 'x64', 'x86_64-windows.msi', 16.8, 0.17],
  ['linux', 'x64', 'x86_64-linux.tar.gz', 12.9, 0.19],
  ['linux', 'arm64', 'aarch64-linux.tar.gz', 12.4, 0.06],
]

/** A made-up but stable checksum per build. */
const sha = (name: string, n: number) =>
  Array.from({ length: 64 }, (_, i) =>
    ((i * 7 + n * 13 + name.length * 5) % 16).toString(16),
  ).join('')

function assets(
  name: string,
  tag: string,
  downloads: number,
  nightly = false,
): Seed['assets'] {
  return builds
    .map(([platform, arch, suffix, mb, share], n) => ({
      name: `${name}-${tag}-${suffix}`,
      platform: platform as Seed['assets'][number]['platform'],
      arch,
      size: Math.round(mb * 1_048_576),
      downloads: Math.round(downloads * share),
      sha256: sha(name, n),
    }))
    .filter(
      (a) =>
        !nightly ||
        (a.platform !== 'windows' && a.arch === 'x64') ||
        (a.platform === 'macos' && a.arch === 'arm64'),
    )
}

export const sampleReleases: Record<string, Array<Seed>> = {
  'dana/gitfs': [
    {
      tag: 'v0.9.0',
      channel: 'stable',
      title: 'Faster ref lookups',
      notes: {
        added: [
          'Negative ref cache: repeated lookups for missing refs no longer hit disk.',
          '`gitfs mount --readonly` for CI runners.',
        ],
        changed: ['Pack index reads are now memory-mapped on Linux and macOS.'],
        fixed: [
          'Panic when a ref name contained a trailing dot.',
          'Windows: handle UNC paths in `gitfs clone`.',
        ],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('gitfs', 'v0.9.0', 18419),
      published: 1792454400000,
    },
    {
      tag: 'v0.10.0-beta.2',
      channel: 'beta',
      title: 'Read-only mounts',
      notes: {
        added: ['`gitfs mount --readonly` for CI runners.'],
        changed: ['Pack index reads are now memory-mapped on Linux and macOS.'],
        fixed: [
          'Panic when a ref name contained a trailing dot.',
          'Windows: handle UNC paths in `gitfs clone`.',
        ],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('gitfs', 'v0.10.0-beta.2', 1330),
      published: 1793232000000,
    },
    {
      tag: 'v0.8.3',
      channel: 'stable',
      title: 'Patch release',
      notes: {
        added: [],
        changed: [],
        fixed: ['Retry on S3 503 responses.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('gitfs', 'v0.8.3', 41199),
      published: 1790726400000,
    },
  ],
  'hollis/lumen': [
    {
      tag: 'v2.5.0-nightly.20261104',
      channel: 'nightly',
      title: 'Built from main',
      notes: {
        added: ['Encrypt a vault at rest (first cut, off by default).'],
        changed: ['Sync runs on a background thread.'],
        fixed: [],
      },
      signed: false,
      commit: 'e91b3c4',
      withdrawn: null,
      assets: assets('lumen', 'v2.5.0-nightly.20261104', 1899, true),
      published: 1793750400000,
    },
    {
      tag: 'v2.4.1',
      channel: 'stable',
      title: 'Sync conflicts, finally readable',
      notes: {
        added: ['Side-by-side conflict view.', 'Open vault from the terminal.'],
        changed: ['Search index is 3x smaller.'],
        fixed: ['Cursor jump when pasting images.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('lumen', 'v2.4.1', 211999),
      published: 1793577600000,
    },
    {
      tag: 'v2.5.0-beta.2',
      channel: 'beta',
      title: 'Vault encryption, second look',
      notes: {
        added: ['Passphrase prompt on first open of an encrypted vault.'],
        changed: ['Encrypted vaults skip the search index until unlocked.'],
        fixed: ['Beta 1: crash when unlocking with an empty passphrase.'],
      },
      signed: true,
      commit: '4ad07f2',
      withdrawn: null,
      assets: assets('lumen', 'v2.5.0-beta.2', 8399),
      published: 1793145600000,
    },
    {
      tag: 'v2.5.0-beta.1',
      channel: 'beta',
      title: 'Vault encryption, first look',
      notes: {
        added: ['Encrypt a vault with a passphrase.'],
        changed: ['Settings are now stored per vault.'],
        fixed: [],
      },
      signed: true,
      commit: 'b7c215e',
      withdrawn: null,
      assets: assets('lumen', 'v2.5.0-beta.1', 5099),
      published: 1791936000000,
    },
    {
      tag: 'v2.4.0',
      channel: 'stable',
      title: 'Plugins can add commands',
      notes: {
        added: ['Plugins can register commands in the palette.', 'Pin notes.'],
        changed: ['Faster cold start on Windows.'],
        fixed: ['Wrong word count for notes with front matter.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('lumen', 'v2.4.0', 187999),
      published: 1791244800000,
    },
    {
      tag: 'v2.3.2',
      channel: 'stable',
      title: 'Patch: sync stalls',
      notes: {
        added: [],
        changed: ['Retry sync with backoff instead of failing.'],
        fixed: ['Sync stalled after the laptop woke from sleep.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('lumen', 'v2.3.2', 93999),
      published: 1789084800000,
    },
    {
      tag: 'v2.3.1',
      channel: 'stable',
      title: 'Move notes between vaults',
      notes: {
        added: ['Move notes between vaults.'],
        changed: [],
        fixed: ['Tag autocomplete lagged on large vaults.'],
      },
      signed: true,
      commit: null,
      withdrawn: {
        reason:
          'Moving a note between vaults could overwrite a note with the same name. Use v2.3.2 or later.',
        at: 1787788800000,
      },
      assets: assets('lumen', 'v2.3.1', 11999),
      published: 1787702400000,
    },
    {
      tag: 'v2.3.0',
      channel: 'stable',
      title: 'Canvas view',
      notes: {
        added: ['Canvas view for laying notes out freely.'],
        changed: ['The graph view starts zoomed out.'],
        fixed: ['Backlinks missed links inside tables.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('lumen', 'v2.3.0', 140999),
      published: 1787097600000,
    },
    {
      tag: 'v2.0.0',
      channel: 'stable',
      title: 'A new editor',
      notes: {
        added: ['A new editor with live preview.', 'Vaults on any folder.'],
        changed: ['The file format is unchanged: still plain markdown.'],
        fixed: [],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('lumen', 'v2.0.0', 401999),
      published: 1773273600000,
    },
  ],
  'ines/tern': [
    {
      tag: 'v1.12.0',
      channel: 'stable',
      title: 'Plan mode',
      notes: {
        added: ['`tern plan` shows the SQL without running it.'],
        changed: [],
        fixed: ['Deadlock on concurrent `up` runs.'],
      },
      signed: true,
      commit: null,
      withdrawn: null,
      assets: assets('tern', 'v1.12.0', 63999),
      published: 1793404800000,
    },
  ],
}
