import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { BlobStore } from '../uploads'

/**
 * Where uploaded bytes live. Never in Convex: a bucket in production, a
 * folder on this machine in development, so files survive a restart.
 */

/** Files in a folder, one per upload id. For development. */
export class DiskBlobStore implements BlobStore {
  private total = 0
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(dir)) this.total += statSync(join(dir, f)).size
  }

  private path(id: string) {
    if (!/^[a-z]+_[0-9a-z]+$/.test(id)) throw new Error('bad blob id')
    return join(this.dir, id)
  }

  put(id: string, bytes: Uint8Array) {
    writeFileSync(this.path(id), bytes)
    this.total += bytes.byteLength
  }

  get(id: string) {
    try {
      return new Uint8Array(readFileSync(this.path(id)))
    } catch {
      return null
    }
  }

  delete(id: string) {
    try {
      this.total -= statSync(this.path(id)).size
      rmSync(this.path(id))
    } catch {}
  }

  get bytes() {
    return this.total
  }
}

/**
 * An S3-compatible bucket (Railway buckets, R2, S3), through Bun's own S3
 * client. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.
 */
export class BucketBlobStore implements BlobStore {
  readonly bytes = 0
  private readonly client: {
    file: (key: string) => {
      write: (b: Uint8Array) => Promise<number>
      arrayBuffer: () => Promise<ArrayBuffer>
      exists: () => Promise<boolean>
      delete: () => Promise<void>
    }
  }

  constructor(o: {
    bucket: string
    endpoint?: string
    accessKeyId: string
    secretAccessKey: string
    region?: string
  }) {
    const S3 = (
      globalThis as {
        Bun?: { S3Client: new (o: unknown) => BucketBlobStore['client'] }
      }
    ).Bun?.S3Client
    if (!S3) throw new Error('The bucket store needs the Bun runtime.')
    this.client = new S3(o)
  }

  async put(id: string, bytes: Uint8Array) {
    await this.client.file(`uploads/${id}`).write(bytes)
  }

  async get(id: string) {
    const f = this.client.file(`uploads/${id}`)
    if (!(await f.exists())) return null
    return new Uint8Array(await f.arrayBuffer())
  }

  async delete(id: string) {
    await this.client.file(`uploads/${id}`).delete()
  }
}

/** The bucket when one is configured, else a folder. */
export function blobStoreFromEnv(
  env: Record<string, string | undefined>,
  folder: string,
): BlobStore {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
    return new BucketBlobStore({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    })
  return new DiskBlobStore(folder)
}
