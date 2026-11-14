import { newId } from '../ids'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type { EventRecord } from '../events'
import type {
  ActorRec,
  NotificationKind,
  NotificationPrefs,
  NotificationRec,
  RepoRec,
  Viewer,
} from './records'
import { DomainSync } from './sync'

export const defaultPrefs: NotificationPrefs = {
  review: true,
  mention: true,
  release: true,
  ci: true,
  issue: true,
  import: true,
  digest: false,
}

/** Handles written as `@handle` in a text, at most ten, in order. */
function mentions(text: string): Array<string> {
  const out: Array<string> = []
  for (const m of text.matchAll(/(?:^|[^\w@/])@([a-z0-9][a-z0-9-]{0,38})/gi))
    if (!out.includes(m[1].toLowerCase())) out.push(m[1].toLowerCase())
  return out.slice(0, 10)
}

/**
 * Each person's inbox. It is fed from the events every write already emits,
 * so a write does not have to know who to tell: this layer reads the event and
 * decides. Someone is never told about what they did themself, nor about a
 * repository they can no longer read when they look.
 */
export abstract class DomainNotifications extends DomainSync {
  readonly inboxes = new Map<string, Array<NotificationRec>>()
  readonly notificationPrefs = new Map<string, NotificationPrefs>()
  /** Bumped by every inbox write, for conditional reads. */
  inboxRev = new Map<string, number>()

  protected override emit(
    repo: RepoRec,
    type: string,
    by: ActorRec,
    subject: { object: string; id: string; number: number | null },
    changes: Array<string>,
    data: Record<string, unknown> | null,
  ): EventRecord {
    const e = super.emit(repo, type, by, subject, changes, data)
    this.fanOut(repo, type, by, subject, changes, data)
    return e
  }

  private fanOut(
    repo: RepoRec,
    type: string,
    by: ActorRec,
    subject: { object: string; id: string; number: number | null },
    changes: Array<string>,
    data: Record<string, unknown> | null,
  ) {
    const full = `${repo.owner}/${repo.name}`
    const n = subject.number
    const d = (data ?? {}) as {
      title?: string
      body?: string
      author?: { handle: string }
      assignees?: Array<{ handle: string }>
      issue?: number
    }
    const tell = (
      who: string | undefined,
      kind: NotificationKind,
      title: string,
      path: string,
    ) => {
      if (!who || who === by.handle) return
      this.notify(who, { kind, title, repo: full, path })
    }
    if (type === 'issue.created' || type === 'issue.updated') {
      // Told once, when they are given it, not on every later edit.
      if (
        !d.assignees ||
        (type === 'issue.updated' && !changes.includes('assignees'))
      )
        return
      for (const a of d.assignees)
        tell(
          a.handle,
          'issue',
          `${by.handle} assigned you #${n} ${d.title ?? ''}`.trim(),
          `/${full}/issues?n=${n}`,
        )
      return
    }
    if (type === 'issue.commented') {
      const issue = repo.issues.get(d.issue ?? -1)
      for (const h of mentions(d.body ?? ''))
        tell(
          h,
          'mention',
          `${by.handle} mentioned you on #${d.issue} ${issue?.title ?? ''}`.trim(),
          `/${full}/issues?n=${d.issue}`,
        )
      return
    }
    const author = d.author?.handle
    // A fix that answers a thread tells whoever started the thread.
    const addressed = (data as { addressed?: unknown } | null)?.addressed
    if (Array.isArray(addressed)) {
      for (const x of addressed as Array<{ author: string; patch_set: number }>)
        tell(
          x.author,
          'review',
          `${by.handle} addressed your comment on #${n} in patch set ${x.patch_set}`,
          `/${full}/changes?n=${n}`,
        )
      if (type === 'change.comment_addressed') return
    }
    if (type === 'change.commented') {
      const t = data as { body?: string; thread?: Array<string> } | null
      const told = new Set<string>()
      const where = `/${full}/changes?n=${n}`
      for (const h of mentions(t?.body ?? '')) {
        told.add(h)
        tell(
          h,
          'mention',
          `${by.handle} mentioned you on #${n} ${d.title ?? ''}`.trim(),
          where,
        )
      }
      for (const h of [author, ...(t?.thread ?? [])])
        if (h && !told.has(h)) {
          told.add(h)
          tell(
            h,
            'review',
            `${by.handle} commented on #${n} ${d.title ?? ''}`.trim(),
            where,
          )
        }
      return
    }
    if (type === 'finding.raised')
      tell(
        author,
        'review',
        `${by.handle} raised a finding on #${n} ${d.title ?? ''}`.trim(),
        `/${full}/changes?n=${n}`,
      )
    if (type === 'change.reviewed')
      tell(
        author,
        'review',
        `${by.handle} reviewed #${n} ${d.title ?? ''}`.trim(),
        `/${full}/changes?n=${n}`,
      )
    if (type === 'ci.failed')
      tell(
        author,
        'ci',
        `Checks failed on #${n} ${d.title ?? ''}`.trim(),
        `/${full}/changes?n=${n}`,
      )
    if (type === 'change.landed')
      tell(
        author,
        'review',
        `${by.handle} landed #${n} ${d.title ?? ''}`.trim(),
        `/${full}/changes?n=${n}`,
      )
  }

  protected override onRepoMoved(from: string, to: string) {
    super.onRepoMoved(from, to)
    for (const list of this.inboxes.values())
      for (const x of list)
        if (x.repo === from) {
          x.repo = to
          if (x.path.startsWith(`/${from}/`))
            x.path = `/${to}${x.path.slice(from.length + 1)}`
        }
  }

  /** Put something in a person's inbox, if they want that kind. */
  notify(
    handle: string,
    n: {
      kind: NotificationKind
      title: string
      repo: string | null
      path: string
      at?: number
      unread?: boolean
      id?: string
    },
  ) {
    const account = this.accounts.get(handle)
    if (account?.kind !== 'person') return
    const prefs = this.notificationPrefs.get(handle) ?? defaultPrefs
    if (!prefs[n.kind]) return
    const at = n.at ?? this.now()
    const list = this.inboxes.get(handle) ?? []
    list.unshift({
      id: n.id ?? newId('notification', at),
      kind: n.kind,
      title: n.title,
      repo: n.repo,
      path: n.path,
      unread: n.unread ?? true,
      created: at,
    })
    // An inbox keeps its newest thousand.
    if (list.length > 1000) list.length = 1000
    this.inboxes.set(handle, list)
    this.inboxRev.set(handle, (this.inboxRev.get(handle) ?? 0) + 1)
  }

  private me(p: Viewer) {
    if (!p) throw apiError('unauthenticated', 'Sign in to read your inbox.')
    return p.handle
  }

  /** What the viewer may still see: items about a repository they can no longer read drop out. */
  private visible(p: Viewer, list: Array<NotificationRec>) {
    return list.filter(
      (x) => !x.repo || x.repo.startsWith('~') || this.mayReadRepo(x.repo, p),
    )
  }

  private mayReadRepo(full: string, p: Viewer) {
    const r = this.repos.get(full) ?? this.repos.get(full.toLowerCase())
    // Not a repository (an account-level item such as an import): keep it.
    if (!r) return !full.includes('/')
    return this.canRead(r, p)
  }

  private presentNotification(x: NotificationRec) {
    return {
      object: 'notification' as const,
      id: x.id,
      kind: x.kind,
      title: x.title,
      repo: x.repo,
      html_url: `${this.urls.html}${x.path}`,
      unread: x.unread,
      created_at: new Date(x.created).toISOString(),
    }
  }

  async listNotifications(
    p: Viewer,
    q: {
      unread?: boolean
      kind?: NotificationKind
      after: CursorPosition | null
      limit: number
    },
  ) {
    const all = this.visible(p, this.inboxes.get(this.me(p)) ?? []).filter(
      (x) => (!q.unread || x.unread) && (!q.kind || x.kind === q.kind),
    )
    let start = 0
    if (q.after) {
      const k = all.findIndex((x) => x.id === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map((x) => this.presentNotification(x)),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.id }
          : null,
    }
  }

  async notificationsVersion(p: Viewer) {
    const h = this.me(p)
    return `${h}.${this.inboxRev.get(h) ?? 0}.${this.accessRevision}`
  }

  async unreadCount(p: Viewer) {
    const list = this.visible(p, this.inboxes.get(this.me(p)) ?? [])
    return {
      object: 'notification_count' as const,
      unread: list.filter((x) => x.unread).length,
    }
  }

  async markRead(p: Viewer, id: string | null) {
    const h = this.me(p)
    const list = this.inboxes.get(h) ?? []
    if (id !== null && !list.some((x) => x.id === id))
      throw apiError('not_found', `No notification ${id}.`)
    let changed = false
    for (const x of list)
      if ((id === null || x.id === id) && x.unread) {
        x.unread = false
        changed = true
      }
    if (changed) this.inboxRev.set(h, (this.inboxRev.get(h) ?? 0) + 1)
  }

  async getNotificationPrefs(p: Viewer) {
    return {
      object: 'notification_preferences' as const,
      ...(this.notificationPrefs.get(this.me(p)) ?? defaultPrefs),
    }
  }

  async updateNotificationPrefs(p: Viewer, body: Partial<NotificationPrefs>) {
    const h = this.me(p)
    const next = { ...(this.notificationPrefs.get(h) ?? defaultPrefs) }
    for (const [k, v] of Object.entries(body) as Array<
      [string, boolean | undefined]
    >)
      if (v !== undefined) next[k as keyof NotificationPrefs] = v
    this.notificationPrefs.set(h, next)
    return { object: 'notification_preferences' as const, ...next }
  }
}
