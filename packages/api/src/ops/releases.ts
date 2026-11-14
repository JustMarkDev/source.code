import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape, repoParams } from './common'

const channel = z.enum(['stable', 'beta', 'nightly'])
const tagParams = repoParams.extend({
  tag: z.string().min(1).max(100).describe('The release tag, such as v2.4.1'),
})
const notes = z.strictObject({
  added: z.array(z.string().max(500)).max(100).optional(),
  changed: z.array(z.string().max(500)).max(100).optional(),
  fixed: z.array(z.string().max(500)).max(100).optional(),
})
const readOp = {
  tags: ['releases'],
  auth: 'optional' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
}
const writeOp = {
  tags: ['releases'],
  auth: 'required' as const,
  scopes: ['repo:write' as const],
  pool: 'write' as const,
  safety: 'write' as const,
}

export const listReleases = defineOp({
  ...readOp,
  id: 'releases.list',
  summary: 'Releases of a repository',
  description:
    'Newest first, withdrawn ones included so their pages can say why.',
  method: 'GET',
  path: '/repos/{owner}/{repo}/releases',
  params: repoParams,
  query: z.strictObject({ ...pageShape, channel: channel.optional() }),
  response: S.listOf(S.Release),
  errors: ['not_found', 'moved', 'cursor_mismatch'],
  probe: (ctx, d) =>
    d.releasesVersion(ctx.params.owner, ctx.params.repo, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp(
        'releases.list',
        ctx.params.owner,
        ctx.params.repo,
        ctx.query.channel,
      )
      const page = yield* run((d) =>
        d.listReleases(ctx.params.owner, ctx.params.repo, ctx.principal, {
          channel: ctx.query.channel,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const getRelease = defineOp({
  ...readOp,
  id: 'releases.get',
  summary: 'One release',
  method: 'GET',
  path: '/repos/{owner}/{repo}/releases/{tag}',
  params: tagParams,
  response: S.Release,
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.getRelease(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.tag,
          ctx.principal,
        ),
      )
    }),
})

export const createRelease = defineOp({
  ...writeOp,
  id: 'releases.create',
  summary: 'Publish a release',
  description:
    'Naturally idempotent by tag: publishing one that exists returns it with `Sx-Outcome: unchanged`. A stable release tells the people who starred the repository.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/releases',
  idempotent: true,
  dryRun: true,
  params: repoParams,
  body: z.strictObject({
    tag: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/),
    channel: channel.default('stable'),
    title: z.string().min(1).max(200),
    notes: notes.optional(),
    signed: z.boolean().optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    assets: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(200),
          platform: z.enum(['macos', 'windows', 'linux']),
          arch: z.string().max(20),
          size: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Bytes; taken from `upload` when that is given'),
          sha256: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .optional()
            .describe('Taken from `upload` when that is given'),
          upload: z
            .string()
            .optional()
            .describe(
              'An `upl_` id of yours with purpose `release`, uploaded and not attached yet; the file is then served here',
            ),
        }),
      )
      .max(50)
      .optional(),
  }),
  response: S.Release,
  status: 201,
  errors: [
    'not_found',
    'forbidden',
    'moved',
    'invalid_request',
    'upload_incomplete',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createRelease(
          ctx.params.owner,
          ctx.params.repo,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
      return reply(r.release, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: { 'sx-outcome': r.outcome },
      })
    }),
})

export const updateRelease = defineOp({
  ...writeOp,
  id: 'releases.update',
  summary: 'Edit or withdraw a release',
  description:
    'A reason in `withdrawn` pulls it: it stays listed with the reason, and its files stop downloading. `null` puts it back.',
  method: 'PATCH',
  path: '/repos/{owner}/{repo}/releases/{tag}',
  idempotent: true,
  dryRun: true,
  params: tagParams,
  body: z.strictObject({
    title: z.string().min(1).max(200).optional(),
    notes: notes.optional(),
    withdrawn: z.string().min(1).max(500).nullable().optional(),
  }),
  response: S.Release,
  errors: ['not_found', 'forbidden', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateRelease(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.tag,
          ctx.principal,
          ctx.body,
          ctx.dryRun,
        ),
      )
    }),
})

export const downloadAsset = defineOp({
  tags: ['releases'],
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  id: 'releases.download',
  summary: 'Download a file of a release',
  description:
    'Counts the download and answers with where the file is and its checksum. A withdrawn release refuses.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/releases/{tag}/assets/{asset}/download',
  params: tagParams.extend({ asset: z.string().min(1).max(200) }),
  response: S.Download,
  errors: ['not_found', 'moved', 'invalid_state'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.downloadAsset(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.tag,
          ctx.params.asset,
          ctx.principal,
        ),
      )
    }),
})

export const releaseOps = [
  listReleases,
  getRelease,
  createRelease,
  updateRelease,
  downloadAsset,
]
