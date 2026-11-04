import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowTurnDownLeftIcon,
  BellIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { siBluesky, siDiscord, siGithub, siX, siYoutube } from 'simple-icons'
import { cn } from 'cn'
import { Kbd, Tile } from './bits'
import { Dropdown, MenuItem, MenuSeparator } from '~/components/ui/menu'
import { socials } from '~/lib/site'
import { developers, repos } from '~/mock/data'
import { notifications } from '~/mock/extra'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex items-center gap-2 font-mono text-sm font-semibold tracking-tight',
        className,
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-brand-foreground">
        {'{}'}
      </span>
      <span>
        source<span className="text-brand-ink">.</span>code
      </span>
    </Link>
  )
}

function UserMenu() {
  return (
    <Dropdown
      className="w-60"
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Tile name="Dana" hue={160} round className="size-8 text-xs" />
        </button>
      }
    >
      <div className="px-2 py-2">
        <div className="font-medium">Dana Okafor</div>
        <div className="font-mono text-xs text-muted-foreground">@dana</div>
      </div>
      <MenuSeparator />
      <MenuItem render={<Link to="/dashboard" />}>Dashboard</MenuItem>
      <MenuItem render={<Link to="/dashboard" search={{ view: 'profile' }} />}>
        Public profile
      </MenuItem>
      <MenuItem
        render={
          <Link to="/settings/$section" params={{ section: 'profile' }} />
        }
      >
        Settings
      </MenuItem>
      <MenuItem
        render={
          <Link to="/settings/$section" params={{ section: 'integrations' }} />
        }
      >
        Integrations
      </MenuItem>
      <MenuSeparator />
      <MenuItem className="text-muted-foreground">Sign out</MenuItem>
    </Dropdown>
  )
}

type Command = {
  id: string
  label: string
  hint: string
  group: 'Projects' | 'People' | 'Go to'
  keys?: string
  run: () => void
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
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
    const list = q
      ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q))
      : commands.filter((c) => c.group === 'Go to')
    return list.slice(0, 8)
  }, [commands, query])

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
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]" />
        <Dialog.Popup
          aria-label="Search"
          className="fixed top-[16vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-2xl outline-none"
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

const navLinks = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Discover', to: '/discover' },
  { label: 'Pricing', to: '/pricing' },
] as const

const navItem =
  'inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
const navActive = 'raised bg-card font-medium text-foreground'

export function SiteHeader() {
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
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
        if (e.key === 'd') void navigate({ to: '/dashboard' })
        if (e.key === 'e') void navigate({ to: '/discover' })
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

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
        <Logo />
        <nav
          aria-label="Main"
          className="well absolute left-1/2 hidden -translate-x-1/2 gap-0.5 rounded-xl bg-muted/70 p-1 md:flex"
        >
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={navItem}
              activeProps={{ className: navActive }}
            >
              {l.label}
            </Link>
          ))}
          <Link
            to="/docs/$"
            params={{ _splat: '' }}
            className={navItem}
            activeProps={{ className: navActive }}
          >
            Docs
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
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
      </div>
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2 md:hidden"
      >
        {navLinks.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={navItem}
            activeProps={{ className: navActive }}
          >
            {l.label}
          </Link>
        ))}
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className={navItem}
          activeProps={{ className: navActive }}
        >
          Docs
        </Link>
      </nav>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </header>
  )
}

const socialIcons = {
  x: siX,
  bluesky: siBluesky,
  discord: siDiscord,
  youtube: siYoutube,
  github: siGithub,
} as const

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 text-sm sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo />
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
                    aria-label={s.label}
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
        {(
          [
            [
              'Product',
              [
                ['Discover', '/discover'],
                ['Pricing', '/pricing'],
                ['Dashboard', '/dashboard'],
              ],
            ],
            [
              'Build with it',
              [
                ['Docs', '/docs'],
                ['CLI', '/docs/cli'],
                ['MCP server', '/docs/mcp'],
                ['llms.txt', '/llms.txt'],
              ],
            ],
            [
              'Company',
              [
                ['Status', '/status'],
                ['Design system', '/design'],
                ['Privacy', '/settings/privacy'],
              ],
            ],
          ] as const
        ).map(([title, links]) => (
          <div key={title} className="space-y-3">
            <h3 className="font-medium">{title}</h3>
            <ul className="space-y-2 text-muted-foreground">
              {links.map(([label, href]) => (
                <li key={href}>
                  <a href={href} className="hover:text-foreground">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 pb-8 text-xs text-muted-foreground">
        <span>
          © 2026 Marco Procopio. Names and logos belong to their owners; no
          endorsement implied.
        </span>
        <Link
          to="/status"
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-success" />
          All systems operational
        </Link>
      </div>
    </footer>
  )
}
