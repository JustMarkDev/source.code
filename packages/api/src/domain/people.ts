import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type { RepoRec, Viewer } from './records'
import { DomainInsights } from './insights'

const DAY = 86_400_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** What a person chose their profile shows, and how downloads pick a file. */
export type AccountPrefs = {
  combined_total: boolean
  private_totals: boolean
  show_activity: boolean
  show_agents: boolean
  searchable: boolean
  download_target: {
    os: 'macos' | 'windows' | 'linux'
    arch: 'arm64' | 'x64'
  } | null
}

export const defaultAccountPrefs: AccountPrefs = {
  combined_total: true,
  private_totals: true,
  show_activity: true,
  show_agents: true,
  searchable: true,
  download_target: null,
}

type Contribution = {
  kind: 'push' | 'review' | 'change' | 'issue' | 'release'
  at: number
  title: string
  repo: RepoRec
  /** The work was an agent's, and this person reviewed or landed it. */
  agent?: boolean
}

/**
 * People: their preferences, who follows whom, a profile worked out from what
 * they did, and the directory that Discover and search list. Everything on a
 * profile is counted from commits, reviews, changes, issues and releases the
 * domain already holds; nothing is typed in.
 */
export abstract class DomainPeople extends DomainInsights {
  readonly accountPrefs = new Map<string, AccountPrefs>()
  /** Who each person follows. */
  readonly following = new Map<string, Set<string>>()
  peopleRev = 0

  prefsOf(handle: string): AccountPrefs {
    return this.accountPrefs.get(handle) ?? defaultAccountPrefs
  }

  private signedIn(p: Viewer) {
    if (!p) throw apiError('unauthenticated', 'Sign in first.')
    return p.handle
  }

  private person(handle: string) {
    const a =
      this.accounts.get(handle) ?? this.accounts.get(handle.toLowerCase())
    if (!a) throw apiError('not_found', `No account ${handle}.`)
    return a
  }

  // ---- preferences ----------------------------------------------------------

  async getAccountPrefs(p: Viewer) {
    return {
      object: 'account_preferences' as const,
      ...this.prefsOf(this.signedIn(p)),
    }
  }

  async updateAccountPrefs(p: Viewer, body: Partial<AccountPrefs>) {
    const h = this.signedIn(p)
    const next = { ...this.prefsOf(h) }
    for (const [k, v] of Object.entries(body) as Array<[string, unknown]>)
      if (v !== undefined) (next as Record<string, unknown>)[k] = v
    this.accountPrefs.set(h, next)
    this.peopleRev++
    this.svc.search.reset()
    return { object: 'account_preferences' as const, ...next }
  }

  // ---- follows --------------------------------------------------------------

  private followersOf(handle: string) {
    const out: Array<string> = []
    for (const [who, set] of this.following) if (set.has(handle)) out.push(who)
    return out.sort()
  }

  seedFollow(who: string, whom: string) {
    const set = this.following.get(who) ?? new Set()
    set.add(whom)
    this.following.set(who, set)
  }

  async follow(p: Viewer, handle: string, on: boolean) {
    const me = this.signedIn(p)
    const a = this.person(handle)
    if (a.handle === me)
      throw apiError('invalid_request', 'You cannot follow yourself.')
    if (p!.class !== 'human')
      throw apiError('forbidden', 'Only people follow accounts.')
    const set = this.following.get(me) ?? new Set()
    if (on) set.add(a.handle)
    else set.delete(a.handle)
    this.following.set(me, set)
    this.peopleRev++
  }

  private ref(handle: string) {
    const a = this.accounts.get(handle)
    return {
      object: 'account_ref' as const,
      handle,
      name: a?.name ?? handle,
      kind: a?.kind ?? ('person' as const),
      html_url: `${this.urls.html}/${handle}`,
    }
  }

  async listFollows(
    handle: string,
    which: 'followers' | 'following',
    q: { after: CursorPosition | null; limit: number },
  ) {
    const a = this.person(handle)
    const all =
      which === 'followers'
        ? this.followersOf(a.handle)
        : [...(this.following.get(a.handle) ?? [])].sort()
    let start = 0
    if (q.after) {
      const k = all.indexOf(q.after.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map((h) => this.ref(h)),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last }
          : null,
    }
  }

  async peopleVersion(_p: Viewer) {
    return `ppl${this.peopleRev}.${this.accessRevision}.${this.accounts.size}`
  }

  // ---- profile --------------------------------------------------------------

  /** Everything a person did, in repositories `p` may read, or counted privately. */
  private async contributions(handle: string, p: Viewer, since: number) {
    const prefs = this.prefsOf(handle)
    const own = p?.handle === handle
    const shown: Array<Contribution> = []
    let hidden = 0
    const email = `${handle}@users.source.code`
    for (const r of this.repos.values()) {
      const readable = this.canRead(r, p)
      // A private repository's work counts, as a number only, if they allow it.
      if (!readable && !(own || prefs.private_totals)) continue
      const found: Array<Contribution> = []
      let commits: Awaited<ReturnType<typeof this.svc.git.commits>> = []
      try {
        commits = await this.svc.git.commits(`${r.owner}/${r.name}`, 1000)
      } catch {
        commits = []
      }
      for (const c of commits) {
        const at = Date.parse(c.date)
        if (at >= since && c.author.email.toLowerCase() === email)
          found.push({
            kind: 'push',
            at,
            title: c.message.split('\n')[0],
            repo: r,
          })
      }
      for (const c of r.changes.values()) {
        if (c.author.handle === handle && c.created >= since)
          found.push({
            kind: 'change',
            at: c.created,
            title: `Opened #${c.number} ${c.title}`,
            repo: r,
          })
        for (const v of c.reviews)
          if (v.actor.handle === handle && v.created >= since)
            found.push({
              kind: 'review',
              at: v.created,
              title: `Reviewed #${c.number} ${c.title}`,
              repo: r,
              agent: c.author.class !== 'human' && v.state === 'approved',
            })
      }
      for (const i of r.issues.values())
        if (i.author.handle === handle && i.created >= since)
          found.push({
            kind: 'issue',
            at: i.created,
            title: `Opened issue #${i.number} ${i.title}`,
            repo: r,
          })
      for (const x of r.releases ?? [])
        if (x.author.handle === handle && x.published >= since)
          found.push({
            kind: 'release',
            at: x.published,
            title: `Published ${x.tag}`,
            repo: r,
          })
      if (readable) shown.push(...found)
      else hidden += found.length
    }
    return { shown, hidden }
  }

  async profile(handle: string, p: Viewer) {
    const a = this.person(handle)
    const now = this.now()
    const prefs = this.prefsOf(a.handle)
    const own = p?.handle === a.handle
    const yearAgo = now - 365 * DAY
    const { shown, hidden } =
      a.kind === 'person'
        ? await this.contributions(a.handle, p, yearAgo)
        : { shown: [], hidden: 0 }
    const all = shown.length + hidden

    // Months, oldest first, ending with this one.
    const end = new Date(now)
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + i, 1),
      )
      return { month: d.toISOString().slice(0, 7), count: 0 }
    })
    const days = Array.from({ length: 26 * 7 }, () => 0)
    const today = Math.floor(now / DAY)
    const weekday = WEEKDAYS.map((day) => ({ day, commits: 0, reviews: 0 }))
    const kinds = { push: 0, review: 0, change: 0, issue: 0, release: 0 }
    for (const c of shown) {
      const m = months.find(
        (x) => x.month === new Date(c.at).toISOString().slice(0, 7),
      )
      if (m) m.count++
      const k = days.length - 1 - (today - Math.floor(c.at / DAY))
      if (k >= 0 && k < days.length) days[k]++
      const w = (new Date(c.at).getUTCDay() + 6) % 7
      if (c.kind === 'push') weekday[w].commits++
      if (c.kind === 'review') weekday[w].reviews++
      kinds[c.kind]++
    }
    const work = (
      [
        ['Commits', kinds.push],
        ['Reviews', kinds.review],
        ['Changes', kinds.change],
        ['Issues', kinds.issue],
        ['Releases', kinds.release],
      ] as const
    ).map(([axis, n]) => ({
      axis,
      value: shown.length ? Math.round((n / shown.length) * 100) : 0,
    }))

    // Languages: of the public repositories they own or worked in, weighted by how much they did there.
    const weight = new Map<RepoRec, number>()
    for (const c of shown) weight.set(c.repo, (weight.get(c.repo) ?? 0) + 1)
    for (const r of this.repos.values())
      if (r.owner === a.handle && this.canRead(r, p) && !weight.has(r))
        weight.set(r, 1)
    const langs = new Map<string, number>()
    for (const [r, w] of weight)
      for (const [name, pct] of r.languages)
        langs.set(name, (langs.get(name) ?? 0) + pct * w)
    const langTotal = [...langs.values()].reduce((x, y) => x + y, 0) || 1

    const ownedRepos = [...this.repos.values()].filter(
      (r) => r.owner === a.handle && this.canRead(r, p),
    )
    const releases = ownedRepos.reduce(
      (n, r) => n + (r.releases?.length ?? 0),
      0,
    )
    const downloads = ownedRepos.reduce(
      (n, r) =>
        n +
        (r.releases ?? []).reduce(
          (m, x) => m + x.assets.reduce((k, s) => k + s.downloads, 0),
          0,
        ),
      0,
    )
    const reviewed = shown.filter((c) => c.kind === 'review')
    const showAgents = own || prefs.show_agents
    const showActivity = own || prefs.show_activity
    return {
      object: 'profile' as const,
      handle: a.handle,
      name: a.name,
      kind: a.kind,
      bio: a.bio,
      followers: this.followersOf(a.handle).length,
      following: this.following.get(a.handle)?.size ?? 0,
      viewer_follows:
        p && p.handle !== a.handle
          ? (this.following.get(p.handle)?.has(a.handle) ?? false)
          : null,
      contributions: {
        total: own || prefs.private_totals ? all : shown.length,
        private: own || prefs.private_totals ? hidden : 0,
        by_month: months,
        by_day: showActivity ? days : [],
        by_weekday: weekday,
      },
      work,
      languages: [...langs.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([name, v]) => ({
          name,
          percent: Math.round((v / langTotal) * 100),
        })),
      repositories: ownedRepos.length,
      releases,
      downloads,
      agent_share:
        showAgents && reviewed.length
          ? Math.round(
              (reviewed.filter((c) => c.agent).length / reviewed.length) * 100,
            )
          : null,
      activity: showActivity
        ? shown
            .sort((x, y) => y.at - x.at)
            .slice(0, 30)
            .map((c) => ({
              kind: c.kind,
              title: c.title,
              repo: `${c.repo.owner}/${c.repo.name}`,
              at: new Date(c.at).toISOString(),
            }))
        : [],
      activity_hidden: !showActivity,
    }
  }

  async profileVersion(handle: string, p: Viewer) {
    const a = this.person(handle)
    let rev = 0
    for (const r of this.repos.values()) rev += r.rev
    return `${a.id}.${a.version}.${rev}.${this.peopleRev}.${this.accessRevision}.${Math.floor(this.now() / DAY)}.${p?.handle ?? '-'}`
  }

  // ---- directory ------------------------------------------------------------

  async listPeople(
    p: Viewer,
    q: { q?: string; after: CursorPosition | null; limit: number },
  ) {
    const needle = q.q?.trim().toLowerCase() ?? ''
    const all = [...this.accounts.values()]
      .filter(
        (a) =>
          a.kind === 'person' &&
          (this.prefsOf(a.handle).searchable || a.handle === p?.handle) &&
          (!needle ||
            a.handle.toLowerCase().includes(needle) ||
            a.name.toLowerCase().includes(needle) ||
            a.bio.toLowerCase().includes(needle)),
      )
      .map((a) => ({
        a,
        followers: this.followersOf(a.handle).length,
        repos: [...this.repos.values()].filter(
          (r) => r.owner === a.handle && r.visibility === 'public',
        ),
      }))
      // Most followed first, then by handle, so the order is stable.
      .sort(
        (x, y) =>
          y.followers - x.followers || x.a.handle.localeCompare(y.a.handle),
      )
    let start = 0
    if (q.after) {
      const k = all.findIndex((x) => x.a.handle === q.after!.id)
      start = k >= 0 ? k + 1 : all.length
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map(({ a, followers, repos }) => {
        const langs = new Map<string, number>()
        for (const r of repos)
          for (const [name, pct] of r.languages)
            langs.set(name, (langs.get(name) ?? 0) + pct * (r.stars + 1))
        return {
          object: 'person' as const,
          handle: a.handle,
          name: a.name,
          bio: a.bio,
          followers,
          repositories: repos.length,
          stars: repos.reduce((n, r) => n + r.stars, 0),
          languages: [...langs.entries()]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 3)
            .map(([name]) => name),
          html_url: `${this.urls.html}/${a.handle}`,
          viewer_follows:
            p && p.handle !== a.handle
              ? (this.following.get(p.handle)?.has(a.handle) ?? false)
              : null,
        }
      }),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.a.handle }
          : null,
    }
  }
}
