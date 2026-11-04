import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'

/** Centered dialog. `wide` is for dialogs that hold a form with several sections. */
function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]" />
        <Dialog.Popup
          className={cn(
            'fixed top-[10vh] left-1/2 z-50 max-h-[80vh] -translate-x-1/2 space-y-4 overflow-y-auto rounded-2xl border bg-popover p-6 shadow-2xl outline-none',
            wide
              ? 'w-[min(40rem,calc(100vw-2rem))]'
              : 'w-[min(28rem,calc(100vw-2rem))]',
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Dialog.Title className="text-base font-semibold tracking-tight">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mt-1 -mr-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XMarkIcon className="size-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export { Modal }
