import { apiError } from '../problem'
import type { Principal } from '../auth'
import type { Viewer } from './records'
import { DomainAutomations } from './automations'

type Host = 'github' | 'gitlab' | 'codeberg' | 'gitea'

export type LinkRec = {
  host: Host
  login: string
  /** For a self-hosted Gitea: its address. */
  instance: string | null
  linked: number
}

/**
 * Bringing work from another host. An import is a repository here that
 * remembers where it came from and pulls from it through a mirror. A linked
 * account says who someone is on another host; it is recorded as they say
 * it and marked unverified until signing in with that host is built.
 */
export abstract class DomainImports extends DomainAutomations {
  readonly links = new Map<string, Array<LinkRec>>()
  linkRev = 0

  private self(handle: string, p: Viewer) {
    if (
      !p ||
      p.handle !== handle ||
      this.accounts.get(handle)?.kind !== 'person'
    )
      throw apiError('not_found', `No account ${handle}.`)
  }

  private presentLink(handle: string, l: LinkRec) {
    return {
      object: 'linked_account' as const,
      account: handle,
      host: l.host,
      login: l.login,
      instance: l.instance,
      verified: false,
      linked_at: new Date(l.linked).toISOString(),
    }
  }

  seedLink(handle: string, l: LinkRec) {
    this.links.set(handle, [...(this.links.get(handle) ?? []), l])
  }

  async listLinks(handle: string, p: Viewer) {
    this.self(handle, p)
    return (this.links.get(handle) ?? []).map((l) =>
      this.presentLink(handle, l),
    )
  }

  async linkAccount(
    handle: string,
    host: Host,
    p: Viewer,
    body: { login: string; instance?: string },
  ) {
    this.self(handle, p)
    if (host === 'gitea' && !body.instance)
      throw apiError('invalid_request', 'A Gitea account needs its address.', {
        errors: [
          {
            pointer: '/body/instance',
            code: 'required',
            message: 'Gitea runs on your own server: say where.',
          },
        ],
      })
    const list = (this.links.get(handle) ?? []).filter((l) => l.host !== host)
    const l: LinkRec = {
      host,
      login: body.login,
      instance: body.instance ?? null,
      linked: this.now(),
    }
    this.links.set(handle, [...list, l])
    this.linkRev++
    return this.presentLink(handle, l)
  }

  async unlinkAccount(handle: string, host: Host, p: Viewer) {
    this.self(handle, p)
    this.links.set(
      handle,
      (this.links.get(handle) ?? []).filter((l) => l.host !== host),
    )
    this.linkRev++
  }

  async importRepo(
    p: Principal,
    body: {
      host: Host
      slug: string
      owner?: string
      name?: string
      visibility: 'public' | 'private'
    },
    dry: boolean,
  ) {
    const name = body.name ?? body.slug.split('/').pop()!
    const made = await this.createRepo(
      p,
      {
        owner: body.owner,
        name,
        visibility: body.visibility,
        description: `Imported from ${body.host}:${body.slug}`,
      },
      dry,
    )
    if (dry) return made
    const full = `${made.repo.owner}/${made.repo.name}`
    const rec = this.repos.get(full)!
    if (made.created || !rec.upstream) {
      rec.upstream = { host: body.host, slug: body.slug }
      const x = this.memExtras.for(full)
      if (!x.mirrors.some((m) => m.host === body.host && m.slug === body.slug))
        x.mirrors.push({
          id: `mir_${this.now().toString(36)}${x.mirrors.length}`
            .padEnd(22, '0')
            .slice(0, 22),
          host: body.host,
          slug: body.slug,
          direction: 'pull',
          state: 'syncing',
          lastSync: this.now(),
          detail: 'Waiting for the first fetch.',
          created: this.now(),
        })
      rec.version++
    }
    return { repo: this.presentRepo(rec), created: made.created }
  }

  /** What the person imported: repositories they manage that came from another host. */
  async listImports(p: Viewer) {
    if (!p) throw apiError('unauthenticated', 'Sign in to see your imports.')
    const out = []
    for (const r of this.repos.values()) {
      if (!r.upstream || !this.canWrite(r, p)) continue
      const full = `${r.owner}/${r.name}`
      const m = this.memExtras
        .for(full)
        .mirrors.find(
          (x) => x.host === r.upstream!.host && x.slug === r.upstream!.slug,
        )
      out.push({
        object: 'import' as const,
        repo: full,
        host: r.upstream.host,
        slug: r.upstream.slug,
        state: m?.state ?? ('in-sync' as const),
        created_at: new Date(r.created).toISOString(),
      })
    }
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }
}
