import {
  CheckCircleIcon,
  EllipsisHorizontalCircleIcon,
  MinusIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { Panel } from './bits'
import { GitMergeIcon } from '~/components/icons'
import { Button } from '~/components/ui/button'

export function StateIcon({
  state,
}: {
  state: 'pass' | 'fail' | 'pending' | 'na'
}) {
  if (state === 'pass')
    return <CheckCircleIcon className="size-4 text-success" />
  if (state === 'fail') return <XCircleIcon className="size-4 text-danger" />
  if (state === 'pending')
    return <EllipsisHorizontalCircleIcon className="size-4 text-warning" />
  return <MinusIcon className="size-4 text-muted-foreground" />
}

export type StatusItem = {
  id: string
  label: string
  detail: string
  state: 'pass' | 'fail' | 'pending'
  goto?: 'code' | 'timeline'
}

/** The checklist and the Land button. Presentational, so the landing page can show it too. */
export function StatusCard({
  items,
  landing,
  canLand,
  changeId,
  note,
  onLand,
  onGoto,
}: {
  items: Array<StatusItem>
  landing: 'idle' | 'landing' | 'landed'
  canLand: boolean
  changeId: string
  note: string
  onLand: () => void
  onGoto?: (tab: 'code' | 'timeline') => void
}) {
  return (
    <Panel className="overflow-hidden p-2">
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              disabled={!i.goto || !onGoto}
              onClick={() => i.goto && onGoto?.(i.goto)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left enabled:hover:bg-muted/60"
            >
              <span className="mt-0.5">
                <StateIcon state={i.state} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{i.label}</span>
                <span className="block text-sm text-muted-foreground">
                  {i.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 p-2 pt-3">
        {landing === 'landed' ? (
          <div className="flex items-center gap-2 rounded-xl bg-merged/10 px-4 py-3 font-medium text-merged">
            <GitMergeIcon className="size-4" />
            Landed. Children were rebased.
          </div>
        ) : (
          <>
            <Button
              // Lime means "you can do this now". Until then it is quiet.
              variant={canLand ? 'brand' : 'outline'}
              size="lg"
              className="w-full"
              disabled={!canLand || landing === 'landing'}
              onClick={onLand}
            >
              <GitMergeIcon />
              {landing === 'landing' ? 'Landing' : `Land #${changeId}`}
            </Button>
            <p className="px-1 text-center text-xs text-muted-foreground">
              {note}
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}
