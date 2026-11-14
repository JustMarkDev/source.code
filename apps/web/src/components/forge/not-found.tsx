import { Link } from '@tanstack/react-router'
import type * as React from 'react'
import { Button } from '~/components/ui/button'
import { refusalOf } from '~/lib/forge'

/** Shown for an address that leads nowhere. Says what happened and where to go next. */
export function NotFoundPage({
  title = 'We could not find that page',
  children,
}: {
  title?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-lg space-y-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">
        {children ??
          'The address may be mistyped, or the project or person may have been renamed or removed. These are the places most people go next.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="brand"
          render={<Link to="/discover" />}
          nativeButton={false}
        >
          Browse software
        </Button>
        <Button render={<Link to="/" />} nativeButton={false}>
          Go home
        </Button>
        <Button
          render={<Link to="/docs/$" params={{ _splat: '' }} />}
          nativeButton={false}
        >
          Read the docs
        </Button>
      </div>
    </div>
  )
}

/** Shown when a page fails to load. A person gets a way forward, a developer gets the reason. */
export function ErrorPage({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  // What a page read live and may not see (or that is gone) is not found.
  if (refusalOf(error)?.code === 'not_found') return <NotFoundPage />
  return (
    <div className="mx-auto max-w-lg space-y-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        This page did not load. Trying again usually fixes it. If it does not,
        the status page says whether something is down.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="brand" onClick={reset}>
          Try again
        </Button>
        <Button render={<Link to="/status" />} nativeButton={false}>
          Check status
        </Button>
        <Button render={<Link to="/" />} nativeButton={false}>
          Go home
        </Button>
      </div>
      {error instanceof Error && error.message && (
        <p className="font-mono text-xs break-words text-muted-foreground">
          {error.message}
        </p>
      )}
    </div>
  )
}
