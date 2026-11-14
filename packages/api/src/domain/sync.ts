import { pageSorted } from '../cursor'
import { apiError } from '../problem'
import { parseEvent } from '../events'
import { Pre } from '../registry'
import type { CursorPosition } from '../cursor'
import type { StoredEvent } from '../events'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import { seqId } from './records'
import type { Viewer } from './records'
import { DomainChanges } from './changes'

/** The event feed and the sync snapshot. */
export abstract class DomainSync extends DomainChanges {
  /** The event log's position, for conditional reads of the log itself. */
  eventVersion() {
    return `${this.events.head}.${this.events.oldest}`
  }

  async syncVersion(owner: string, name: string, p: Viewer) {
    const full = owner.startsWith('rep_') ? owner : `${owner}/${name}`
    return `${this.repoKey(this.repoForSync(full, p))}.${this.events.oldest}`
  }

  /** Sync accepts an old name and the current name; it resolves the stable id. */
  protected repoForSync(full: string, p: Viewer) {
    const id = this.repoIdForHistory(full)
    const r = id ? this.reposById.get(id) : null
    if (!r || !this.canRead(r, p))
      throw apiError('not_found', `No repository ${full}.`, {
        hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
      })
    return r
  }

  /** The event log's position for one repository, after checking the caller may read it. */
  async repoHistoryVersion(full: string, p: Viewer) {
    const id = this.repoIdForHistory(full)
    if (!id) throw apiError('not_found', `No repository ${full}.`)
    if (!this.readableRepoIds(p)(id))
      throw apiError('not_found', `No repository ${full}.`, {
        hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
      })
    const list = this.events.repoEvents(id)
    return `${id}.${list.at(-1)?.sequence ?? 0}.${this.events.oldest}`
  }

  /** The current owner/name for an address, following rename aliases without a permission check. */
  canonicalRepoName(full: string): string {
    const direct = this.repos.get(full) ?? this.byLower(full.toLowerCase())
    if (direct) return `${direct.owner}/${direct.name}`
    let key = full.toLowerCase()
    const seen = new Set<string>([key])
    for (let i = 0; i < 10; i++) {
      const next = this.aliases.get(key)
      if (!next || seen.has(next.toLowerCase())) break
      key = next.toLowerCase()
      seen.add(key)
    }
    const repo = this.repos.get(key) ?? this.byLower(key)
    return repo ? `${repo.owner}/${repo.name}` : full
  }

  /**
   * The stable repository identity and access stamp for a keyed write. It is
   * built from the routed parameters, so empty or extra slashes and rename
   * aliases cannot change it. A bare repository delete keeps only the id, so a
   * retry can still replay 204 once the repository is gone.
   */
  replayKey(
    opId: string,
    params: Record<string, string>,
    p: Principal,
  ): { id: string; stamp: string } {
    const owner = params.owner
    const name = params.repo
    if (!owner || !name) return { id: '', stamp: '' }
    const id =
      name === '~' && owner.startsWith('rep_')
        ? this.repoIdForHistory(owner)
        : this.repoIdForHistory(`${owner}/${name}`)
    if (!id) return { id: '', stamp: 'none' }
    if (opId === 'repos.delete') return { id, stamp: id }
    const repo = this.reposById.get(id)
    return { id, stamp: `${id}:${repo ? this.canWrite(repo, p) : false}` }
  }

  /** The stable id behind a repository address, without requiring that it still exists. */
  repoIdForHistory(full: string): string | null {
    if (full.startsWith('rep_'))
      return this.reposById.has(full) || this.deletedRepos.has(full)
        ? full
        : (this.deletedIds.get(full) ?? null)
    const direct = this.repos.get(full) ?? this.byLower(full.toLowerCase())
    if (direct) return direct.id
    let key = full.toLowerCase()
    const seen = new Set<string>([key])
    for (let i = 0; i < 10; i++) {
      const next = this.aliases.get(key)
      if (!next || seen.has(next.toLowerCase())) break
      key = next.toLowerCase()
      seen.add(key)
    }
    const repo = this.repos.get(key) ?? this.byLower(key)
    if (repo) return repo.id
    const to = this.aliases.get(key)
    if (to)
      return (
        this.repos.get(to)?.id ?? this.deletedIds.get(to.toLowerCase()) ?? null
      )
    return this.deletedIds.get(key) ?? null
  }

  async listEvents(
    p: Viewer,
    q: {
      repo?: string
      type?: string
      after: CursorPosition | null
      limit: number
    },
  ) {
    const can = this.readableRepoIds(p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const types = q.type ? q.type.split(',') : null
    const typeOk = (t: string) =>
      !types ||
      types.some((x) =>
        x.endsWith('.*') ? t.startsWith(x.slice(0, -1)) : x === t,
      )
    const scopeOk = (t: string) =>
      t.startsWith('issue.')
        ? canIssue
        : /^(change|finding|check|ci|operation)\./.test(t)
          ? canPull
          : true
    // A repository's own list when one is asked for, so a quiet repository is not
    // found by reading everyone else's events. The key is the stable id, so a
    // rename does not split the history.
    const repoId = q.repo ? this.repoIdForHistory(q.repo) : null
    const source = q.repo
      ? repoId
        ? this.events.repoEvents(repoId)
        : []
      : this.events.all()
    const page = pageSorted(source, (e) => e.sequence, seqId, {
      limit: q.limit,
      after: q.after,
      desc: false,
      stored: 'asc',
      match: (e) => typeOk(e.type) && scopeOk(e.type) && can(e.repoId),
    })
    // An event never changes, so its text is its own version.
    return {
      items: page.items.map(
        (e: StoredEvent) =>
          new Pre(e.json, () => parseEvent(e), `ev${e.sequence}`),
      ),
      next: page.next,
    }
  }

  async sync(
    p: Viewer,
    q: { repo: string; cursor?: string; limit: number },
  ): Promise<z.infer<typeof S.Sync>> {
    const [owner = '', name = ''] = q.repo.split('/')
    const repo = this.repoForSync(
      owner.startsWith('rep_') ? owner : `${owner}/${name}`,
      p,
    )
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const scopeOk = (t: string) =>
      t.startsWith('issue.')
        ? canIssue
        : /^(change|finding|check|ci|operation)\./.test(t)
          ? canPull
          : true
    const snapshot = (from: number, head: number, reset: boolean) => {
      const all: Array<Record<string, unknown>> = [
        this.presentRepo(repo),
        ...(canPull
          ? [...repo.changes.values()].map(
              (c) =>
                this.presentChange(repo, c, 'event') as unknown as Record<
                  string,
                  unknown
                >,
            )
          : []),
        ...(canIssue
          ? [...repo.issues.values()].map(
              (i) =>
                this.presentIssue(repo, i) as unknown as Record<
                  string,
                  unknown
                >,
            )
          : []),
      ]
      const slice = all.slice(from, from + q.limit)
      const more = from + q.limit < all.length
      return {
        object: 'sync' as const,
        cursor: more
          ? `s_${repo.id}_${head}_${from + q.limit}`
          : `e_${repo.id}_${head}`,
        objects: slice,
        deleted: [],
        has_more: more,
        reset,
      }
    }
    const c = q.cursor
    if (!c) return snapshot(0, this.events.head, true)
    const snap = /^s_(.+)_(\d+)_(\d+)$/.exec(c)
    if (snap) {
      if (snap[1] !== repo.id)
        throw apiError(
          'cursor_mismatch',
          'This cursor belongs to another repository.',
          {
            errors: [
              {
                pointer: '/query/cursor',
                code: 'cursor_mismatch',
                message: 'Use a cursor returned for this repository.',
              },
            ],
          },
        )
      if (Number(snap[2]) > this.events.head)
        return snapshot(0, this.events.head, true)
      return snapshot(
        Number(snap[3]),
        Math.min(Number(snap[2]), this.events.head),
        false,
      )
    }
    const ev = /^e_(.+)_(\d+)$/.exec(c)
    if (!ev)
      throw apiError('invalid_request', 'The cursor is not valid.', {
        errors: [
          {
            pointer: '/query/cursor',
            code: 'invalid_cursor',
            message: 'Use cursor exactly as returned.',
          },
        ],
      })
    if (ev[1] !== repo.id)
      throw apiError(
        'cursor_mismatch',
        'This cursor belongs to another repository.',
        {
          errors: [
            {
              pointer: '/query/cursor',
              code: 'cursor_mismatch',
              message: 'Use a cursor returned for this repository.',
            },
          ],
        },
      )
    const after = Number(ev[2])
    if (after > this.events.head) return snapshot(0, this.events.head, true)
    if (after + 1 < this.events.oldest)
      return snapshot(0, this.events.head, true)
    const {
      events: stored,
      exhausted,
      scannedTo,
    } = this.events.since(
      after,
      q.limit,
      (e) =>
        e.repoId === repo.id &&
        scopeOk(e.type) &&
        /^(repo|change|issue|finding|check|ci)\./.test(e.type),
    )
    // Keep only the newest state of each object, and remember what was deleted
    // after the cursor so a local copy can remove it.
    const latest = new Map<string, Record<string, unknown>>()
    const deleted = new Map<string, { object: string; id: string }>()
    for (const s of stored) {
      const e = parseEvent(s)
      if (e.data) {
        latest.set(e.subject.id, e.data)
        deleted.delete(e.subject.id)
      } else if (e.type.endsWith('.deleted')) {
        latest.delete(e.subject.id)
        deleted.set(e.subject.id, {
          object: e.subject.object,
          id: e.subject.id,
        })
      }
    }
    return {
      object: 'sync',
      cursor: `e_${repo.id}_${exhausted ? Math.max(scannedTo, this.events.head) : scannedTo}`,
      objects: [...latest.values()],
      deleted: [...deleted.values()],
      has_more: !exhausted,
      reset: false,
    }
  }
}
