import * as React from 'react'
import { Menu } from '@base-ui/react/menu'
import { cn } from 'cn'

/** A dropdown. Pass a trigger element; items go inside `MenuItem`. */
function Dropdown({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: React.ReactElement
  children: React.ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner align={align} sideOffset={6} className="z-50">
          <Menu.Popup
            className={cn(
              'overlay-popup min-w-44 rounded-xl border bg-popover p-1 text-sm shadow-lg outline-none',
              className,
            )}
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function MenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function MenuSeparator() {
  return <div className="my-1 border-t" />
}

export { Dropdown, MenuItem, MenuSeparator }
