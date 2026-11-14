import * as React from 'react'
import { cn } from 'cn'

export const field =
  'well w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25 focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 aria-invalid:border-danger'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(field, 'h-9', className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(field, 'min-h-20 py-2', className)}
      {...props}
    />
  )
}

/** Label, control, hint. The one layout every form in the app uses. */
function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  )
}

export { Input, Textarea, Field }
