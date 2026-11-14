import { Link, createFileRoute } from '@tanstack/react-router'
import type { ProfileTab } from '~/components/forge/profile-tabs'
import type { DashboardData } from '~/lib/model/dashboard'
import type { Account } from '~/lib/auth/accounts'
import { RequireAuth } from '~/components/forge/auth'
import {
  ActivityFeed,
  GettingStarted,
  History,
  InProgress,
  LastWeeks,
  NeedsYou,
  Repositories,
  SummaryStrip,
} from '~/components/forge/dashboard'
import { OrgPage } from '~/components/forge/organization'
import { profileTabs } from '~/components/forge/profile-tabs'
import { ProfileView } from '~/components/forge/profile-view'
import { Badge } from '~/components/ui/badge'
import { Segmented } from '~/components/ui/tabs'
import { useAccounts } from '~/lib/auth/accounts'
import { useOp } from '~/lib/forge'
import { toDashboardData } from '~/lib/dashboard'

type Search = { view?: 'profile'; tab?: ProfileTab }

export const Route = createFileRoute('/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: s.view === 'profile' ? 'profile' : undefined,
    tab: profileTabs.find(([id]) => id === s.tab)?.[0],
  }),
  component: () => (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  ),
})

function DashboardView({
  data,
  account,
}: {
  data: DashboardData
  account: Account
}) {
  if (data.empty)
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <GettingStarted account={account} />
        <aside className="space-y-10">
          <Repositories data={data} />
          <History data={data} organization={account.kind === 'organization'} />
        </aside>
      </div>
    )
  return (
    <div className="space-y-8">
      <SummaryStrip data={data} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10">
          <NeedsYou data={data} />
          <InProgress data={data} />
          <ActivityFeed data={data} />
        </div>
        <aside className="space-y-10">
          <Repositories data={data} />
          <History data={data} organization={account.kind === 'organization'} />
          <LastWeeks data={data} />
        </aside>
      </div>
    </div>
  )
}

/** The page follows the account you are acting as: yours, or an organization's. */
function Dashboard() {
  const { view = 'dashboard', tab = 'overview' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { active } = useAccounts()
  if (!active) return null
  return (
    <DashboardFor
      key={active.handle}
      active={active}
      view={view}
      tab={tab}
      navigate={navigate}
    />
  )
}

function DashboardFor({
  active,
  view,
  tab,
  navigate,
}: {
  active: Account
  view: 'dashboard' | 'profile'
  tab: ProfileTab
  navigate: ReturnType<typeof Route.useNavigate>
}) {
  const org = active.kind === 'organization'
  const api = useOp('dashboard.get', { account: active.handle })
  const owned = useOp('repos.list', { owner: active.handle, limit: 100 }).data
  const data = toDashboardData(api, owned)
  const first = active.name.split(' ').at(0) ?? 'there'
  const agents = data.inProgress.filter((p) => p.kind === 'agent').length
  const title = org ? active.name : `Welcome back, ${first}`
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {view === 'profile'
              ? org
                ? 'Your public page'
                : 'Your public profile'
              : title}
            {org && view === 'dashboard' && (
              <Badge tone="outline">Organization</Badge>
            )}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {view === 'profile' ? (
              'This is exactly what other people see.'
            ) : data.empty ? (
              org ? (
                `You are acting as ${active.name}. It has nothing in it yet.`
              ) : (
                'Nothing here yet. A repository is the place to start.'
              )
            ) : (
              <>
                <b className="font-medium text-foreground">
                  {data.needsYou.length}{' '}
                  {data.needsYou.length === 1 ? 'thing needs' : 'things need'}{' '}
                  {org ? 'the team' : 'you'}.
                </b>{' '}
                {data.inProgress.length} more{' '}
                {data.inProgress.length === 1 ? 'is' : 'are'} moving without you
                {agents > 0 &&
                  `, including ${agents} agent ${agents === 1 ? 'session' : 'sessions'}`}
                .
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {view === 'profile' && (
            <Link
              to="/$handle"
              params={{ handle: active.handle }}
              className="inline-block py-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Open as a visitor
            </Link>
          )}
          <Segmented
            label="View"
            value={view}
            onChange={(v) =>
              void navigate({
                search: v === 'profile' ? { view: 'profile' } : {},
              })
            }
            options={[
              ['dashboard', 'Dashboard'],
              ['profile', org ? 'Public page' : 'Public profile'],
            ]}
          />
        </div>
      </header>

      {view === 'dashboard' ? (
        <DashboardView data={data} account={active} />
      ) : org ? (
        <OrgPage handle={active.handle} embedded />
      ) : (
        <ProfileView
          embedded
          handle={active.handle}
          tab={tab}
          tabLink={(id) => ({
            to: '/dashboard',
            search:
              id === 'overview'
                ? { view: 'profile' }
                : { view: 'profile', tab: id },
          })}
        />
      )}
    </div>
  )
}
