import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from 'cn'
import type { VariantProps } from 'class-variance-authority'

/**
 * Status and metadata. Tones come from the semantic tokens, so a badge needs
 * no `dark:` variants: the colours flip with the theme.
 */
const badgeVariants = cva(
  'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        muted: 'bg-muted text-muted-foreground',
        outline: 'border text-muted-foreground',
        success: 'bg-success/12 text-success',
        warning: 'bg-warning/12 text-warning',
        danger: 'bg-danger/12 text-danger',
        info: 'bg-info/12 text-info',
        merged: 'bg-merged/12 text-merged',
        brand: 'bg-brand/35 text-foreground',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
