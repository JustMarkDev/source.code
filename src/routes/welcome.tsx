import * as React from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, CheckIcon } from '@heroicons/react/24/outline'
import type { Source } from '~/mock/data'
import { AuthShell, RequireAuth } from '~/components/forge/auth'
import { BrandLogo } from '~/components/brand'
import { Button } from '~/components/ui/button'
import { authClient, safeRedirect } from '~/lib/auth/client'
import { providers } from '~/mock/extra'

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

type Status = 'idle' | 'connecting' | 'connected'

/** Step 2 of 2. Optional: copy history over from the hosts people used before. */
function Welcome() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [state, setState] = React.useState<Partial<Record<Source, Status>>>({})
  const connected = providers.filter((p) => state[p.id] === 'connected')

  const connect = (id: Source) => {
    setState((s) => ({ ...s, [id]: 'connecting' }))
    // The real flow sends the person to the host and back; the mock just waits.
    setTimeout(() => setState((s) => ({ ...s, [id]: 'connected' })), 900)
  }

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
        {providers.map((p) => {
          const status = state[p.id] ?? 'idle'
          return (
            <li key={p.id} className="flex items-center gap-3 px-3.5 py-3">
              {p.id !== 'native' && <BrandLogo id={p.id} className="size-5" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.blurb}
                </div>
              </div>
              {status === 'connected' ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckIcon className="size-3.5" />
                  Connected
                </span>
              ) : (
                <Button
                  size="sm"
                  disabled={status === 'connecting'}
                  onClick={() => connect(p.id)}
                >
                  {status === 'connecting' && (
                    <ArrowPathIcon className="animate-spin" />
                  )}
                  {status === 'connecting' ? 'Connecting' : 'Connect'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Connecting copies your history here. Nobody can sign in with these
        accounts, and where a project came from is only visible to you.
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
