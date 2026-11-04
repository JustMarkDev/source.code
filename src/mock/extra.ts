// More mock data: issues, pull requests, CI, insights, inbox and linkable accounts.
import { seeded } from './data'
import type { Repo, Source } from './data'

export type Issue = {
  n: number
  title: string
  state: 'open' | 'closed'
  labels: Array<string>
  author: string
  comments: number
  when: string
  body: string
}

export const labelStyle: Record<string, string> = {
  bug: 'bg-danger/15 text-danger',
  enhancement: 'bg-info/15 text-info',
  docs: 'bg-merged/15 text-merged',
  perf: 'bg-warning/15 text-warning',
  'good first issue': 'bg-success/15 text-success',
  'help wanted': 'bg-brand/30 text-foreground',
}

export function issuesFor(repo: Repo): Array<Issue> {
  const r = repo.name
  return [
    {
      n: 214,
      title: `${r} exits with code 1 when the config file is empty`,
      state: 'open',
      labels: ['bug'],
      author: 'kofi',
      comments: 6,
      when: '3 hours ago',
      body: `Running \`${r} run\` against an empty \`${r}.toml\` prints nothing and exits 1. An empty file should behave like defaults.`,
    },
    {
      n: 213,
      title: 'Publish a Windows ARM64 build',
      state: 'open',
      labels: ['enhancement', 'help wanted'],
      author: 'yuki',
      comments: 11,
      when: 'yesterday',
      body: 'Surface and Snapdragon laptops are common now. Happy to test nightly builds.',
    },
    {
      n: 209,
      title: 'Respect XDG_CONFIG_HOME on Linux',
      state: 'open',
      labels: ['enhancement', 'good first issue'],
      author: 'mira',
      comments: 2,
      when: '2 days ago',
      body: 'Config is read from ~/.config regardless of the XDG variable.',
    },
    {
      n: 207,
      title: 'Memory grows steadily in long-running sessions',
      state: 'open',
      labels: ['bug', 'perf'],
      author: 'otto',
      comments: 9,
      when: '4 days ago',
      body: 'RSS goes from 40 MB to 1.1 GB over 36 hours with the watcher enabled.',
    },
    {
      n: 203,
      title: 'Explain retry behaviour in the docs',
      state: 'open',
      labels: ['docs', 'good first issue'],
      author: 'sol',
      comments: 1,
      when: 'last week',
      body: 'The README mentions retries but not the backoff schedule or how to disable them.',
    },
    {
      n: 198,
      title: 'Panic on ref names with a trailing dot',
      state: 'closed',
      labels: ['bug'],
      author: 'ines',
      comments: 5,
      when: 'last week',
      body: 'Fixed in the latest release.',
    },
    {
      n: 191,
      title: 'JSON output for the list command',
      state: 'closed',
      labels: ['enhancement'],
      author: 'tomas',
      comments: 8,
      when: '2 weeks ago',
      body: 'Added `--json` in the previous release.',
    },
    {
      n: 187,
      title: 'Deprecation warning is noisy in CI',
      state: 'closed',
      labels: ['bug'],
      author: 'vera',
      comments: 3,
      when: '3 weeks ago',
      body: 'Warnings now print once per run.',
    },
  ]
}

export type Run = {
  id: number
  workflow: string
  title: string
  branch: string
  sha: string
  status: 'success' | 'failure' | 'running' | 'queued'
  duration: string
  when: string
  actor: string
}

export const runs: Array<Run> = [
  {
    id: 1842,
    workflow: 'build',
    title: 'Cache negative ref lookups',
    branch: 'main',
    sha: 'a41c9e2',
    status: 'success',
    duration: '2m 41s',
    when: '2 days ago',
    actor: 'dana',
  },
  {
    id: 1841,
    workflow: 'release',
    title: 'Release v0.9.0',
    branch: 'v0.9.0',
    sha: '9c02e7b',
    status: 'success',
    duration: '6m 12s',
    when: '2 weeks ago',
    actor: 'dana',
  },
  {
    id: 1840,
    workflow: 'build',
    title: 'Add a read-only mount mode',
    branch: 'kofi/readonly-mount',
    sha: '3fd81aa',
    status: 'running',
    duration: '1m 05s',
    when: '2 hours ago',
    actor: 'kofi',
  },
  {
    id: 1839,
    workflow: 'build',
    title: 'Windows ARM64 builds',
    branch: 'yuki/win-arm64',
    sha: 'be4410c',
    status: 'failure',
    duration: '3m 58s',
    when: '3 days ago',
    actor: 'yuki',
  },
  {
    id: 1838,
    workflow: 'security',
    title: 'Nightly dependency audit',
    branch: 'main',
    sha: 'a41c9e2',
    status: 'success',
    duration: '48s',
    when: 'yesterday',
    actor: 'scheduler',
  },
  {
    id: 1837,
    workflow: 'build',
    title: 'Cache negative lookups',
    branch: 'dana/neg-cache',
    sha: '77ab3d0',
    status: 'queued',
    duration: '-',
    when: 'yesterday',
    actor: 'dana',
  },
  {
    id: 1836,
    workflow: 'build',
    title: 'Document retry settings',
    branch: 'sol/docs-retry',
    sha: '51c0aa9',
    status: 'success',
    duration: '2m 30s',
    when: 'last week',
    actor: 'sol',
  },
  {
    id: 1835,
    workflow: 'release',
    title: 'Beta: v0.10.0-beta.2',
    branch: 'v0.10.0-beta.2',
    sha: '0e19c4f',
    status: 'failure',
    duration: '5m 44s',
    when: 'last week',
    actor: 'dana',
  },
]

export const jobs = [
  { name: 'lint', time: '14s', status: 'success' },
  { name: 'test (linux)', time: '1m 02s', status: 'success' },
  { name: 'test (macos)', time: '1m 31s', status: 'success' },
  { name: 'test (windows)', time: '1m 48s', status: 'success' },
  { name: 'package and sign', time: '53s', status: 'success' },
] as const

export function contributorsFor(repo: Repo) {
  const rand = seeded(repo.name.length * 31 + repo.stars)
  return ['dana', 'ines', 'kofi', 'yuki', 'sol', 'mira'].map((name, i) => ({
    name,
    commits: Math.round((140 / (i + 1)) * (0.7 + rand() * 0.6)),
    additions: Math.round((9000 / (i + 1)) * (0.6 + rand() * 0.8)),
  }))
}

export function downloadsSeries(repo: Repo) {
  const rand = seeded(repo.stars)
  const base = 400 + (repo.stars % 900)
  return Array.from({ length: 16 }, (_, i) =>
    Math.round(base * (0.5 + i * 0.07) * (0.8 + rand() * 0.4)),
  )
}

export type Notification = {
  id: number
  kind: 'review' | 'mention' | 'release' | 'ci' | 'issue' | 'import'
  title: string
  repo: string
  when: string
  unread: boolean
}

export const notifications: Array<Notification> = [
  {
    id: 1,
    kind: 'import',
    title:
      'Finished linking your GitHub history: 2,410 contributions added to your profile',
    repo: 'Linked accounts',
    when: '12 min ago',
    unread: true,
  },
  {
    id: 2,
    kind: 'review',
    title: 'ines requested your review on #218 Add a read-only mount mode',
    repo: 'dana/gitfs',
    when: '2 hours ago',
    unread: true,
  },
  {
    id: 3,
    kind: 'ci',
    title: 'Build failed on yuki/win-arm64 (#216)',
    repo: 'dana/gitfs',
    when: '3 days ago',
    unread: true,
  },
  {
    id: 4,
    kind: 'release',
    title: 'lumen v2.4.1 is out: Sync conflicts, finally readable',
    repo: 'hollis/lumen',
    when: 'yesterday',
    unread: false,
  },
  {
    id: 5,
    kind: 'mention',
    title: 'kofi mentioned you in #209 Respect XDG_CONFIG_HOME on Linux',
    repo: 'dana/gitfs',
    when: '2 days ago',
    unread: false,
  },
  {
    id: 6,
    kind: 'issue',
    title:
      'You were assigned #207 Memory grows steadily in long-running sessions',
    repo: 'dana/gitfs',
    when: '4 days ago',
    unread: false,
  },
  {
    id: 7,
    kind: 'release',
    title: 'tern v1.12.0 is out: Plan mode',
    repo: 'ines/tern',
    when: '4 days ago',
    unread: false,
  },
]

export type Provider = {
  id: Source
  name: string
  blurb: string
  scopes: Array<string>
  account: {
    handle: string
    repos: number
    contributions: number
    since: string
  }
}

export const providers: Array<Provider> = [
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Commits, pull requests, reviews, issues and releases.',
    scopes: [
      'Read your public profile',
      'Read repository metadata',
      'Read your contribution history',
    ],
    account: {
      handle: 'dana-okafor',
      repos: 42,
      contributions: 2410,
      since: '2017',
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    blurb:
      'Projects, merge requests and pipelines from gitlab.com or self-managed.',
    scopes: [
      'Read your profile',
      'Read project metadata',
      'Read your activity',
    ],
    account: { handle: 'dana', repos: 11, contributions: 640, since: '2019' },
  },
  {
    id: 'codeberg',
    name: 'Codeberg',
    blurb: 'Repositories and activity from Codeberg.',
    scopes: [
      'Read your profile',
      'Read repository metadata',
      'Read your activity',
    ],
    account: { handle: 'dana', repos: 5, contributions: 130, since: '2022' },
  },
  {
    id: 'gitea',
    name: 'Gitea or Forgejo',
    blurb: 'Any self-hosted instance. Enter its address to connect.',
    scopes: ['Read your profile', 'Read repository metadata'],
    account: { handle: 'dana', repos: 3, contributions: 96, since: '2023' },
  },
]

export const imports = [
  {
    name: 'tinyqueue',
    from: 'github' as const,
    status: 'Syncing',
    when: '14 min ago',
  },
  {
    name: 'dotfiles',
    from: 'github' as const,
    status: 'Imported',
    when: 'today',
  },
  {
    name: 'zine',
    from: 'codeberg' as const,
    status: 'Imported',
    when: 'today',
  },
  {
    name: 'old-site',
    from: 'gitlab' as const,
    status: 'Imported',
    when: 'today',
  },
]
