import * as React from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowDownTrayIcon,
  BellIcon,
  CpuChipIcon,
  LinkIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { AuthUser } from '~/lib/auth/client'
import { RequireAuth } from '~/components/forge/auth'
import { useOp, useOpMaybe, useWrite } from '~/lib/forge'
import { useMe } from '~/lib/auth/accounts'
import { Input } from '~/components/ui/input'
import { Chip, SectionLabel, SourceBadge } from '~/components/forge/bits'
import { BrandLogo } from '~/components/brand'
import { TargetPicker } from '~/components/forge/download-button'
import { useTarget } from '~/lib/platform'
import { Bots } from '~/components/forge/agents-panels'
import { IntegrationsPanel } from '~/components/forge/integrations-panel'
import { Toggle } from '~/components/forge/repo-pages'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth/client'
import { toRepo } from '~/lib/repo'

const sections = [
  ['profile', 'Profile', UserIcon],
  ['accounts', 'Linked accounts', LinkIcon],
  ['integrations', 'Integrations', PuzzlePieceIcon],
  ['agents', 'Agents and tokens', CpuChipIcon],
  ['privacy', 'Privacy', ShieldCheckIcon],
  ['downloads', 'Downloads', ArrowDownTrayIcon],
  ['notifications', 'Notifications', BellIcon],
] as const

type SectionId = (typeof sections)[number][0]

export const Route = createFileRoute('/settings/$section')({
  head: () => ({ meta: [{ title: 'Settings · source.code' }] }),
  component: () => (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  ),
})

function Settings() {
  const { section } = Route.useParams()
  const current = sections.find(([id]) => id === section)?.[0]
  if (!current) throw notFound()
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label="Settings"
        className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:self-start"
      >
        {sections.map(([id, label, Icon]) => (
          <Link
            key={id}
            to="/settings/$section"
            params={{ section: id }}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              id === current && 'bg-muted font-medium text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {current === 'profile' && <ProfileSettings />}
        {current === 'accounts' && <Accounts />}
        {current === 'integrations' && (
          <div className="max-w-3xl">
            <Header id="integrations" title="Integrations">
              Connect a service once. Then turn it on for the repositories that
              should use it, from each repository&apos;s settings.
            </Header>
            <IntegrationsPanel />
          </div>
        )}
        {current === 'agents' && (
          <div className="max-w-4xl">
            <Header id="agents" title="Agents and tokens">
              Bots are named identities with limited access. A bot can lose
              access while it is installed, never gain it.
            </Header>
            <Bots />
          </div>
        )}
        {current === 'privacy' && <Privacy />}
        {current === 'downloads' && <Downloads />}
        {current === 'notifications' && <Notifications />}
      </div>
    </div>
  )
}

function Header({
  id,
  title,
  children,
}: {
  id: SectionId
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6" data-section={id}>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && (
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  )
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('space-y-4 rounded-xl border bg-card p-5', className)}
    >
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )
      )}
    </label>
  )
}

const input =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

// ---------------------------------------------------------------------------
function ProfileSettings() {
  const { data: session } = authClient.useSession()
  // The route is behind RequireAuth, so there is always a person here.
  if (!session) return null
  return <ProfileForm user={session.user} />
}

type Problem = { field: 'name' | 'email' | 'handle'; message: string }
const problemField: Record<string, Problem['field']> = {
  INVALID_NAME: 'name',
  INVALID_EMAIL: 'email',
  INVALID_ADDRESS: 'handle',
  ADDRESS_TAKEN: 'handle',
}

function ProfileForm({ user }: { user: AuthUser }) {
  const [saved, setSaved] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState(user.name)
  const [email, setEmail] = React.useState(user.email)
  const [address, setAddress] = React.useState(user.handle)
  const [problem, setProblem] = React.useState<Problem | null>(null)
  const emailChanged = email.trim().toLowerCase() !== user.email

  const save = async () => {
    setSaving(true)
    setProblem(null)
    const { error } = await authClient.updateUser({
      name,
      email,
      handle: address,
    })
    setSaving(false)
    if (error) {
      setProblem({
        field: problemField[error.code] ?? 'name',
        message: error.message,
      })
      return
    }
    setSaved(true)
  }
  const owned = useOpMaybe(
    'repos.list',
    { owner: user.handle, limit: 100 },
    !!user.handle,
  )
  const mine = (owned?.data ?? []).map((r) => toRepo(r))
  // Nothing pinned means all of them, until pinning is saved with the profile.
  const [unpinned, setUnpinned] = React.useState<Set<string>>(new Set())
  const pinned = new Set(
    mine.map((r) => r.name).filter((n) => !unpinned.has(n)),
  )
  const setPinned = (next: Set<string>) =>
    setUnpinned(new Set(mine.map((r) => r.name).filter((n) => !next.has(n))))
  const touch = () => setSaved(false)
  const errorOf = (f: Problem['field']) =>
    problem?.field === f ? problem.message : null
  return (
    <div className="max-w-2xl">
      <Header id="profile" title="Profile">
        What people see when they open your page.
      </Header>
      <div className="space-y-6">
        <Card>
          <Field
            label="Full name"
            hint="What people see on your page. Companies get their own page, so this is always a person's name."
            error={errorOf('name')}
          >
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                touch()
              }}
              autoComplete="name"
              className={input}
            />
          </Field>
          <Field
            label="Email"
            hint={
              emailChanged
                ? 'We will send a link to the new address. It changes once you open it.'
                : 'Where we send sign-in and security messages. Never shown on your page.'
            }
            error={errorOf('email')}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                touch()
              }}
              autoComplete="email"
              className={input}
            />
          </Field>
          <Field
            label="Address"
            hint="Your page and every project link start with it. If you change it, old links keep working and redirect to the new one."
            error={errorOf('handle')}
          >
            <span className="relative block">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground"
              >
                source.code/
              </span>
              <input
                value={address}
                onChange={(e) => {
                  setAddress(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  )
                  touch()
                }}
                autoCapitalize="none"
                spellCheck={false}
                className={cn(input, 'pl-[calc(12ch+1rem)] font-mono')}
              />
            </span>
          </Field>
          <Field label="Bio" hint="One line. Shown under your name.">
            <textarea
              defaultValue="Building small, fast dev tools. Rust and TypeScript."
              rows={2}
              onChange={touch}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Location">
              <input defaultValue="Lagos" onChange={touch} className={input} />
            </Field>
            <Field label="Website">
              <input
                defaultValue="https://dana.dev"
                onChange={touch}
                className={input}
              />
            </Field>
          </div>
        </Card>
        <Card>
          <SectionLabel>Pinned projects</SectionLabel>
          <p className="text-sm text-muted-foreground">
            Shown first on your profile. Pick up to six.
          </p>
          <ul className="divide-y rounded-lg border">
            {mine.map((r) => (
              <li key={r.name}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={pinned.has(r.name)}
                    onChange={(e) => {
                      const next = new Set(pinned)
                      if (e.target.checked) next.add(r.name)
                      else next.delete(r.name)
                      setPinned(next)
                      touch()
                    }}
                    className="size-4 accent-[var(--brand-ink)]"
                  />
                  <span className="font-mono">{r.name}</span>
                  <span className="truncate text-muted-foreground">
                    {r.description}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-success">Saved</span>}
          <Button
            variant="brand"
            size="lg"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving' : 'Save profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
const hosts = [
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Commits, pull requests, reviews, issues and releases.',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    blurb: 'Commits, merge requests, issues and pipelines.',
  },
  {
    id: 'codeberg',
    name: 'Codeberg',
    blurb: 'Commits, pull requests and issues.',
  },
  {
    id: 'gitea',
    name: 'Gitea',
    blurb: 'Your own Gitea or Forgejo server.',
  },
] as const

function Accounts() {
  const me = useMe()
  const handle = me?.handle ?? ''
  const links = useOpMaybe('links.list', { handle }, !!me)?.data ?? []
  const imports = useOpMaybe('imports.list', {}, !!me)?.data ?? []
  const session = authClient.useSession().data
  const write = useWrite()
  const [dialog, setDialog] = React.useState<(typeof hosts)[number] | null>(
    null,
  )
  const [login, setLogin] = React.useState('')
  const [instance, setInstance] = React.useState('')
  const [error, setError] = React.useState('')
  const [confirm, setConfirm] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState(false)
  const instanceOk = /^https:\/\/[^\s/]+\.[^\s/]+/.test(instance)
  const close = () => {
    setDialog(null)
    setLogin('')
    setInstance('')
    setError('')
  }

  return (
    <div className="max-w-3xl">
      <Header id="accounts" title="Linked accounts">
        Say who you are on other hosts, and bring projects from them. Where a
        project came from stays private.
      </Header>

      <Card className="mb-6">
        <div className="font-mono text-4xl font-semibold tracking-tighter tabular-nums">
          {links.length}
        </div>
        <div className="text-sm text-muted-foreground">
          linked {links.length === 1 ? 'account' : 'accounts'}. Contributions
          from other hosts are counted once source.code can sign in with them.
        </div>
      </Card>

      <div className="space-y-3">
        {hosts.map((p) => {
          const link = links.find((l) => l.host === p.id)
          return (
            <section
              key={p.id}
              className="surface rounded-2xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card">
                    <BrandLogo id={p.id} />
                  </span>
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {p.blurb}
                    </div>
                  </div>
                </div>
                {link ? (
                  <Chip tone="warning">Linked, not verified</Chip>
                ) : (
                  <Button onClick={() => setDialog(p)}>Link</Button>
                )}
              </div>
              {link && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
                  <span>
                    <b className="font-mono">@{link.login}</b>
                    {link.instance && (
                      <span className="text-muted-foreground">
                        {' '}
                        on {link.instance}
                      </span>
                    )}
                  </span>
                  {confirm === p.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        Unlink {p.name}?
                      </span>
                      <Button
                        variant="danger"
                        onClick={() =>
                          void write('links.remove', {
                            handle,
                            host: p.id,
                          }).then(() => setConfirm(null))
                        }
                      >
                        Unlink
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirm(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setConfirm(p.id)}
                    >
                      Unlink
                    </Button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <Card className="mt-6">
        <SectionLabel>Email</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Commits written with it are credited to you. One address per account
          for now.
        </p>
        {session && (
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <span className="font-mono text-xs">{session.user.email}</span>
            {session.user.emailVerified ? (
              <Chip tone="success">Verified</Chip>
            ) : sent ? (
              <Chip tone="warning">Link sent</Chip>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void authClient
                    .sendVerification(session.user.email)
                    .then((r) =>
                      r.error ? setError(r.error.message) : setSent(true),
                    )
                }
              >
                Verify it
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="flex items-start justify-between gap-4">
          <SectionLabel>Imported projects</SectionLabel>
          <Chip>Only visible to you</Chip>
        </div>
        <ul className="divide-y rounded-lg border">
          {imports.map((i) => (
            <li
              key={i.repo}
              className="flex items-center gap-3 px-3 py-2.5 text-sm"
            >
              <span className="flex-1 font-mono">{i.repo}</span>
              <SourceBadge source={i.host} />
              <span className="w-32 text-right text-xs text-muted-foreground">
                {i.state === 'in-sync' ? 'In sync' : i.state}
              </span>
            </li>
          ))}
          {imports.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing imported yet.
            </li>
          )}
        </ul>
        <Link
          to="/new"
          search={{ mode: 'import' }}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Import projects
        </Link>
      </Card>

      <Dialog.Root open={dialog !== null} onOpenChange={(o) => !o && close()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="overlay-backdrop fixed inset-0 z-50 bg-background/80" />
          <Dialog.Popup className="overlay-popup fixed top-[18vh] left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 space-y-4 rounded-xl border bg-popover p-6 shadow-2xl outline-none">
            {dialog && (
              <>
                <Dialog.Title className="text-lg font-semibold tracking-tight">
                  Link {dialog.name}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Say who you are there. Until source.code can sign in with{' '}
                  {dialog.name}, it is shown as not verified.
                </Dialog.Description>
                <Field label={`Your ${dialog.name} username`}>
                  <Input
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    className="font-mono"
                  />
                </Field>
                {dialog.id === 'gitea' && (
                  <Field label="Server address">
                    <Input
                      value={instance}
                      onChange={(e) => setInstance(e.target.value)}
                      placeholder="https://git.example.com"
                      className="font-mono"
                    />
                  </Field>
                )}
                {error && <p className="text-sm text-danger">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="brand"
                    size="lg"
                    disabled={
                      !login.trim() || (dialog.id === 'gitea' && !instanceOk)
                    }
                    onClick={() =>
                      void write('links.set', {
                        handle,
                        host: dialog.id,
                        body: {
                          login: login.trim(),
                          ...(dialog.id === 'gitea' ? { instance } : {}),
                        },
                      }).then((r) =>
                        r.error ? setError(r.error.message) : close(),
                      )
                    }
                  >
                    Link
                  </Button>
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Privacy() {
  const prefs = useOp('preferences.get', {})
  const write = useWrite()
  const [error, setError] = React.useState('')
  const state = {
    combined: prefs.combined_total,
    privateTotals: prefs.private_totals,
    searchable: prefs.searchable,
    activity: prefs.show_activity,
    agents: prefs.show_agents,
  }
  const field = {
    combined: 'combined_total',
    privateTotals: 'private_totals',
    searchable: 'searchable',
    activity: 'show_activity',
    agents: 'show_agents',
  } as const
  const set = (k: keyof typeof state) => (v: boolean) =>
    void write('preferences.update', { body: { [field[k]]: v } }).then((r) =>
      setError(r.error?.message ?? ''),
    )
  return (
    <div className="max-w-2xl">
      <Header id="privacy" title="Privacy">
        You decide what your profile shows. Linked accounts stay linked quietly.
        How we handle your data is in the{' '}
        <Link
          to="/privacy"
          className="underline decoration-border underline-offset-4 hover:text-foreground"
        >
          privacy policy
        </Link>
        .
      </Header>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <div className="space-y-6">
        <Card>
          <Toggle
            label="Show one combined contribution total"
            hint="Merges everything you linked into a single number and graph."
            checked={state.combined}
            onChange={set('combined')}
          />
          <Toggle
            label="Include private contribution totals"
            hint="Counts only. Titles and repositories are never exposed."
            checked={state.privateTotals}
            onChange={set('privateTotals')}
          />
          <Toggle
            label="Show recent activity"
            hint="Pushes, releases and reviews on public projects."
            checked={state.activity}
            onChange={set('activity')}
          />
          <Toggle
            label="Show how I work with agents"
            hint="The share of recent commits that were agent-assisted, and which agents. Only counts changes a person reviewed."
            checked={state.agents}
            onChange={set('agents')}
          />
          <Toggle
            label="Let people find me by name"
            hint="Appears in search and on the People tab of Discover."
            checked={state.searchable}
            onChange={set('searchable')}
          />
        </Card>
        <Card>
          <SectionLabel>Where projects came from</SectionLabel>
          <fieldset className="space-y-2 text-sm">
            {(
              [
                ['me', 'Only me', true],
                ['team', 'People I invite to a project', false],
                ['public', 'Everyone', false],
              ] as const
            ).map(([id, label, on]) => (
              <label
                key={id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3',
                  !on && 'opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="origin"
                  checked={on}
                  disabled={!on}
                  readOnly
                  className="accent-[var(--brand-ink)]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            source.code is its own home for your work, so imported projects look
            like any other project. Their origin is never shown on Discover or
            on a project page.
          </p>
        </Card>
        <Card>
          <SectionLabel>Your data</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Export everything</Button>
            <Button variant="danger">Delete account</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Downloads() {
  const prefs = useOp('preferences.get', {})
  const write = useWrite()
  const { target, isOverridden } = useTarget()
  const saved = prefs.download_target
  // What is picked here is kept with the account, so it follows you to
  // another browser; this browser's own choice is applied at once.
  React.useEffect(() => {
    if (!target) return
    const next =
      isOverridden && target.arch ? { os: target.os, arch: target.arch } : null
    if (JSON.stringify(next) === JSON.stringify(saved)) return
    void write('preferences.update', { body: { download_target: next } })
  }, [target, isOverridden, saved, write])
  return (
    <div className="max-w-2xl">
      <Header id="downloads" title="Downloads">
        The theme follows your device, so there is nothing to set for it.
      </Header>
      <Card>
        <p className="text-sm text-muted-foreground">
          Every download button picks the file for the machine you are on, down
          to the CPU. If we guess wrong, correct it here and we will remember.
        </p>
        <TargetPicker />
      </Card>
    </div>
  )
}

function Notifications() {
  const s = useOp('notifications.preferences', {})
  const write = useWrite()
  const [error, setError] = React.useState('')
  const set = (k: Exclude<keyof typeof s, 'object'>) => (v: boolean) =>
    void write('notifications.update_preferences', { body: { [k]: v } }).then(
      (r) => setError(r.error?.message ?? ''),
    )
  return (
    <div className="max-w-2xl">
      <Header id="notifications" title="Notifications">
        Choose what reaches your inbox and your email.
      </Header>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <Card>
        <Toggle
          label="Review requests"
          checked={s.review}
          onChange={set('review')}
        />
        <Toggle
          label="Mentions"
          checked={s.mention}
          onChange={set('mention')}
        />
        <Toggle
          label="New releases from projects you follow"
          checked={s.release}
          onChange={set('release')}
        />
        <Toggle
          label="Failed builds on your projects"
          checked={s.ci}
          onChange={set('ci')}
        />
        <Toggle
          label="Issues assigned to you"
          checked={s.issue}
          onChange={set('issue')}
        />
        <Toggle
          label="Finished imports and syncs"
          checked={s.import}
          onChange={set('import')}
        />
        <Toggle
          label="Weekly digest by email"
          hint="One email on Mondays with what changed. Saved now; the email starts when sending does."
          checked={s.digest}
          onChange={set('digest')}
        />
      </Card>
    </div>
  )
}
