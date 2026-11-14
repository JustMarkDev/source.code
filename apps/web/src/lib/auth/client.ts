/**
 * The auth client: Better Auth, with sessions, users and credentials kept by
 * the `betterAuth` Convex component (`convex/auth.ts`). Requests go to
 * `/api/auth/*` on this site, which forwards them to Convex.
 *
 * The app only uses what is exported here (`useSession()` ->
 * `{ data, isPending }`, `signIn.email`, `signUp.email`, `updateUser`,
 * `signOut`, results as `{ data, error }`), so screens do not import Better
 * Auth themselves.
 *
 * The session is a cookie. The first server render does not read it, so
 * `isPending` is true until the browser has asked. Pages that need a user
 * wait on it (see `RequireAuth`); server code asks `~/lib/auth/server`.
 */
import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import * as React from 'react'
import { isValidHandle } from '@source-code/api/handles'
import { randomHandle } from '@source-code/api/handles'

export type AuthUser = {
  id: string
  name: string
  email: string
  /**
   * The address in every URL (source.code/<handle>). Generated at sign-up, and
   * the person can change it in Settings. It is Better Auth's `username`.
   */
  handle: string
  /** Whether they proved the address is theirs. */
  emailVerified?: boolean
}

export type Session = { user: AuthUser; session: { id: string } }

export type AuthError = { code: string; message: string }
export type AuthResult = { data: Session | null; error: AuthError | null }

/**
 * The demo account every screen in the mock data belongs to. It only exists
 * where someone has pressed the demo button on a development deployment.
 */
export const demoUser: AuthUser = {
  id: 'usr_dana',
  name: 'Dana Okafor',
  email: 'dana@source.code',
  handle: 'dana',
}
const DEMO_PASSWORD = 'source-code-demo'

const client = createAuthClient({
  plugins: [usernameClient(), convexClient()],
})

/**
 * Better Auth itself, for the Convex client only: it asks it for the token
 * that signs the page's Convex reads and writes in as the person.
 */
export const sessionClient = client

type RawUser = {
  id: string
  name: string
  email: string
  emailVerified?: boolean
  username?: string | null
}

const toUser = (u: RawUser): AuthUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  handle: u.username ?? '',
  emailVerified: u.emailVerified ?? false,
})

const fail = (code: string, message: string): AuthResult => ({
  data: null,
  error: { code, message },
})

/** What a person can act on, in our words, for the codes they can cause. */
const MESSAGES: Partial<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  USER_ALREADY_EXISTS: 'An account with this email already exists.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'An account with this email already exists.',
  USERNAME_IS_ALREADY_TAKEN: 'That address is already taken.',
  PASSWORD_TOO_SHORT: 'Use a password of at least 8 characters.',
  INVALID_EMAIL: 'Enter a valid email.',
}

type RawError = { code?: string; message?: string; status?: number } | null

const toError = (error: RawError): AuthError => {
  const code = error?.code ?? 'UNKNOWN'
  return {
    code,
    message:
      MESSAGES[code] ??
      error?.message ??
      'Something went wrong. Try again in a moment.',
  }
}

/** The session as it is now, after a call that changed it. */
async function current(): Promise<AuthResult> {
  const { data, error } = await client.getSession()
  if (error) return { data: null, error: toError(error) }
  if (!data) return fail('UNAUTHORIZED', 'Sign in again to continue.')
  return {
    data: { user: toUser(data.user), session: { id: data.session.id } },
    error: null,
  }
}

async function signUp(input: {
  name: string
  email: string
  password: string
  handle?: string
}): Promise<AuthResult> {
  // A new account starts at a generated address. A clash is rare, so try a
  // few before giving up; an address the caller chose is tried once.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await client.signUp.email({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      username: input.handle ?? randomHandle(),
    })
    if (!error) return current()
    if (error.code !== 'USERNAME_IS_ALREADY_TAKEN' || input.handle)
      return { data: null, error: toError(error) }
  }
  return fail('ADDRESS_TAKEN', 'Could not find a free address. Try again.')
}

export const authClient = {
  useSession() {
    const { data, isPending } = client.useSession()
    const user = data?.user as RawUser | undefined
    const id = user?.id
    const name = user?.name
    const email = user?.email
    const handle = user?.username
    const verified = user?.emailVerified ?? false
    const sessionId = data?.session.id
    // Stable between renders unless something in it really changes.
    const session = React.useMemo<Session | null>(
      () =>
        id && name !== undefined && email && sessionId
          ? {
              user: {
                id,
                name,
                email,
                handle: handle ?? '',
                emailVerified: verified,
              },
              session: { id: sessionId },
            }
          : null,
      [id, name, email, handle, verified, sessionId],
    )
    return { data: session, isPending }
  },

  signIn: {
    async email(input: {
      email: string
      password: string
    }): Promise<AuthResult> {
      const { error } = await client.signIn.email({
        email: input.email.trim().toLowerCase(),
        password: input.password,
      })
      return error ? { data: null, error: toError(error) } : current()
    },
    /**
     * One click into the demo account, on a development deployment. The
     * first press creates it; the server lets it take the sample address
     * `dana` only when the site is this machine.
     */
    async demo(): Promise<AuthResult> {
      const login = { email: demoUser.email, password: DEMO_PASSWORD }
      const { error } = await client.signIn.email(login)
      if (!error) return current()
      if (error.code !== 'INVALID_EMAIL_OR_PASSWORD')
        return { data: null, error: toError(error) }
      return signUp({ ...login, name: demoUser.name, handle: demoUser.handle })
    },
  },

  signUp: {
    email(input: {
      name: string
      email: string
      password: string
    }): Promise<AuthResult> {
      return signUp(input)
    },
  },

  /** Change the name, email or address on the signed-in account. */
  async updateUser(
    input: Partial<Pick<AuthUser, 'name' | 'email' | 'handle'>>,
  ): Promise<AuthResult> {
    const before = await current()
    if (!before.data) return before
    const me = before.data.user
    const handle = input.handle?.trim().toLowerCase()
    const renames = handle !== undefined && handle !== me.handle
    if (renames && !isValidHandle(handle))
      return fail('INVALID_ADDRESS', 'Use 1 to 24 letters, numbers or dashes.')
    const email = input.email?.trim().toLowerCase()
    if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email))
      return fail('INVALID_EMAIL', 'Enter a valid email.')
    const name = input.name?.trim()
    if (name !== undefined && !name)
      return fail('INVALID_NAME', 'Enter your full name.')

    const changes = {
      ...(name !== undefined && name !== me.name && { name }),
      ...(renames && { username: handle }),
    }
    if (Object.keys(changes).length) {
      const { error } = await client.updateUser(changes)
      if (error)
        return error.code === 'USERNAME_IS_ALREADY_TAKEN'
          ? fail('ADDRESS_TAKEN', `source.code/${handle} is already taken.`)
          : { data: null, error: toError(error) }
    }
    if (email !== undefined && email !== me.email) {
      const { error } = await client.changeEmail({ newEmail: email })
      if (error) return { data: null, error: toError(error) }
    }
    return current()
  },

  /**
   * Ask for a reset link. It always answers ok, so it never says whether an
   * email has an account. Until an email provider is connected the link is
   * written to the Convex deployment's log, not sent.
   */
  async forgotPassword(input: { email: string }): Promise<{ ok: true }> {
    await client.requestPasswordReset({
      email: input.email.trim().toLowerCase(),
      redirectTo: '/reset-password',
    })
    return { ok: true }
  },

  /** Choose a new password with the token from a reset link. */
  async resetPassword(input: {
    token: string
    password: string
  }): Promise<{ error: AuthError | null }> {
    const { error } = await client.resetPassword({
      newPassword: input.password,
      token: input.token,
    })
    return { error: error ? toError(error) : null }
  },

  /** Send (for now: log) a link that proves the address is the person's. */
  async sendVerification(email: string): Promise<{ error: AuthError | null }> {
    const { error } = await client.sendVerificationEmail({
      email,
      callbackURL: '/settings/accounts',
    })
    return { error: error ? toError(error) : null }
  },

  async signOut(): Promise<void> {
    await client.signOut()
  },
}

/** Only follow redirects that stay on this site. */
export function safeRedirect(to: unknown): string | undefined {
  if (typeof to !== 'string') return undefined
  if (!to.startsWith('/') || to.startsWith('//')) return undefined
  // Coming back to an account screen would only bounce the person around.
  if (/^\/(sign-in|sign-up|forgot-password|reset-password)(?:[/?#]|$)/.test(to))
    return undefined
  return to
}
