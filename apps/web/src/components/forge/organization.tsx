import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import { CopyAddress, EmptyState, Tile } from './bits'
import { RepoRow } from './repo-card'
import { randomHandle } from '@source-code/api/handles'
import type { Account, Invite, Person, Role } from '~/lib/auth/accounts'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Modal } from '~/components/ui/dialog'
import { Field, Input, Textarea } from '~/components/ui/input'
import { LinkTabs } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'
import {
  manages as managesAccount,
  switchAccount,
  useAccounts,
  useOrganization,
} from '~/lib/auth/accounts'
import { useOpMaybe, useWrite } from '~/lib/forge'
import { toRepo } from '~/lib/repo'

/** An account's picture: round for a person, rounded square for an organization. */
export function AccountTile({
  account,
  className,
}: {
  account: Pick<Account, 'kind' | 'name' | 'handle'>
  className?: string
}) {
  return (
    <Tile
      name={account.name}
      round={account.kind === 'person'}
      className={className}
    />
  )
}

const roleLabel: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge
      tone={role === 'owner' ? 'brand' : role === 'admin' ? 'info' : 'muted'}
    >
      {roleLabel[role]}
    </Badge>
  )
}

/** The public page of an organization: its repositories and its people. */
export function OrgPage({
  handle,
  embedded = false,
}: {
  handle: string
  /** Shown inside another page that already has the h1. */
  embedded?: boolean
}) {
  const Name = embedded ? 'h2' : 'h1'
  const found = useOrganization(handle)
  // Read before any early return, so the hooks run the same every time.
  const listed = useOpMaybe('repos.list', { owner: handle, limit: 100 })
  if (found === undefined || listed === undefined) return null
  if (!found)
    return (
      <EmptyState title="This organization does not exist">
        It may have been renamed or removed.
      </EmptyState>
    )
  const { org, members } = found
  const owned = (listed?.data ?? []).map((r) => toRepo(r))
  const manages = managesAccount(org)
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <AccountTile
          account={{ kind: 'organization', name: org.name, handle: org.handle }}
          className="size-20 text-2xl"
        />
        <div>
          <Name className="text-xl font-semibold tracking-tight">
            {org.name}
          </Name>
          <CopyAddress handle={org.handle} />
        </div>
        <Badge tone="outline">Organization</Badge>
        {org.description && <p className="text-sm">{org.description}</p>}
        <p className="text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{members.length}</b>{' '}
          {members.length === 1 ? 'person' : 'people'}
        </p>
        {manages && (
          <Button
            className="w-full"
            render={
              <Link
                to="/organizations/$handle/$section"
                params={{ handle: org.handle, section: 'general' }}
              />
            }
            nativeButton={false}
          >
            Manage organization
          </Button>
        )}
      </aside>

      <div className="min-w-0 space-y-10">
        <section aria-labelledby="org-repos">
          <h2 id="org-repos" className="mb-3 text-sm font-medium">
            Repositories{' '}
            <span className="text-xs text-muted-foreground tabular-nums">
              {owned.length}
            </span>
          </h2>
          {owned.length > 0 ? (
            <div className="divide-y rounded-xl border bg-card">
              {owned.map((r) => (
                <RepoRow key={r.name} repo={r} />
              ))}
            </div>
          ) : (
            <EmptyState title="No repositories yet">
              {manages ? (
                <Link
                  to="/new"
                  className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  Create or import the first one
                </Link>
              ) : (
                'Nothing public here yet.'
              )}
            </EmptyState>
          )}
        </section>

        <section aria-labelledby="org-people">
          <h2 id="org-people" className="mb-3 text-sm font-medium">
            People
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {members.map(({ person, role: r }) => (
              <li key={person.handle}>
                <Link
                  to="/$handle"
                  params={{ handle: person.handle }}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/50"
                >
                  <AccountTile
                    account={{ kind: 'person', ...person }}
                    className="size-9 text-sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {person.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      @{person.handle}
                    </span>
                  </span>
                  {r !== 'member' && <RoleBadge role={r} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings

export type OrgSection = 'general' | 'members'
export const orgSections: Array<[OrgSection, string]> = [
  ['general', 'General'],
  ['members', 'Members'],
]

export function OrgSettings({
  handle,
  section,
}: {
  handle: string
  section: OrgSection
}) {
  const found = useOrganization(handle)
  const { me } = useAccounts()
  if (found === undefined) return null
  if (!found || !found.role || !me)
    return (
      <EmptyState title="You are not a member of this organization">
        Ask an owner to invite you, or switch to an account that is.
      </EmptyState>
    )
  const { org, role, members, owners, invites } = found
  const ctx: Context = { me, org, role, owners, members, invites }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-4">
        <AccountTile
          account={{ kind: 'organization', name: org.name, handle: org.handle }}
          className="size-12 text-lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {org.name}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RoleBadge role={role} />
            <Link
              to="/$handle"
              params={{ handle: org.handle }}
              className="-my-1 py-1 underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Public page
            </Link>
          </p>
        </div>
      </header>
      <LinkTabs
        label="Organization settings"
        tabs={orgSections.map(([id, label]) => ({
          label,
          count: id === 'members' ? members.length : undefined,
          active: id === section,
          link: {
            to: '/organizations/$handle/$section',
            params: { handle: org.handle, section: id },
          },
        }))}
      />
      {section === 'general' ? (
        <General key={`${org.id}.${org.name}`} {...ctx} />
      ) : (
        <Members key={org.id} {...ctx} />
      )}
    </div>
  )
}

const card = 'space-y-4 rounded-xl border bg-card p-5'

type Context = {
  me: Person
  org: Account
  role: Role
  owners: number
  members: Array<{ person: Person; role: Role }>
  invites: Array<Invite>
}

function General({ me, org, role, owners }: Context) {
  const navigate = useNavigate()
  const write = useWrite()
  const [name, setName] = React.useState(org.name)
  const [description, setDescription] = React.useState(org.description)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [problem, setProblem] = React.useState<{
    field: 'name' | 'form'
    message: string
  } | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const isOwner = role === 'owner'
  const lastOwner = isOwner && owners === 1
  const errorOf = (f: 'name') => (problem?.field === f ? problem.message : null)

  const save = async () => {
    setProblem(null)
    if (!name.trim()) {
      setProblem({ field: 'name', message: 'Give the organization a name.' })
      return
    }
    setSaving(true)
    const r = await write('accounts.update', {
      handle: org.handle,
      body: { name: name.trim(), bio: description.trim() },
    })
    setSaving(false)
    if (r.error) setProblem({ field: 'form', message: r.error.message })
    else setSaved(true)
  }

  const leave = async () => {
    const r = await write('members.remove', {
      handle: org.handle,
      login: me.handle,
    })
    if (r.error) {
      setLeaving(false)
      setProblem({ field: 'form', message: r.error.message })
      return
    }
    switchAccount(me, me.handle)
    void navigate({ to: '/dashboard' })
  }

  return (
    <div className="space-y-6">
      {problem?.field === 'form' && (
        <Callout tone="danger" title="Could not save">
          {problem.message}
        </Callout>
      )}
      <section className={card}>
        <Field
          label="Name"
          hint="What people see. It can be a company, a team or a project."
        >
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
            aria-invalid={errorOf('name') ? true : undefined}
          />
        </Field>
        {errorOf('name') && (
          <p role="alert" className="-mt-2 text-xs text-danger">
            {errorOf('name')}
          </p>
        )}
        <Field label="Description" hint="One line, shown on its page.">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field
          label="Address"
          hint="Every link to the organization and its repositories starts with it. It cannot be changed yet."
        >
          <Input
            value={`source.code/${org.handle}`}
            readOnly
            disabled
            className="font-mono"
          />
        </Field>
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-success">Saved</span>}
          <Button
            variant="brand"
            size="lg"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      </section>

      <section className={card}>
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Leave this organization</h2>
          <p className="text-sm text-muted-foreground">
            You lose access to its private repositories. Its repositories stay
            with the organization, not with you.
          </p>
        </div>
        {lastOwner && (
          <p className="text-sm text-muted-foreground">
            You are the only owner. Make someone else an owner in{' '}
            <Link
              to="/organizations/$handle/$section"
              params={{ handle: org.handle, section: 'members' }}
              className="font-medium text-foreground underline decoration-border underline-offset-4"
            >
              Members
            </Link>{' '}
            before you leave.
          </p>
        )}
        <Button
          variant="danger"
          disabled={lastOwner}
          onClick={() => setLeaving(true)}
        >
          Leave organization
        </Button>
      </section>

      <Modal
        open={leaving}
        onClose={() => setLeaving(false)}
        title={`Leave ${org.name}?`}
        description="You can be invited back by an owner or admin."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setLeaving(false)}>Stay</Button>
          <Button variant="danger" onClick={() => void leave()}>
            Leave
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function Members({ me, org, role, members, invites, owners }: Context) {
  const write = useWrite()
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [who, setWho] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState<Role>('member')
  const [busy, setBusy] = React.useState(false)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const isOwner = role === 'owner'
  const canInvite = isOwner || role === 'admin'

  const report = (r: { error: { message: string } | null }) => {
    setError(r.error?.message ?? null)
    if (r.error) setNotice(null)
    return r.error === null
  }

  // An email gets an invitation. Anything else is the address of someone who
  // already has an account, and they are added at once.
  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = who.trim()
    if (!value) return
    setBusy(true)
    if (value.includes('@')) {
      const r = await write('invitations.create', {
        handle: org.handle,
        body: { email: value, role: inviteRole },
      })
      if (report(r)) {
        setNotice(`Invitation sent to ${r.data?.email ?? value}.`)
        setWho('')
      }
    } else {
      const login = value
        .replace(/^(https?:\/\/)?source\.code\//, '')
        .replace(/^@/, '')
        .toLowerCase()
      const r = await write('members.set', {
        handle: org.handle,
        login,
        body: { role: inviteRole },
      })
      if (report(r)) {
        setNotice(`${r.data?.name ?? login} was added.`)
        setWho('')
      } else if (r.error?.code === 'not_found')
        setError(
          `Nobody has the address ${login}. To invite someone without an account, enter their email.`,
        )
    }
    setBusy(false)
  }

  const target = members.find((m) => m.person.handle === removing)

  return (
    <div className="space-y-6">
      {error && (
        <Callout tone="danger" title="That did not work">
          {error}
        </Callout>
      )}
      {notice && !error && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}

      <section className="rounded-xl border bg-card">
        <ul className="divide-y">
          {members.map(({ person, role: r }) => {
            const self = person.handle === me.handle
            const onlyOwner = r === 'owner' && owners === 1
            // Owners remove anyone. Admins remove members. Nobody removes the last owner.
            const mayRemove =
              !self &&
              !onlyOwner &&
              (isOwner || (role === 'admin' && r === 'member'))
            return (
              <li
                key={person.handle}
                className="flex items-center gap-3 px-4 py-3"
              >
                <AccountTile
                  account={{ kind: 'person', ...person }}
                  className="size-9 text-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {person.name}
                    {self && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    @{person.handle}
                  </div>
                </div>
                {isOwner ? (
                  <Select
                    aria-label={`Role of ${person.name}`}
                    value={r}
                    disabled={onlyOwner}
                    title={
                      onlyOwner
                        ? 'An organization always needs an owner.'
                        : undefined
                    }
                    onValueChange={(v) =>
                      void write('members.set', {
                        handle: org.handle,
                        login: person.handle,
                        body: { role: v as Role },
                      }).then(report)
                    }
                    className="h-8 w-28 text-[13px]"
                  >
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </Select>
                ) : (
                  <RoleBadge role={r} />
                )}
                {mayRemove ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoving(person.handle)}
                    className="w-16"
                  >
                    Remove
                  </Button>
                ) : (
                  // Keeps the columns aligned. No button, so nothing empty to focus.
                  <span aria-hidden className="w-16" />
                )}
              </li>
            )
          })}
        </ul>
        {owners === 1 && isOwner && (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            You are the only owner. To hand the organization over, make someone
            else an owner first, then change your own role.
          </p>
        )}
      </section>

      {canInvite && (
        <section className={card}>
          <div className="space-y-1">
            <h2 className="text-sm font-medium">Add someone</h2>
            <p className="text-sm text-muted-foreground">
              Enter an email to invite them: they get a link, and have no access
              until they accept. Or enter the address of someone who already has
              an account to add them now.
            </p>
          </div>
          <form
            onSubmit={(e) => void onAdd(e)}
            noValidate
            className="flex flex-wrap items-end gap-2"
          >
            <Field label="Email or address" className="min-w-56 flex-1">
              <Input
                placeholder="name@example.com or their-address"
                autoCapitalize="none"
                spellCheck={false}
                value={who}
                onChange={(e) => setWho(e.target.value)}
              />
            </Field>
            <Field label="Role" className="w-32">
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as Role)}
              >
                {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </Select>
            </Field>
            <Button type="submit" variant="brand" disabled={busy}>
              <UserPlusIcon /> {who.includes('@') ? 'Invite' : 'Add'}
            </Button>
          </form>
          {invites.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {invites.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <Badge tone="warning">Pending</Badge>
                  <RoleBadge role={i.role} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void write('invitations.revoke', {
                        handle: org.handle,
                        invitation: i.id,
                      }).then(report)
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={card}>
        <h2 className="text-sm font-medium">What each role can do</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {(
            [
              [
                'owner',
                'Everything, including roles and billing. At least one.',
              ],
              [
                'admin',
                'Edit the organization, invite people and remove members.',
              ],
              ['member', 'Work in its repositories. Cannot manage people.'],
            ] as const
          ).map(([r, text]) => (
            <div key={r} className="space-y-1.5">
              <dt>
                <RoleBadge role={r} />
              </dt>
              <dd className="text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={target ? `Remove ${target.person.name}?` : 'Remove member?'}
        description="They lose access to the organization's private repositories. Their past work stays."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (removing)
                void write('members.remove', {
                  handle: org.handle,
                  login: removing,
                }).then(report)
              setRemoving(null)
            }}
          >
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  )
}

/** The "new organization" form: a name, and a note on what happens next. */
export function NewOrganizationForm() {
  const { me } = useAccounts()
  const navigate = useNavigate()
  const write = useWrite()
  const [name, setName] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!me || !name.trim()) return
    setBusy(true)
    setError(null)
    // The address is generated, like a person's. A clash is rare: try again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const handle = randomHandle()
      const r = await write('accounts.create', {
        body: { handle, name: name.trim() },
      })
      if (r.error?.code === 'invalid_state') continue
      if (r.error) {
        setBusy(false)
        setError(r.error.message)
        return
      }
      // The new organization is now the account in use, so the dashboard is its own.
      switchAccount(me, r.data.handle)
      void navigate({ to: '/dashboard' })
      return
    }
    setBusy(false)
    setError('Could not find a free address. Try again.')
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className={`${card} space-y-5`}
    >
      {error && (
        <Callout tone="danger" title="Could not create it">
          {error}
        </Callout>
      )}
      <Field
        label="Organization name"
        hint="A company, a team or a project. You can change it later."
      >
        <Input
          autoFocus
          placeholder="Northwind Labs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={tried && !name.trim() ? true : undefined}
          disabled={busy}
        />
      </Field>
      {tried && !name.trim() && (
        <p role="alert" className="-mt-3 text-xs text-danger">
          Give the organization a name.
        </p>
      )}
      <Callout title="What happens next">
        You become its first owner and start acting as it. It owns the
        repositories you create in it, so they stay with the team when people
        come and go. Its address is generated.
      </Callout>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          render={<Link to="/dashboard" />}
          nativeButton={false}
        >
          Cancel
        </Button>
        <Button type="submit" variant="brand" size="lg" disabled={busy}>
          <PlusIcon /> {busy ? 'Creating' : 'Create organization'}
        </Button>
      </div>
    </form>
  )
}
