import * as React from 'react'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'

const tones = {
  info: { icon: InformationCircleIcon, cls: 'bg-info/8 text-info' },
  success: { icon: CheckCircleIcon, cls: 'bg-success/8 text-success' },
  warning: { icon: ExclamationTriangleIcon, cls: 'bg-warning/8 text-warning' },
} as const

/** A short note that sits inside a page. Use it for what the reader must not miss. */
function Callout({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const { icon: Icon, cls } = tones[tone]
  return (
    <div className={cn('flex gap-3 rounded-xl p-4 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1 text-foreground">
        {title && <p className="font-medium">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

export { Callout }
