import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import { cn } from 'cn'
import type { VariantProps } from 'class-variance-authority'

/**
 * One primary action per screen. `brand` is that action; everything else is
 * deliberately quiet so the page has a clear next step.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        brand:
          'raised bg-brand font-semibold text-brand-foreground hover:brightness-[1.04]',
        default:
          'raised bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'raised border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted',
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        danger:
          'bg-danger/10 text-danger hover:bg-danger/15 focus-visible:ring-danger/30',
        link: 'h-auto px-0 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-3.5',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
)

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
