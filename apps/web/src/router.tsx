import { createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { routeTree } from './routeTree.gen'
import { ErrorPage } from '~/components/forge/not-found'
import { sessionClient } from '~/lib/auth/client'

/**
 * The Convex client for React Query, with one fix. When a live result comes
 * in, the library only stores it over an earlier result; a read whose first
 * answer was an error (asked before sign-in finished, or for something that
 * did not exist yet) would never show the answers that follow.
 */
class LiveQueryClient extends ConvexQueryClient {
  override onUpdateQueryKeyHash(queryHash: string) {
    const query = this.queryClient.getQueryCache().get(queryHash)
    const sub = this.subscriptions[queryHash] as
      | (typeof this.subscriptions)[string]
      | undefined
    if (query && sub && query.state.data === undefined) {
      let value: unknown
      try {
        value = sub.watch.localQueryResult()
      } catch {
        value = undefined
      }
      if (value !== undefined) {
        this.queryClient.setQueryData(sub.queryKey, value)
        return
      }
    }
    super.onUpdateQueryKeyHash(queryHash)
  }
}

export function getRouter() {
  const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!
  if (!CONVEX_URL) {
    console.error('missing envar CONVEX_URL')
  }
  const convexQueryClient = new LiveQueryClient(CONVEX_URL)

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        // Convex keeps a query live while it is on screen. Holding the last
        // result for a few minutes makes going back to a page instant; the
        // live subscription then replaces it with fresh data.
        gcTime: 5 * 60 * 1000,
        // A Convex read that failed failed for a reason (not found, not
        // allowed); asking again would only make the page wait.
        retry: (count, error) =>
          !(error as { data?: unknown } | null)?.data && count < 3,
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0, // Let React Query handle all caching
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: () => <p>not found</p>,
    Wrap: ({ children }) => (
      // Signed in as the person whose session this is, so a page reads and
      // writes Convex as them.
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={sessionClient}
      >
        {children}
      </ConvexBetterAuthProvider>
    ),
  })
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}
