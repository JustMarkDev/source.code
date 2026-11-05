import * as React from 'react'
import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import type { ProfileTab } from '~/components/forge/profile-tabs'
import { NotFoundPage } from '~/components/forge/not-found'
import { OrgPage } from '~/components/forge/organization'
import { profileTabs } from '~/components/forge/profile-tabs'
import { ProfileView } from '~/components/forge/profile-view'
import { directory, useDirectoryLookups } from '~/lib/auth/accounts'
import { settleWithin } from '~/lib/effect'
import { developers } from '~/mock/data'

export const Route = createFileRoute('/$handle/')({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => ({
    tab: profileTabs.find(([id]) => id === s.tab)?.[0],
  }),
  loader: async ({ context, params }) => {
    if (typeof window !== 'undefined') {
      directory.load()
      // An address an account used to have leads to the one it has now.
      const to = directory.resolveAlias(params.handle)
      if (to) throw redirect({ to: '/$handle', params: { handle: to } })
      if (directory.isOrganization(params.handle)) return
    }
    // Convex is the source of truth when it is reachable. The sample people
    // keep the page usable in design previews when it is not.
    const isMock =
      developers.some((d) => d.handle === params.handle) ||
      directory.isOrganization(params.handle)
    const query = context.queryClient.ensureQueryData(
      convexQuery(api.profiles.get, params),
    )
    if (isMock) {
      // Never block navigation on the backend for a sample person.
      query.catch(() => undefined)
      return
    }
    if (typeof window === 'undefined') {
      // Accounts made in the browser exist only there, so a server render
      // cannot tell one from a typo. The page decides once it can see them.
      query.catch(() => undefined)
      return
    }
    // An offline Convex client never settles, so cap the wait.
    const data = await settleWithin(() => query, '4 seconds')
    if (data === null) throw notFound()
  },
  component: Profile,
})

function Profile() {
  const { handle } = Route.useParams()
  const { tab = 'overview' } = Route.useSearch()
  const navigate = useNavigate()
  const { isOrganization, resolveAlias, ready } = useDirectoryLookups()
  // An address an account used to have leads to the one it has now. The
  // loader cannot do this on a first page load, which is rendered on the
  // server, so the page does it once the browser's accounts are read.
  const alias = resolveAlias(handle)
  React.useEffect(() => {
    if (alias)
      void navigate({
        to: '/$handle',
        params: { handle: alias },
        replace: true,
      })
  }, [alias, navigate])
  const { data, isPending } = useQuery(
    convexQuery(api.profiles.get, { handle }),
  )
  const known =
    developers.some((d) => d.handle === handle) || isOrganization(handle)
  if (alias) return null
  if (!known) {
    // Not a sample and not an account made in this browser: Convex decides.
    // Show nothing, not a blank profile, until we know what this address is.
    if (!ready || isPending) return null
    if (data === null)
      return (
        <NotFoundPage title="Nothing lives at this address">
          It may have been renamed, or it never existed. These are the places
          most people go next.
        </NotFoundPage>
      )
  }
  if (isOrganization(handle)) return <OrgPage handle={handle} />
  return (
    <ProfileView
      handle={handle}
      tab={tab}
      tabLink={(id) => ({
        to: '/$handle',
        params: { handle },
        search: id === 'overview' ? {} : { tab: id },
      })}
    />
  )
}
