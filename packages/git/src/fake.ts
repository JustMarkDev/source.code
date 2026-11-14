import { createHash } from 'node:crypto'
import { structuredPatch } from 'diff'
import { ApiError } from '@pierre/storage'
import type { CommitInfo, FileDiff } from '@pierre/storage'
import { contributingFor, licenseFor, readmeFor } from './sample-docs'
import type { GitRepo } from './index'

// Each commit lists the files it touches; null deletes the file.
type FixtureCommit = {
  message: string
  author: string
  date: string
  files: Record<string, string | null>
}

const fixtures: Partial<Record<string, Array<FixtureCommit>>> = {
  tinyqueue: [
    {
      message: 'Start the queue over',
      author: 'Dana Okafor',
      date: '2026-09-02T10:00:00Z',
      files: {
        'README.md': '# tinyqueue\n\nA zero-dependency job queue.\n',
        'package.json': '{\n  "name": "tinyqueue",\n  "version": "0.1.0"\n}\n',
        'src/index.ts':
          'export type Job = () => Promise<void>\n\nexport class Queue {\n  private jobs: Job[] = []\n\n  push(job: Job) {\n    this.jobs.push(job)\n  }\n\n  async drain() {\n    for (const job of this.jobs.splice(0)) await job()\n  }\n}\n',
      },
    },
    {
      message: 'Retry failed jobs with backoff',
      author: 'Dana Okafor',
      date: '2026-09-18T14:30:00Z',
      files: {
        'src/retry.ts':
          'export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {\n  for (let i = 1; ; i++) {\n    try {\n      return await fn()\n    } catch (err) {\n      if (i >= attempts) throw err\n      await new Promise((r) => setTimeout(r, 2 ** i * 100))\n    }\n  }\n}\n',
        'src/index.ts':
          "import { retry } from './retry'\n\nexport type Job = () => Promise<void>\n\nexport class Queue {\n  private jobs: Job[] = []\n\n  push(job: Job) {\n    this.jobs.push(job)\n  }\n\n  async drain() {\n    for (const job of this.jobs.splice(0)) await retry(job)\n  }\n}\n",
      },
    },
    {
      message: 'Document retries',
      author: 'Dana Okafor',
      date: '2026-10-01T09:15:00Z',
      files: {
        'README.md':
          '# tinyqueue\n\nA zero-dependency job queue.\n\nFailed jobs retry up to 3 times with exponential backoff.\n',
      },
    },
  ],
  gitfs: [
    {
      message: 'Move ref lookup into Refs',
      author: 'Dana Okafor',
      date: '2026-08-11T08:00:00Z',
      files: {
        'README.md': '# gitfs\n\nGit over object storage.\n',
        'src/refs.rs':
          'pub struct Refs {\n    disk: Disk,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        self.disk.read_ref(name)\n    }\n}\n',
      },
    },
    {
      message: 'Cache negative ref lookups',
      author: 'Dana Okafor',
      date: '2026-10-20T16:45:00Z',
      files: {
        'src/refs.rs':
          'pub struct Refs {\n    disk: Disk,\n    neg: NegCache,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        if self.neg.hit(name) {\n            return None;\n        }\n        self.disk.read_ref(name).or_else(|| self.neg.put(name))\n    }\n}\n',
      },
    },
  ],
}

// ---------------------------------------------------------------------------
// Generated history. The sample repositories need more than two commits to
// look like projects: a tree with docs, policy and source, and a history by
// several people, an agent and a bot. It is derived from the repository's
// name, so it is the same on every run.

type Sample = {
  owner: string
  description: string
  license: string
  ext: 'rs' | 'ts' | 'go' | 'py'
}

const samples: Partial<Record<string, Sample>> = {
  gitfs: {
    owner: 'dana',
    description:
      'Git over object storage. Mount any bucket as a repository and clone it from anywhere.',
    license: 'MIT',
    ext: 'rs',
  },
  tinyqueue: {
    owner: 'dana',
    description:
      'Zero-dependency job queue with retries and exponential backoff.',
    license: 'MIT',
    ext: 'ts',
  },
  relay: {
    owner: 'northwind',
    description:
      'A small message relay with at-least-once delivery and a replayable log.',
    license: 'Apache-2.0',
    ext: 'go',
  },
  lumen: {
    owner: 'hollis',
    description:
      'A fast, local-first markdown notebook. Plain files on disk, instant search, no account.',
    license: 'AGPL-3.0',
    ext: 'rs',
  },
  tern: {
    owner: 'ines',
    description:
      'Typed schema migrations for Postgres. Plan, diff and roll back from one binary.',
    license: 'Apache-2.0',
    ext: 'go',
  },
  inkwell: {
    owner: 'ines',
    description:
      'Python library for typesetting beautiful PDFs from plain data.',
    license: 'BSD-3-Clause',
    ext: 'py',
  },
}

const code: Record<Sample['ext'], string> = {
  rs: `pub struct Refs {
    disk: Disk,
    neg: NegCache,
}

impl Refs {
    pub fn lookup(&self, name: &str) -> Option<Oid> {
        if self.neg.contains(name) {
            return None;
        }
        self.disk
            .read_ref(name)
            .or_else(|| self.neg.put(name))
    }
}
`,
  ts: `export class Queue {
  private jobs: Array<Job> = []

  push(job: Job) {
    this.jobs.push(job)
    void this.drain()
  }

  private async drain() {
    while (this.jobs.length) await retry(this.jobs.shift()!, { attempts: 3 })
  }
}
`,
  go: `type Refs struct {
	disk Disk
	neg  *NegCache
}

func (r *Refs) Lookup(name string) (Oid, bool) {
	if r.neg.Contains(name) {
		return Oid{}, false
	}
	oid, ok := r.disk.ReadRef(name)
	if !ok {
		r.neg.Put(name)
	}
	return oid, ok
}
`,
  py: `class Refs:
    def __init__(self, disk, neg):
        self.disk = disk
        self.neg = neg

    def lookup(self, name):
        if name in self.neg:
            return None
        oid = self.disk.read_ref(name)
        if oid is None:
            self.neg.add(name)
        return oid
`,
}

function baseFiles(name: string, s: Sample): Record<string, string> {
  const src = code[s.ext]
  const lines = src.split('\n')
  const repo = { ...s, name }
  return {
    'README.md': readmeFor(repo),
    'SECURITY.md': `# Security policy\n\nReport vulnerabilities privately to security@${s.owner}.dev. Do not open a public issue.\n`,
    'CONTRIBUTING.md': contributingFor(repo),
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n',
    LICENSE: `${licenseFor(repo)}\n`,
    '.env.schema':
      '# @defaultSensitive=true\n# ---\n# @required @type=url\nDATABASE_URL=\n\n# @public @type=port\nAPI_PORT=8080\n',
    '.source/policy/main.yml':
      'rules:\n  - id: core-paths\n    when: { paths: ["src/**"] }\n    require:\n      - approval: { min: 1, class: human }\n',
    '.source/secrets/production.env':
      'DATABASE_URL=enc:age:AGE-1q8xk…:Zmx1c2gtc2VjcmV0\nAPI_PORT=8080\n',
    '.github/workflows/ci.yml':
      'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: make test\n',
    'docs/retries.md':
      '# Retries\n\nFailed jobs retry up to three times with backoff.\n',
    'scripts/sign.sh':
      '#!/bin/sh\nset -eu\nfor f in dist/*; do cosign sign-blob "$f"; done\n',
    [`src/main.${s.ext}`]: lines.slice(0, 6).join('\n') + '\n',
    [`src/refs.${s.ext}`]: src,
    [`src/neg_cache.${s.ext}`]: lines.slice(0, 4).join('\n') + '\n',
    [`tests/refs_test.${s.ext}`]: lines.slice(4, 10).join('\n') + '\n',
  }
}

/** Who writes the sample history. The email is how the forge knows the account. */
const people: Array<[name: string, login: string]> = [
  ['Dana Okafor', 'dana'],
  ['Hollis Reyes', 'hollis'],
  ['Inês Barbosa', 'ines'],
  ['Kofi Mensah', 'kofi'],
  ['Yuki Tanaka', 'yuki'],
  ['claude via T3 Code', 'claude-t3'],
  ['dep-bot', 'dep-bot'],
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
  'Add --json to the status command',
  'Reduce allocations in pack parsing',
  'Tidy error messages for bad credentials',
  'Fix a data race in the cache shutdown path',
  'Update the install script for ARM64',
]

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const GENERATED = 58
/** The newest generated commit, when a repository has no written ones. */
const SAMPLE_NOW = Date.UTC(2026, 10, 4, 12, 0)

/** The generated commits of a sample repository, oldest first. */
function generated(id: string, s: Sample, end: number): Array<FixtureCommit> {
  const seed = Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 7)
  const rand = seeded(seed)
  // Newest first, as a history reads; reversed at the end.
  const out: Array<FixtureCommit> = []
  let hours = 2
  for (let i = 0; i < GENERATED; i++) {
    hours += 3 + rand() * 30
    const [author] = people[Math.floor(rand() ** 1.6 * people.length)]
    const message = messages[(i * 5 + seed) % messages.length]
    const files: Record<string, string | null> = {}
    out.push({
      message,
      author,
      date: new Date(end - hours * 3_600_000).toISOString(),
      files,
    })
  }
  out.reverse()
  // Every commit changes something, so every commit has a diff.
  let changelog = baseFiles(id, s)['CHANGELOG.md']
  let notes = '# Notes\n'
  out.forEach((c, i) => {
    if (i === 0) {
      c.message = 'Project skeleton'
      Object.assign(c.files, baseFiles(id, s))
      return
    }
    changelog += `- ${c.message}\n`
    c.files['CHANGELOG.md'] = changelog
    if (i % 3 === 0) {
      notes += `\n## ${c.message}\n\nSee the changelog.\n`
      c.files['docs/notes.md'] = notes
    }
  })
  return out
}

const authorEmail = (name: string) =>
  `${people.find(([n]) => n === name)?.[1] ?? name.split(' ')[0].toLowerCase()}@users.source.code`

/** Every commit of a repository, oldest first: the generated ones, then the written ones. */
function history(id: string): Array<FixtureCommit> | undefined {
  const written = fixtures[id]
  const sample = samples[id]
  if (!sample) return written
  const first = written?.[0]
  const end = first ? Date.parse(first.date) - 3_600_000 : SAMPLE_NOW
  return [...generated(id, sample, end), ...(written ?? [])]
}

function notFound(what: string) {
  return new ApiError({
    message: `${what} not found`,
    status: 404,
    statusText: 'Not Found',
    method: 'GET',
    url: 'fake://',
  })
}

// Partial: a lookup for a missing path is undefined at runtime, and the types should say so.
type Tree = Partial<Record<string, string>>
type Built = { info: CommitInfo; tree: Tree; parentTree: Tree }

const built = new Map<string, Array<Built>>()

function build(id: string): Array<Built> {
  const have = built.get(id)
  if (have) return have
  const commits = history(id)
  if (!commits) throw notFound(`repo ${id}`)
  const out: Array<Built> = []
  let tree: Tree = {}
  for (const c of commits) {
    const parentTree = tree
    tree = { ...tree }
    for (const [path, content] of Object.entries(c.files)) {
      if (content === null) delete tree[path]
      else tree[path] = content
    }
    const parent = out.at(-1)?.info.sha
    const sha = createHash('sha1')
      .update(`${id}${parent}${c.message}${c.date}`)
      .digest('hex')
    const email = authorEmail(c.author)
    out.push({
      tree,
      parentTree,
      info: {
        sha,
        parentShas: parent ? [parent] : [],
        message: c.message,
        authorName: c.author,
        authorEmail: email,
        committerName: c.author,
        committerEmail: email,
        date: new Date(c.date),
        rawDate: c.date,
      },
    })
  }
  built.set(id, out)
  return out
}

function resolve(id: string, ref?: string): Built {
  const commits = build(id)
  const found =
    !ref || ref === 'main'
      ? commits.at(-1)
      : commits.find((c) => c.info.sha.startsWith(ref))
  if (!found) throw notFound(`ref ${ref}`)
  return found
}

function fileDiff(
  path: string,
  before: string | undefined,
  after: string | undefined,
): FileDiff {
  const p = structuredPatch(
    `a/${path}`,
    `b/${path}`,
    before ?? '',
    after ?? '',
    '',
    '',
    { context: 3 },
  )
  let additions = 0
  let deletions = 0
  const hunks = p.hunks.map((h) => {
    for (const l of h.lines) {
      if (l[0] === '+') additions++
      else if (l[0] === '-') deletions++
    }
    return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}\n`
  })
  const state =
    before === undefined
      ? 'added'
      : after === undefined
        ? 'deleted'
        : 'modified'
  const raw = [
    `diff --git a/${path} b/${path}\n`,
    state === 'added'
      ? 'new file mode 100644\n'
      : state === 'deleted'
        ? 'deleted file mode 100644\n'
        : '',
    `--- ${state === 'added' ? '/dev/null' : `a/${path}`}\n`,
    `+++ ${state === 'deleted' ? '/dev/null' : `b/${path}`}\n`,
    ...hunks,
  ].join('')
  return {
    path,
    state,
    rawState: state[0].toUpperCase(),
    bytes: raw.length,
    isEof: true,
    raw,
    additions,
    deletions,
  }
}

// Implements the subset of @pierre/storage's Repo the app uses, from in-memory fixtures.
export function fakeRepo(id: string): GitRepo {
  return {
    async listFiles(opts) {
      const { tree, info } = resolve(id, opts?.ref)
      const paths = Object.keys(tree).sort()
      return {
        paths,
        ref: info.sha,
        entries: paths.map((path) => ({ path, type: 'blob', mode: '100644' })),
        hasMore: false,
      }
    },
    async getFileStream(opts) {
      const content = resolve(id, opts.ref).tree[opts.path]
      return content === undefined
        ? new Response('not found', { status: 404 })
        : new Response(content)
    },
    async listCommits(opts) {
      const commits = build(id)
        .map((c) => c.info)
        .reverse()
      return {
        commits: commits.slice(0, opts?.limit ?? commits.length),
        hasMore: false,
      }
    },
    async getCommit(opts) {
      return { commit: resolve(id, opts.sha).info }
    },
    async getCommitDiff(opts) {
      const { info, tree, parentTree } = resolve(id, opts.sha)
      const paths = [
        ...new Set([...Object.keys(parentTree), ...Object.keys(tree)]),
      ].sort()
      const files = paths
        .filter((p) => parentTree[p] !== tree[p])
        .map((p) => fileDiff(p, parentTree[p], tree[p]))
      const additions = files.reduce((n, f) => n + f.additions, 0)
      const deletions = files.reduce((n, f) => n + f.deletions, 0)
      return {
        sha: info.sha,
        baseSha: info.parentShas[0],
        stats: {
          files: files.length,
          additions,
          deletions,
          changes: additions + deletions,
        },
        files,
        filteredFiles: [],
      }
    },
  }
}
