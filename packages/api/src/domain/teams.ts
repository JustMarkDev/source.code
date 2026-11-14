import { newId } from '../ids'
import { apiError } from '../problem'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import { iso } from './records'
import type { TeamRec } from './records'
import { DomainRepos } from './repos'

/** Teams and their access to repositories. */
export abstract class DomainTeams extends DomainRepos {
  protected teamRec(org: string, slug: string): TeamRec {
    const t = this.teams.get(`${org}/${slug}`)
    if (!t) throw apiError('not_found', `No team ${slug} in ${org}.`)
    return t
  }

  presentTeam(t: TeamRec): z.infer<typeof S.Team> {
    return {
      object: 'team',
      id: t.id,
      org: t.org,
      slug: t.slug,
      name: t.name,
      description: t.description,
      members: [...t.members].sort(),
      repos: [...t.repos]
        .map(([full_name, permission]) => ({ full_name, permission }))
        .sort((a, b) => (a.full_name < b.full_name ? -1 : 1)),
      url: `${this.urls.api}/accounts/${t.org}/teams/${t.slug}`,
      created_at: iso(t.created),
      updated_at: iso(t.updated),
      version: t.version,
    }
  }

  async listTeams(org: string, p: Principal) {
    this.orgFor(org, p, 'member')
    return [...this.teams.values()]
      .filter((t) => t.org === org)
      .sort((a, b) => (a.slug < b.slug ? -1 : 1))
      .map((t) => this.presentTeam(t))
  }

  async getTeam(org: string, slug: string, p: Principal) {
    this.orgFor(org, p, 'member')
    return this.presentTeam(this.teamRec(org, slug))
  }

  async teamVersion(org: string, slug: string, p: Principal) {
    this.orgFor(org, p, 'member')
    const t = this.teamRec(org, slug)
    return `${t.id}.${t.version}`
  }

  async createTeam(
    org: string,
    p: Principal,
    input: { slug: string; name?: string; description?: string },
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const key = `${org}/${input.slug}`
    const existing = this.teams.get(key)
    if (existing) return { team: this.presentTeam(existing), created: false }
    const t: TeamRec = {
      id: newId('team', this.now()),
      org,
      slug: input.slug,
      name: input.name ?? input.slug,
      description: input.description ?? '',
      members: new Set(),
      repos: new Map(),
      created: this.now(),
      updated: this.now(),
      version: 1,
    }
    if (!dry) this.teams.set(key, t)
    return { team: this.presentTeam(t), created: true }
  }

  async updateTeam(
    org: string,
    slug: string,
    p: Principal,
    body: { name?: string; description?: string },
    ifMatch: string | null,
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    this.assertMatch(ifMatch, `${t.id}.${t.version}`, () => this.presentTeam(t))
    const same =
      (body.name === undefined || body.name === t.name) &&
      (body.description === undefined || body.description === t.description)
    if (same) return this.presentTeam(t)
    if (!dry) {
      if (body.name !== undefined) t.name = body.name
      if (body.description !== undefined) t.description = body.description
      t.updated = this.now()
      t.version++
    }
    const shown = dry
      ? {
          ...t,
          name: body.name ?? t.name,
          description: body.description ?? t.description,
        }
      : t
    return this.presentTeam(shown)
  }

  async deleteTeam(org: string, slug: string, p: Principal, dry: boolean) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    if (dry) return
    for (const m of t.members) this.unindexMember(m, `${org}/${slug}`)
    this.teams.delete(`${org}/${slug}`)
    this.accessRevision++
    this.svc.search.reset()
  }

  protected unindexMember(handle: string, key: string) {
    const set = this.teamsOf.get(handle)
    set?.delete(key)
    if (set?.size === 0) this.teamsOf.delete(handle)
  }

  async setTeamMember(
    org: string,
    slug: string,
    login: string,
    p: Principal,
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const person = this.accounts.get(login)
    if (!person || person.kind !== 'person')
      throw apiError('not_found', `No person ${login}.`)
    if (t.members.size >= 500 && !t.members.has(login))
      throw apiError('limit_reached', 'A team can have 500 members.')
    if (dry)
      return this.presentTeam({ ...t, members: new Set([...t.members, login]) })
    if (!t.members.has(login)) {
      t.members.add(login)
      let set = this.teamsOf.get(login)
      if (!set) this.teamsOf.set(login, (set = new Set()))
      set.add(`${org}/${slug}`)
      t.updated = this.now()
      t.version++
      this.accessRevision++
      this.svc.search.reset()
    }
    return this.presentTeam(t)
  }

  async removeTeamMember(
    org: string,
    slug: string,
    login: string,
    p: Principal,
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    if (!t.members.has(login))
      throw apiError('not_found', `${login} is not in ${slug}.`)
    if (dry) return
    t.members.delete(login)
    this.unindexMember(login, `${org}/${slug}`)
    t.updated = this.now()
    t.version++
    this.accessRevision++
    this.svc.search.reset()
  }

  async setTeamRepo(
    org: string,
    slug: string,
    owner: string,
    name: string,
    permission: 'read' | 'write',
    p: Principal,
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const repo = this.resolve(owner, name, p, 'read')
    // A team belongs to an organization and reaches only that organization's repositories.
    if (repo.owner !== org)
      throw apiError(
        'invalid_request',
        `${repo.owner}/${repo.name} is not in ${org}.`,
        {
          hint: 'A team can only be given repositories of its own organization.',
        },
      )
    if (t.repos.get(`${repo.owner}/${repo.name}`) === permission)
      return this.presentTeam(t)
    if (!dry) {
      t.repos.set(`${repo.owner}/${repo.name}`, permission)
      t.updated = this.now()
      t.version++
      this.accessRevision++
      // Visibility changed, so cached search results may be stale.
      this.svc.search.reset()
    }
    if (dry)
      return this.presentTeam({
        ...t,
        repos: new Map(t.repos).set(`${repo.owner}/${repo.name}`, permission),
      })
    return this.presentTeam(t)
  }

  async removeTeamRepo(
    org: string,
    slug: string,
    owner: string,
    name: string,
    p: Principal,
    dry: boolean,
  ) {
    this.orgFor(org, p, 'admin')
    const t = this.teamRec(org, slug)
    const repo = this.resolve(owner, name, p, 'read')
    const full = `${repo.owner}/${repo.name}`
    if (!t.repos.has(full))
      throw apiError('not_found', `${slug} has no access to ${full}.`)
    if (dry) return
    t.repos.delete(full)
    t.updated = this.now()
    t.version++
    this.accessRevision++
    this.svc.search.reset()
  }
}
