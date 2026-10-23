import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

const icons = {
  release: '⇡',
  review: '◎',
  agent_session: '⌁',
  push: '•',
} as const

export const Route = createFileRoute('/$handle/')({
  loader: async ({ context, params }) => {
    const profile = await context.queryClient.ensureQueryData(
      convexQuery(api.profiles.get, params),
    )
    if (!profile) throw notFound()
  },
  component: Profile,
})

function Profile() {
  const { handle } = Route.useParams()
  const { data } = useSuspenseQuery(convexQuery(api.profiles.get, { handle }))
  if (!data) return null
  const { user, repos, activity } = data

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg">{user.name[0]}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-lg font-semibold">
            {user.name}{' '}
            <span className="font-mono text-sm text-muted-foreground">
              @{user.handle}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">{user.bio}</p>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-8">
          {user.now && (
            <Card className="ring-primary/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                  Now
                </CardTitle>
                <CardDescription>{user.now}</CardDescription>
              </CardHeader>
            </Card>
          )}

          <section>
            <Label>Projects</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {repos.map((r) => (
                <Link
                  key={r._id}
                  to="/$handle/$repo"
                  params={{ handle, repo: r.name }}
                >
                  <Card size="sm" className="h-full hover:ring-foreground/25">
                    <CardHeader>
                      <CardTitle className="font-mono">{r.name}</CardTitle>
                      <CardDescription>
                        {r.description} · {r.stars.toLocaleString()} ★
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <Label>Activity</Label>
            <ul className="divide-y text-sm">
              {activity.map((e) => (
                <li key={e._id} className="flex items-center gap-3 py-2">
                  <span className="w-5 text-center text-muted-foreground">
                    {icons[e.kind]}
                  </span>
                  <span>
                    {e.title}
                    {e.repo && (
                      <Link
                        to="/$handle/$repo"
                        params={{ handle, repo: e.repo }}
                        className="ml-1 font-mono text-muted-foreground hover:underline"
                      >
                        {e.repo}
                      </Link>
                    )}
                  </span>
                  {e.agent && (
                    <Badge variant="outline" className="font-mono">
                      {e.agent}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section>
          <Label>Setup</Label>
          <Card size="sm">
            <CardContent>
              <dl className="space-y-1">
                {Object.entries(user.setup).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="capitalize">{k}</dt>
                    <dd className="font-mono text-muted-foreground">
                      {v.join(', ')}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 font-mono text-xs tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}
