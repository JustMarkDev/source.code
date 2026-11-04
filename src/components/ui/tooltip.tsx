import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

/** Hover or focus hint for icon-only controls. */
function Tip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <TooltipPrimitive.Provider delay={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner sideOffset={6} className="z-50">
            <TooltipPrimitive.Popup className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md">
              {label}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export { Tip }
