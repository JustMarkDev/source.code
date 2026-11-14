import { RESERVED_HANDLES, isValidHandle } from '../handles'
import { hashToken } from '../auth'
import { newId, randomSource, seededId } from '../ids'
import { apiError } from '../problem'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import type { AccountRec, InviteRec, Role, Viewer } from './records'
import { DomainEvents } from './events'

const MAX_MEMBERS = 5_000
const MAX_INVITES = 500
const INVITE_TTL = 7 * 86_400_000

/**
 * Editing an account, creating an organization, and who belongs to one.
 *
 * People and organizations share one namespace. A person comes from sign-in
 * (`knowPerson`); an organization is created here by the person who becomes
 * its first owner. An organization always has at least one owner.
 */
export abstract class DomainAccounts extends DomainEvents {
  /**
   * A person signed in. Called by the server once it knows who they are,
   * never by an operation, so it checks nothing: the caller already did.
   */
  async knowPerson(handle: string, name: string) {
    const known = this.accounts.get(handle)
    if (!known) {
      this.seedAccount(handle, name, 'person')
      return
    }
    if (known.kind === 'person' && known.name !== name) {
      known.name = name
      known.updated = this.now()
      known.version++
    }
  }

  /** The account, when the caller may change it. A token limited to repositories may not. */
  private editable(handle: string, p: Principal): AccountRec {
    const a = this.accounts.get(handle)
    if (!a) throw apiError('not_found', `No account ${handle}.`)
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot change an account.',
        { hint: 'Use a token that is not limited to repositories.' },
      )
    if (a.kind === 'person') {
      if (a.handle !== p.handle)
        throw apiError('forbidden', 'Only the person can change their account.')
      return a
    }
    const role = a.members.get(p.handle)
    // Not a member: the organization's members are not theirs to know.
    if (!role) throw apiError('not_found', `No account ${handle}.`)
    if (role === 'member')
      throw apiError(
        'forbidden',
        `Only an owner or admin of ${handle} can change it.`,
        { hint: 'GET /v1/accounts shows your role in each account.' },
      )
    return a
  }

  /** The organization, when the caller belongs to it. Everyone else gets 404. */
  private memberOf(handle: string, p: Principal): AccountRec {
    const a = this.accounts.get(handle)
    if (!a || a.kind !== 'organization' || !a.members.has(p.handle))
      throw apiError('not_found', `No organization ${handle}.`)
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot read or change members.',
        { hint: 'Use a token that is not limited to repositories.' },
      )
    return a
  }

  private touch(a: AccountRec) {
    a.updated = this.now()
    a.version++
  }

  async updateAccount(
    handle: string,
    p: Principal,
    body: { name?: string; bio?: string },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const a = this.editable(handle, p)
    this.assertMatch(ifMatch, `${a.id}.${a.version}`, () =>
      this.presentAccount(a, p),
    )
    const next = { name: body.name ?? a.name, bio: body.bio ?? a.bio }
    if (next.name === a.name && next.bio === a.bio)
      return this.presentAccount(a, p)
    if (dry) return this.presentAccount({ ...a, ...next }, p)
    a.name = next.name
    a.bio = next.bio
    this.touch(a)
    // The name is searchable and shown on repositories.
    this.svc.search.reset()
    return this.presentAccount(a, p)
  }

  /**
   * Create an organization owned by the caller. Repeat-safe: asking for one
   * the caller already owns returns it unchanged.
   */
  async createOrganization(
    p: Principal,
    input: { handle: string; name?: string; bio?: string },
    dry: boolean,
  ) {
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot create an organization.',
        { hint: 'Use a token that is not limited to repositories.' },
      )
    if (p.class !== 'human')
      throw apiError(
        'human_required',
        'Only a person can create an organization.',
      )
    const existing = this.accounts.get(input.handle)
    if (existing) {
      if (
        existing.kind === 'organization' &&
        existing.members.get(p.handle) === 'owner'
      )
        return { account: this.presentAccount(existing, p), created: false }
      throw apiError('invalid_state', `${input.handle} is already taken.`, {
        hint: 'Choose another handle.',
      })
    }
    if (!isValidHandle(input.handle) || RESERVED_HANDLES.has(input.handle))
      throw apiError('invalid_state', `${input.handle} is already taken.`, {
        hint: 'Choose another handle.',
      })
    const at = this.now()
    const fields = { name: input.name ?? input.handle, bio: input.bio ?? '' }
    if (dry) {
      const preview: AccountRec = {
        id: seededId('account', at, input.handle),
        handle: input.handle,
        kind: 'organization',
        ...fields,
        created: at,
        updated: at,
        version: 1,
        members: new Map<string, Role>([[p.handle, 'owner']]),
        invites: new Map(),
      }
      return { account: this.presentAccount(preview, p), created: true }
    }
    const rec = this.seedAccount(
      input.handle,
      fields.name,
      'organization',
      [[p.handle, 'owner']],
      at,
    )
    rec.bio = fields.bio
    this.accessRevision++
    this.svc.search.reset()
    return { account: this.presentAccount(rec, p), created: true }
  }

  private presentMember(
    a: AccountRec,
    handle: string,
    role: Role,
  ): z.infer<typeof S.Member> {
    return {
      object: 'member',
      account: a.handle,
      handle,
      name: this.accounts.get(handle)?.name ?? handle,
      role,
      url: `${this.urls.api}/accounts/${a.handle}/members/${handle}`,
    }
  }

  /** An organization that exists. Who is in one is public, like the organization. */
  private organization(handle: string): AccountRec {
    const a = this.accounts.get(handle)
    if (!a || a.kind !== 'organization')
      throw apiError('not_found', `No organization ${handle}.`)
    return a
  }

  async listMembers(handle: string, _p: Viewer) {
    const a = this.organization(handle)
    return [...a.members]
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([login, role]) => this.presentMember(a, login, role))
  }

  async membersVersion(handle: string, _p: Viewer) {
    const a = this.organization(handle)
    return `${a.id}.${a.version}`
  }

  private owners(a: AccountRec) {
    let n = 0
    for (const role of a.members.values()) if (role === 'owner') n++
    return n
  }

  /**
   * Add a person or change their role. Admins manage members and admins;
   * only an owner makes or unmakes an owner. The last owner stays an owner.
   */
  async setMember(
    handle: string,
    login: string,
    role: Role,
    p: Principal,
    dry: boolean,
  ) {
    const a = this.editable(handle, p)
    if (a.kind !== 'organization')
      throw apiError('not_found', `No organization ${handle}.`)
    const person = this.accounts.get(login)
    if (!person || person.kind !== 'person')
      throw apiError('not_found', `No person ${login}.`)
    const mine = a.members.get(p.handle)
    const theirs = a.members.get(login)
    if ((role === 'owner' || theirs === 'owner') && mine !== 'owner')
      throw apiError(
        'forbidden',
        `Only an owner of ${handle} can make or change an owner.`,
      )
    if (theirs === role)
      return {
        member: this.presentMember(a, login, role),
        outcome: 'unchanged' as const,
      }
    if (theirs === 'owner' && this.owners(a) === 1)
      throw apiError(
        'invalid_state',
        `${login} is the only owner of ${handle}.`,
        { hint: 'Make someone else an owner first.' },
      )
    if (!theirs && a.members.size >= MAX_MEMBERS)
      throw apiError(
        'limit_reached',
        `An organization can have ${MAX_MEMBERS} members.`,
      )
    if (!dry) {
      a.members.set(login, role)
      this.touch(a)
      this.accessRevision++
    }
    return {
      member: this.presentMember(a, login, role),
      outcome: theirs ? ('updated' as const) : ('created' as const),
    }
  }

  /** Remove a person. Anyone may leave; removing someone else follows `setMember`'s rules. */
  async removeMember(
    handle: string,
    login: string,
    p: Principal,
    dry: boolean,
  ) {
    const a =
      login === p.handle ? this.memberOf(handle, p) : this.editable(handle, p)
    if (a.kind !== 'organization')
      throw apiError('not_found', `No organization ${handle}.`)
    const theirs = a.members.get(login)
    // Already gone: removing is repeat-safe.
    if (!theirs) return
    if (theirs === 'owner') {
      if (a.members.get(p.handle) !== 'owner')
        throw apiError(
          'forbidden',
          `Only an owner of ${handle} can remove an owner.`,
        )
      if (this.owners(a) === 1)
        throw apiError(
          'invalid_state',
          `${login} is the only owner of ${handle}.`,
          { hint: 'Make someone else an owner first.' },
        )
    }
    if (dry) return
    a.members.delete(login)
    // Their team memberships in this organization end with it.
    // Copied first: the loop removes from the set it reads.
    const theirTeams = Array.from(this.teamsOf.get(login) ?? [])
    for (const key of theirTeams) {
      if (!key.startsWith(`${handle}/`)) continue
      const team = this.teams.get(key)
      if (team?.members.delete(login)) {
        team.updated = this.now()
        team.version++
      }
      const set = this.teamsOf.get(login)
      set?.delete(key)
      if (set?.size === 0) this.teamsOf.delete(login)
    }
    this.touch(a)
    this.accessRevision++
  }

  // ---- invitations ---------------------------------------------------------

  private presentInvite(
    a: AccountRec,
    i: InviteRec,
  ): z.infer<typeof S.Invitation> {
    return {
      object: 'invitation',
      id: i.id,
      account: a.handle,
      email: i.email,
      role: i.role,
      invited_by: i.invitedBy,
      created_at: new Date(i.created).toISOString(),
      expires_at: new Date(i.expires).toISOString(),
      url: `${this.urls.api}/accounts/${a.handle}/invitations/${i.id}`,
    }
  }

  /** The organization, when the caller is an owner or admin of it. */
  private managed(handle: string, p: Principal): AccountRec {
    const a = this.editable(handle, p)
    if (a.kind !== 'organization')
      throw apiError('not_found', `No organization ${handle}.`)
    return a
  }

  private dropExpired(a: AccountRec) {
    const at = this.now()
    for (const [id, i] of a.invites) if (i.expires <= at) a.invites.delete(id)
  }

  async listInvitations(handle: string, p: Principal) {
    const a = this.managed(handle, p)
    this.dropExpired(a)
    return [...a.invites.values()]
      .sort((x, y) => y.created - x.created)
      .map((i) => this.presentInvite(a, i))
  }

  /**
   * Invite someone by email. They get a link; opening it signed in makes
   * them a member with this role. Until then they have no access. Inviting
   * the same email again sends a new link and ends the old one.
   */
  async invite(
    handle: string,
    p: Principal,
    input: { email: string; role: Role },
    dry: boolean,
  ) {
    const a = this.managed(handle, p)
    if (input.role === 'owner' && a.members.get(p.handle) !== 'owner')
      throw apiError(
        'forbidden',
        `Only an owner of ${handle} can invite an owner.`,
      )
    this.dropExpired(a)
    const email = input.email.trim().toLowerCase()
    const had = [...a.invites.values()].find((i) => i.email === email)
    if (!had && a.invites.size >= MAX_INVITES)
      throw apiError(
        'limit_reached',
        `An organization can have ${MAX_INVITES} invitations waiting.`,
        { hint: 'Revoke some, or wait for them to be accepted.' },
      )
    const at = this.now()
    const secret = `sxi_${Buffer.from(randomSource.bytes(24)).toString('base64url')}`
    const rec: InviteRec = {
      id: had?.id ?? newId('invitation', at),
      email,
      role: input.role,
      secretHash: hashToken(secret),
      invitedBy: p.handle,
      created: at,
      expires: at + INVITE_TTL,
    }
    if (!dry) {
      a.invites.set(rec.id, rec)
      this.touch(a)
      const by = this.accounts.get(p.handle)?.name ?? p.handle
      await this.svc.mail.send({
        to: email,
        subject: `${by} invited you to ${a.name} on source.code`,
        text: [
          `${by} invited you to join ${a.name} (source.code/${a.handle}) as ${
            input.role === 'member' ? 'a member' : `an ${input.role}`
          }.`,
          '',
          `Accept: ${this.urls.html}/organizations/join?token=${secret}`,
          '',
          'The link works for 7 days. If you do not want to join, ignore this email.',
        ].join('\n'),
      })
    }
    return {
      invitation: this.presentInvite(a, rec),
      outcome: had ? ('updated' as const) : ('created' as const),
    }
  }

  /** Revoke an invitation. Its link stops working. Repeat-safe. */
  async revokeInvitation(
    handle: string,
    id: string,
    p: Principal,
    dry: boolean,
  ) {
    const a = this.managed(handle, p)
    if (!a.invites.has(id) || dry) return
    a.invites.delete(id)
    this.touch(a)
  }

  /**
   * Accept an invitation with the secret from its link. Whoever holds the
   * link and is signed in as a person joins; the link then stops working.
   */
  async acceptInvitation(secret: string, p: Principal, dry: boolean) {
    if (p.class !== 'human')
      throw apiError('human_required', 'Only a person can join.')
    if (p.repos)
      throw apiError(
        'forbidden',
        'A token limited to repositories cannot join an organization.',
        { hint: 'Use a token that is not limited to repositories.' },
      )
    const hash = hashToken(secret)
    const at = this.now()
    for (const a of this.accounts.values()) {
      if (a.kind !== 'organization') continue
      for (const i of a.invites.values()) {
        if (i.secretHash !== hash) continue
        if (i.expires <= at) break
        const theirs = a.members.get(p.handle)
        // Already in: keep the higher of the two roles, never demote.
        const rank = { member: 0, admin: 1, owner: 2 }
        const role = theirs && rank[theirs] >= rank[i.role] ? theirs : i.role
        if (!theirs && a.members.size >= MAX_MEMBERS)
          throw apiError(
            'limit_reached',
            `An organization can have ${MAX_MEMBERS} members.`,
          )
        if (!dry) {
          a.invites.delete(i.id)
          a.members.set(p.handle, role)
          this.touch(a)
          this.accessRevision++
        }
        return this.presentMember(a, p.handle, role)
      }
    }
    throw apiError(
      'not_found',
      'This invitation does not exist, was revoked or has expired.',
      { hint: 'Ask an owner or admin of the organization for a new one.' },
    )
  }
}
