import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { AuthField, AuthShell, SubmitButton } from '~/components/forge/auth'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Input } from '~/components/ui/input'
import { authClient } from '~/lib/auth/client'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: 'Reset your password · source.code' }] }),
  component: ForgotPassword,
})

function ForgotPassword() {
  const [email, setEmail] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [sentTo, setSentTo] = React.useState<string | null>(null)

  const error =
    tried && !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email.' : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!/^\S+@\S+\.\S+$/.test(email)) return
    setPending(true)
    await authClient.forgotPassword({ email })
    setPending(false)
    setSentTo(email)
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we will send a link to choose a new one."
      footer={
        <Link
          to="/sign-in"
          className="-my-1.5 inline-flex items-center gap-1.5 py-1.5 font-medium text-foreground hover:underline"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <div className="space-y-4">
          <Callout tone="success" title="Check your inbox">
            If an account exists for {sentTo}, a reset link is on its way. It
            works for one hour.
          </Callout>
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setSentTo(null)
              setTried(false)
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <AuthField id="email" label="Email" error={error}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'email-note' : undefined}
              disabled={pending}
              autoFocus
            />
          </AuthField>
          <SubmitButton pending={pending}>
            {pending ? 'Sending' : 'Send reset link'}
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  )
}
