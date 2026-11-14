import { AsyncLocalStorage } from 'node:async_hooks'
import { checkFile, sha256Hex } from '../uploads'
import { run } from '../domain/convex'
import type { ConvexCall } from '../domain/convex'
import type {
  BlobStore,
  Purpose,
  UploadPort,
  UploadRec,
  UploadSigner,
} from '../uploads'

/**
 * Upload records in Convex (`convex/forge/uploads.ts`), bytes in a
 * `BlobStore` (the bucket). A request reads copies of records; what it
 * changed on them (attached to a repository, say) is saved when it is done.
 */
type Held = { rec: UploadRec; json: string }

export const uploadScope = new AsyncLocalStorage<Map<string, Held>>()

const fields = (r: UploadRec) =>
  JSON.stringify([r.state, r.sha256, r.attachedTo, r.attachedRepoId])

export class ConvexUploads implements UploadPort {
  constructor(
    private readonly call: ConvexCall,
    readonly blobs: BlobStore,
    private readonly signer: UploadSigner,
    private readonly now: () => number,
  ) {}

  private hold(rec: UploadRec | null) {
    if (!rec) return null
    const scope = uploadScope.getStore()
    const had = scope?.get(rec.id)
    if (had) return had.rec
    scope?.set(rec.id, { rec, json: fields(rec) })
    return rec
  }

  async create(
    owner: string,
    input: {
      filename: string
      contentType: string
      size: number
      purpose: Purpose
    },
  ) {
    return this.hold(
      await run<UploadRec>(
        this.call,
        'mutation',
        'forge/uploads:create',
        { owner, ...input },
        'system',
      ),
    )
  }

  async get(id: string) {
    const had = uploadScope.getStore()?.get(id)
    if (had) return had.rec
    return this.hold(
      await run<UploadRec | null>(
        this.call,
        'query',
        'forge/uploads:get',
        { id },
        'system',
      ),
    )
  }

  /** Counting runs the expiry sweep first, as the memory store does. */
  async countPending(owner: string) {
    await this.sweepNow()
    return await run<number>(
      this.call,
      'query',
      'forge/uploads:countPending',
      { owner, at: this.now() },
      'system',
    )
  }

  sign(rec: UploadRec) {
    return this.signer.sign(rec)
  }

  verify(rec: UploadRec, exp: number, sig: string) {
    return this.signer.verify(rec, exp, sig, this.now())
  }

  async put(rec: UploadRec, bytes: Uint8Array, contentType: string) {
    const problem = checkFile(rec, bytes, contentType, this.blobs)
    if (problem) return problem
    await this.blobs.put(rec.id, bytes)
    rec.sha256 = sha256Hex(bytes)
    rec.state = 'uploaded'
    return null
  }

  async dropRepo(repoId: string) {
    const gone = await run<Array<string>>(
      this.call,
      'mutation',
      'forge/uploads:dropRepo',
      { repoId },
      'system',
    )
    for (const id of gone) await this.blobs.delete?.(id)
  }

  async remove(id: string) {
    uploadScope.getStore()?.delete(id)
    await run(this.call, 'mutation', 'forge/uploads:remove', { id }, 'system')
    await this.blobs.delete?.(id)
  }

  async sweepNow() {
    const gone = await run<Array<string>>(
      this.call,
      'mutation',
      'forge/uploads:sweep',
      {},
      'system',
    )
    for (const id of gone) await this.blobs.delete?.(id)
  }

  async flush() {
    const scope = uploadScope.getStore()
    if (!scope) return
    for (const h of scope.values()) {
      const now = fields(h.rec)
      if (now === h.json) continue
      const r = h.rec
      await run(
        this.call,
        'mutation',
        'forge/uploads:save',
        {
          id: r.id,
          state: r.state,
          sha256: r.sha256,
          attachedTo: r.attachedTo,
          attachedRepoId: r.attachedRepoId,
        },
        'system',
      )
      h.json = now
    }
  }
}
