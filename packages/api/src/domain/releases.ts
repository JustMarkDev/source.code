import { newId } from '../ids'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type {
  AssetRec,
  ReleaseChannel,
  ReleaseRec,
  RepoRec,
  Viewer,
} from './records'
import { DomainNotifications } from './notifications'

/**
 * Releases: a version with notes and signed files for each platform. A stable
 * release tells the people who starred the repository; betas and nightlies
 * reach only those who look.
 */
export abstract class DomainReleases extends DomainNotifications {
  protected presentRelease(repo: RepoRec, r: ReleaseRec) {
    const iso = (t: number) => new Date(t).toISOString()
    return {
      object: 'release' as const,
      id: r.id,
      tag: r.tag,
      url: `${this.repoUrl(repo)}/releases/${encodeURIComponent(r.tag)}`,
      html_url: `${this.urls.html}/${repo.owner}/${repo.name}/releases`,
      channel: r.channel,
      title: r.title,
      notes: r.notes,
      signed: r.signed,
      commit: r.commit,
      withdrawn: r.withdrawn
        ? { reason: r.withdrawn.reason, at: iso(r.withdrawn.at) }
        : null,
      assets: r.assets.map(({ uploadId, ...a }) => ({
        ...a,
        content_url: uploadId
          ? `${this.urls.api}/uploads/${uploadId}/content`
          : null,
      })),
      downloads: r.assets.reduce((n, a) => n + a.downloads, 0),
      author: this.actor(r.author),
      published_at: iso(r.published),
      version: r.version,
    }
  }

  private releaseOf(repo: RepoRec, tag: string) {
    const r = repo.releases?.find((x) => x.tag === tag)
    if (!r)
      throw apiError(
        'not_found',
        `No release ${tag} in ${repo.owner}/${repo.name}.`,
      )
    return r
  }

  seedRelease(repo: RepoRec, r: ReleaseRec) {
    repo.releases = [...(repo.releases ?? []), r].sort(
      (a, b) => b.published - a.published,
    )
  }

  async listReleases(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      channel?: ReleaseChannel
      after: CursorPosition | null
      limit: number
    },
  ) {
    const repo = this.resolve(owner, name, p)
    const all = (repo.releases ?? []).filter(
      (r) => !q.channel || r.channel === q.channel,
    )
    let start = 0
    if (q.after) {
      const k = all.findIndex((r) => r.id === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map((r) => this.presentRelease(repo, r)),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.id }
          : null,
    }
  }

  async releasesVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const v = (repo.releases ?? []).reduce((n, r) => n + r.version, 0)
    return `${repo.id}.r${repo.releases?.length ?? 0}.${v}.${this.accessRevision}`
  }

  async getRelease(owner: string, name: string, tag: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return this.presentRelease(repo, this.releaseOf(repo, tag))
  }

  async createRelease(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      tag: string
      channel: ReleaseChannel
      title: string
      notes?: Partial<ReleaseRec['notes']>
      signed?: boolean
      commit?: string
      assets?: Array<
        Omit<AssetRec, 'downloads' | 'uploadId' | 'size' | 'sha256'> & {
          size?: number
          sha256?: string
          upload?: string
        }
      >
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const same = repo.releases?.find((r) => r.tag === body.tag)
    if (same)
      return {
        release: this.presentRelease(repo, same),
        outcome: 'unchanged' as const,
      }
    const at = this.now()
    const by = this.asActor(p!)
    const bad = (i: number, field: string, message: string) =>
      apiError('invalid_request', message, {
        errors: [
          { pointer: `/body/assets/${i}/${field}`, code: 'invalid', message },
        ],
      })
    const assets: Array<AssetRec> = (body.assets ?? []).map((a, i) => {
      const { upload, ...rest } = a
      if (!upload) {
        if (a.size === undefined || a.sha256 === undefined)
          throw bad(i, 'upload', `${a.name}: give upload, or size and sha256.`)
        return { ...rest, size: a.size, sha256: a.sha256, downloads: 0 }
      }
      const u = this.memUploads.get(upload)
      if (!u || u.owner !== p!.handle)
        throw apiError('not_found', `No upload ${upload}.`)
      if (u.state !== 'uploaded' || !u.sha256)
        throw apiError('upload_incomplete', `Upload ${a.name} first.`)
      if (u.purpose !== 'release')
        throw bad(i, 'upload', `${upload} was not uploaded for a release.`)
      if (u.attachedTo) throw bad(i, 'upload', `${upload} is already attached.`)
      if (a.sha256 && a.sha256 !== u.sha256)
        throw bad(i, 'sha256', `${a.name} does not match what was uploaded.`)
      return {
        ...rest,
        size: u.size,
        sha256: u.sha256,
        downloads: 0,
        uploadId: u.id,
      }
    })
    const r: ReleaseRec = {
      id: newId('release', at),
      tag: body.tag,
      channel: body.channel,
      title: body.title,
      notes: {
        added: body.notes?.added ?? [],
        changed: body.notes?.changed ?? [],
        fixed: body.notes?.fixed ?? [],
      },
      signed: body.signed ?? false,
      commit: body.commit ?? null,
      withdrawn: null,
      assets,
      author: by,
      published: at,
      version: 1,
    }
    const shown = this.presentRelease(repo, r)
    if (!dry) {
      for (const a of assets)
        if (a.uploadId) {
          const u = this.memUploads.get(a.uploadId)!
          u.attachedTo = `${repo.owner}/${repo.name}`
          u.attachedRepoId = repo.id
        }
      this.seedRelease(repo, r)
      this.emit(
        repo,
        'release.published',
        by,
        { object: 'release', id: r.id, number: null },
        ['releases'],
        shown,
      )
      if (r.channel === 'stable')
        for (const h of repo.starredBy)
          if (h !== by.handle)
            this.notify(h, {
              kind: 'release',
              title: `${repo.name} ${r.tag} is out: ${r.title}`,
              repo: `${repo.owner}/${repo.name}`,
              path: `/${repo.owner}/${repo.name}/releases`,
            })
    }
    return { release: shown, outcome: 'created' as const }
  }

  async updateRelease(
    owner: string,
    name: string,
    tag: string,
    p: Viewer,
    body: {
      title?: string
      notes?: Partial<ReleaseRec['notes']>
      withdrawn?: string | null
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const r = this.releaseOf(repo, tag)
    const next: ReleaseRec = {
      ...r,
      title: body.title ?? r.title,
      notes: { ...r.notes, ...body.notes },
      withdrawn:
        body.withdrawn === undefined
          ? r.withdrawn
          : body.withdrawn === null
            ? null
            : { reason: body.withdrawn, at: r.withdrawn?.at ?? this.now() },
    }
    if (dry) return this.presentRelease(repo, next)
    Object.assign(r, next, { version: r.version + 1 })
    const shown = this.presentRelease(repo, r)
    this.emit(
      repo,
      body.withdrawn ? 'release.withdrawn' : 'release.updated',
      this.asActor(p!),
      { object: 'release', id: r.id, number: null },
      Object.keys(body),
      shown,
    )
    return shown
  }

  /**
   * Someone is downloading an asset: count it, and say where the file is. The
   * file itself is served by the store, not by the API.
   */
  async downloadAsset(
    owner: string,
    name: string,
    tag: string,
    asset: string,
    p: Viewer,
  ) {
    const repo = this.resolve(owner, name, p)
    const r = this.releaseOf(repo, tag)
    const a = r.assets.find((x) => x.name === asset)
    if (!a) throw apiError('not_found', `No file ${asset} in ${tag}.`)
    if (r.withdrawn)
      throw apiError(
        'invalid_state',
        `${tag} was withdrawn: ${r.withdrawn.reason}`,
      )
    a.downloads++
    r.version++
    return {
      object: 'download' as const,
      release: r.tag,
      asset: a.name,
      sha256: a.sha256,
      url: `${this.urls.html}/${repo.owner}/${repo.name}/releases/download/${encodeURIComponent(r.tag)}/${encodeURIComponent(a.name)}`,
      downloads: a.downloads,
      content_url: a.uploadId
        ? `${this.urls.api}/uploads/${a.uploadId}/content`
        : null,
    }
  }
}
