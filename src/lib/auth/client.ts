/**
 * Mock auth client.
 *
 * The real layer will be Better Auth. This file copies the shape of its client
 * on purpose (`useSession()` -> `{ data, isPending }`, `signIn.email`,
 * `signUp.email`, `signIn.social`, `signOut`, results as `{ data, error }`), so
 * moving over is a change to this one file: replace the body with
 * `createAuthClient()` from `better-auth/react` and nothing else moves.
 *
 * The session lives in localStorage so a reload keeps you signed in. The
 * server render never knows the session, so `isPending` is true until the
 * client has looked. Pages that need a user wait on it (see `RequireAuth`).
 */
import * as React from 'react'
import {
  addressTaken,
  generateAddress,
  isValidAddress,
  recordAlias,
  releaseAlias,
} from './directory'

export type AuthUser = {
  id: string
  name: string
  email: string
  /**
   * The address in every URL (source.code/<handle>). Generated at sign-up, and
   * the person can change it in Settings. Better Auth's username plugin will
   * own it.
   */
  handle: string
}

export type Session = { user: AuthUser; session: { id: string } }

export type AuthError = { code: string; message: string }
export type AuthResult = { data: Session | null; error: AuthError | null }

/** The demo account every screen in the mock data belongs to. */
export const demoUser: AuthUser = {
  id: 'usr_dana',
  name: 'Dana Okafor',
  email: 'dana@source.code',
  handle: 'dana',
}

const KEY = 'mock-session'
const LATENCY = 700

type State = { session: Session | null; ready: boolean }

const listeners = new Set<() => void>()
let state: State = { session: null, ready: false }
let started = false

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function persist(session: Session | null) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage can be blocked; the session then lasts for this page view.
  }
}

function start() {
  if (started) return
  started = true
  let session: Session | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) session = JSON.parse(raw) as Session
  } catch {
    session = null
  }
  emit({ session, ready: true })
  // Keep other tabs in step, as a cookie session would.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    try {
      emit({ session: e.newValue ? (JSON.parse(e.newValue) as Session) : null })
    } catch {
      emit({ session: null })
    }
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const SERVER: State = { session: null, ready: false }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function open(user: AuthUser): Session {
  const session: Session = {
    user,
    session: { id: `ses_${Math.random().toString(36).slice(2, 10)}` },
  }
  persist(session)
  emit({ session })
  return session
}

const fail = (code: string, message: string): AuthResult => ({
  data: null,
  error: { code, message },
})

/** Accounts the mock treats as taken, so the error states can be seen. */
const TAKEN_EMAIL = 'dana@source.code'

export const authClient = {
  useSession() {
    React.useEffect(start, [])
    const s = React.useSyncExternalStore(
      subscribe,
      () => state,
      () => SERVER,
    )
    return { data: s.session, isPending: !s.ready }
  },

  signIn: {
    /** Any email and password signs in. A password of "wrong" fails, to show the error. */
    async email(input: {
      email: string
      password: string
    }): Promise<AuthResult> {
      await wait(LATENCY)
      if (input.password === 'wrong')
        return fail('INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.')
      const email = input.email.trim().toLowerCase()
      const local = email.split('@')[0] ?? 'you'
      const known = email === demoUser.email
      return {
        data: open(
          known
            ? demoUser
            : {
                id: `usr_${generateAddress(email)}`,
                name: titleCase(local),
                email,
                handle: generateAddress(email),
              },
        ),
        error: null,
      }
    },
    /** One click into the demo account. Not part of Better Auth. */
    async demo(): Promise<AuthResult> {
      await wait(250)
      return { data: open(demoUser), error: null }
    },
  },

  signUp: {
    async email(input: {
      name: string
      email: string
      password: string
    }): Promise<AuthResult> {
      await wait(LATENCY + 200)
      const email = input.email.trim().toLowerCase()
      if (email === TAKEN_EMAIL)
        return fail(
          'USER_ALREADY_EXISTS',
          'An account with this email already exists.',
        )
      return {
        data: open({
          id: `usr_${generateAddress(email)}`,
          name: input.name.trim(),
          email,
          handle: generateAddress(email),
        }),
        error: null,
      }
    },
  },

  /** Change the name, email or address on the signed-in account. */
  async updateUser(
    input: Partial<Pick<AuthUser, 'name' | 'email' | 'handle'>>,
  ): Promise<AuthResult> {
    await wait(400)
    const current = state.session
    if (!current) return fail('UNAUTHORIZED', 'Sign in again to continue.')
    const handle = input.handle?.trim().toLowerCase()
    const renames = handle !== undefined && handle !== current.user.handle
    if (renames) {
      if (!isValidAddress(handle))
        return fail(
          'INVALID_ADDRESS',
          'Use 1 to 24 letters, numbers or dashes.',
        )
      if (addressTaken(handle, current.user.id))
        return fail('ADDRESS_TAKEN', `source.code/${handle} is already taken.`)
    }
    const email = input.email?.trim().toLowerCase()
    if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email))
      return fail('INVALID_EMAIL', 'Enter a valid email.')
    const name = input.name?.trim()
    if (name !== undefined && !name)
      return fail('INVALID_NAME', 'Enter your full name.')
    if (renames) {
      // The old address keeps redirecting; taking back one's own earlier one ends its redirect.
      recordAlias(current.user.handle, current.user.id, handle)
      releaseAlias(handle, current.user.id)
    }
    return {
      data: open({
        ...current.user,
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(handle !== undefined && { handle }),
      }),
      error: null,
    }
  },

  async forgotPassword(input: { email: string }): Promise<{ ok: true }> {
    await wait(LATENCY)
    void input
    return { ok: true }
  },

  async signOut(): Promise<void> {
    await wait(150)
    persist(null)
    emit({ session: null })
  },
}

const titleCase = (s: string) =>
  s
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ') || 'You'

/** Only follow redirects that stay on this site. */
export function safeRedirect(to: unknown): string | undefined {
  if (typeof to !== 'string') return undefined
  if (!to.startsWith('/') || to.startsWith('//')) return undefined
  // Coming back to an account screen would only bounce the person around.
  if (/^\/(sign-in|sign-up|forgot-password)(?:[/?#]|$)/.test(to))
    return undefined
  return to
}
