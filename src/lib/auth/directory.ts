/**
 * Accounts, organizations and who belongs to what. Mock for now: it lives in
 * localStorage and mirrors the Convex tables (`accounts`, `memberships`,
 * `handleAliases`), so the real thing only has to replace the calls.
 *
 * The rules live here, in plain functions, so they can be tested without a
 * page: an organization always has an owner, who may change what, and which
 * addresses nobody may take. Better Auth's organization plugin has the same
 * shape (organization, member, invitation), so the web app and the CLI can
 * move over together.
 *
 * This file imports nothing from the auth client. The client imports it.
 */
import { developers, setOriginalOwner } from '~/mock/data'

export type Role = 'owner' | 'admin' | 'member'
export type AccountKind = 'person' | 'organization'

/** What acts and owns: a person or an organization. One namespace for both. */
export type Account = {
  id: string
  kind: AccountKind
  handle: string
  name: string
  description: string
}

export type Person = { id: string; handle: string; name: string }
export type Member = { personId: string; role: Role }
export type Invite = { id: string; email: string; role: Role }
export type Org = {
  id: string
  handle: string
  name: string
  description: string
  members: Array<Member>
  invites: Array<Invite>
}

export type Failure = { code: string; message: string }
export type Result<T> =
  { data: T; error: null } | { data: null; error: Failure }

const ok = <T>(data: T): Result<T> => ({ data, error: null })
const fail = (code: string, message: string): Result<never> => ({
  data: null,
  error: { code, message },
})

// ---------------------------------------------------------------------------
// Addresses

/** 1 to 24 lowercase letters, numbers or dashes; no dash at either end. */
export const isValidAddress = (address: string) =>
  /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(address)

const ADJECTIVES = [
  'quiet',
  'bright',
  'brave',
  'calm',
  'clever',
  'eager',
  'gentle',
  'happy',
  'keen',
  'lucky',
  'mellow',
  'nimble',
  'proud',
  'swift',
  'warm',
  'witty',
]
const NOUNS = [
  'otter',
  'heron',
  'maple',
  'comet',
  'harbor',
  'lantern',
  'meadow',
  'pebble',
  'falcon',
  'willow',
  'ember',
  'summit',
  'river',
  'badger',
  'cedar',
  'orchid',
]

/**
 * The address a new account starts with: two words and a number, like
 * `quiet-otter-482`. It says nothing about who the account is, so nobody can
 * sign up as someone else's name or a company's. The same seed always gives
 * the same address, which keeps the mock steady across sign-ins. The real one
 * draws random words and retries on the rare clash.
 */
export function generateAddress(seed: string): string {
  let h = 2166136261
  for (const ch of seed) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  h >>>= 0
  const adjective = ADJECTIVES[h % ADJECTIVES.length]
  const noun = NOUNS[(h >>> 4) % NOUNS.length]
  return `${adjective}-${noun}-${100 + ((h >>> 8) % 900)}`
}

/** Names that are routes or belong to us. An account can never be called these. */
const RESERVED = new Set([
  'admin',
  'support',
  'api',
  'docs',
  'design',
  'discover',
  'dashboard',
  'inbox',
  'new',
  'pricing',
  'status',
  'settings',
  'organizations',
  'privacy',
  'terms',
  'welcome',
  'sign-in',
  'sign-up',
  'forgot-password',
  'mcp',
  'llms',
  'about',
  'help',
  'login',
  'logout',
])

// ---------------------------------------------------------------------------
// State

type Alias = { id: string; to: string }

type State = {
  /** False on the server and until the browser's saved accounts have been read. */
  ready: boolean
  orgs: Array<Org>
  /** Old address -> the account that had it, and the address it has now. */
  aliases: Record<string, Alias | undefined>
  /** Person id -> the account they are acting as. */
  active: Record<string, string>
}

const KEY = 'mock-directory'

/** The organization the demo account belongs to, so switching can be tried at once. */
function seedState(): State {
  return {
    ready: false,
    orgs: [
      {
        id: 'org_northwind',
        handle: 'northwind',
        name: 'Northwind Labs',
        description: 'Message infrastructure for small teams.',
        members: [
          { personId: 'usr_dana', role: 'owner' },
          { personId: 'usr_hollis', role: 'admin' },
          { personId: 'usr_ines', role: 'member' },
        ],
        invites: [
          { id: 'inv_seed1', email: 'yuki@example.com', role: 'member' },
        ],
      },
    ],
    aliases: {},
    active: {},
  }
}

const listeners = new Set<() => void>()
let state: State = seedState()
let loaded = false

function emit(next: State) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage can be blocked, or missing in tests; the state then lasts for this page view.
  }
  listeners.forEach((l) => l())
}

/** Read the saved state once on the client. The server render always uses the seed. */
export function load() {
  if (loaded) return
  loaded = true
  let saved: State | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) saved = JSON.parse(raw) as State
  } catch {
    // Unreadable or blocked: keep the seed.
  }
  state = { ...(saved ?? state), ready: true }
  listeners.forEach((l) => l())
}

// A renamed organization still owns the sample repositories written under its first address.
setOriginalOwner((handle) => {
  const org = state.orgs.find((o) => o.handle === handle)
  return org?.id.replace(/^org_/, '')
})

export function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const snapshot = () => state
export const SERVER: State = seedState()

/** Back to the seed. For tests and for the "start over" of a demo. */
export function resetDirectory() {
  loaded = true
  emit({ ...seedState(), ready: true })
}

// ---------------------------------------------------------------------------
// People

const personId = (handle: string) => `usr_${handle}`

/** Who a person id is. The signed-in person is passed in, so renames show at once. */
export function personInfo(id: string, me?: Person): Person {
  if (me?.id === id) return me
  const dev = developers.find((d) => personId(d.handle) === id)
  if (dev) return { id, handle: dev.handle, name: dev.name }
  const handle = id.replace(/^usr_/, '')
  return { id, handle, name: handle }
}

export const personAccount = (p: Person): Account => ({
  id: p.id,
  kind: 'person',
  handle: p.handle,
  name: p.name,
  description: '',
})

const orgAccount = (o: Org): Account => ({
  id: o.id,
  kind: 'organization',
  handle: o.handle,
  name: o.name,
  description: o.description,
})

// ---------------------------------------------------------------------------
// Reading

const roleOf = (org: Org, id: string): Role | null =>
  org.members.find((m) => m.personId === id)?.role ?? null

/** The organization at an address, or at its old address: a renamed one is still found. */
export function findOrg(handle: string, s: State = state): Org | undefined {
  const now = s.aliases[handle]?.to ?? handle
  return (
    s.orgs.find((o) => o.handle === handle) ??
    s.orgs.find((o) => o.handle === now)
  )
}

export function orgById(id: string, s: State = state): Org | undefined {
  return s.orgs.find((o) => o.id === id)
}

/** The person first, then every organization they belong to. */
export function accountsFor(me: Person, s: State = state): Array<Account> {
  return [
    personAccount(me),
    ...s.orgs.filter((o) => roleOf(o, me.id) !== null).map(orgAccount),
  ]
}

/** The account a person is acting as. Their own, unless they picked another they still belong to. */
export function activeFor(me: Person, s: State = state): Account {
  const all = accountsFor(me, s)
  return all.find((a) => a.id === s.active[me.id]) ?? all[0]
}

export function roleIn(me: Person, handle: string, s: State = state) {
  const org = findOrg(handle, s)
  return org ? roleOf(org, me.id) : null
}

/** May this person manage what belongs to `handle`: their own, or an organization they own or administer. */
export function canManage(me: Person, handle: string, s: State = state) {
  if (handle === me.handle) return true
  const role = roleIn(me, handle, s)
  return role === 'owner' || role === 'admin'
}

/** The name to show for an address: an organization's name, a person's full name, else the address itself. */
export function displayName(handle: string, me?: Person, s: State = state) {
  const org = findOrg(handle, s)
  if (org) return org.name
  if (me?.handle === handle) return me.name
  return developers.find((d) => d.handle === handle)?.name ?? handle
}

export function isOrganization(handle: string, s: State = state) {
  return findOrg(handle, s) !== undefined
}

/** Where an old address leads now, or nothing if it was never an address. */
export function resolveAlias(
  handle: string,
  s: State = state,
): string | undefined {
  return s.aliases[handle]?.to
}

/**
 * Whether nobody else may have this address: a route, a person or organization
 * that exists, or an old address that still redirects. `exceptId` lets an
 * account keep or take back its own.
 */
export function addressTaken(
  address: string,
  exceptId?: string,
  s: State = state,
): boolean {
  const a = address.toLowerCase()
  if (RESERVED.has(a)) return true
  if (developers.some((d) => d.handle === a && personId(d.handle) !== exceptId))
    return true
  if (s.orgs.some((o) => o.handle === a && o.id !== exceptId)) return true
  const alias = s.aliases[a]
  return alias !== undefined && alias.id !== exceptId
}

// ---------------------------------------------------------------------------
// Writing. Every change names who is making it, and is refused when they may not.

/** Repoint every old address of an account at its new one. */
function repoint(
  aliases: State['aliases'],
  id: string,
  to: string,
): State['aliases'] {
  return Object.fromEntries(
    Object.entries(aliases).map(([k, v]) => [k, v?.id === id ? { id, to } : v]),
  )
}

/**
 * An account changed its address: the old one keeps answering with a
 * redirect, nobody else can take it, and earlier old ones follow along.
 */
export function recordAlias(oldHandle: string, accountId: string, to: string) {
  if (!oldHandle) return
  emit({
    ...state,
    aliases: {
      ...repoint(state.aliases, accountId, to),
      [oldHandle]: { id: accountId, to },
    },
  })
}

/** Taking back one's own old address ends its redirect. */
export function releaseAlias(handle: string, accountId: string) {
  if (state.aliases[handle]?.id !== accountId) return
  const { [handle]: _gone, ...rest } = state.aliases
  emit({ ...state, aliases: rest })
}

export function setActive(me: Person, accountId: string): Result<Account> {
  const target = accountsFor(me).find((a) => a.id === accountId)
  if (!target) return fail('NOT_A_MEMBER', 'You do not belong to that account.')
  emit({ ...state, active: { ...state.active, [me.id]: accountId } })
  return ok(target)
}

/**
 * Create an organization. Its creator becomes the first owner, and the
 * organization, not the person, owns what is created in it. Its address is
 * generated like a person's, and can be changed in its settings.
 */
export function createOrg(
  me: Person,
  input: { name: string; description?: string },
): Result<Account> {
  const name = input.name.trim()
  if (!name) return fail('INVALID_NAME', 'Give the organization a name.')
  let n = state.orgs.length
  let handle = generateAddress(`org:${name}:${me.id}:${n}`)
  while (addressTaken(handle))
    handle = generateAddress(`org:${name}:${me.id}:${++n}`)
  const org: Org = {
    id: `org_${handle}`,
    handle,
    name,
    description: input.description?.trim() ?? '',
    members: [{ personId: me.id, role: 'owner' }],
    invites: [],
  }
  emit({
    ...state,
    orgs: [...state.orgs, org],
    active: { ...state.active, [me.id]: org.id },
  })
  return ok(orgAccount(org))
}

function mutateOrg(orgId: string, change: (o: Org) => Org) {
  emit({
    ...state,
    orgs: state.orgs.map((o) => (o.id === orgId ? change(o) : o)),
  })
}

const LAST_OWNER =
  'An organization always needs an owner. Make someone else an owner first.'

/** Owners and admins edit the name and description. Only an owner changes the address. */
export function updateOrg(
  me: Person,
  orgId: string,
  patch: { name?: string; handle?: string; description?: string },
): Result<Account> {
  const org = orgById(orgId)
  if (!org) return fail('NOT_FOUND', 'That organization does not exist.')
  const role = roleOf(org, me.id)
  if (role !== 'owner' && role !== 'admin')
    return fail(
      'FORBIDDEN',
      'Only owners and admins can edit the organization.',
    )
  const name = patch.name?.trim()
  if (name !== undefined && !name)
    return fail('INVALID_NAME', 'Give the organization a name.')
  const handle = patch.handle?.trim().toLowerCase()
  const changesAddress = handle !== undefined && handle !== org.handle
  if (changesAddress) {
    if (role !== 'owner')
      return fail('FORBIDDEN', 'Only an owner can change the address.')
    if (!isValidAddress(handle))
      return fail('INVALID_ADDRESS', 'Use 1 to 24 letters, numbers or dashes.')
    if (addressTaken(handle, org.id))
      return fail('ADDRESS_TAKEN', `source.code/${handle} is already taken.`)
  }
  const next: Org = {
    ...org,
    ...(name !== undefined && { name }),
    ...(handle !== undefined && { handle }),
    ...(patch.description !== undefined && {
      description: patch.description.trim(),
    }),
  }
  if (changesAddress) {
    // The old address keeps redirecting; taking back an earlier one ends its redirect.
    const { [handle]: _own, ...rest } = state.aliases
    emit({
      ...state,
      orgs: state.orgs.map((o) => (o.id === orgId ? next : o)),
      aliases: {
        ...repoint(rest, org.id, handle),
        [org.handle]: { id: org.id, to: handle },
      },
    })
  } else mutateOrg(orgId, () => next)
  return ok(orgAccount(next))
}

export function setRole(
  me: Person,
  orgId: string,
  person: string,
  role: Role,
): Result<Member> {
  const org = orgById(orgId)
  const mine = org && roleOf(org, me.id)
  if (!org || mine !== 'owner')
    return fail('FORBIDDEN', 'Only an owner can change roles.')
  const current = roleOf(org, person)
  if (!current) return fail('NOT_FOUND', 'That person is not a member.')
  const owners = org.members.filter((m) => m.role === 'owner').length
  if (current === 'owner' && role !== 'owner' && owners === 1)
    return fail('LAST_OWNER', LAST_OWNER)
  mutateOrg(orgId, (o) => ({
    ...o,
    members: o.members.map((m) => (m.personId === person ? { ...m, role } : m)),
  }))
  return ok({ personId: person, role })
}

/**
 * Remove a member, or leave (remove yourself). Owners can remove anyone and
 * admins can remove members; nobody can remove the last owner.
 */
export function removeMember(
  me: Person,
  orgId: string,
  person: string,
): Result<null> {
  const org = orgById(orgId)
  const mine = org && roleOf(org, me.id)
  if (!org || !mine) return fail('FORBIDDEN', 'You are not a member.')
  const theirs = roleOf(org, person)
  if (!theirs) return fail('NOT_FOUND', 'That person is not a member.')
  const leaving = person === me.id
  if (!leaving) {
    if (mine === 'member')
      return fail('FORBIDDEN', 'Members cannot remove other people.')
    if (mine === 'admin' && theirs !== 'member')
      return fail('FORBIDDEN', 'Admins can only remove members.')
  }
  const owners = org.members.filter((m) => m.role === 'owner').length
  if (theirs === 'owner' && owners === 1) return fail('LAST_OWNER', LAST_OWNER)
  mutateOrg(orgId, (o) => ({
    ...o,
    members: o.members.filter((m) => m.personId !== person),
  }))
  // Someone who leaves is no longer acting as the organization.
  if (state.active[person] === orgId) {
    const { [person]: _left, ...rest } = state.active
    emit({ ...state, active: rest })
  }
  return ok(null)
}

export function invite(
  me: Person,
  orgId: string,
  input: { email: string; role: Role },
): Result<Invite> {
  const org = orgById(orgId)
  const mine = org && roleOf(org, me.id)
  if (!org || (mine !== 'owner' && mine !== 'admin'))
    return fail('FORBIDDEN', 'Only owners and admins can invite people.')
  if (input.role === 'owner' && mine !== 'owner')
    return fail('FORBIDDEN', 'Only an owner can invite another owner.')
  const email = input.email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email))
    return fail('INVALID_EMAIL', 'Enter a valid email.')
  if (org.invites.some((i) => i.email === email))
    return fail('ALREADY_INVITED', `${email} has already been invited.`)
  const made: Invite = {
    id: `inv_${Math.random().toString(36).slice(2, 8)}`,
    email,
    role: input.role,
  }
  mutateOrg(orgId, (o) => ({ ...o, invites: [...o.invites, made] }))
  return ok(made)
}

export function revokeInvite(
  me: Person,
  orgId: string,
  inviteId: string,
): Result<null> {
  const org = orgById(orgId)
  const mine = org && roleOf(org, me.id)
  if (!org || (mine !== 'owner' && mine !== 'admin'))
    return fail('FORBIDDEN', 'Only owners and admins can cancel invitations.')
  mutateOrg(orgId, (o) => ({
    ...o,
    invites: o.invites.filter((i) => i.id !== inviteId),
  }))
  return ok(null)
}
