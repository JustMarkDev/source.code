import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { Button } from '~/components/ui/button'
import { Modal } from '~/components/ui/dialog'
import { Field, Input, Textarea } from '~/components/ui/input'
import { Select, SelectItem } from '~/components/ui/select'
import { authClient } from '~/lib/auth/client'

/**
 * "Talk to us" for enterprise: a short form instead of a dead button. Three
 * questions, only one required, and an answer on screen when it is sent. The
 * preview does not send it anywhere yet.
 */
export function ContactSales({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession()
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [size, setSize] = React.useState('11-50')
  const [need, setNeed] = React.useState('')
  const [tried, setTried] = React.useState(false)
  const [state, setState] = React.useState<'form' | 'sending' | 'sent'>('form')
  const valid = /^\S+@\S+\.\S+$/.test(email)

  const onOpen = () => {
    // Someone signed in should not have to type their own address.
    if (!email && session) setEmail(session.user.email)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    // Reopening after a send starts a fresh request.
    setTimeout(() => {
      setState('form')
      setTried(false)
      setNeed('')
    }, 200)
  }
  const send = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!valid) return
    setState('sending')
    setTimeout(() => setState('sent'), 700)
  }

  return (
    <>
      <Button onClick={onOpen}>{children}</Button>
      <Modal
        open={open}
        onClose={close}
        title={state === 'sent' ? 'Thanks, we have it' : 'Talk to us'}
        description={
          state === 'sent'
            ? undefined
            : 'Tell us a little about your team. A person will reply to the address below.'
        }
      >
        {state === 'sent' ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl bg-success/8 p-4 text-sm">
              <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
              <p>
                A person will reply to <b className="font-medium">{email}</b>.
                In the meantime the{' '}
                <Link
                  to="/docs/$"
                  params={{ _splat: 'concepts/policies' }}
                  className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  policy docs
                </Link>{' '}
                show how landing rules work.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={close}>Close</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={send} noValidate className="space-y-4">
            <Field
              label="Work email"
              hint={
                tried && !valid ? (
                  <span role="alert" className="text-danger">
                    Enter a valid email.
                  </span>
                ) : undefined
              }
            >
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={tried && !valid ? true : undefined}
                autoFocus
              />
            </Field>
            <Field label="Team size">
              <Select value={size} onValueChange={setSize}>
                <SelectItem value="1-10">1 to 10 people</SelectItem>
                <SelectItem value="11-50">11 to 50 people</SelectItem>
                <SelectItem value="51-200">51 to 200 people</SelectItem>
                <SelectItem value="201-1000">201 to 1,000 people</SelectItem>
                <SelectItem value="1000+">More than 1,000</SelectItem>
              </Select>
            </Field>
            <Field
              label="What do you need?"
              hint="Optional. SSO, audit export, data residency, an SLA, or something else."
            >
              <Textarea
                rows={3}
                value={need}
                onChange={(e) => setNeed(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="brand"
                disabled={state === 'sending'}
              >
                {state === 'sending' && (
                  <ArrowPathIcon className="animate-spin" />
                )}
                {state === 'sending' ? 'Sending' : 'Send'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
