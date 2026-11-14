import { createHash } from 'node:crypto'
import { handler } from '~/lib/auth/server'
import type { SessionResolver, SessionUser } from '@source-code/api/oauth'

/**
 * Who is signed in on the OAuth pages (consent, device code): the same
 * session as the rest of the app. A signed-out visitor is sent to `/sign-in`
 * and comes back to the page that asked.
 */

const COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/

type Seen = (user: SessionUser) => void

export class AppSessions implements SessionResolver {
  /** `seen` runs for every signed-in person, so the API can know them. */
  constructor(private readonly seen: Seen = () => {}) {}

  async current(req: Request): Promise<SessionUser | null> {
    const cookie = req.headers.get('cookie')
    if (!cookie || !COOKIE.test(cookie)) return null
    try {
      const res = await handler(
        new Request(new URL('/api/auth/get-session', req.url), {
          headers: { cookie },
        }),
      )
      if (!res.ok) return null
      const body = (await res.json()) as {
        user?: { username?: string | null; name?: string }
      } | null
      const handle = body?.user?.username
      if (!handle) return null
      const user = { handle, name: body.user?.name ?? handle }
      this.seen(user)
      return user
    } catch {
      // Sign-in is unreachable: nobody is signed in, and the pages say so.
      return null
    }
  }

  /**
   * The form token. It is derived from the session cookie, which a page on
   * another site cannot read, so only this site can produce it. Callers
   * check `current` as well, so a dead session's token opens nothing.
   */
  csrf(req: Request) {
    const token = COOKIE.exec(req.headers.get('cookie') ?? '')?.[1]
    return token
      ? createHash('sha256').update(`oauth-form:${token}`).digest('base64url')
      : null
  }

  /** No account picker: people sign in on the app's own page. */
  logins() {
    return []
  }

  start() {
    return null
  }

  signInUrl(returnTo: string) {
    return `/sign-in?redirect=${encodeURIComponent(returnTo)}`
  }
}
