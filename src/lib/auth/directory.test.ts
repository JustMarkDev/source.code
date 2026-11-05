import { beforeEach, describe, expect, test } from 'bun:test'
import {
  accountsFor,
  activeFor,
  addressTaken,
  canManage,
  createOrg,
  displayName,
  findOrg,
  generateAddress,
  invite,
  isValidAddress,
  recordAlias,
  removeMember,
  resetDirectory,
  resolveAlias,
  revokeInvite,
  roleIn,
  setActive,
  setRole,
  snapshot,
  updateOrg,
} from './directory'
import type { Person } from './directory'

const dana: Person = { id: 'usr_dana', handle: 'dana', name: 'Dana Okafor' }
const hollis: Person = {
  id: 'usr_hollis',
  handle: 'hollis',
  name: 'Hollis Reyes',
}
const ines: Person = { id: 'usr_ines', handle: 'ines', name: 'Ines Falk' }
const ada: Person = {
  id: 'usr_ada',
  handle: 'brave-badger-367',
  name: 'Ada Lovelace',
}

const NW = 'org_northwind'

beforeEach(() => resetDirectory())

describe('addresses', () => {
  test('generated addresses are valid and steady for one seed', () => {
    const a = generateAddress('ada@example.com')
    expect(isValidAddress(a)).toBe(true)
    expect(generateAddress('ada@example.com')).toBe(a)
    expect(generateAddress('grace@example.com')).not.toBe(a)
  })

  test('routes, people, organizations and old addresses are all taken', () => {
    expect(addressTaken('dashboard')).toBe(true)
    expect(addressTaken('Organizations')).toBe(true)
    expect(addressTaken('privacy')).toBe(true)
    expect(addressTaken('terms')).toBe(true)
    expect(addressTaken('hollis')).toBe(true)
    expect(addressTaken('northwind')).toBe(true)
    expect(addressTaken('calm-harbor-231')).toBe(false)
    recordAlias('old-name', 'org_x', 'new-name')
    expect(addressTaken('old-name')).toBe(true)
    // An account can take back its own old address.
    expect(addressTaken('old-name', 'org_x')).toBe(false)
  })
})

describe('accounts and switching', () => {
  test('a person acts as themselves until they pick an organization', () => {
    expect(activeFor(dana).handle).toBe('dana')
    expect(accountsFor(dana).map((a) => a.handle)).toEqual([
      'dana',
      'northwind',
    ])
    expect(setActive(dana, NW).data?.kind).toBe('organization')
    expect(activeFor(dana).handle).toBe('northwind')
    // Switching is per person: someone else is unaffected.
    expect(activeFor(hollis).handle).toBe('hollis')
  })

  test('you cannot act as an organization you do not belong to', () => {
    const r = setActive(ada, NW)
    expect(r.error?.code).toBe('NOT_A_MEMBER')
    expect(activeFor(ada).handle).toBe('brave-badger-367')
  })

  test('creating an organization makes the creator its owner and switches to it', () => {
    const r = createOrg(ada, { name: '  Acme Robotics ' })
    expect(r.error).toBeNull()
    const org = findOrg(r.data!.handle)!
    expect(org.name).toBe('Acme Robotics')
    expect(roleIn(ada, org.handle)).toBe('owner')
    expect(activeFor(ada).id).toBe(org.id)
    // The address says nothing about the name.
    expect(org.handle).not.toContain('acme')
    expect(isValidAddress(org.handle)).toBe(true)
  })

  test('an organization needs a name', () => {
    expect(createOrg(ada, { name: '   ' }).error?.code).toBe('INVALID_NAME')
  })

  test('canManage covers your own account and organizations you run', () => {
    expect(canManage(dana, 'dana')).toBe(true)
    expect(canManage(dana, 'northwind')).toBe(true)
    expect(canManage(hollis, 'northwind')).toBe(true) // admin
    expect(canManage(ines, 'northwind')).toBe(false) // member
    expect(canManage(ada, 'northwind')).toBe(false)
  })

  test('names: organizations by name, people by full name', () => {
    expect(displayName('northwind')).toBe('Northwind Labs')
    expect(displayName('hollis')).toBe('Hollis Reyes')
    expect(displayName(ada.handle, ada)).toBe('Ada Lovelace')
    expect(displayName('nobody-here')).toBe('nobody-here')
  })
})

describe('the last owner', () => {
  test('cannot be demoted, removed or leave', () => {
    expect(setRole(dana, NW, 'usr_dana', 'admin').error?.code).toBe(
      'LAST_OWNER',
    )
    expect(removeMember(dana, NW, 'usr_dana').error?.code).toBe('LAST_OWNER')
    expect(roleIn(dana, 'northwind')).toBe('owner')
  })

  test('can hand over ownership, then step down', () => {
    expect(setRole(dana, NW, 'usr_hollis', 'owner').error).toBeNull()
    expect(setRole(dana, NW, 'usr_dana', 'member').error).toBeNull()
    expect(roleIn(dana, 'northwind')).toBe('member')
    expect(roleIn(hollis, 'northwind')).toBe('owner')
  })

  test('leaving ends acting as the organization', () => {
    setRole(dana, NW, 'usr_hollis', 'owner')
    setActive(dana, NW)
    expect(removeMember(dana, NW, 'usr_dana').error).toBeNull()
    expect(roleIn(dana, 'northwind')).toBeNull()
    expect(activeFor(dana).handle).toBe('dana')
  })
})

describe('who may do what', () => {
  test('only owners change roles', () => {
    expect(setRole(hollis, NW, 'usr_ines', 'admin').error?.code).toBe(
      'FORBIDDEN',
    )
    expect(setRole(ines, NW, 'usr_ines', 'owner').error?.code).toBe('FORBIDDEN')
  })

  test('admins remove members, not owners or other admins', () => {
    expect(removeMember(hollis, NW, 'usr_dana').error?.code).toBe('FORBIDDEN')
    expect(removeMember(hollis, NW, 'usr_ines').error).toBeNull()
  })

  test('members cannot remove anyone but themselves', () => {
    expect(removeMember(ines, NW, 'usr_hollis').error?.code).toBe('FORBIDDEN')
    expect(removeMember(ines, NW, 'usr_ines').error).toBeNull()
  })

  test('inviting: owners and admins, a valid email, once; only owners add owners', () => {
    expect(
      invite(ines, NW, { email: 'a@b.co', role: 'member' }).error?.code,
    ).toBe('FORBIDDEN')
    expect(
      invite(hollis, NW, { email: 'a@b.co', role: 'owner' }).error?.code,
    ).toBe('FORBIDDEN')
    expect(
      invite(dana, NW, { email: 'nope', role: 'member' }).error?.code,
    ).toBe('INVALID_EMAIL')
    const made = invite(dana, NW, { email: 'New@B.co ', role: 'admin' })
    expect(made.data?.email).toBe('new@b.co')
    expect(
      invite(hollis, NW, { email: 'new@b.co', role: 'member' }).error?.code,
    ).toBe('ALREADY_INVITED')
    expect(revokeInvite(hollis, NW, made.data!.id).error).toBeNull()
    expect(
      findOrg('northwind')!.invites.some((i) => i.id === made.data!.id),
    ).toBe(false)
  })
})

describe('renaming an organization', () => {
  test('keeps the old address as a redirect and reserves it', () => {
    const r = updateOrg(dana, NW, { handle: 'northwind-labs' })
    expect(r.error).toBeNull()
    expect(findOrg('northwind-labs')?.id).toBe(NW)
    expect(resolveAlias('northwind')).toBe('northwind-labs')
    expect(addressTaken('northwind')).toBe(true)
    expect(snapshot().aliases.northwind?.id).toBe(NW)
  })

  test('refuses a taken, invalid or unauthorised address', () => {
    expect(updateOrg(dana, NW, { handle: 'hollis' }).error?.code).toBe(
      'ADDRESS_TAKEN',
    )
    expect(updateOrg(dana, NW, { handle: '-bad-' }).error?.code).toBe(
      'INVALID_ADDRESS',
    )
    expect(updateOrg(hollis, NW, { handle: 'fine-name' }).error?.code).toBe(
      'FORBIDDEN',
    )
    // An admin can still edit the name.
    expect(updateOrg(hollis, NW, { name: 'Northwind' }).error).toBeNull()
    expect(updateOrg(ines, NW, { name: 'Nope' }).error?.code).toBe('FORBIDDEN')
  })

  test('lookups by the old address still find the organization', () => {
    updateOrg(dana, NW, { handle: 'northwind-labs' })
    expect(findOrg('northwind')?.id).toBe(NW)
    expect(displayName('northwind')).toBe('Northwind Labs')
    expect(canManage(dana, 'northwind')).toBe(true)
    expect(canManage(ines, 'northwind')).toBe(false)
  })

  test('a second rename repoints the first old address', () => {
    updateOrg(dana, NW, { handle: 'northwind-labs' })
    updateOrg(dana, NW, { handle: 'northwind-inc' })
    expect(resolveAlias('northwind')).toBe('northwind-inc')
    expect(resolveAlias('northwind-labs')).toBe('northwind-inc')
  })

  test('taking back an earlier address ends its redirect', () => {
    updateOrg(dana, NW, { handle: 'northwind-labs' })
    expect(updateOrg(dana, NW, { handle: 'northwind' }).error).toBeNull()
    expect(resolveAlias('northwind')).toBeUndefined()
    expect(resolveAlias('northwind-labs')).toBe('northwind')
  })
})
