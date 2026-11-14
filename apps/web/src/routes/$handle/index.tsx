import { createFileRoute } from '@tanstack/react-router'
import type { ProfileTab } from '~/components/forge/profile-tabs'
import { NotFoundPage } from '~/components/forge/not-found'
import { OrgPage } from '~/components/forge/organization'
import { profileTabs } from '~/components/forge/profile-tabs'
import { ProfileView } from '~/components/forge/profile-view'
import { useAccount } from '~/lib/auth/accounts'
import { opQueryOrNull } from '~/lib/forge'

export const Route = createFileRoute('/$handle/')({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => ({
    tab: profileTabs.find(([id]) => id === s.tab)?.[0],
  }),
  // What lives at the address decides the page: a person or an organization.
  loader: ({ context, params }) =>
    context.queryClient.prefetchQuery(
      opQueryOrNull('accounts.get', { handle: params.handle }),
    ),
  component: Profile,
})

function Profile() {
  const { handle } = Route.useParams()
  const { tab = 'overview' } = Route.useSearch()
  const account = useAccount(handle)
  if (account === undefined) return null
  if (account === null)
    return (
      <NotFoundPage title="Nothing lives at this address">
        It may have been renamed, or it never existed. These are the places most
        people go next.
      </NotFoundPage>
    )
  if (account.kind === 'organization') return <OrgPage handle={handle} />
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
