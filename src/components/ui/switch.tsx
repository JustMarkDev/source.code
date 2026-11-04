import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from 'cn'

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'well relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[checked]:bg-brand data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="raised block size-5 translate-x-0.5 rounded-full bg-background transition-transform data-[checked]:translate-x-[18px] data-[checked]:bg-white" />
    </SwitchPrimitive.Root>
  )
}

/** A switch with its label and a one-line explanation beside it. */
function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="text-sm">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

export { Switch, SwitchRow }
