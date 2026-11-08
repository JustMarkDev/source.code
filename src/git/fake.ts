import { createHash } from 'node:crypto'
import { structuredPatch } from 'diff'
import { ApiError } from '@pierre/storage'
import type { CommitInfo, FileDiff } from '@pierre/storage'
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
      message: 'Initial commit',
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
      message: 'Initial commit',
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

function build(id: string): Array<Built> {
  const commits = fixtures[id]
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
    const email = `${c.author.split(' ')[0].toLowerCase()}@example.com`
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
