/**
 * Sign-in on the server. `handler` forwards `/api/auth/*` to Convex, where
 * Better Auth runs. `currentUser` is who a request is from, read from its
 * session cookie: use it in server functions and loaders, never trust a
 * handle the browser sends.
 */
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'
import { api } from '../../../../../convex/_generated/api'

// Vite puts `.env.local` in `import.meta.env`; a host sets real environment
// variables, which win.
const fromVite: Record<string, string | undefined> = import.meta.env
const setting = (name: string) => process.env[name] ?? fromVite[name] ?? ''

// Built on first use. The library refuses to start without its addresses,
// and a missing setting should fail the sign-in request that needs it, with
// its message, not every page that imports this file.
let made: ReturnType<typeof convexBetterAuthReactStart> | undefined
const auth = () =>
  (made ??= convexBetterAuthReactStart({
    convexUrl: setting('VITE_CONVEX_URL'),
    convexSiteUrl: setting('VITE_CONVEX_SITE_URL'),
  }))

/** Forwards a `/api/auth/*` request to Convex. */
export const handler = (request: Request) => auth().handler(request)

export type CurrentUser = {
  id: string
  name: string
  email: string
  handle: string
}

/** The signed-in person behind the current request, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  if (!(await auth().getToken())) return null
  const user = await auth().fetchAuthQuery(api.auth.getCurrentUser, {})
  return user?.handle ? { ...user, handle: user.handle } : null
}

/** The Convex token for the current request's session, for the server render. */
export const convexTokenNow = async () => (await auth().getToken()) ?? null
