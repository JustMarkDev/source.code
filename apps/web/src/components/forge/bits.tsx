import * as React from 'react'
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { BadgeTone } from '~/components/ui/badge'
import type { Source } from '~/lib/model/data'
import { Badge } from '~/components/ui/badge'
import { Segmented } from '~/components/ui/tabs'
import { languageColors, sources } from '~/lib/model/data'

/** The ONLY place a forge name may show: private screens (settings, owner-only). */
export function SourceBadge({
  source,
  className,
}: {
  source: Source
  className?: string
}) {
  const s = sources[source]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

export function LangDot({
  language,
  className,
}: {
  language: string
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className="size-2.5 rounded-full"
        style={{ background: languageColors[language] ?? '#71717a' }}
      />
      {language}
    </span>
  )
}

/** Letter tile on a soft per-name colour. Readable in both themes. */
export function Tile({
  name,
  hue,
  className,
  round,
}: {
  name: string
  hue?: number
  className?: string
  round?: boolean
}) {
  const h =
    hue ??
    Array.from(name).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center font-mono text-sm font-semibold',
        round ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={{
        background: `oklch(0.8 0.1 ${h})`,
        color: `oklch(0.25 0.06 ${h})`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/** A person's round profile picture, on the same colour as their profile page. */
export function Avatar({
  handle,
  className,
}: {
  handle: string
  className?: string
}) {
  return <Tile name={handle} round className={className} />
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </kbd>
  )
}

/** A section heading. Plain words, no decoration. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={cn('text-sm font-medium text-foreground', className)}>
      {children}
    </h2>
  )
}

export function Panel({
  className,
  children,
  as: Component = 'section',
  ...props
}: Omit<React.ComponentProps<'section'>, 'ref'> & {
  as?: 'section' | 'div' | 'article' | 'aside'
}) {
  return (
    <Component
      className={cn('surface rounded-2xl border bg-card', className)}
      {...props}
    >
      {children}
    </Component>
  )
}

export function Chip({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <Badge tone={tone} className={className}>
      {children}
    </Badge>
  )
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      )}
    </div>
  )
}

export function PageTitle({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && (
        <p className="mt-1.5 max-w-[65ch] text-muted-foreground">{children}</p>
      )}
    </div>
  )
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<[T, string]>
}) {
  return <Segmented value={value} onChange={onChange} options={options} />
}

export { Modal } from '~/components/ui/dialog'

/** The address, small and quiet under the name. One click copies it. */
export function CopyAddress({ handle }: { handle: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : `Copy address ${handle}`}
      onClick={() => {
        void navigator.clipboard.writeText(handle).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="group -my-1 mt-0.5 inline-flex items-center gap-1.5 rounded-md py-1 font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      @{handle}
      {copied ? (
        <CheckIcon className="size-3.5 text-success" />
      ) : (
        <ClipboardDocumentIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      )}
    </button>
  )
}
