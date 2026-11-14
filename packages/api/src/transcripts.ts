import { apiError } from './problem'
import { sha256Hex } from './uploads'
import type { UploadPort, UploadRec } from './uploads'

/**
 * Agent transcripts, checked for secrets before anyone else can read them.
 *
 * A transcript is what an agent saw and said. Agents read `.env` files, print
 * tokens while debugging and paste keys into commands, so every transcript is
 * scanned before it is attached:
 *
 *  - known token formats: ours (`packages/api/src/auth.ts`), and the common
 *    hosted services';
 *  - long, random-looking values next to a word like `key`, `secret`,
 *    `token` or `password`.
 *
 * In `mask` mode, the default, each one is replaced with `[redacted:<kind>]`
 * and the copy is attached. In `block` mode the transcript is refused and the
 * answer names the kinds found. Either way the upload as sent is deleted, so
 * the original bytes are never kept.
 */

export type SecretKind =
  | 'source_code_token'
  | 'github_token'
  | 'gitlab_token'
  | 'slack_token'
  | 'aws_access_key'
  | 'stripe_key'
  | 'anthropic_key'
  | 'openai_key'
  | 'google_api_key'
  | 'npm_token'
  | 'private_key'
  | 'jwt'
  | 'assigned_secret'

/** Known formats. Order matters: the more specific pattern comes first. */
const KNOWN: ReadonlyArray<{ kind: SecretKind; re: RegExp }> = [
  {
    kind: 'private_key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // Ours: personal, bot, run, OAuth and refresh tokens (`secretFor`).
  { kind: 'source_code_token', re: /\bsx[pbrof]_[A-Za-z0-9_-]{16,}/g },
  {
    kind: 'github_token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g,
  },
  { kind: 'gitlab_token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack_token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws_access_key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'stripe_key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai_key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'google_api_key', re: /\bAIza[A-Za-z0-9_-]{35}/g },
  { kind: 'npm_token', re: /\bnpm_[A-Za-z0-9]{36}/g },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
]

/**
 * A value given to a name that sounds secret: `API_KEY=...`, `"token": "..."`,
 * `password: ...`. Only the value is replaced, and only when it looks random.
 */
const ASSIGNED =
  /\b([A-Za-z0-9_.-]*(?:key|secret|token|passw(?:or)?d|pwd|credential|auth)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([A-Za-z0-9+/=_.~-]{16,})/gi

/** Bits per character, by Shannon entropy. */
export function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** Random enough to be a key rather than a word, a path or a number. */
const looksRandom = (v: string) =>
  v.length >= 16 &&
  entropy(v) >= 3.5 &&
  /[0-9]/.test(v) &&
  /[A-Za-z]/.test(v) &&
  !/^[0-9a-f]{40}$/.test(v)

export type ScanResult = {
  text: string
  /** How many values were replaced. */
  redactions: number
  /** Each kind found, with its count, most first. */
  kinds: Array<{ kind: SecretKind; count: number }>
}

/** Finds secrets in a text and replaces each with `[redacted:<kind>]`. */
export function scanForSecrets(text: string): ScanResult {
  const counts = new Map<SecretKind, number>()
  const bump = (k: SecretKind) => counts.set(k, (counts.get(k) ?? 0) + 1)
  let out = text
  for (const { kind, re } of KNOWN)
    out = out.replace(re, () => {
      bump(kind)
      return `[redacted:${kind}]`
    })
  out = out.replace(
    ASSIGNED,
    (whole, name: string, sep: string, value: string) => {
      if (value.startsWith('[redacted') || !looksRandom(value)) return whole
      bump('assigned_secret')
      return `${name}${sep}[redacted:assigned_secret]`
    },
  )
  const kinds = [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1))
  return {
    text: out,
    redactions: kinds.reduce((n, k) => n + k.count, 0),
    kinds,
  }
}

export type TranscriptMode = 'mask' | 'block'

/** What a run keeps about its transcript. */
export type TranscriptRec = {
  uploadId: string
  size: number
  sha256: string
  redactions: number
}

/** Types a transcript may be. */
export const TRANSCRIPT_TYPES = new Set(['text/plain', 'application/json'])

/**
 * Checks an upload is a transcript its caller may attach. The upload must be
 * the caller's, finished, not attached anywhere, and text.
 */
export function transcriptUpload(
  u: UploadRec | null,
  handle: string,
): UploadRec {
  if (!u || u.owner !== handle) throw apiError('not_found', 'No such upload.')
  if (u.state !== 'uploaded')
    throw apiError('upload_incomplete', 'Upload the file first.')
  if (u.attachedTo)
    throw apiError('invalid_state', 'This file is already attached.')
  if (!TRANSCRIPT_TYPES.has(u.contentType))
    throw apiError(
      'invalid_request',
      `A transcript is text/plain or application/json, not ${u.contentType}.`,
      {
        errors: [
          {
            pointer: '/body/upload',
            code: 'type_mismatch',
            message: 'Upload the transcript as text/plain or application/json.',
          },
        ],
      },
    )
  return u
}

/**
 * Scans an upload and, unless this is a dry run, keeps the scanned copy as a
 * new upload attached to the repository and deletes the one that was sent.
 * In `block` mode a transcript with secrets is refused, and still deleted.
 */
export async function redactTranscript(
  uploads: UploadPort,
  u: UploadRec,
  mode: TranscriptMode,
  attach: { full: string; repoId: string },
  dry: boolean,
): Promise<TranscriptRec> {
  const bytes = await uploads.blobs.get(u.id)
  if (!bytes) throw apiError('upload_incomplete', 'Upload the file first.')
  const scan = scanForSecrets(new TextDecoder().decode(bytes))
  if (scan.redactions && mode === 'block') {
    if (!dry) await uploads.remove(u.id)
    throw apiError(
      'transcript_has_secrets',
      `The transcript has ${scan.redactions} secret${scan.redactions === 1 ? '' : 's'}: ${scan.kinds.map((k) => k.kind).join(', ')}.`,
      {
        hint: 'The upload was deleted. Remove the secrets and upload it again, or send mode=mask to attach it with them masked.',
        extra: { kinds: scan.kinds },
      },
    )
  }
  const clean = new TextEncoder().encode(scan.text)
  const kept = {
    uploadId: 'upl_dryrun',
    size: clean.byteLength,
    sha256: sha256Hex(clean),
    redactions: scan.redactions,
  }
  if (dry) return kept
  const copy = await uploads.create(u.owner, {
    filename: u.filename,
    contentType: u.contentType,
    size: clean.byteLength,
    purpose: 'transcript',
  })
  if (!copy)
    throw apiError(
      'limit_reached',
      'Too many uploads are stored. Try again after the oldest expire.',
    )
  const problem = await uploads.put(copy, clean, u.contentType)
  if (problem)
    throw apiError(
      problem === 'full' ? 'limit_reached' : 'invalid_request',
      problem === 'full' ? 'Upload storage is full.' : problem,
    )
  copy.attachedTo = attach.full
  copy.attachedRepoId = attach.repoId
  await uploads.remove(u.id)
  return { ...kept, uploadId: copy.id }
}
