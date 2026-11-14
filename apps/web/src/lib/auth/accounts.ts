/**
 * Who you are acting as. One login is one person; that person can belong to
 * organizations and acts as one account at a time. Accounts, members and
 * invitations come from the API (`accounts.*`, `members.*`,
 * `invitations.*`); which account you are acting as is a preference kept in
 * this browser.
 */
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authClient } from './client'
import type { Account as ApiAccount } from '@source-code/sdk'
import { useOpMaybe } from '~/lib/forge'

export type Role = 'owner' | 'admin' | 'member'
export type AccountKind = 'person' | 'organization'

/** What acts and owns: a person or an organization. One namespace for both. */
export type Account = {
  id: string
  kind: AccountKind
  handle: string
  name: string
  description: string
  /** What the signed-in person is in it. `owner` on their own account. */
  role: Role | null
}

export type Person = { handle: string; name: string }
export type Invite = { id: string; email: string; role: Role }

const toAccount = (a: ApiAccount): Account => ({
  id: a.id,
  kind: a.kind,
  handle: a.handle,
  name: a.name,
  description: a.bio,
  role: a.role,
})

/** The signed-in person, or null. Stable between renders unless it really changes. */
export function useMe(): Person | null {
  const { data } = authClient.useSession()
  const handle = data?.user.handle
  const name = data?.user.name
  return React.useMemo(
    () => (handle && name ? { handle, name } : null),
    [handle, name],
  )
}

// ---------------------------------------------------------------------------
// The account in use. A handle in this browser's storage, per person.

const KEY = 'sx-acting-as'
const listeners = new Set<() => void>()

function readActing(): Record<string, string | undefined> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<
      string,
      string | undefined
    >
  } catch {
    // Storage can be blocked: then you act as yourself.
    return {}
  }
}

let acting: Record<string, string | undefined> | undefined
const snapshot = () => (acting ??= readActing())
const onServer = {}
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Act as another account. Instant, and the same on every screen. */
export function switchAccount(me: Person, handle: string) {
  acting = { ...snapshot(), [me.handle]: handle }
  try {
    localStorage.setItem(KEY, JSON.stringify(acting))
  } catch {
    // Kept for this page view only.
  }
  listeners.forEach((l) => l())
}

type Accounts = {
  me: Person | null
  accounts: Array<Account>
  active: Account | null
}

/** The person, every account they can act as, and the one they are acting as. */
export function useAccounts(): Accounts {
  const me = useMe()
  const listed = useOpMaybe('accounts.list', {}, me !== null)
  const picked = React.useSyncExternalStore(
    subscribe,
    snapshot,
    () => onServer as Record<string, string | undefined>,
  )
  return React.useMemo(() => {
    if (!me) return { me: null, accounts: [], active: null }
    // Until the list arrives, the person is the one account we are sure of.
    const mine: Account = {
      id: me.handle,
      kind: 'person',
      handle: me.handle,
      name: me.name,
      description: '',
      role: 'owner',
    }
    const all = listed?.data.map(toAccount) ?? []
    const self = all.find((a) => a.handle === me.handle) ?? mine
    const accounts = [self, ...all.filter((a) => a.handle !== me.handle)]
    return {
      me,
      accounts,
      active: accounts.find((a) => a.handle === picked[me.handle]) ?? self,
    }
  }, [me, listed, picked])
}

/**
 * The account at an address: `undefined` while it is being read, `null` when
 * there is none. `role` is what the signed-in person is in it.
 */
export function useAccount(handle: string): Account | null | undefined {
  // Read again when the person changes: the role in the answer is theirs.
  const found = useOpMaybe('accounts.get', { handle }, handle !== '')
  return React.useMemo(() => found && toAccount(found), [found])
}

/** May the signed-in person manage what belongs to this account. */
export const manages = (account: Account | null | undefined) =>
  account?.role === 'owner' || account?.role === 'admin'

/** An organization with its members, and what the signed-in person may do in it. */
export function useOrganization(handle: string) {
  const org = useAccount(handle)
  const isOrg = org?.kind === 'organization'
  const members = useOpMaybe('members.list', { handle }, isOrg)
  const canInvite = isOrg && manages(org)
  const invites = useOpMaybe('invitations.list', { handle }, canInvite)
  return React.useMemo(() => {
    if (org === undefined || (isOrg && members === undefined)) return undefined
    if (!org || !isOrg) return null
    const people = members?.data ?? []
    return {
      org,
      role: org.role,
      members: people.map((m) => ({
        person: { handle: m.handle, name: m.name },
        role: m.role,
      })),
      invites: (invites?.data ?? []).map((i): Invite => ({
        id: i.id,
        email: i.email,
        role: i.role,
      })),
      owners: people.filter((m) => m.role === 'owner').length,
    }
  }, [org, isOrg, members, invites])
}

/**
 * Reads are answered for whoever was signed in when they were made. When
 * that changes (sign in, sign out), read them again.
 */
export function SessionSync() {
  const { data, isPending } = authClient.useSession()
  const queries = useQueryClient()
  const handle = data?.user.handle ?? null
  const seen = React.useRef<string | null | undefined>(undefined)
  React.useEffect(() => {
    if (isPending) return
    // The first settled answer is who the page was rendered for.
    if (seen.current !== undefined && seen.current !== handle)
      void queries.invalidateQueries({ queryKey: ['sx'] })
    seen.current = handle
  }, [handle, isPending, queries])
  return null
}
