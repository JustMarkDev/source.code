import { createFileRoute, notFound } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import type { ProfileTab } from '~/components/forge/profile-tabs'
import { profileTabs } from '~/components/forge/profile-tabs'
import { ProfileView } from '~/components/forge/profile-view'
import { settleWithin } from '~/lib/effect'
import { developers } from '~/mock/data'

export const Route = createFileRoute('/$handle/')({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => ({
    tab: profileTabs.find(([id]) => id === s.tab)?.[0],
  }),
  loader: async ({ context, params }) => {
    // Convex is the source of truth when it is reachable. The sample people
    // keep the page usable in design previews when it is not.
    const isMock = developers.some((d) => d.handle === params.handle)
    const query = context.queryClient.ensureQueryData(
      convexQuery(api.profiles.get, params),
    )
    if (isMock) {
      // Never block navigation on the backend for a sample person.
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
