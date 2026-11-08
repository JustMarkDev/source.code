import { newId } from '../ids'
import { pageSorted } from '../cursor'
import { apiError } from '../problem'
import type { CursorPosition, Page } from '../cursor'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import { recId } from './records'
import type { ChangeRec, IssueRec, RepoRec, Viewer } from './records'
import { DomainEvents } from './events'

/** Accounts and repositories. */
export abstract class DomainRepos extends DomainEvents {
  async createRepo(
    p: Principal,
    input: {
      owner?: string
      name: string
      description?: string
      visibility: 'public' | 'private'
      maintainers?: Array<string>
    },
    dry: boolean,
  ) {
    const owner = input.owner ?? p.actingAs
    const acct = this.accounts.get(owner)
    if (!acct) throw apiError('not_found', `No account ${owner}.`)
    const role = owner === p.handle ? 'owner' : acct.members.get(p.handle)
    if (!role) throw apiError('not_found', `No account ${owner}.`)
    if (role === 'member')
      throw apiError(
        'forbidden',
        `Members of ${owner} cannot create repositories there.`,
        {
          hint: 'Ask an owner or admin, or create it in an account you manage. GET /v1/accounts shows your role in each.',
        },
      )
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot create new ones.',
      )
    const maintainers = new Set(input.maintainers ?? [])
    if (input.maintainers) {
      if (input.maintainers.length === 0)
        throw apiError(
          'invalid_request',
          'A repository needs at least one maintainer.',
          {
            errors: [
              {
                pointer: '/body/maintainers',
                code: 'empty',
                message: 'Name at least one person.',
              },
            ],
          },
        )
      for (const h of input.maintainers)
        if (this.accounts.get(h)?.kind !== 'person')
          throw apiError('invalid_request', `${h} is not a person.`, {
            errors: [
              {
                pointer: '/body/maintainers',
                code: 'not_a_person',
                message: `${h} is not a person.`,
              },
            ],
          })
    } else {
      if (acct.kind === 'person') maintainers.add(acct.handle)
      for (const [h, r] of acct.members)
        if (
          (r === 'owner' || r === 'admin') &&
          this.accounts.get(h)?.kind === 'person'
        )
          maintainers.add(h)
      if (this.accounts.get(p.handle)?.kind === 'person')
        maintainers.add(p.handle)
    }
    if (maintainers.size === 0)
      throw apiError(
        'invalid_request',
        'A repository needs at least one maintainer.',
        {
          errors: [
            {
              pointer: '/body/maintainers',
              code: 'empty',
              message: 'Name at least one person.',
            },
          ],
        },
      )
    const existing =
      this.repos.get(`${owner}/${input.name}`) ??
      this.byLower(`${owner}/${input.name}`.toLowerCase())
    if (existing) return { repo: this.presentRepo(existing), created: false }
    if (dry)
      return {
        repo: this.presentRepo(
          this.makeRepo(owner, input.name, {
            description: input.description ?? '',
            visibility: input.visibility,
            created: this.now(),
            maintainers: [...maintainers],
            collaborators: [...maintainers],
          }),
        ),
        created: true,
      }
    const rec = this.seedRepo(owner, input.name, {
      id: newId('repo', this.now()),
      description: input.description ?? '',
      visibility: input.visibility,
      created: this.now(),
      maintainers: [...maintainers],
      collaborators: [...maintainers],
    })
    rec.maintainerGrants = new Set(maintainers)
    this.accessRevision++
    const lower = `${owner}/${input.name}`.toLowerCase()
    this.aliases.delete(lower)
    for (const [key, value] of this.aliases)
      if (value.toLowerCase() === lower) this.aliases.delete(key)
    this.svc.git.setRepo?.(`${owner}/${input.name}`, rec.storeId)
    this.svc.search.upsertIfBuilt({
      key: `repo:${rec.id}`,
      type: 'repo',
      id: rec.id,
      repo: `${owner}/${input.name}`,
      number: null,
      title: `${owner}/${input.name}`,
      text: rec.description,
      state: rec.visibility,
      author: owner,
      labels: [],
      updated: rec.updated,
      url: this.repoUrl(rec),
    })
    return { repo: this.presentRepo(rec), created: true }
  }

  async updateRepo(
    owner: string,
    name: string,
    p: Principal,
    body: {
      name?: string
      description?: string
      visibility?: 'public' | 'private'
      default_branch?: string
      maintainers?: Array<string>
    },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.assertAdmin(repo, p)
    this.assertMatch(ifMatch, `${repo.id}.${repo.version}`, () =>
      this.presentRepo(repo),
    )
    const renaming = body.name !== undefined && body.name !== repo.name
    if (renaming && p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot rename one.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    if (renaming) {
      const target = `${repo.owner}/${body.name}`
      const taken = this.repos.get(target) ?? this.byLower(target.toLowerCase())
      if (taken && taken !== repo)
        throw apiError('invalid_state', `${target} already exists.`, {
          hint: 'Pick another name, or delete the repository that has it.',
        })
    }
    const nextMaintainers =
      body.maintainers !== undefined
        ? [...new Set(body.maintainers)].sort()
        : undefined
    const maintainersChanged =
      nextMaintainers !== undefined &&
      JSON.stringify([...repo.maintainers].sort()) !==
        JSON.stringify(nextMaintainers)
    if (maintainersChanged && p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot change maintainers.',
        {
          hint: 'Use a token that is not limited to repositories.',
        },
      )
    if (body.maintainers !== undefined) {
      if (body.maintainers.length === 0)
        throw apiError(
          'invalid_request',
          'A repository needs at least one maintainer.',
          {
            errors: [
              {
                pointer: '/body/maintainers',
                code: 'empty',
                message: 'Name at least one person.',
              },
            ],
          },
        )
      for (const h of body.maintainers)
        if (this.accounts.get(h)?.kind !== 'person')
          throw apiError('invalid_request', `${h} is not a person.`, {
            errors: [
              {
                pointer: '/body/maintainers',
                code: 'not_a_person',
                message: `${h} is not a person.`,
              },
            ],
          })
    }
    if (dry)
      return this.presentRepo({
        ...repo,
        name: body.name ?? repo.name,
        description: body.description ?? repo.description,
        visibility: body.visibility ?? repo.visibility,
        defaultBranch: body.default_branch ?? repo.defaultBranch,
        maintainers: nextMaintainers
          ? new Set(nextMaintainers)
          : repo.maintainers,
      })
    const from = `${repo.owner}/${repo.name}`
    const changed: Array<string> = []
    if (
      body.description !== undefined &&
      body.description !== repo.description
    ) {
      repo.description = body.description
      changed.push('description')
    }
    if (body.visibility !== undefined && body.visibility !== repo.visibility) {
      repo.visibility = body.visibility
      changed.push('visibility')
    }
    if (
      body.default_branch !== undefined &&
      body.default_branch !== repo.defaultBranch
    ) {
      repo.defaultBranch = body.default_branch
      changed.push('default_branch')
    }
    if (maintainersChanged) {
      const removed = [...repo.maintainers].filter(
        (h) => !nextMaintainers.includes(h),
      )
      for (const h of removed)
        if (repo.maintainerGrants.delete(h)) repo.collaborators.delete(h)
      for (const h of nextMaintainers)
        if (!repo.collaborators.has(h)) {
          repo.collaborators.add(h)
          repo.maintainerGrants.add(h)
        }
      repo.maintainers = new Set(nextMaintainers)
      for (const c of repo.changes.values()) c.policyMemo = undefined
      this.accessRevision++
      this.svc.search.reset()
      changed.push('maintainers')
    }
    if (renaming) {
      const to = `${repo.owner}/${body.name}`
      this.repos.delete(from)
      repo.name = body.name!
      this.repos.set(to, repo)
      this.svc.auth.renameRepo(from, to)
      this.svc.git.setRepo?.(to, repo.storeId)
      if (from.toLowerCase() !== to.toLowerCase()) this.svc.git.dropRepo?.(from)
      // The old address keeps working: it answers 308 with the new one. Any
      // alias that pointed at the old name follows the chain.
      for (const [key, value] of this.aliases)
        if (value === from || value.toLowerCase() === from.toLowerCase())
          this.aliases.set(key, to)
      this.aliases.set(from.toLowerCase(), to)
      this.aliases.delete(to.toLowerCase())
      this.svc.hooks.rename(from, to)
      this.svc.extras.rename(from, to)
      const runs = this.runsByRepo.get(from)
      if (runs) {
        this.runsByRepo.delete(from)
        this.runsByRepo.set(to, runs)
        for (const r of runs) r.repo = to
      }
      for (const t of this.teams.values())
        if (t.repos.has(from)) {
          t.repos.set(to, t.repos.get(from)!)
          t.repos.delete(from)
          t.updated = this.now()
          t.version++
        }
      changed.push('name')
    }
    if (changed.length) {
      repo.version++
      if (changed.includes('visibility') || changed.includes('name'))
        this.accessRevision++
      // Search keeps the repository's name, description and visibility in every document.
      if (
        renaming ||
        changed.includes('visibility') ||
        changed.includes('description')
      )
        this.svc.search.reset()
      this.emit(
        repo,
        'repo.updated',
        this.asActor(p),
        { object: 'repo', id: repo.id, number: null },
        changed,
        this.presentRepo(repo),
      )
    }
    return this.presentRepo(repo)
  }

  async deleteRepo(
    owner: string,
    name: string,
    p: Principal,
    confirm: string | undefined,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.assertAdmin(repo, p)
    const full = `${repo.owner}/${repo.name}`
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot delete one.',
      )
    if (confirm !== full)
      throw apiError(
        'invalid_request',
        `Deleting ${full} cannot be undone. Pass confirm=${full} to do it.`,
        {
          errors: [
            {
              pointer: '/query/confirm',
              code: 'confirmation_required',
              message: `Send confirm=${full}.`,
            },
          ],
          hint: 'Check you are deleting the right repository, then repeat the request with ?confirm=owner/name.',
        },
      )
    if (dry) return { deleted: false, full }
    // The event is written first, while the repository still exists to be named.
    this.emit(
      repo,
      'repo.deleted',
      this.asActor(p),
      { object: 'repo', id: repo.id, number: null },
      ['deleted'],
      null,
    )
    this.repos.delete(full)
    this.aliases.delete(full.toLowerCase())
    for (const [key, value] of this.aliases)
      if (value.toLowerCase() === full.toLowerCase()) this.aliases.delete(key)
    this.svc.auth.dropRepo(full)
    this.svc.uploads.dropRepo(repo.id)
    this.svc.git.dropRepo?.(full)
    this.deleted.set(full, repo.owner)
    this.deletedRepos.set(repo.id, { full, owner: repo.owner })
    this.deletedIds.set(full.toLowerCase(), repo.id)
    this.accessRevision++
    this.reposById.delete(repo.id)
    this.svc.hooks.dropRepo(full)
    this.svc.extras.drop(full)
    for (const t of this.teams.values())
      if (t.repos.delete(full)) {
        t.updated = this.now()
        t.version++
      }
    // Its runs end with it, and their tokens stop working.
    for (const r of this.runsByRepo.get(full) ?? []) {
      if (r.state === 'running') this.svc.auth.revoke(r.tokenId)
      this.runs.delete(r.id)
    }
    this.runsByRepo.delete(full)
    this.svc.search.reset()
    return { deleted: true, full }
  }

  async listAccounts(p: Principal): Promise<Array<z.infer<typeof S.Account>>> {
    const out: Array<z.infer<typeof S.Account>> = []
    for (const a of this.accounts.values())
      if (a.handle === p.handle || a.members.has(p.handle))
        out.push(this.presentAccount(a, p))
    return out
  }

  async getAccount(handle: string, p: Viewer) {
    const a = this.accounts.get(handle)
    if (!a) throw apiError('not_found', `No account ${handle}.`)
    return this.presentAccount(a, p)
  }

  async accountVersion(handle: string) {
    const a = this.accounts.get(handle)
    return a ? `${a.id}.${this.accessRevision}` : null
  }

  async listRepos(
    p: Viewer,
    q: { owner?: string; after: CursorPosition | null; limit: number },
  ): Promise<Page<z.infer<typeof S.Repo>>> {
    const all = [...this.repos.values()]
      .filter((r) => this.canRead(r, p) && (!q.owner || r.owner === q.owner))
      .sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1))
    const page = pageSorted(all, (r) => r.created, recId, {
      limit: q.limit,
      after: q.after,
      desc: true,
      stored: 'desc',
    })
    return {
      items: page.items.map((r) => this.presentRepo(r)),
      next: page.next,
    }
  }

  async getRepo(owner: string, name: string, p: Viewer) {
    return this.presentRepo(this.resolve(owner, name, p))
  }

  async repoVersion(owner: string, name: string, p: Viewer) {
    return this.repoKey(this.resolve(owner, name, p))
  }

  async changeListVersion(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p)
    return `${r.id}.${r.changeRev}.${r.version}.${this.accessRevision}`
  }

  async issueListVersion(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p)
    return `${r.id}.${r.issueRev}.${r.version}.${this.accessRevision}`
  }

  protected repoKey(r: RepoRec) {
    return `${r.id}.${r.version}.${r.rev}.${r.changes.size}.${r.issues.size}.${this.accessRevision}`
  }

  /** The repository id behind an address, after checking the caller may read it. */
  async repoIdOf(owner: string, name: string, p: Viewer) {
    return this.resolve(owner, name, p).id
  }

  /** Marks a repository's derived state (env metadata, say) as changed without an event. */
  async bumpRepo(owner: string, name: string, p: Viewer) {
    const r = this.resolve(owner, name, p, 'write')
    r.updated = this.now()
    r.version++
  }

  async numberRef(owner: string, name: string, n: number, p: Viewer) {
    const r = this.resolve(owner, name, p)
    const type: 'change' | 'issue' | null = r.changes.has(n)
      ? 'change'
      : r.issues.has(n)
        ? 'issue'
        : null
    if (!type)
      throw apiError('not_found', `Nothing numbered #${n} in ${owner}/${name}.`)
    return {
      object: 'number_ref' as const,
      number: n,
      type,
      url: `${this.repoUrl(r)}/${type === 'change' ? 'changes' : 'issues'}/${n}`,
    }
  }

  async context(
    owner: string,
    name: string,
    p: Viewer,
  ): Promise<z.infer<typeof S.Context>> {
    const r = this.resolve(owner, name, p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const open: Array<ChangeRec> = []
    if (canPull)
      for (
        let k = r.byUpdated.items.length - 1;
        k >= 0 && open.length < 50;
        k--
      ) {
        const c = r.byUpdated.items[k]
        if (c.state === 'open' || c.state === 'draft') open.push(c)
      }
    const issues: Array<IssueRec> = []
    if (canIssue)
      for (
        let k = r.issuesByNumber.items.length - 1;
        k >= 0 && issues.length < 50;
        k--
      ) {
        const i = r.issuesByNumber.items[k]
        if (i.state === 'open') issues.push(i)
      }
    return {
      object: 'context',
      repo: this.presentRepo(r),
      changes: open.slice(0, 50).map((c) => {
        const reqs = this.evaluate(r, c)
        return {
          number: c.number,
          title: c.title,
          state: c.state,
          author: this.actor(c.author),
          checks: this.checksFor(c).state,
          policy: this.policyState(reqs),
          blocking: reqs
            .filter((q) => q.state === 'fail' || q.state === 'pending')
            .map((q) => `${q.id}:${q.state}`),
        }
      }),
      issues: issues.slice(0, 50).map((i) => ({
        number: i.number,
        title: i.title,
        labels: i.labels,
      })),
      policy: { rules: 4, mode: 'enforce' },
      env:
        p?.scopes.has('secrets:schema') && this.hasRepoGrant(r, p)
          ? this.svc.extras.for(`${r.owner}/${r.name}`).env.map((v) => ({
              name: v.name,
              kind: v.kind,
              set: [...v.set],
            }))
          : [],
      cursor: `e_${r.id}_${this.events.head}`,
    }
  }
}
