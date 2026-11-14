import { LiveForge } from '~/lib/live'
import { ConvexSignIn } from '~/lib/forge'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import { SiteFooter, SiteHeader } from '~/components/forge/chrome'
import { NotFoundPage } from '~/components/forge/not-found'
import {
  MotionProvider,
  PageTransition,
  RouteProgress,
} from '~/components/motion'
import { SessionSync } from '~/lib/auth/accounts'
import { convexToken } from '~/lib/auth/token'
import { themeInitScript } from '~/lib/theme'
import appCss from '~/styles/app.css?url'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  // The server render reads Convex as the person, so the first paint has
  // what they may see. In the browser the Convex client signs in itself.
  beforeLoad: async ({ context }) => {
    const server = context.convexQueryClient.serverHttpClient
    if (!server) return
    const token = await convexToken()
    if (token) server.setAuth(token)
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'source.code',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  notFoundComponent: () => <NotFoundPage />,
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <ConvexSignIn />
      <LiveForge />
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // Docs bring their own navigation.
  const docs = useRouterState({
    select: (s) => s.location.pathname.startsWith('/docs'),
  })
  // Account screens are one card on a quiet page, with no header or footer.
  const bare = useRouterState({
    select: (s) =>
      ['/sign-in', '/sign-up', '/forgot-password', '/welcome'].includes(
        s.location.pathname,
      ),
  })
  // The leaf route, not the URL: moving between tabs of one route keeps the
  // page mounted, and the page animates its own tab content.
  const routeId = useRouterState({ select: (s) => s.matches.at(-1)?.routeId })
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col">
        {!docs && (
          <a href="#main" className="skip-link">
            Skip to content
          </a>
        )}
        <RootProvider
          theme={{ defaultTheme: 'system', enableSystem: true }}
          // The app has its own palette on ⌘K. Fumadocs' search would open a
          // second dialog on top of it, so it only runs inside the docs.
          search={{ enabled: docs }}
        >
          <MotionProvider>
            <RouteProgress />
            <SessionSync />
            {docs ? (
              children
            ) : bare ? (
              <main id="main" tabIndex={-1} className="flex-1 outline-none">
                <PageTransition trigger={routeId}>{children}</PageTransition>
              </main>
            ) : (
              <>
                <SiteHeader />
                <main
                  id="main"
                  tabIndex={-1}
                  className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 outline-none"
                >
                  <PageTransition trigger={routeId}>{children}</PageTransition>
                </main>
                <SiteFooter />
              </>
            )}
          </MotionProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
