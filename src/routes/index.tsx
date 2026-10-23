import { Link, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(convexQuery(api.profiles.list, {})),
  component: Home,
})

function Home() {
  const { data: users } = useSuspenseQuery(convexQuery(api.profiles.list, {}))
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">People</h1>
      {users.length === 0 && (
        <p className="text-muted-foreground">
          No one here yet. Run{' '}
          <code className="font-mono">bunx convex run seed:seed</code>.
        </p>
      )}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u._id}>
            <Link
              to="/$handle"
              params={{ handle: u.handle }}
              className="hover:underline"
            >
              {u.name}{' '}
              <span className="font-mono text-muted-foreground">
                @{u.handle}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
