import * as React from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BellIcon,
  CheckIcon,
  CpuChipIcon,
  LinkIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { Provider } from '~/mock/extra'
import { Chip, SectionLabel, SourceBadge } from '~/components/forge/bits'
import { BrandLogo } from '~/components/brand'
import { TargetPicker } from '~/components/forge/download-button'
import { Bots } from '~/components/forge/agents-panels'
import { IntegrationsPanel } from '~/components/forge/integrations-panel'
import { Toggle } from '~/components/forge/repo-pages'
import { ContributionGraph } from '~/components/forge/repo-shell'
import { Button } from '~/components/ui/button'
import { repos } from '~/mock/data'
import { imports, providers } from '~/mock/extra'

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
  component: Settings,
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
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  )
}

const input =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

// ---------------------------------------------------------------------------
function ProfileSettings() {
  const [saved, setSaved] = React.useState(false)
  const mine = repos.filter((r) => r.owner === 'dana')
  const [pinned, setPinned] = React.useState<Set<string>>(
    new Set(mine.map((r) => r.name)),
  )
  const touch = () => setSaved(false)
  return (
    <div className="max-w-2xl">
      <Header id="profile" title="Profile">
        What people see when they open your page.
      </Header>
      <div className="space-y-6">
        <Card>
          <Field label="Display name">
            <input
              defaultValue="Dana Okafor"
              onChange={touch}
              className={input}
            />
          </Field>
          <Field
            label="Handle"
            hint="Your handle is part of every URL, so it cannot be changed here."
          >
            <input
              defaultValue="dana"
              disabled
              className={cn(input, 'font-mono')}
            />
          </Field>
          <Field label="Bio" hint="One line. Shown under your name.">
            <textarea
              defaultValue="Building small, fast dev tools. Rust and TypeScript."
              rows={2}
              onChange={touch}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
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
          <Button variant="brand" size="lg" onClick={() => setSaved(true)}>
            Save profile
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
type Conn = {
  status: 'idle' | 'authorizing' | 'syncing' | 'connected'
  progress: number
  lastSync: string
  opts: { privateCounts: boolean; releases: boolean; auto: boolean }
  confirmDisconnect: boolean
}

const stages = [
  'Reading commits',
  'Matching your email addresses',
  'Linking pull requests and reviews',
  'Updating your profile',
]

function initial(connected: boolean): Conn {
  return {
    status: connected ? 'connected' : 'idle',
    progress: connected ? 100 : 0,
    lastSync: connected ? '14 min ago' : '',
    opts: { privateCounts: true, releases: true, auto: true },
    confirmDisconnect: false,
  }
}

function Accounts() {
  const [conns, setConns] = React.useState<Record<string, Conn>>({
    github: initial(true),
    gitlab: initial(true),
    codeberg: initial(false),
    gitea: initial(false),
  })
  const [dialog, setDialog] = React.useState<Provider | null>(null)
  const [instance, setInstance] = React.useState('')
  const [emails, setEmails] = React.useState([
    { email: 'dana@okafor.dev', verified: true },
    { email: 'dana.okafor@users.noreply.example', verified: true },
  ])
  const [newEmail, setNewEmail] = React.useState('')

  const patch = (id: string, p: Partial<Conn>) =>
    setConns((c) => ({ ...c, [id]: { ...c[id], ...p } }))

  // Simulated import: progress ticks until the account is fully linked.
  const syncing = Object.entries(conns).filter(
    ([, c]) => c.status === 'syncing' || c.status === 'authorizing',
  )
  React.useEffect(() => {
    if (syncing.length === 0) return
    const t = setTimeout(() => {
      setConns((all) => {
        const next = { ...all }
        for (const [id, c] of Object.entries(all)) {
          if (c.status === 'authorizing')
            next[id] = { ...c, status: 'syncing', progress: 4 }
          else if (c.status === 'syncing') {
            const progress = Math.min(100, c.progress + 9)
            next[id] =
              progress >= 100
                ? {
                    ...c,
                    status: 'connected',
                    progress: 100,
                    lastSync: 'just now',
                  }
                : { ...c, progress }
          }
        }
        return next
      })
    }, 380)
    return () => clearTimeout(t)
  })

  const total = providers.reduce(
    (sum, p) =>
      sum + (conns[p.id].status === 'connected' ? p.account.contributions : 0),
    640,
  )
  const linked = providers.filter(
    (p) => conns[p.id].status === 'connected',
  ).length
  const instanceOk = /^https:\/\/[^\s/]+\.[^\s/]+/.test(instance)

  return (
    <div className="max-w-3xl">
      <Header id="accounts" title="Linked accounts">
        Bring your history from other hosts so your profile tells the whole
        story. Visitors see one combined record. Where each piece came from
        stays private.
      </Header>

      <Card className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-4xl font-semibold tracking-tighter tabular-nums">
              {total.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground">
              contributions on your profile from {linked + 1}{' '}
              {linked === 0 ? 'source' : 'sources'}
            </div>
          </div>
          <Chip>Visible to visitors as one total</Chip>
        </div>
        <ContributionGraph seed={11 + linked * 17} weeks={52} />
      </Card>

      <div className="space-y-3">
        {providers.map((p) => {
          const c = conns[p.id]
          const stage =
            stages[
              Math.min(
                stages.length - 1,
                Math.floor((c.progress / 100) * stages.length),
              )
            ]
          return (
            <section
              key={p.id}
              className="surface rounded-2xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card">
                    {p.id !== 'native' && <BrandLogo id={p.id} />}
                  </span>
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {p.blurb}
                    </div>
                  </div>
                </div>
                {c.status === 'idle' && (
                  <Button onClick={() => setDialog(p)}>Connect</Button>
                )}
                {c.status === 'authorizing' && (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <ArrowPathIcon className="size-4 animate-spin motion-reduce:animate-none" />{' '}
                    Waiting for {p.name}
                  </span>
                )}
                {c.status === 'connected' && (
                  <Chip tone="success">
                    <CheckIcon className="size-3" /> Linked
                  </Chip>
                )}
              </div>

              {c.status === 'syncing' && (
                <div className="mt-4 space-y-1.5" aria-live="polite">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stage}</span>
                    <span className="font-mono tabular-nums">
                      {c.progress}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand-ink transition-[width] duration-300 ease-out"
                      style={{ width: `${c.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {c.status === 'connected' && (
                <div className="mt-4 space-y-4 border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>
                      <b className="font-mono">@{p.account.handle}</b>
                      <span className="text-muted-foreground">
                        {' '}
                        {p.account.contributions.toLocaleString()}{' '}
                        contributions, {p.account.repos} repositories, since{' '}
                        {p.account.since}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Synced {c.lastSync}
                    </span>
                  </div>
                  <Toggle
                    label="Count private contributions"
                    hint="Adds totals only. No titles, repositories or code are ever shown."
                    checked={c.opts.privateCounts}
                    onChange={(v) =>
                      patch(p.id, { opts: { ...c.opts, privateCounts: v } })
                    }
                  />
                  <Toggle
                    label="Import releases"
                    hint="Copies release files so downloads keep working here."
                    checked={c.opts.releases}
                    onChange={(v) =>
                      patch(p.id, { opts: { ...c.opts, releases: v } })
                    }
                  />
                  <Toggle
                    label="Keep history in sync"
                    hint="New activity is pulled in every 15 minutes."
                    checked={c.opts.auto}
                    onChange={(v) =>
                      patch(p.id, { opts: { ...c.opts, auto: v } })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        patch(p.id, { status: 'syncing', progress: 4 })
                      }
                    >
                      <ArrowPathIcon className="size-4" />
                      Sync now
                    </Button>
                    {c.confirmDisconnect ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">
                          Disconnect {p.name}?
                        </span>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setConns((all) => ({
                              ...all,
                              [p.id]: initial(false),
                            }))
                          }
                        >
                          Keep imported history
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            setConns((all) => ({
                              ...all,
                              [p.id]: initial(false),
                            }))
                          }
                        >
                          Remove it too
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            patch(p.id, { confirmDisconnect: false })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => patch(p.id, { confirmDisconnect: true })}
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <Card className="mt-6">
        <SectionLabel>Commit emails</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Commits written with these addresses are credited to you, whichever
          host they came from.
        </p>
        <ul className="divide-y rounded-lg border">
          {emails.map((e) => (
            <li
              key={e.email}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">{e.email}</span>
              {e.verified ? (
                <Chip tone="success">Verified</Chip>
              ) : (
                <Chip tone="warning">Check your inbox</Chip>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (!/^\S+@\S+\.\S+$/.test(newEmail)) return
            setEmails((l) => [...l, { email: newEmail, verified: false }])
            setNewEmail('')
          }}
        >
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Add an email"
            className={input}
          />
          <Button type="submit" variant="outline" size="lg">
            Add
          </Button>
        </form>
      </Card>

      <Card className="mt-6">
        <div className="flex items-start justify-between gap-4">
          <SectionLabel>Imported projects</SectionLabel>
          <Chip>Only visible to you</Chip>
        </div>
        <ul className="divide-y rounded-lg border">
          {imports.map((i) => (
            <li
              key={i.name}
              className="flex items-center gap-3 px-3 py-2.5 text-sm"
            >
              <span className="flex-1 font-mono">dana/{i.name}</span>
              <SourceBadge source={i.from} />
              <span className="w-28 text-right text-xs text-muted-foreground">
                {i.status}, {i.when}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/new"
          search={{ mode: 'import' }}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Import more projects
        </Link>
      </Card>

      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(o) => !o && (setDialog(null), setInstance(''))}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="overlay-backdrop fixed inset-0 z-50 bg-background/80" />
          <Dialog.Popup className="overlay-popup fixed top-[18vh] left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 space-y-4 rounded-xl border bg-popover p-6 shadow-2xl outline-none">
            {dialog && (
              <>
                <Dialog.Title className="text-lg font-semibold tracking-tight">
                  Connect {dialog.name}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  source.code will ask {dialog.name} for read-only access. It
                  never writes to your account.
                </Dialog.Description>
                {dialog.id === 'gitea' && (
                  <Field
                    label="Instance address"
                    hint="For example https://git.example.com"
                  >
                    <input
                      value={instance}
                      onChange={(e) => setInstance(e.target.value)}
                      placeholder="https://"
                      className={cn(input, 'font-mono')}
                    />
                  </Field>
                )}
                <ul className="space-y-2 rounded-lg border bg-background p-3 text-sm">
                  {dialog.scopes.map((s) => (
                    <li key={s} className="flex items-center gap-2">
                      <CheckIcon className="size-4 text-success" />
                      {s}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => (setDialog(null), setInstance(''))}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="brand"
                    size="lg"
                    disabled={dialog.id === 'gitea' && !instanceOk}
                    onClick={() => {
                      patch(dialog.id, { status: 'authorizing' })
                      setDialog(null)
                      setInstance('')
                    }}
                  >
                    Authorize
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
  const [state, setState] = React.useState({
    combined: true,
    privateTotals: true,
    searchable: true,
    activity: true,
    agents: true,
  })
  const set = (k: keyof typeof state) => (v: boolean) =>
    setState((s) => ({ ...s, [k]: v }))
  return (
    <div className="max-w-2xl">
      <Header id="privacy" title="Privacy">
        You decide what your profile shows. Linked accounts stay linked quietly.
      </Header>
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
  const [s, setS] = React.useState({
    review: true,
    mention: true,
    release: true,
    ci: true,
    imports: true,
    digest: false,
  })
  const set = (k: keyof typeof s) => (v: boolean) =>
    setS((o) => ({ ...o, [k]: v }))
  return (
    <div className="max-w-2xl">
      <Header id="notifications" title="Notifications">
        Choose what reaches your inbox and your email.
      </Header>
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
          label="Finished imports and syncs"
          checked={s.imports}
          onChange={set('imports')}
        />
        <Toggle
          label="Weekly digest by email"
          hint="One email on Mondays with what changed."
          checked={s.digest}
          onChange={set('digest')}
        />
      </Card>
    </div>
  )
}
