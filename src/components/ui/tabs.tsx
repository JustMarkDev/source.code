import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import type { LinkProps } from '@tanstack/react-router'
import { Pill } from '~/components/motion'

const trough =
  'well inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-muted/70 p-1'
const base =
  'relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground'
const on = 'font-medium text-foreground hover:text-foreground'

/** Navigation tabs: every tab is a real link, so the URL says where you are. */
function LinkTabs({
  tabs,
  label,
  className,
}: {
  tabs: Array<{
    link: LinkProps
    label: string
    count?: number
    active: boolean
  }>
  label: string
  className?: string
}) {
  const pill = React.useId()
  return (
    <nav aria-label={label} className={cn(trough, className)}>
      {tabs.map((t) => (
        <Link
          key={t.label}
          {...t.link}
          aria-current={t.active ? 'page' : undefined}
          className={cn(base, t.active && on)}
        >
          {t.active && <Pill id={pill} />}
          <span className="relative">{t.label}</span>
          {t.count !== undefined && (
            <span className="relative text-xs text-muted-foreground tabular-nums">
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}

/** In-page tabs for switching a view without changing the URL. */
function StateTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; label: string; count?: number }>
  label: string
  className?: string
}) {
  const pill = React.useId()
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  // A tablist is one stop for Tab and moves with the arrow keys, like any native one.
  const go = (to: number) => {
    const next = (to + options.length) % options.length
    onChange(options[next].id)
    refs.current[next]?.focus()
  }
  const keys = (e: React.KeyboardEvent, i: number) => {
    const target =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? options.length - 1
              : null
    if (target === null) return
    e.preventDefault()
    go(target)
  }
  return (
    <div role="tablist" aria-label={label} className={cn(trough, className)}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => keys(e, i)}
          className={cn(base, value === o.id && on)}
        >
          {value === o.id && <Pill id={pill} />}
          <span className="relative">{o.label}</span>
          {o.count !== undefined && (
            <span className="relative text-xs text-muted-foreground tabular-nums">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Small pill group for choosing between two to four modes. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<[T, React.ReactNode]>
  label?: string
}) {
  const pill = React.useId()
  return (
    <div
      role="group"
      aria-label={label}
      className="well inline-flex rounded-xl bg-muted/70 p-1 text-sm"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'relative rounded-lg px-3 py-1 text-muted-foreground transition-colors hover:text-foreground',
            value === id && 'font-medium text-foreground',
          )}
        >
          {value === id && <Pill id={pill} />}
          <span className="relative">{text}</span>
        </button>
      ))}
    </div>
  )
}

export { LinkTabs, StateTabs, Segmented }
