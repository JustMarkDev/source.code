import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowTurnDownLeftIcon,
  BellIcon,
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Kbd } from './bits'
import { AccountTile } from './organization'
import type { LinkProps } from '@tanstack/react-router'
import { siDiscord, siGithub, siX, siYoutube } from '~/components/social-icons'
import { Pill } from '~/components/motion'
import { Button } from '~/components/ui/button'
import { Dropdown, MenuItem, MenuSeparator } from '~/components/ui/menu'
import { switchAccount, useAccounts } from '~/lib/auth/accounts'
import { useTarget } from '~/lib/platform'
import { authClient } from '~/lib/auth/client'
import { socials } from '~/lib/site'
import { developers, repos } from '~/mock/data'
import { notifications } from '~/mock/extra'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        '-my-2 inline-flex items-center gap-2 py-2 font-mono text-sm font-semibold tracking-tight',
        className,
      )}
    >
      <span>
        source<span className="text-brand-ink">.</span>code
      </span>
    </Link>
  )
}

/**
 * The account menu. It is also the account switcher: one login, and the
 * accounts it can act as listed first, so changing who you are acting as is
 * one click from anywhere.
 */
function UserMenu() {
  const navigate = useNavigate()
  const { me, accounts, active } = useAccounts()
  if (!me || !active) return null
  const org = active.kind === 'organization'
  return (
    <Dropdown
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="flex items-center gap-2 rounded-xl py-0.5 pr-1 pl-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:pr-2"
        >
          <AccountTile account={active} className="size-8 text-xs" />
          <span className="hidden max-w-32 truncate text-sm font-medium lg:block">
            {active.name}
          </span>
          <ChevronUpDownIcon className="hidden size-4 text-muted-foreground lg:block" />
        </button>
      }
    >
      <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        Acting as
      </div>
      {accounts.map((a) => (
        <MenuItem
          key={a.id}
          onClick={() => switchAccount(me, a.id)}
          className="gap-3 py-2"
        >
          <AccountTile account={a} className="size-7 text-xs" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">
              {a.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {a.kind === 'person' ? `@${a.handle} · you` : 'Organization'}
            </span>
          </span>
          {a.id === active.id && (
            <CheckIcon className="size-4 text-foreground" />
          )}
        </MenuItem>
      ))}
      <MenuItem render={<Link to="/organizations/new" />}>
        <PlusIcon /> New organization
      </MenuItem>
      <MenuSeparator />
      <MenuItem render={<Link to="/dashboard" />}>Dashboard</MenuItem>
      {org ? (
        <MenuItem
          render={<Link to="/$handle" params={{ handle: active.handle }} />}
        >
          Public page
        </MenuItem>
      ) : (
        <MenuItem
          render={<Link to="/dashboard" search={{ view: 'profile' }} />}
        >
          Public profile
        </MenuItem>
      )}
      <MenuItem
        render={
          org ? (
            <Link
              to="/organizations/$handle/$section"
              params={{ handle: active.handle, section: 'general' }}
            />
          ) : (
            <Link to="/settings/$section" params={{ section: 'profile' }} />
          )
        }
      >
        {org ? 'Organization settings' : 'Settings'}
      </MenuItem>
      {org ? (
        <MenuItem
          render={
            <Link to="/settings/$section" params={{ section: 'profile' }} />
          }
        >
          Your personal settings
        </MenuItem>
      ) : (
        <MenuItem
          render={
            <Link
              to="/settings/$section"
              params={{ section: 'integrations' }}
            />
          }
        >
          Integrations
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        className="text-muted-foreground"
        onClick={() => {
          // Leave first: a private page would send the visitor to sign in.
          void navigate({ to: '/' }).then(() => authClient.signOut())
        }}
      >
        Sign out
      </MenuItem>
    </Dropdown>
  )
}

/** Palette entries that make no sense without an account. */
const accountOnly = new Set([
  'dashboard',
  'inbox',
  'settings',
  'integrations',
  'accounts',
  'new',
])

type Command = {
  id: string
  label: string
  hint: string
  group: 'Projects' | 'People' | 'Go to' | 'Accounts'
  keys?: string
  run: () => void
}

function CommandPalette({
  open,
  onOpenChange,
  signedIn,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signedIn: boolean
}) {
  const navigate = useNavigate()
  const { me, accounts, active: acting } = useAccounts()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)

  const commands = React.useMemo<Array<Command>>(
    () => [
      {
        id: 'dashboard',
        label: 'Dashboard',
        hint: 'What needs you, and your public profile',
        group: 'Go to',
        keys: 'g d',
        run: () => void navigate({ to: '/dashboard' }),
      },
      {
        id: 'discover',
        label: 'Discover',
        hint: 'Find projects and people',
        group: 'Go to',
        keys: 'g e',
        run: () => void navigate({ to: '/discover' }),
      },
      {
        id: 'inbox',
        label: 'Inbox',
        hint: 'Reviews, mentions and releases',
        group: 'Go to',
        keys: 'g i',
        run: () => void navigate({ to: '/inbox' }),
      },
      {
        id: 'settings',
        label: 'Settings',
        hint: 'Profile, linked accounts, integrations, agents',
        group: 'Go to',
        keys: 'g s',
        run: () =>
          void navigate({
            to: '/settings/$section',
            params: { section: 'profile' },
          }),
      },
      {
        id: 'integrations',
        label: 'Integrations',
        hint: 'Reviewers, runners, agent environments, secrets',
        group: 'Go to',
        run: () =>
          void navigate({
            to: '/settings/$section',
            params: { section: 'integrations' },
          }),
      },
      {
        id: 'accounts',
        label: 'Linked accounts',
        hint: 'Bring your history from another host',
        group: 'Go to',
        run: () =>
          void navigate({
            to: '/settings/$section',
            params: { section: 'accounts' },
          }),
      },
      {
        id: 'pricing',
        label: 'Pricing',
        hint: 'Plans for storage, history and teams',
        group: 'Go to',
        run: () => void navigate({ to: '/pricing' }),
      },
      {
        id: 'status',
        label: 'Status',
        hint: 'Is everything running?',
        group: 'Go to',
        run: () => void navigate({ to: '/status' }),
      },
      {
        id: 'docs',
        label: 'Docs',
        hint: 'Guides, CLI and configuration reference',
        group: 'Go to',
        run: () => void navigate({ to: '/docs/$', params: { _splat: '' } }),
      },
      {
        id: 'new',
        label: 'New repository',
        hint: 'Create or import',
        group: 'Go to',
        run: () => void navigate({ to: '/new' }),
      },
      ...repos.map<Command>((r) => ({
        id: `${r.owner}/${r.name}`,
        label: `${r.owner}/${r.name}`,
        hint: r.description,
        group: 'Projects',
        run: () =>
          void navigate({
            to: '/$handle/$repo/$tab',
            params: { handle: r.owner, repo: r.name, tab: 'code' },
          }),
      })),
      ...developers.map<Command>((d) => ({
        id: `@${d.handle}`,
        label: d.name,
        hint: `@${d.handle}`,
        group: 'People',
        run: () =>
          void navigate({ to: '/$handle', params: { handle: d.handle } }),
      })),
    ],
    [navigate],
  )

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    // Switching is as close as search: every account you can act as, and a way to make one.
    const accountCommands: Array<Command> =
      me && acting
        ? [
            ...accounts
              .filter((a) => a.id !== acting.id)
              .map<Command>((a) => ({
                id: `switch:${a.id}`,
                label: `Switch to ${a.name}`,
                hint:
                  a.kind === 'organization'
                    ? 'Act as this organization'
                    : 'Act as yourself',
                group: 'Accounts',
                run: () => void switchAccount(me, a.id),
              })),
            {
              id: 'new-organization',
              label: 'New organization',
              hint: 'A company, team or project that owns repositories',
              group: 'Accounts',
              run: () => void navigate({ to: '/organizations/new' }),
            },
          ]
        : []
    // Pages that need an account are only offered to someone who has one.
    const available = signedIn
      ? [...accountCommands, ...commands]
      : [
          {
            id: 'sign-in',
            label: 'Sign in',
            hint: 'Pick up where you left off',
            group: 'Go to' as const,
            run: () => void navigate({ to: '/sign-in' }),
          },
          {
            id: 'sign-up',
            label: 'Create an account',
            hint: 'Free to start. Bring your history with you',
            group: 'Go to' as const,
            run: () => void navigate({ to: '/sign-up' }),
          },
          ...commands.filter((c) => !accountOnly.has(c.id)),
        ]
    const list = q
      ? available.filter((c) =>
          `${c.label} ${c.hint}`.toLowerCase().includes(q),
        )
      : available.filter((c) => c.group === 'Go to' || c.group === 'Accounts')
    return list.slice(0, 8)
  }, [commands, query, signedIn, navigate, me, acting, accounts])

  const pick = (c: Command | undefined) => {
    if (!c) return
    onOpenChange(false)
    c.run()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setQuery('')
          setActive(0)
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay-backdrop fixed inset-0 z-50 bg-foreground/25" />
        <Dialog.Popup
          aria-label="Search"
          className="overlay-popup fixed top-[16vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-2xl outline-none"
        >
          <div className="flex items-center gap-3 border-b px-4">
            <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, results.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  pick(results.at(active))
                }
              }}
              placeholder="Search projects, people and pages"
              aria-label="Search"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd>esc</Kbd>
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing found for "{query}".
              </li>
            )}
            {results.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                    i === active && 'bg-muted',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {c.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.hint}
                    </span>
                  </span>
                  {c.keys && !query && (
                    <span className="flex gap-1">
                      {c.keys.split(' ').map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  )}
                  {i === active && (
                    <ArrowTurnDownLeftIcon className="size-3.5 text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const publicLinks = [
  { label: 'Discover', to: '/discover' },
  { label: 'Compare', to: '/compare' },
  { label: 'Pricing', to: '/pricing' },
] as const
const navLinks = [
  { label: 'Dashboard', to: '/dashboard' },
  ...publicLinks,
] as const

const navItem =
  'relative inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
const navActive = 'font-medium text-foreground'

/** One entry of the main nav. The active one carries the sliding pill. */
function NavItem({
  pill,
  label,
  ...link
}: LinkProps & { pill: string; label: string }) {
  return (
    <Link {...link} className={navItem} activeProps={{ className: navActive }}>
      {({ isActive }) => (
        <>
          {isActive && <Pill id={pill} />}
          <span className="relative">{label}</span>
        </>
      )}
    </Link>
  )
}

export function SiteHeader() {
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const signedIn = session !== null
  const links = signedIn ? navLinks : publicLinks
  const desktopPill = React.useId()
  const mobilePill = React.useId()
  // The key handler lives for the whole page; it reads the session from here.
  const signedInRef = React.useRef(signedIn)
  signedInRef.current = signedIn
  React.useEffect(() => {
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT' ||
          e.target.isContentEditable)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        setOpen(true)
      } else if (pending) {
        pending = false
        clearTimeout(timer)
        if (e.key === 'h') void navigate({ to: '/' })
        if (e.key === 'e') void navigate({ to: '/discover' })
        if (!signedInRef.current) return
        if (e.key === 'd') void navigate({ to: '/dashboard' })
        if (e.key === 'i') void navigate({ to: '/inbox' })
        if (e.key === 's')
          void navigate({
            to: '/settings/$section',
            params: { section: 'profile' },
          })
      } else if (e.key === 'g') {
        pending = true
        timer = setTimeout(() => (pending = false), 1200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
  const unread = notifications.filter((n) => n.unread).length
  const { target } = useTarget()
  // Search used to be a shortcut and nothing else. This is the way in for everyone who
  // reaches for the mouse, and the only way on a phone.
  const searchButton = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search"
      className="raised inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <MagnifyingGlassIcon className="size-4" />
      <span className="hidden lg:inline">Search</span>
      <span className="hidden lg:inline">
        <Kbd>{target && target.os !== 'macos' ? 'Ctrl K' : '⌘K'}</Kbd>
      </span>
    </button>
  )

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <Logo />
        <nav
          aria-label="Main"
          className="well absolute left-1/2 hidden -translate-x-1/2 gap-0.5 rounded-xl bg-muted/70 p-1 md:flex"
        >
          {links.map((l) => (
            <NavItem key={l.to} pill={desktopPill} to={l.to} label={l.label} />
          ))}
          <NavItem
            pill={desktopPill}
            to="/docs/$"
            params={{ _splat: '' }}
            label="Docs"
          />
        </nav>
        {session ? (
          <div className="ml-auto flex items-center gap-1.5">
            {searchButton}
            <Link
              to="/new"
              aria-label="New repository"
              className="raised inline-flex size-9 items-center justify-center rounded-lg border bg-card text-foreground hover:bg-muted"
            >
              <PlusIcon className="size-4" />
            </Link>
            <Link
              to="/inbox"
              aria-label={`Inbox, ${unread} unread`}
              className="raised relative inline-flex size-9 items-center justify-center rounded-lg border bg-card text-foreground hover:bg-muted"
            >
              <BellIcon className="size-4" />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand ring-2 ring-card" />
              )}
            </Link>
            <span className="ml-1">
              <UserMenu />
            </span>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-1.5">
            {searchButton}
            <Button
              variant="ghost"
              render={<Link to="/sign-in" />}
              nativeButton={false}
            >
              Sign in
            </Button>
            <Button
              variant="default"
              render={<Link to="/sign-up" />}
              nativeButton={false}
            >
              Get started
            </Button>
          </div>
        )}
      </div>
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2 md:hidden"
      >
        {links.map((l) => (
          <NavItem key={l.to} pill={mobilePill} to={l.to} label={l.label} />
        ))}
        <NavItem
          pill={mobilePill}
          to="/docs/$"
          params={{ _splat: '' }}
          label="Docs"
        />
      </nav>
      <CommandPalette open={open} onOpenChange={setOpen} signedIn={signedIn} />
    </header>
  )
}

const socialIcons = {
  x: siX,
  discord: siDiscord,
  youtube: siYoutube,
  github: siGithub,
} as const

type FooterLink = { label: string; link: LinkProps | null }

/** Internal destinations are router links so a click never reloads the page. `null` is a plain file. */
const footerColumns: Array<[string, Array<FooterLink>]> = [
  [
    'Product',
    [
      { label: 'Discover', link: { to: '/discover' } },
      { label: 'Compare', link: { to: '/compare' } },
      { label: 'Pricing', link: { to: '/pricing' } },
      { label: 'Dashboard', link: { to: '/dashboard' } },
    ],
  ],
  [
    'Build with it',
    [
      { label: 'Docs', link: { to: '/docs/$', params: { _splat: '' } } },
      { label: 'CLI', link: { to: '/docs/$', params: { _splat: 'cli' } } },
      {
        label: 'MCP server',
        link: { to: '/docs/$', params: { _splat: 'mcp' } },
      },
      { label: 'llms.txt', link: null },
    ],
  ],
  [
    'Company',
    [
      { label: 'Status', link: { to: '/status' } },
      { label: 'Design system', link: { to: '/design' } },
      { label: 'Privacy', link: { to: '/privacy' } },
      { label: 'Terms', link: { to: '/terms' } },
    ],
  ],
]

export function SiteFooter() {
  const { data: session } = authClient.useSession()
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-6 py-12 text-sm sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <div className="pb-1">
            <Logo />
          </div>
          <p className="max-w-xs text-muted-foreground">
            A home for your code that keeps your history, and works with any
            model, harness and agent.
          </p>
          <ul className="flex gap-2">
            {socials.map((s) => {
              const icon = socialIcons[s.id]
              return (
                <li key={s.id}>
                  <a
                    href={s.href}
                    aria-label={`${s.label} (opens in a new tab)`}
                    target="_blank"
                    rel="noreferrer"
                    className="raised flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="currentColor"
                    >
                      <path d={icon.path} />
                    </svg>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
        {footerColumns.map(([title, all]) => {
          const links = session
            ? all
            : all.filter(({ label }) => label !== 'Dashboard')
          return (
            <nav key={title} aria-label={title} className="space-y-2">
              <h2 className="font-medium">{title}</h2>
              <ul className="text-muted-foreground">
                {links.map(({ label, link }) => (
                  <li key={label}>
                    {link ? (
                      <Link
                        {...link}
                        className="-mx-1 inline-block min-w-6 px-1 py-1 hover:text-foreground"
                      >
                        {label}
                      </Link>
                    ) : (
                      <a
                        href="/llms.txt"
                        className="inline-block py-1 hover:text-foreground"
                      >
                        {label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          )
        })}
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 pb-8 text-xs text-muted-foreground">
        <span>
          © 2026 Marco Procopio. Names and logos belong to their owners; no
          endorsement implied.
        </span>
        <Link
          to="/status"
          className="-my-1 inline-flex items-center gap-1.5 py-1 hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-success" />
          All systems operational
        </Link>
      </div>
    </footer>
  )
}
