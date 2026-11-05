import * as React from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  AuthField,
  AuthShell,
  PasswordInput,
  SubmitButton,
} from '~/components/forge/auth'
import { Callout } from '~/components/ui/callout'
import { Input } from '~/components/ui/input'
import { authClient, safeRedirect } from '~/lib/auth/client'

export const Route = createFileRoute('/sign-up')({
  head: () => ({ meta: [{ title: 'Create your account · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(s.redirect),
  }),
  component: SignUp,
})

/** Step 1 of 2. Step 2 (`/welcome`) offers to bring history from another host. */
function SignUp() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const submitted = React.useRef(false)

  // Opening this page while already signed in has nothing to do.
  React.useEffect(() => {
    if (!isPending && session && !submitted.current)
      router.history.push(redirect ?? '/dashboard')
  }, [isPending, session, router, redirect])

  const errors = {
    name: !name.trim() ? 'Tell us your full name.' : null,
    email: !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email.' : null,
    password: password.length < 8 ? 'Use at least 8 characters.' : null,
  }
  const show = (k: keyof typeof errors) => (tried ? errors[k] : null)
  const invalid = (k: keyof typeof errors) =>
    show(k) ? { 'aria-invalid': true, 'aria-describedby': `${k}-note` } : {}

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    setError(null)
    setBusy(true)
    submitted.current = true
    const { error: err } = await authClient.signUp.email({
      name,
      email,
      password,
    })
    if (err) {
      setBusy(false)
      submitted.current = false
      setError(err.message)
      return
    }
    void navigate({ to: '/welcome', search: { redirect } })
  }

  return (
    <AuthShell
      step="Step 1 of 2"
      title="Create your account"
      subtitle="Keep your code, and everything you have done elsewhere, in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/sign-in"
            search={{ redirect }}
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <Callout tone="danger" title="Could not create your account">
          {error}
        </Callout>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <AuthField
          id="name"
          label="Full name"
          error={show('name')}
          hint="This is how people see you. Companies get their own page later."
        >
          <Input
            id="name"
            autoComplete="name"
            placeholder="Dana Okafor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            {...invalid('name')}
          />
        </AuthField>
        <AuthField id="email" label="Email" error={show('email')}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            {...invalid('email')}
          />
        </AuthField>
        <AuthField
          id="password"
          label="Password"
          error={show('password')}
          hint="At least 8 characters."
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            {...invalid('password')}
          />
        </AuthField>
        <SubmitButton pending={busy}>
          {busy ? 'Creating your account' : 'Continue'}
        </SubmitButton>
      </form>
    </AuthShell>
  )
}
