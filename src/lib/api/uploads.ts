import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { newId, randomSource } from './ids'

const randomBytes = (n: number) => Buffer.from(randomSource.bytes(n))

/**
 * Uploads. A file is announced, sent to a signed address, and then attached to
 * something. The API never takes a large body through a JSON endpoint.
 *
 *  - The signed address works once for one file of one declared type and size,
 *    for an hour. It needs no token, so a browser or a runner can PUT to it.
 *  - What arrives is checked against what was declared: the size exactly, and
 *    for images and video the first bytes, so a script cannot be stored as a
 *    picture.
 *  - Files are served with `nosniff`, a sandboxing CSP, and as downloads unless
 *    they are images or video.
 */
export type Purpose = 'evidence'

export const ALLOWED: Record<string, { max: number; check: (b: Uint8Array) => boolean; inline: boolean }> = {
  'image/png': { max: 10 << 20, check: (b) => eq(b, [0x89, 0x50, 0x4e, 0x47]), inline: true },
  'image/jpeg': { max: 10 << 20, check: (b) => eq(b, [0xff, 0xd8, 0xff]), inline: true },
  'image/gif': { max: 10 << 20, check: (b) => eq(b, [0x47, 0x49, 0x46, 0x38]), inline: true },
  'image/webp': { max: 10 << 20, check: (b) => eq(b, [0x52, 0x49, 0x46, 0x46]) && eq(b.subarray(8), [0x57, 0x45, 0x42, 0x50]), inline: true },
  'video/mp4': { max: 50 << 20, check: (b) => eq(b.subarray(4), [0x66, 0x74, 0x79, 0x70]), inline: true },
  'video/webm': { max: 50 << 20, check: (b) => eq(b, [0x1a, 0x45, 0xdf, 0xa3]), inline: true },
  'application/json': { max: 5 << 20, check: (b) => parses(b), inline: false },
  'text/plain': { max: 5 << 20, check: (b) => utf8(b), inline: false },
  // A preview page. It is only ever served sandboxed, as a download.
  'text/html': { max: 5 << 20, check: (b) => utf8(b), inline: false },
}

function eq(b: Uint8Array, sig: Array<number>) {
  return b.length >= sig.length && sig.every((v, i) => b[i] === v)
}
function utf8(b: Uint8Array) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b)
    return true
  } catch {
    return false
  }
}
function parses(b: Uint8Array) {
  try {
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b))
    return true
  } catch {
    return false
  }
}

export interface BlobStore {
  put: (id: string, bytes: Uint8Array) => void
  get: (id: string) => Uint8Array | null
  delete?: (id: string) => void
  readonly bytes: number
  /** Total capacity, when the store has one. A store without it never fills. */
  readonly capacity?: number
}

export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>()
  private total = 0
  constructor(readonly capacity = 256 << 20) {}
  put(id: string, bytes: Uint8Array) {
    this.total += bytes.byteLength - (this.blobs.get(id)?.byteLength ?? 0)
    this.blobs.set(id, bytes)
  }
  get(id: string) {
    return this.blobs.get(id) ?? null
  }
  delete(id: string) {
    const old = this.blobs.get(id)
    if (old) this.total -= old.byteLength
    this.blobs.delete(id)
  }
  get bytes() {
    return this.total
  }
}

export type UploadRec = {
  id: string
  owner: string
  filename: string
  contentType: string
  size: number
  purpose: Purpose
  state: 'pending' | 'uploaded'
  sha256: string | null
  expires: number
  created: number
  /** `owner/name` of the repository it was attached in, which decides who may read it. */
  attachedTo: string | null
  /** The same repository's stable id, which survives a rename and a reused name. */
  attachedRepoId: string | null
}

const TTL = 3_600_000
const MAX_UPLOADS = 20_000

export class UploadService {
  private readonly uploads = new Map<string, UploadRec>()
  /**
   * Uploads still waiting for their file, oldest first. They all live for the same
   * time, so the oldest is always the first to expire: counting and clearing
   * them never reads more than the ones that just expired.
   */
  private waiting: Array<UploadRec> = []
  private waitingFrom = 0
  private readonly pendingBy = new Map<string, number>()
  private readonly counted = new WeakSet<UploadRec>()
  private readonly secret: Buffer

  constructor(
    readonly blobs: BlobStore,
    private readonly now: () => number = Date.now,
    secret?: Buffer,
  ) {
    this.secret = secret ?? randomBytes(32)
  }

  private mac(id: string, exp: number, type: string, size: number) {
    return createHmac('sha256', this.secret).update(`${id}.${exp}.${type}.${size}`).digest()
  }

  create(owner: string, input: { filename: string; contentType: string; size: number; purpose: Purpose }): UploadRec | null {
    if (this.uploads.size >= MAX_UPLOADS) {
      this.sweep()
      // Uploaded files that were never attached cannot be reached by anyone but
      // their owner. Dropping the oldest one bounds the metadata map.
      for (const [id, rec] of this.uploads) {
        if (this.uploads.size < MAX_UPLOADS) break
        if (rec.state === 'uploaded' && rec.attachedTo === null) {
          this.uploads.delete(id)
          this.blobs.delete?.(id)
        }
      }
      if (this.uploads.size >= MAX_UPLOADS) return null
    }
    const t = this.now()
    const rec: UploadRec = {
      id: newId('upload', t),
      owner,
      filename: input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200),
      contentType: input.contentType,
      size: input.size,
      purpose: input.purpose,
      state: 'pending',
      sha256: null,
      expires: t + TTL,
      created: t,
      attachedTo: null,
      attachedRepoId: null,
    }
    this.uploads.set(rec.id, rec)
    this.waiting.push(rec)
    this.counted.add(rec)
    this.pendingBy.set(owner, (this.pendingBy.get(owner) ?? 0) + 1)
    return rec
  }

  private settle(rec: UploadRec) {
    if (!this.counted.delete(rec)) return
    const n = (this.pendingBy.get(rec.owner) ?? 1) - 1
    if (n <= 0) this.pendingBy.delete(rec.owner)
    else this.pendingBy.set(rec.owner, n)
  }

  /** Forgets announced uploads whose time ran out without a file. */
  private sweep() {
    const t = this.now()
    while (this.waitingFrom < this.waiting.length && this.waiting[this.waitingFrom].expires <= t) {
      const rec = this.waiting[this.waitingFrom++]
      this.settle(rec)
      if (rec.state === 'pending') this.uploads.delete(rec.id)
    }
    if (this.waitingFrom > 1024 && this.waitingFrom * 2 > this.waiting.length) {
      this.waiting = this.waiting.slice(this.waitingFrom)
      this.waitingFrom = 0
    }
  }

  /** Run the expiry sweep on the API's schedule. */
  sweepNow() {
    this.sweep()
  }

  get(id: string) {
    return this.uploads.get(id) ?? null
  }

  countPending(owner: string) {
    this.sweep()
    return this.pendingBy.get(owner) ?? 0
  }

  /** The query string of the signed address. */
  sign(rec: UploadRec): string {
    return `exp=${rec.expires}&sig=${this.mac(rec.id, rec.expires, rec.contentType, rec.size).toString('base64url')}`
  }

  verify(rec: UploadRec, exp: number, sig: string): boolean {
    if (exp !== rec.expires || exp < this.now()) return false
    const want = this.mac(rec.id, exp, rec.contentType, rec.size)
    const got = Buffer.from(sig, 'base64url')
    return got.length === want.length && timingSafeEqual(got, want)
  }

  /** Stores the bytes. Returns an error message, or null. */
  put(rec: UploadRec, bytes: Uint8Array, contentType: string): string | null {
    if (rec.state === 'uploaded') return 'This upload already has its file.'
    if (contentType.split(';')[0].trim().toLowerCase() !== rec.contentType) return `Send Content-Type: ${rec.contentType}.`
    if (bytes.byteLength !== rec.size) return `Expected ${rec.size} bytes, got ${bytes.byteLength}.`
    const rule = ALLOWED[rec.contentType]
    if (!rule.check(bytes)) return `The file is not a valid ${rec.contentType}.`
    if (this.blobs.capacity !== undefined && this.blobs.bytes + bytes.byteLength > this.blobs.capacity) return 'full'
    this.blobs.put(rec.id, bytes)
    rec.sha256 = createHash('sha256').update(bytes).digest('hex')
    this.settle(rec)
    rec.state = 'uploaded'
    return null
  }
}
