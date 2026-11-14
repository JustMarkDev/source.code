import * as React from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Logo } from './chrome'
import { Stagger } from '~/components/motion'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { authClient, safeRedirect } from '~/lib/auth/client'

/**
 * The frame every account screen shares: a quiet page, the logo, one card.
 * The site header and footer are left out so the only way forward is the form.
 */
export function AuthShell({
  step,
  title,
  subtitle,
  children,
  footer,
}: {
  /** "Step 1 of 2": shown above the title on multi-step flows. */
  step?: string
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-6 py-10">
      <Logo className="text-base" />
      <Stagger className="mt-8 w-full max-w-[26rem] space-y-6 pb-10 sm:mt-[9vh]">
        <div className="space-y-1.5 text-center">
          {step && (
            <p className="font-mono text-xs text-muted-foreground">{step}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground text-balance">
              {subtitle}
            </p>
          )}
        </div>
        <div className="surface space-y-5 rounded-2xl border bg-card p-6">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground">{footer}</p>
        )}
      </Stagger>
      <p className="mt-auto max-w-sm text-center text-xs text-muted-foreground">
        By continuing you agree to the{' '}
        <Link
          to="/terms"
          className="underline decoration-border underline-offset-4 hover:text-foreground"
        >
          terms of service
        </Link>{' '}
        and the{' '}
        <Link
          to="/privacy"
          className="underline decoration-border underline-offset-4 hover:text-foreground"
        >
          privacy policy
        </Link>
        .
      </p>
    </div>
  )
}

export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = React.useState(false)
  const Icon = shown ? EyeSlashIcon : EyeIcon
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Icon className="size-4" />
      </button>
    </div>
  )
}

/** The submit button: the screen's one primary action. */
export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="submit"
      variant="brand"
      size="lg"
      disabled={pending}
      className="w-full"
    >
      {pending && <ArrowPathIcon className="animate-spin" />}
      {children}
    </Button>
  )
}

/**
 * Wraps a page only a signed-in person can use. Signed out, it sends them to
 * sign in and brings them back here afterwards. While the session is still
 * being read it shows nothing, so a signed-in reload never flashes the form.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const href = useRouterState({ select: (s) => s.location.href })
  // The page to come back to. Read when the redirect fires, not as a
  // dependency: this component stays mounted for a moment after the URL
  // changes, and a dependency would redirect again with the sign-in URL.
  const back = React.useRef(href)
  back.current = href
  const signedOut = !isPending && !data
  // `navigate` changes identity whenever the location does, so the effect
  // cannot depend on it: it would fire again from the sign-in URL.
  const sent = React.useRef(false)
  React.useEffect(() => {
    if (!signedOut) {
      sent.current = false
      return
    }
    // Already on the way: the route change can run this a second time.
    if (sent.current || safeRedirect(back.current) === undefined) return
    sent.current = true
    void navigate({
      to: '/sign-in',
      search: { redirect: back.current },
      replace: true,
    })
  }, [signedOut, navigate])
  if (isPending || signedOut) return <div aria-busy className="min-h-[60vh]" />
  return children
}

/**
 * For buttons that need an account (Star, Fork, Follow). Signed in, it runs
 * the action. Signed out, it opens sign in and returns to this page after.
 */
export function useSignInGate() {
  const { data } = authClient.useSession()
  const navigate = useNavigate()
  const href = useRouterState({ select: (s) => s.location.href })
  return React.useCallback(
    (action?: () => void) => {
      if (data) action?.()
      else void navigate({ to: '/sign-in', search: { redirect: href } })
    },
    [data, navigate, href],
  )
}

/** Label, control, then a hint or an error. `aside` sits opposite the label. */
export function AuthField({
  id,
  label,
  aside,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  aside?: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {aside && <span className="text-xs">{aside}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-note`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
