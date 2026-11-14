import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { AuthField, AuthShell, SubmitButton } from '~/components/forge/auth'
import { Callout } from '~/components/ui/callout'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth/client'

type Search = { token?: string; error?: string }

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: 'Choose a new password · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === 'string' && s.token ? s.token : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  component: ResetPassword,
})

const MIN = 8

/** Where a reset link lands: the token is in the address, the new password is typed here. */
function ResetPassword() {
  const { token, error: linkError } = Route.useSearch()
  const [password, setPassword] = React.useState('')
  const [again, setAgain] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  const short = password.length < MIN
  const differ = again !== password
  const fieldError = !tried
    ? null
    : short
      ? `Use at least ${MIN} characters.`
      : null
  const againError = tried && !short && differ ? 'The two do not match.' : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (short || differ || !token) return
    setPending(true)
    const r = await authClient.resetPassword({ token, password })
    setPending(false)
    if (r.error) setProblem(r.error.message)
    else setDone(true)
  }

  const footer = (
    <Link
      to="/sign-in"
      className="-my-1.5 inline-flex items-center gap-1.5 py-1.5 font-medium text-foreground hover:underline"
    >
      <ArrowLeftIcon className="size-3.5" />
      Back to sign in
    </Link>
  )

  if (!token || linkError)
    return (
      <AuthShell title="This link does not work" footer={footer}>
        <Callout tone="danger" title="The reset link is invalid or has expired">
          Links work once, for one hour.{' '}
          <Link to="/forgot-password" className="font-medium underline">
            Ask for a new one
          </Link>
          .
        </Callout>
      </AuthShell>
    )

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You will sign in with it from now on."
      footer={footer}
    >
      {done ? (
        <Callout tone="success" title="Your password is changed">
          <Link to="/sign-in" className="font-medium underline">
            Sign in
          </Link>{' '}
          with the new one.
        </Callout>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <AuthField id="password" label="New password" error={fieldError}>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              disabled={pending}
              autoFocus
            />
          </AuthField>
          <AuthField id="again" label="The same again" error={againError}>
            <Input
              id="again"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              aria-invalid={againError ? true : undefined}
              disabled={pending}
            />
          </AuthField>
          {problem && <Callout tone="danger">{problem}</Callout>}
          <SubmitButton pending={pending}>
            {pending ? 'Saving' : 'Save new password'}
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  )
}
