/**
 * Who you are acting as. One login is one person; that person can belong to
 * organizations and acts as one account at a time. These hooks read the
 * session and the directory together, so a component asks "who am I acting as"
 * and "may I manage this" without knowing where either lives.
 */
import * as React from 'react'
import { authClient } from './client'
import * as dir from './directory'
import type { Account, Invite, Org, Person, Role } from './directory'

export type { Account, Invite, Org, Person, Role }

function useDirectory() {
  React.useEffect(dir.load, [])
  return React.useSyncExternalStore(
    dir.subscribe,
    dir.snapshot,
    () => dir.SERVER,
  )
}

/** The signed-in person, or null. Stable between renders unless it really changes. */
function useMe(): Person | null {
  const { data } = authClient.useSession()
  const id = data?.user.id
  const handle = data?.user.handle
  const name = data?.user.name
  return React.useMemo(
    () => (id && handle && name ? { id, handle, name } : null),
    [id, handle, name],
  )
}

type Accounts = {
  me: Person | null
  accounts: Array<Account>
  active: Account | null
}

/** The person, every account they can act as, and the one they are acting as. */
export function useAccounts(): Accounts {
  const me = useMe()
  const s = useDirectory()
  return React.useMemo(() => {
    if (!me) return { me: null, accounts: [], active: null }
    return {
      me,
      accounts: dir.accountsFor(me, s),
      active: dir.activeFor(me, s),
    }
  }, [me, s])
}

/** Act as another account. Instant, and the same everywhere. */
export function switchAccount(me: Person, accountId: string) {
  return dir.setActive(me, accountId)
}

/** An organization with its members named, and what the signed-in person may do in it. */
export function useOrganization(handle: string) {
  const me = useMe()
  const s = useDirectory()
  return React.useMemo(() => {
    const org = dir.findOrg(handle, s)
    if (!org) return null
    const role: Role | null = me ? dir.roleIn(me, handle, s) : null
    return {
      org,
      role,
      members: org.members.map((m) => ({
        person: dir.personInfo(m.personId, me ?? undefined),
        role: m.role,
      })),
      invites: org.invites,
      owners: org.members.filter((m) => m.role === 'owner').length,
    }
  }, [handle, me, s])
}

/** The name to show for any address, and whether the signed-in person manages it. */
export function useDirectoryLookups() {
  const me = useMe()
  const s = useDirectory()
  return React.useMemo(
    () => ({
      /** False until the browser's saved accounts are read; a server render never has them. */
      ready: s.ready,
      resolveAlias: (handle: string) => dir.resolveAlias(handle, s),
      nameOf: (handle: string) => dir.displayName(handle, me ?? undefined, s),
      isOrganization: (handle: string) => dir.isOrganization(handle, s),
      canManage: (handle: string) =>
        me ? dir.canManage(me, handle, s) : false,
    }),
    [me, s],
  )
}

export { dir as directory }
