import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { RequireAuth } from '~/components/forge/auth'
import { EmptyState, PageTitle } from '~/components/forge/bits'
import { AccountTile, RoleBadge } from '~/components/forge/organization'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { switchAccount, useAccount, useMe } from '~/lib/auth/accounts'
import { useWrite } from '~/lib/forge'
import type { Member } from '@source-code/sdk'

/** Where the link in an invitation email leads. */
export const Route = createFileRoute('/organizations/join')({
  head: () => ({ meta: [{ title: 'Join an organization · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({
    token: typeof s.token === 'string' && s.token ? s.token : undefined,
  }),
  component: () => (
    <RequireAuth>
      <div className="mx-auto max-w-xl">
        <PageTitle title="Join an organization">
          You were invited by someone who owns or administers it.
        </PageTitle>
        <Join />
      </div>
    </RequireAuth>
  ),
})

const GONE =
  'This invitation does not exist, was revoked or has expired. Ask an owner or admin of the organization for a new one.'

function Join() {
  const { token } = Route.useSearch()
  const me = useMe()
  const write = useWrite()
  const navigate = useNavigate()
  // What accepting would do, asked without doing it, so the page can say
  // which organization this is before you join.
  const [offer, setOffer] = React.useState<Member | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const org = useAccount(offer?.account ?? '')

  React.useEffect(() => {
    if (!token || !me) return
    let stale = false
    void write(
      'invitations.accept',
      { body: { token } },
      { dryRun: true },
    ).then((r) => {
      if (stale) return
      if (r.error)
        setError(r.error.code === 'not_found' ? GONE : r.error.message)
      else setOffer(r.data)
    })
    return () => {
      stale = true
    }
  }, [token, me, write])

  if (!token || error)
    return (
      <EmptyState title="This invitation cannot be used">
        {error ??
          'The link is missing its token. Open it from the email again.'}
      </EmptyState>
    )
  if (!offer || !me) return null

  const join = async () => {
    setBusy(true)
    const r = await write('invitations.accept', { body: { token } })
    if (r.error) {
      setBusy(false)
      setError(r.error.code === 'not_found' ? GONE : r.error.message)
      return
    }
    switchAccount(me, r.data.account)
    void navigate({ to: '/$handle', params: { handle: r.data.account } })
  }

  const name = org?.name ?? offer.account
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-4">
        <AccountTile
          account={{ kind: 'organization', name, handle: offer.account }}
          className="size-12 text-lg"
        />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {name}
          </h2>
          <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            source.code/{offer.account} <RoleBadge role={offer.role} />
          </p>
        </div>
      </div>
      <Callout title={`You will join as ${me.name}`}>
        You get access to its repositories, and it shows on your profile that
        you belong to it. You can leave at any time.
      </Callout>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          render={<Link to="/dashboard" />}
          nativeButton={false}
        >
          Not now
        </Button>
        <Button
          variant="brand"
          size="lg"
          disabled={busy}
          onClick={() => void join()}
        >
          {busy ? 'Joining' : `Join ${name}`}
        </Button>
      </div>
    </section>
  )
}
