/* eslint-disable @typescript-eslint/require-await --
   Domain.run takes an async function so the same handlers can read from Convex later;
   the in-memory domain answers synchronously. */
import { Effect } from 'effect'
import { z } from 'zod'
import { ALLOWED } from '../uploads'
import { apiError } from '../problem'
import { Domain, Raw, defineOp, reply } from '../registry'
import { iso } from '../domain'
import * as S from '../schemas'
import { changeParams } from './common'
import type { MemoryDomain } from '../domain'
import type { UploadRec } from '../uploads'

const MAX_PENDING = 50

function present(
  d: MemoryDomain,
  u: UploadRec,
  withUrl: boolean,
): z.infer<typeof S.Upload> {
  const base = `${d.urls.api}/uploads/${u.id}`
  return {
    object: 'upload',
    id: u.id,
    filename: u.filename,
    content_type: u.contentType,
    size: u.size,
    purpose: u.purpose,
    state: u.state,
    sha256: u.sha256,
    upload_url:
      withUrl && u.state === 'pending'
        ? `${base}/data?${d.svc.uploads.sign(u)}`
        : null,
    content_url: u.state === 'uploaded' ? `${base}/content` : null,
    expires_at: iso(u.expires),
    url: base,
    created_at: iso(u.created),
  }
}

const ownerOnly = (u: UploadRec | null, handle: string): UploadRec => {
  if (!u || u.owner !== handle) throw apiError('not_found', 'No such upload.')
  return u
}

const kindFits: Record<string, (type: string) => boolean> = {
  image: (t) => t.startsWith('image/'),
  recording: (t) => t.startsWith('video/'),
  preview: (t) => t === 'text/html',
  test_results: (t) => t === 'application/json' || t === 'text/plain',
}

export const createUpload = defineOp({
  id: 'uploads.create',
  secretResponse: true,
  summary: 'Announce a file you are about to upload',
  description:
    'Say what the file is. The response has an `upload_url`: PUT the bytes there with the same Content-Type, no token needed. The address works once, for exactly this type and size, for an hour. The first bytes of images and video are checked against the type.',
  tags: ['uploads'],
  method: 'POST',
  path: '/uploads',
  auth: 'required',
  scopes: ['repo:write'],
  pool: 'write',
  safety: 'write',
  idempotent: false,
  dryRun: true,
  body: z.strictObject({
    filename: z.string().min(1).max(200),
    content_type: z.enum(Object.keys(ALLOWED) as [string, ...Array<string>]),
    size: z
      .number()
      .int()
      .min(1)
      .max(50 << 20),
    purpose: z.enum(['evidence']).default('evidence'),
  }),
  response: S.Upload,
  status: 201,
  errors: ['limit_reached', 'payload_too_large'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const b = ctx.body
        if (b.size > ALLOWED[b.content_type].max)
          throw apiError(
            'payload_too_large',
            `${b.content_type} files are limited to ${ALLOWED[b.content_type].max} bytes.`,
            {
              hint: 'Choose a smaller file, or use a supported type with a larger limit.',
            },
          )
        const owner = ctx.principal!.handle
        const store = d.svc.uploads.blobs
        if (
          store.capacity !== undefined &&
          store.bytes + b.size > store.capacity
        )
          throw apiError(
            'limit_reached',
            'Upload storage is full. Try again after old uploads expire.',
            {
              hint: 'Wait for pending uploads to expire, or upload a smaller file.',
            },
          )
        const pending = d.svc.uploads.countPending(owner)
        if (pending >= MAX_PENDING)
          throw apiError(
            'limit_reached',
            `You can have ${MAX_PENDING} uploads waiting for their file.`,
            {
              hint: 'Finish an upload you started, or wait for the oldest to expire.',
            },
          )
        const rec = ctx.dryRun
          ? {
              id: 'upl_dryrun',
              owner,
              filename: b.filename,
              contentType: b.content_type,
              size: b.size,
              purpose: b.purpose,
              state: 'pending' as const,
              sha256: null,
              expires: ctx.now() + 3_600_000,
              created: ctx.now(),
              attachedTo: null,
              attachedRepoId: null,
            }
          : d.svc.uploads.create(owner, {
              filename: b.filename,
              contentType: b.content_type,
              size: b.size,
              purpose: b.purpose,
            })
        if (!rec)
          throw apiError(
            'limit_reached',
            'Too many uploads are stored. Try again after the oldest expire.',
            {
              hint: 'Wait for the oldest uploads to expire, then start a new one.',
            },
          )
        return present(d, rec, !ctx.dryRun)
      })
      return reply(out, { status: 201, headers: { location: out.url } })
    }),
})

export const putUpload = defineOp({
  id: 'uploads.put',
  summary: 'Send the file',
  description:
    'The address comes from `uploads.create`. It carries its own signature in `exp` and `sig`, so this needs no token. Send the bytes as the body with the declared Content-Type and exactly the declared size.',
  tags: ['uploads'],
  method: 'PUT',
  path: '/uploads/{id}/data',
  params: z.object({ id: z.string().describe('The upload `upl_` id') }),
  query: z.strictObject({
    exp: z.coerce.number().int().describe('From the upload address'),
    sig: z.string().min(10).max(100).describe('From the upload address'),
  }),
  rawBody: { maxBytes: 50 << 20 },
  auth: 'none',
  pool: 'write',
  cost: 2,
  safety: 'write',
  idempotent: false,
  response: S.Upload,
  errors: [
    'signature_invalid',
    'payload_too_large',
    'limit_reached',
    'unsupported_media_type',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const rec = d.svc.uploads.get(ctx.params.id)
        // An unknown id and a bad signature look the same.
        if (!rec || !d.svc.uploads.verify(rec, ctx.query.exp, ctx.query.sig))
          throw apiError(
            'signature_invalid',
            'The upload address is not valid or has expired.',
          )
        const problem = d.svc.uploads.put(
          rec,
          ctx.bytes ?? new Uint8Array(),
          ctx.header('content-type') ?? '',
        )
        if (problem === 'full')
          throw apiError('limit_reached', 'Storage is full. Try again later.', {
            hint: 'Wait for pending uploads to expire, then start a new upload.',
          })
        if (problem) {
          const hint = problem.startsWith('Send Content-Type')
            ? problem
            : problem.startsWith('This upload already')
              ? 'Start a new upload for another file.'
              : problem.startsWith('Expected')
                ? 'Send exactly the declared number of bytes, or start a new upload with the right size.'
                : problem.startsWith('The file is not a valid')
                  ? 'Send a valid file of the declared type, or start a new upload.'
                  : 'Send the bytes that match the upload you started.'
          throw apiError(
            problem.startsWith('Send Content-Type')
              ? 'unsupported_media_type'
              : 'invalid_request',
            problem,
            {
              hint,
              errors: [
                { pointer: '/body', code: 'upload_mismatch', message: problem },
              ],
            },
          )
        }
        return present(d, rec, false)
      })
    }),
})

export const getUpload = defineOp({
  id: 'uploads.get',
  summary: 'One of your uploads',
  tags: ['uploads'],
  method: 'GET',
  path: '/uploads/{id}',
  params: z.object({ id: z.string().describe('The upload `upl_` id') }),
  auth: 'required',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.Upload,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const rec = d.svc.uploads.get(ctx.params.id)
        // A repository-limited token cannot use ownership to step around the
        // repository limit of an attached upload.
        const mine =
          rec &&
          rec.owner === ctx.principal!.handle &&
          (!rec.attachedRepoId ||
            d.mayReadId(rec.attachedRepoId, ctx.principal))
        if (!mine) throw apiError('not_found', 'No such upload.')
        return reply(present(d, rec, true), {
          headers: { 'cache-control': 'no-store' },
        })
      })
    }),
})

export const uploadContent = defineOp({
  id: 'uploads.content',
  summary: 'Read the file',
  description:
    'You can read your own uploads with a token that has `repo:read`; without it the read answers `403 insufficient_scope`. Once a file is attached to a change, anyone who can read that repository can read it. Served with `nosniff` and a sandboxing policy; only images and video display inline. The ETag is the SHA-256, and the content never changes.',
  tags: ['uploads'],
  method: 'GET',
  path: '/uploads/{id}/content',
  params: z.object({ id: z.string().describe('The upload `upl_` id') }),
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: z.string(),
  responseContentType: '*/*',
  errors: ['not_found', 'upload_incomplete'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run(async (d) => {
        const rec = d.svc.uploads.get(ctx.params.id)
        const mine =
          rec &&
          ctx.principal?.handle === rec.owner &&
          (!rec.attachedRepoId ||
            d.mayReadId(rec.attachedRepoId, ctx.principal))
        if (
          !rec ||
          !(
            mine ||
            (rec.attachedRepoId &&
              d.mayReadId(rec.attachedRepoId, ctx.principal))
          )
        )
          throw apiError('not_found', 'No such upload.')
        if (rec.state !== 'uploaded')
          throw apiError(
            'upload_incomplete',
            'The file has not been uploaded yet.',
          )
        const etag = `"${rec.sha256}"`
        const common = {
          etag,
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        }
        const sent = ctx.header('if-none-match')
        if (
          sent &&
          sent.split(',').some((t) => {
            const tag = t.trim().replace(/^W\//, '')
            return tag === etag || tag === '*'
          })
        )
          return new Raw(new Response(null, { status: 304, headers: common }))
        const inline = ALLOWED[rec.contentType].inline
        return new Raw(
          new Response(d.svc.uploads.blobs.get(rec.id) as BodyInit, {
            headers: {
              ...common,
              'content-type': rec.contentType,
              'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${rec.filename}"`,
            },
          }),
        )
      })
    }),
})

const evidenceBase = { tags: ['changes', 'uploads'], idempotent: false }

export const createEvidence = defineOp({
  ...evidenceBase,
  id: 'evidence.create',
  summary: 'Attach a file to a change as evidence',
  description:
    'Evidence shows what a change does: before and after images, a recording, an interactive preview, or test results. Each says who made it. The upload must be yours and finished, and its type must fit the kind. A file attaches once.',
  method: 'POST',
  path: '/repos/{owner}/{repo}/changes/{number}/evidence',
  params: changeParams,
  auth: 'required',
  scopes: ['pulls:write'],
  pool: 'write',
  safety: 'write',
  dryRun: true,
  body: z.strictObject({
    upload: z.string().describe('The `upl_` id'),
    kind: z.enum(['image', 'recording', 'preview', 'test_results']),
    caption: z.string().max(300).default(''),
  }),
  response: S.Evidence,
  status: 201,
  errors: [
    'not_found',
    'forbidden',
    'upload_incomplete',
    'invalid_state',
    'invalid_request',
    'moved',
  ],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const out = yield* run(async (d) => {
        const u = ownerOnly(
          d.svc.uploads.get(ctx.body.upload),
          ctx.principal!.handle,
        )
        if (u.state !== 'uploaded')
          throw apiError('upload_incomplete', 'Upload the file first.')
        if (u.attachedTo)
          throw apiError('invalid_state', 'This file is already attached.')
        if (!kindFits[ctx.body.kind](u.contentType))
          throw apiError(
            'invalid_request',
            `A ${u.contentType} file cannot be ${ctx.body.kind} evidence.`,
            {
              errors: [
                {
                  pointer: '/body/kind',
                  code: 'type_mismatch',
                  message: `Not a fit for ${u.contentType}.`,
                },
              ],
            },
          )
        return d.addEvidence(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          { upload: u, kind: ctx.body.kind, caption: ctx.body.caption },
          ctx.dryRun,
        )
      })
      return reply(out, { status: 201 })
    }),
})

export const listEvidence = defineOp({
  ...evidenceBase,
  idempotent: true,
  id: 'evidence.list',
  summary: 'Evidence attached to a change',
  method: 'GET',
  path: '/repos/{owner}/{repo}/changes/{number}/evidence',
  params: changeParams,
  auth: 'optional',
  scopes: ['pulls:read'],
  pool: 'read',
  safety: 'read',
  response: S.listOf(S.Evidence),
  errors: ['not_found', 'moved'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listEvidence(
          ctx.params.owner,
          ctx.params.repo,
          ctx.params.number,
          ctx.principal,
          (id) => d.svc.uploads.get(id),
        ),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false,
        next_cursor: null,
      }
    }),
})

export const uploadOps = [
  createUpload,
  putUpload,
  getUpload,
  uploadContent,
  createEvidence,
  listEvidence,
]
