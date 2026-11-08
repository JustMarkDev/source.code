import { apiError } from '../problem'
import type { SearchDoc } from '../search'
import type { Principal } from '../auth'
import { Moved } from './records'
import type { AccountRec, RepoRec, Viewer } from './records'
import { DomainState } from './state'

/** Who may see and change what. */
export abstract class DomainAccess extends DomainState {
  protected isMember(handle: string, who: string) {
    const acc = this.accounts.get(handle)
    return !!acc && (handle === who || acc.members.has(who))
  }

  protected canRead(repo: RepoRec, p: Viewer) {
    const full = `${repo.owner}/${repo.name}`.toLowerCase()
    if (p?.repos && !p.repos.includes(full)) return repo.visibility === 'public'
    if (repo.visibility === 'public') return true
    return (
      !!p &&
      (this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) !== null)
    )
  }

  /** What the teams someone is in give them on a repository. Looked at only when nothing else does. */
  protected teamLevel(repo: RepoRec, handle: string): 'read' | 'write' | null {
    const keys = this.teamsOf.get(handle)
    if (!keys) return null
    const full = `${repo.owner}/${repo.name}`
    let level: 'read' | 'write' | null = null
    for (const k of keys) {
      const g = this.teams.get(k)?.repos.get(full)
      if (g === 'write') return 'write'
      if (g) level = 'read'
    }
    return level
  }

  protected hasAccess(repo: RepoRec, p: Principal) {
    return (
      this.isMember(repo.owner, p.handle) ||
      repo.collaborators.has(p.handle) ||
      repo.installs.has(p.handle)
    )
  }

  protected canWrite(repo: RepoRec, p: Viewer): p is Principal {
    if (!p) return false
    if (
      p.repos &&
      !p.repos.includes(`${repo.owner}/${repo.name}`.toLowerCase())
    )
      return false
    return this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) === 'write'
  }

  protected resolve(
    owner: string,
    name: string,
    p: Viewer,
    need: 'read' | 'write' = 'read',
  ): RepoRec {
    let repo: RepoRec | undefined
    if (name === '~' && owner.startsWith('rep_'))
      repo = this.reposById.get(owner)
    else {
      const key = `${owner}/${name}`.toLowerCase()
      repo = this.repos.get(key) ?? this.byLower(key)
      if (!repo) {
        let target = key
        const seen = new Set<string>([target])
        for (let i = 0; i < 10; i++) {
          const next = this.aliases.get(target)
          if (!next || seen.has(next)) break
          seen.add(next)
          target = next
        }
        if (target !== key) {
          const moved =
            this.repos.get(target) ?? this.byLower(target.toLowerCase())
          if (moved && this.canRead(moved, p)) throw new Moved(key, target)
        }
      }
    }
    if (!repo || !this.canRead(repo, p))
      throw apiError('not_found', `No repository ${owner}/${name}.`)
    if (need === 'write' && !this.canWrite(repo, p))
      throw apiError(
        'forbidden',
        'You can read this repository but not change it.',
      )
    return repo
  }

  /** Whether a viewer may read a repository's files. */
  mayRead(repoFull: string, p: Viewer) {
    const r = this.repos.get(repoFull)
    return !!r && this.canRead(r, p)
  }

  /** Every searchable thing, for building the search index. */
  *searchDocs(): Iterable<SearchDoc> {
    for (const r of this.repos.values()) {
      const full = `${r.owner}/${r.name}`
      yield {
        key: `repo:${r.id}`,
        type: 'repo',
        id: r.id,
        repo: full,
        number: null,
        title: full,
        text: r.description,
        state: r.visibility,
        author: r.owner,
        labels: [],
        updated: r.updated,
        url: this.repoUrl(r),
      }
      for (const c of r.changes.values())
        yield {
          key: `change:${c.id}`,
          type: 'change',
          id: c.id,
          repo: full,
          number: c.number,
          title: c.title,
          text: c.description,
          state: c.state,
          author: c.author.handle,
          labels: c.labels,
          updated: c.updated,
          url: `${this.repoUrl(r)}/changes/${c.number}`,
        }
      for (const i of r.issues.values())
        yield {
          key: `issue:${i.id}`,
          type: 'issue',
          id: i.id,
          repo: full,
          number: i.number,
          title: i.title,
          text: i.body,
          state: i.state,
          author: i.author.handle,
          labels: i.labels,
          updated: i.updated,
          url: `${this.repoUrl(r)}/issues/${i.number}`,
        }
    }
  }

  protected orgFor(
    handle: string,
    p: Principal,
    need: 'member' | 'admin',
  ): AccountRec {
    const acct = this.accounts.get(handle)
    if (!acct || acct.kind !== 'organization')
      throw apiError('not_found', `No organization ${handle}.`)
    const role = acct.members.get(p.handle)
    if (!role) throw apiError('not_found', `No organization ${handle}.`)
    if (need === 'admin' && role !== 'owner' && role !== 'admin')
      throw apiError(
        'forbidden',
        `Only an owner or admin of ${handle} can change its teams.`,
        {
          hint: 'GET /v1/accounts shows your role in each account.',
        },
      )
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot read or change teams.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    return acct
  }

  /** Who may rename, hide or delete a repository: the owner of its account, or an admin of the organization. */
  protected assertAdmin(repo: RepoRec, p: Principal) {
    const acct = this.accounts.get(repo.owner)
    const role = repo.owner === p.handle ? 'owner' : acct?.members.get(p.handle)
    if (role !== 'owner' && role !== 'admin')
      throw apiError(
        'forbidden',
        `Only an owner or admin of ${repo.owner} can do this.`,
        {
          hint: 'GET /v1/accounts shows your role in each account.',
        },
      )
  }

  protected hasRepoGrant(repo: RepoRec, p: Viewer) {
    if (!p) return false
    const full = `${repo.owner}/${repo.name}`.toLowerCase()
    if (p.repos && !p.repos.includes(full)) return false
    return this.hasAccess(repo, p) || this.teamLevel(repo, p.handle) !== null
  }

  /** Read access that requires a real relationship, not public visibility. */
  async repoAccessStrict(
    owner: string,
    name: string,
    p: Viewer,
    need: 'read' | 'write' = 'read',
  ) {
    const r = this.resolve(owner, name, p, need)
    if (!this.hasRepoGrant(r, p))
      throw apiError('not_found', `No repository ${owner}/${name}.`, {
        hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
      })
    return `${r.owner}/${r.name}`
  }

  /** Checks the caller may read or write a repository, and names it `owner/name`. */
  async repoAccess(
    owner: string,
    name: string,
    p: Viewer,
    need: 'read' | 'write',
  ) {
    const r = this.resolve(owner, name, p, need)
    return `${r.owner}/${r.name}`
  }

  async canActAs(login: string, account: string) {
    return this.isMember(account, login)
  }

  /** Whether the caller may read the repository with this stable id. */
  mayReadId(id: string | null, p: Viewer) {
    if (!id) return false
    const r = this.reposById.get(id)
    return r ? this.canRead(r, p) : false
  }

  /** Public entry for operations that keep their own versioned records. */
  assertVersion(
    ifMatch: string | null,
    version: string,
    current: () => unknown,
  ) {
    this.assertMatch(ifMatch, version, current)
  }

  /** `If-Match` carries the ETag the client read: `W/"<version>"`. */
  protected assertMatch(
    ifMatch: string | null,
    version: string,
    current: () => unknown,
  ) {
    if (ifMatch === null) return
    const tags = ifMatch
      .split(',')
      .map((t) => t.trim().replace(/^W\//, '').replace(/"/g, ''))
    if (
      tags.includes('*') ||
      tags.some(
        (t) =>
          t === version ||
          t.startsWith(`${version}-`) ||
          t.startsWith(`${version}.`),
      )
    )
      return
    throw apiError(
      'version_mismatch',
      'The object changed since you read it.',
      {
        extra: { current: current() },
      },
    )
  }

  /** A predicate for the repositories `p` can read. Null repo means an account-level event. */
  canSee(p: Viewer) {
    return this.readableRepos(p)
  }

  protected administered(full: string, p: Viewer): boolean {
    if (!p) return false
    if (p.repos && !p.repos.includes(full.toLowerCase())) return false
    const owner = this.deleted.get(full)
    if (!owner) return false
    const role =
      owner === p.handle
        ? 'owner'
        : this.accounts.get(owner)?.members.get(p.handle)
    return role === 'owner' || role === 'admin'
  }

  protected readableRepos(p: Viewer) {
    const cache = new Map<string, boolean>()
    return (full: string | null) => {
      if (!full) return !!p
      let ok = cache.get(full)
      if (ok === undefined) {
        const r = this.repos.get(full)
        // The history of a deleted repository stays readable by those who administered it.
        ok = r ? this.canRead(r, p) : this.administered(full, p)
        cache.set(full, ok)
      }
      return ok
    }
  }

  protected readableRepoIds(p: Viewer) {
    const cache = new Map<string, boolean>()
    return (id: string | null) => {
      if (!id) return !!p
      let ok = cache.get(id)
      if (ok === undefined) {
        const r = this.reposById.get(id)
        if (r) ok = this.canRead(r, p)
        else {
          // The history of a deleted repository stays readable by those who administered it.
          const d = this.deletedRepos.get(id)
          ok = d ? this.administered(d.full, p) : false
        }
        cache.set(id, ok)
      }
      return ok
    }
  }

  canSeeId(p: Viewer) {
    return this.readableRepoIds(p)
  }
}
