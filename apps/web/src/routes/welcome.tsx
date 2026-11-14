import * as React from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { CheckIcon } from '@heroicons/react/24/outline'
import { AuthShell, RequireAuth } from '~/components/forge/auth'
import { BrandLogo } from '~/components/brand'
import { Button } from '~/components/ui/button'
import { authClient, safeRedirect } from '~/lib/auth/client'
import { useOpMaybe, useWrite } from '~/lib/forge'

export const Route = createFileRoute('/welcome')({
  head: () => ({ meta: [{ title: 'Welcome · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(s.redirect),
  }),
  component: () => (
    <RequireAuth>
      <Welcome />
    </RequireAuth>
  ),
})

const hosts = [
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Commits, pull requests, reviews and issues.',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    blurb: 'Commits, merge requests and issues.',
  },
  {
    id: 'codeberg',
    name: 'Codeberg',
    blurb: 'Commits, pull requests and issues.',
  },
] as const

/** Step 2 of 2. Optional: say who you are elsewhere, then bring projects over. */
function Welcome() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const handle = session?.user.handle ?? ''
  const links = useOpMaybe('links.list', { handle }, !!handle)?.data ?? []
  const write = useWrite()
  const [editing, setEditing] = React.useState<string | null>(null)
  const [login, setLogin] = React.useState('')
  const [error, setError] = React.useState('')
  const connected = hosts.filter((h) => links.some((l) => l.host === h.id))
  const save = (host: (typeof hosts)[number]['id']) =>
    void write('links.set', {
      handle,
      host,
      body: { login: login.trim() },
    }).then((r) => {
      if (r.error) return setError(r.error.message)
      setEditing(null)
      setLogin('')
      setError('')
    })

  const next = connected.length > 0 ? '/new?mode=import' : (redirect ?? '/new')

  return (
    <AuthShell
      step="Step 2 of 2"
      title="Bring your history with you"
      subtitle="Optional. Copy your projects and activity from where they live now. You can do this any time in Settings."
      footer={
        session && (
          <>
            Your page is{' '}
            <span className="font-mono text-foreground">
              source.code/{session.user.handle}
            </span>
            .{' '}
            <Link
              to="/settings/$section"
              params={{ section: 'profile' }}
              className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Change it
            </Link>
          </>
        )
      }
    >
      <ul className="divide-y rounded-xl border">
        {hosts.map((p) => {
          const link = links.find((l) => l.host === p.id)
          return (
            <li key={p.id} className="space-y-2 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <BrandLogo id={p.id} className="size-5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {link ? `@${link.login}` : p.blurb}
                  </div>
                </div>
                {link ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <CheckIcon className="size-3.5" />
                    Linked
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setEditing(p.id)}>
                    Link
                  </Button>
                )}
              </div>
              {editing === p.id && !link && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (login.trim()) save(p.id)
                  }}
                >
                  <input
                    autoFocus
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder={`Your ${p.name} username`}
                    aria-label={`Your ${p.name} username`}
                    className="h-8 flex-1 rounded-lg border bg-background px-2.5 font-mono text-sm"
                  />
                  <Button size="sm" type="submit" disabled={!login.trim()}>
                    Save
                  </Button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Linking says who you are there; nobody can sign in with these accounts.
        Where a project came from is only visible to you.
      </p>
      <Button
        variant={connected.length > 0 ? 'brand' : 'outline'}
        size="lg"
        className="w-full"
        onClick={() => router.history.push(next)}
      >
        {connected.length > 0
          ? `Import from ${connected.length === 1 ? connected[0].name : `${connected.length} sources`}`
          : 'Skip for now'}
      </Button>
    </AuthShell>
  )
}
