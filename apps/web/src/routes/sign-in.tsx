import * as React from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  AuthField,
  AuthShell,
  PasswordInput,
  SubmitButton,
} from '~/components/forge/auth'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Input } from '~/components/ui/input'
import { authClient, safeRedirect } from '~/lib/auth/client'

export const Route = createFileRoute('/sign-in')({
  head: () => ({ meta: [{ title: 'Sign in · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(s.redirect),
  }),
  component: SignIn,
})

/** Where someone was headed, in words. A raw path means nothing to most people. */
function describe(path: string): string {
  const [pathname] = path.split(/[?#]/)
  const seg = pathname.split('/').filter(Boolean)
  if (seg[0] === 'dashboard') return 'your dashboard'
  if (seg[0] === 'inbox') return 'your inbox'
  if (seg[0] === 'new') return 'create a repository'
  if (seg[0] === 'settings') return 'your settings'
  if (seg[0] === 'organizations') return 'your organization'
  if (seg.length >= 2) return `${seg[0]}/${seg[1]}`
  return 'where you were going'
}

function SignIn() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [busy, setBusy] = React.useState<'email' | 'demo' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const submitted = React.useRef(false)

  const target = redirect ?? '/dashboard'
  const go = React.useCallback(
    () => router.history.push(target),
    [router, target],
  )

  // Opening this page while already signed in has nothing to do.
  React.useEffect(() => {
    if (!isPending && session && !submitted.current) go()
  }, [isPending, session, go])

  const emailError =
    tried && !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email.' : null
  const passwordError = tried && !password ? 'Enter your password.' : null

  const finish = async (
    run: () => ReturnType<typeof authClient.signIn.demo>,
    as: typeof busy,
  ) => {
    setError(null)
    setBusy(as)
    submitted.current = true
    const { error: err } = await run()
    if (err) {
      setBusy(null)
      submitted.current = false
      setError(err.message)
      return
    }
    go()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) return
    void finish(() => authClient.signIn.email({ email, password }), 'email')
  }

  const disabled = busy !== null
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where your code and its history left off."
      footer={
        <>
          New here?{' '}
          <Link
            to="/sign-up"
            search={{ redirect }}
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Create an account
          </Link>
        </>
      }
    >
      {redirect && !error && (
        <Callout>Sign in to continue to {describe(redirect)}.</Callout>
      )}
      {error && (
        <Callout tone="danger" title="Could not sign in">
          {error}
        </Callout>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <AuthField id="email" label="Email" error={emailError}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'email-note' : undefined}
            disabled={disabled}
            autoFocus
          />
        </AuthField>
        <AuthField
          id="password"
          label="Password"
          error={passwordError}
          aside={
            <Link
              to="/forgot-password"
              className="text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? 'password-note' : undefined}
            disabled={disabled}
          />
        </AuthField>
        <SubmitButton pending={busy === 'email'}>
          {busy === 'email' ? 'Signing in' : 'Sign in'}
        </SubmitButton>
      </form>
      {/* The demo account only exists on a development deployment. */}
      {import.meta.env.DEV ? (
        <div className="border-t pt-4 text-center text-sm text-muted-foreground">
          Just looking?{' '}
          <Button
            type="button"
            variant="link"
            disabled={disabled}
            onClick={() => void finish(() => authClient.signIn.demo(), 'demo')}
            className="text-sm"
          >
            Use the demo account
          </Button>
        </div>
      ) : null}
    </AuthShell>
  )
}
