import { createHash } from 'node:crypto'
import { apiError } from '../problem'
import { integrations } from '../integrations'
import type { AccountRec, Viewer } from './records'
import { DomainPolicy } from './policy'

export type ConnectionRec = {
  id: string
  /** The last four characters of a key, to recognise it by. Never the key. */
  hint: string | null
  /** A hash of the key, to tell a new one from the same one. */
  keyHash: string | null
  by: string
  connected: number
}

/**
 * Services connected to an account, and which of them each repository uses.
 * A repository can only use what its owner has connected; disconnecting turns
 * it off everywhere. Keys are kept as a hash and a hint, never shown again.
 */
export abstract class DomainIntegrations extends DomainPolicy {
  readonly connections = new Map<string, Map<string, ConnectionRec>>()
  readonly repoIntegrations = new Map<string, Set<string>>()
  integrationRev = 0

  private known(id: string) {
    const i = integrations.find((x) => x.id === id)
    if (!i) throw apiError('not_found', `No integration ${id}.`)
    return i
  }

  /** The account, if the viewer may manage its connections. */
  private managedAccount(handle: string, p: Viewer): AccountRec {
    const a = this.accounts.get(handle)
    if (!a || !p) throw apiError('not_found', `No account ${handle}.`)
    const mine =
      a.kind === 'person'
        ? a.handle === p.handle
        : ['owner', 'admin'].includes(a.members.get(p.handle) ?? '')
    if (!mine)
      throw apiError(
        a.kind === 'person' ? 'not_found' : 'forbidden',
        a.kind === 'person'
          ? `No account ${handle}.`
          : 'Only owners and admins connect services for an organization.',
      )
    return a
  }

  private presentConnection(handle: string, c: ConnectionRec) {
    return {
      object: 'integration_connection' as const,
      integration: c.id,
      account: handle,
      key_hint: c.hint,
      connected_by: c.by,
      connected_at: new Date(c.connected).toISOString(),
    }
  }

  seedConnection(handle: string, id: string, by: string, at: number) {
    const m = this.connections.get(handle) ?? new Map()
    m.set(id, { id, hint: null, keyHash: null, by, connected: at })
    this.connections.set(handle, m)
  }

  async listConnections(handle: string, p: Viewer) {
    this.managedAccount(handle, p)
    return [...(this.connections.get(handle)?.values() ?? [])].map((c) =>
      this.presentConnection(handle, c),
    )
  }

  async connectionsVersion(handle: string, p: Viewer) {
    this.managedAccount(handle, p)
    return `${handle}.int${this.integrationRev}`
  }

  async connect(
    handle: string,
    id: string,
    p: Viewer,
    body: { key?: string },
    dry: boolean,
  ) {
    this.managedAccount(handle, p)
    const i = this.known(id)
    if (i.status !== 'available')
      throw apiError('invalid_state', `${id} cannot be connected yet.`)
    if (i.credential && !body.key)
      throw apiError('invalid_request', `${id} needs a key.`, {
        errors: [
          {
            pointer: '/body/key',
            code: 'required',
            message: `${id} connects with a key.`,
          },
        ],
      })
    const have = this.connections.get(handle)?.get(id)
    const keyHash = body.key
      ? createHash('sha256').update(body.key).digest('hex')
      : null
    if (have && have.keyHash === keyHash)
      return {
        connection: this.presentConnection(handle, have),
        created: false,
      }
    const c: ConnectionRec = {
      id,
      hint: body.key ? body.key.slice(-4) : null,
      keyHash,
      by: p!.handle,
      connected: this.now(),
    }
    if (!dry) {
      const m = this.connections.get(handle) ?? new Map()
      m.set(id, c)
      this.connections.set(handle, m)
      this.integrationRev++
    }
    return { connection: this.presentConnection(handle, c), created: !have }
  }

  async disconnect(handle: string, id: string, p: Viewer, dry: boolean) {
    this.managedAccount(handle, p)
    this.known(id)
    if (dry || !this.connections.get(handle)?.has(id)) return
    this.connections.get(handle)!.delete(id)
    for (const [full, set] of this.repoIntegrations)
      if (full.split('/')[0] === handle) set.delete(id)
    this.integrationRev++
  }

  protected override onRepoMoved(from: string, to: string) {
    super.onRepoMoved(from, to)
    const set = this.repoIntegrations.get(from)
    this.repoIntegrations.delete(from)
    // Services belong to the account, so they stay with the one it left.
    if (set && from.split('/')[0] === to.split('/')[0])
      this.repoIntegrations.set(to, set)
    this.integrationRev++
  }

  async listRepoIntegrations(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const full = `${repo.owner}/${repo.name}`
    const on = this.repoIntegrations.get(full) ?? new Set()
    return [...(this.connections.get(repo.owner)?.values() ?? [])].map((c) => ({
      object: 'repo_integration' as const,
      integration: c.id,
      enabled: on.has(c.id),
    }))
  }

  async repoIntegrationsVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return `${repo.id}.int${this.integrationRev}.${this.accessRevision}`
  }

  async setRepoIntegration(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    on: boolean,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.known(id)
    if (on && !this.connections.get(repo.owner)?.has(id))
      throw apiError(
        'invalid_state',
        `${id} is not connected to ${repo.owner}. Connect it there first.`,
      )
    const full = `${repo.owner}/${repo.name}`
    if (!dry) {
      const set = this.repoIntegrations.get(full) ?? new Set()
      if (on) set.add(id)
      else set.delete(id)
      this.repoIntegrations.set(full, set)
      this.integrationRev++
    }
    return { object: 'repo_integration' as const, integration: id, enabled: on }
  }
}
