import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, Raw, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { apiError } from '../problem'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'
import type { GitCommit } from '../git'

const base = {
  auth: 'optional' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
  tags: ['git'],
}

/** A full commit id never changes what it names, so its answer can be kept for good. */
const isFullSha = (ref: string | undefined) =>
  !!ref && /^[0-9a-f]{40}$/.test(ref)
// Always `private`: whether the repository is public is not this function's to know, and a
// shared cache must never hand a private repository's file to someone else.
const immutable = () => 'private, max-age=31536000, immutable'

const BLOB_MAX = 1 << 20
const TREE_MAX = 2000
const PATCH_MAX = 64 * 1024

const refQuery = z
  .string()
  .max(200)
  .optional()
  .describe('A branch, or a commit id. Default: the default branch')

const present = (
  d: { urls: { api: string } },
  full: string,
  c: GitCommit,
): z.infer<typeof S.GitCommit> => ({
  object: 'commit',
  sha: c.sha,
  url: `${d.urls.api}/repos/${full}/git/commits/${c.sha}`,
  parents: c.parents,
  message: c.message,
  author: c.author,
  committer: c.committer,
  date: c.date,
})

export const gitTree = defineOp({
  ...base,
  id: 'git.tree',
  summary: 'List a directory',
  description: `The files and directories directly under \`path\`, directories first. Up to ${TREE_MAX} entries.`,
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/tree',
  params: repoParams,
  query: z.strictObject({
    ref: refQuery,
    path: z
      .string()
      .max(1000)
      .default('')
      .describe(
        'A directory, without a leading or trailing slash. Default: the root',
      ),
  }),
  response: S.GitTree,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        const { ref, paths } = await d.svc.git.files(full, ctx.query.ref)
        const dir = ctx.query.path.replace(/^\/+|\/+$/g, '')
        const prefix = dir ? `${dir}/` : ''
        const seen = new Map<string, 'tree' | 'blob'>()
        for (const p of paths) {
          if (!p.startsWith(prefix)) continue
          const rest = p.slice(prefix.length)
          const slash = rest.indexOf('/')
          if (slash === -1) seen.set(rest, 'blob')
          else seen.set(rest.slice(0, slash), 'tree')
        }
        if (dir && seen.size === 0)
          throw apiError(
            'not_found',
            `No directory ${dir} at ${ref.slice(0, 7)}.`,
          )
        const entries = [...seen]
          .sort((a, b) =>
            a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] === 'tree' ? -1 : 1,
          )
          .map(([name, type]) => ({ name, path: `${prefix}${name}`, type }))
        return {
          object: 'tree' as const,
          ref,
          path: dir,
          entries: entries.slice(0, TREE_MAX),
          has_more: entries.length > TREE_MAX,
          fixed: isFullSha(ctx.query.ref),
        }
      })
      const { fixed, ...body } = out
      return reply(
        body,
        fixed ? { headers: { 'cache-control': immutable() } } : {},
      )
    }),
})

export const gitBlob = defineOp({
  ...base,
  id: 'git.blob',
  summary: 'Read a file',
  description: `The contents as text, or base64 when the file is not valid UTF-8. Files over 1 MiB answer \`413\`; use \`git.raw\` for those.`,
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/blob',
  params: repoParams,
  query: z.strictObject({ ref: refQuery, path: z.string().min(1).max(1000) }),
  response: S.GitBlob,
  errors: ['not_found', 'payload_too_large', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        const bytes = await d.svc.git.blob(full, ctx.query.path, ctx.query.ref)
        if (!bytes) throw apiError('not_found', `No file ${ctx.query.path}.`)
        if (bytes.byteLength > BLOB_MAX)
          throw apiError(
            'payload_too_large',
            `${ctx.query.path} is ${bytes.byteLength} bytes; this endpoint returns up to ${BLOB_MAX}.`,
            {
              hint: 'Read it with git.raw instead.',
            },
          )
        let text: string | null = null
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          text = null
        }
        return {
          object: 'blob' as const,
          path: ctx.query.path,
          ref: ctx.query.ref ?? 'default',
          size: bytes.byteLength,
          encoding: text === null ? ('base64' as const) : ('utf-8' as const),
          content: text ?? Buffer.from(bytes).toString('base64'),
        }
      })
      return reply(
        out,
        isFullSha(ctx.query.ref)
          ? { headers: { 'cache-control': immutable() } }
          : {},
      )
    }),
})

export const gitRaw = defineOp({
  ...base,
  id: 'git.raw',
  summary: 'Download a file as it is',
  description:
    'The bytes, with no JSON around them. Served as an attachment with `nosniff` and a sandboxing Content-Security-Policy, so a file in a repository cannot run in the page that opens it.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/raw',
  params: repoParams,
  query: z.strictObject({ ref: refQuery, path: z.string().min(1).max(1000) }),
  response: z.string(),
  responseContentType: 'application/octet-stream',
  conditional: false,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const found = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        const bytes = await d.svc.git.blob(full, ctx.query.path, ctx.query.ref)
        if (!bytes) throw apiError('not_found', `No file ${ctx.query.path}.`)
        return bytes
      })
      const name = ctx.query.path
        .split('/')
        .pop()!
        .replace(/[^\w.\- ]+/g, '_')
      return new Raw(
        new Response(found as BodyInit, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${name}"`,
            'x-content-type-options': 'nosniff',
            'content-security-policy': "sandbox; default-src 'none'",
            'cache-control': isFullSha(ctx.query.ref)
              ? immutable()
              : 'private, no-cache',
          },
        }),
      )
    }),
})

export const gitCommits = defineOp({
  ...base,
  id: 'git.commits',
  summary: 'The history of the default branch, newest first',
  description: 'Follows a cursor through the newest 1,000 commits.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/commits',
  params: repoParams,
  query: z.strictObject({ ...pageShape }),
  response: S.listOf(S.GitCommit),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp('git.commits', ctx.params.owner, ctx.params.repo)
      const after = afterOf(ctx.query.cursor, f)
      const page = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        const all = await d.svc.git.commits(full, 1000)
        let start = 0
        if (after) {
          // The cursor is the last commit sent. New commits at the head do not move it.
          const at = all.findIndex((c) => c.sha === after.id)
          start = at === -1 ? all.length : at + 1
        }
        const items = all
          .slice(start, start + ctx.query.limit)
          .map((c) => present(d, full, c))
        const last = items.at(-1)
        return {
          items,
          next:
            start + ctx.query.limit < all.length && last
              ? { key: start + ctx.query.limit, id: last.sha }
              : null,
        }
      })
      return listOf(page.items, page.next, f)
    }),
})

export const gitCommit = defineOp({
  ...base,
  id: 'git.commit',
  summary: 'One commit',
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/commits/{sha}',
  params: repoParams.extend({
    sha: z
      .string()
      .regex(/^[0-9a-f]{4,40}$/)
      .describe('A commit id, or its first characters'),
  }),
  response: S.GitCommit,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const c = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        return present(d, full, await d.svc.git.commit(full, ctx.params.sha))
      })
      return reply(c, {
        headers: {
          'cache-control': isFullSha(ctx.params.sha)
            ? immutable()
            : 'private, no-cache',
        },
      })
    }),
})

export const gitDiff = defineOp({
  ...base,
  id: 'git.diff',
  summary: 'What a commit changed',
  description: `Per file: state, counts and the unified diff, each cut at ${PATCH_MAX / 1024} KB (\`truncated\` says so; read the file with \`git.raw\` for the rest).`,
  method: 'GET',
  path: '/repos/{owner}/{repo}/git/commits/{sha}/diff',
  params: repoParams.extend({
    sha: z
      .string()
      .regex(/^[0-9a-f]{4,40}$/)
      .describe('A commit id, or its first characters'),
  }),
  pool: 'heavy',
  cost: 2,
  response: S.GitCommitDiff,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const full = await d.repoAccess(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          'read',
        )
        const diff = await d.svc.git.diff(full, ctx.params.sha)
        const files = diff.files.map((f) => ({
          path: f.path,
          state: f.state,
          additions: f.additions,
          deletions: f.deletions,
          patch:
            f.patch.length > PATCH_MAX ? f.patch.slice(0, PATCH_MAX) : f.patch,
          truncated: f.patch.length > PATCH_MAX,
        }))
        return {
          object: 'commit_diff' as const,
          sha: diff.sha,
          base_sha: diff.base,
          stats: {
            files: files.length,
            additions: files.reduce((n, f) => n + f.additions, 0),
            deletions: files.reduce((n, f) => n + f.deletions, 0),
          },
          files,
        }
      })
      return reply(out, {
        headers: {
          'cache-control': isFullSha(ctx.params.sha)
            ? immutable()
            : 'private, no-cache',
        },
      })
    }),
})

export const gitOps = [gitTree, gitBlob, gitRaw, gitCommits, gitCommit, gitDiff]
