import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  CheckIcon,
  CloudIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  PlayIcon,
  ServerIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { CopyField } from './repo-shell'
import { Modal } from './bits'
import type { Target } from '~/mock/platform'
import { Button } from '~/components/ui/button'

type Subject = { kind: 'issue' | 'change'; ref: string; title: string }

const targets: Array<{
  id: Target
  icon: React.ComponentType<{ className?: string }>
  name: string
  body: string
}> = [
  {
    id: 'T3 Code',
    icon: ComputerDesktopIcon,
    name: 'T3 Code',
    body: 'Your machine, your own agent login. Opens a thread in a new worktree.',
  },
  {
    id: 'boat.dev',
    icon: CloudIcon,
    name: 'boat.dev',
    body: 'A fresh cloud environment for this task, removed when it ends.',
  },
  {
    id: 'E2B',
    icon: ServerIcon,
    name: 'E2B sandbox',
    body: 'An isolated sandbox from your E2B account, removed when the task ends.',
  },
]

const runtimes = ['Claude Code', 'Codex', 'OpenCode'] as const

const context = [
  ['text', 'The issue or change text'],
  ['policies', 'Policies that apply to the paths involved'],
  ['findings', 'Open review findings'],
  ['schema', 'Env schema, names and types only'],
] as const

export function WorkWithAgent({
  subject,
  repo,
  label = 'Work with an agent',
}: {
  subject: Subject
  repo: string
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [target, setTarget] = React.useState<Target>('T3 Code')
  const [runtime, setRuntime] =
    React.useState<(typeof runtimes)[number]>('Claude Code')
  const [picked, setPicked] = React.useState<Set<string>>(
    new Set(['text', 'policies', 'schema']),
  )
  const [phase, setPhase] = React.useState<'idle' | 'starting' | 'started'>(
    'idle',
  )

  const flag =
    target === 'T3 Code' ? 't3' : target === 'boat.dev' ? 'boat' : 'e2b'
  const command = `sx agent start ${subject.ref} -R ${repo} --target ${flag} --runtime ${runtime === 'Claude Code' ? 'claude' : runtime.toLowerCase()}`

  const start = () => {
    setPhase('starting')
    setTimeout(() => setPhase('started'), 1100)
  }
  const close = () => {
    setOpen(false)
    setTimeout(() => setPhase('idle'), 200)
  }
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CpuChipIcon className="size-4" />
        {label}
      </Button>
      <Modal
        open={open}
        onClose={close}
        wide
        title="Work on this with an agent"
        description={`${subject.ref} ${subject.title}`}
      >
        {phase === 'started' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border bg-background p-4">
              <CheckIcon className="mt-0.5 size-5 text-success" />
              <div className="text-sm">
                <p className="font-medium">
                  {target === 'T3 Code'
                    ? 'Thread started on your machine'
                    : target === 'boat.dev'
                      ? 'Environment ready, agent running'
                      : 'Agent running in your sandbox'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  It will open a draft change on top of {subject.ref} and link
                  it here. You approve before anything lands.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="brand" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={target === t.id}
                  onClick={() => setTarget(t.id)}
                  className={cn(
                    'space-y-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted',
                    target === t.id && 'border-foreground bg-muted',
                  )}
                >
                  <t.icon className="size-4" />
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.body}</div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Agent</span>
              {runtimes.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={runtime === r}
                  onClick={() => setRuntime(r)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted',
                    runtime === r && 'border-foreground bg-muted font-medium',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">
                What to send with it
              </legend>
              {context.map(([id, text]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(id)}
                    onChange={() => toggle(id)}
                    className="size-4 accent-[var(--brand-ink)]"
                  />
                  {text}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                Secret values are never included. Decrypting for an agent is a
                separate, expiring grant under Secrets.
              </p>
            </fieldset>

            <div className="space-y-2">
              <CopyField value={command} prefix="$" />
              <p className="text-xs text-muted-foreground">
                {target === 'T3 Code'
                  ? 'This builds the prompt and prints the t3 command that opens a thread in a new worktree.'
                  : 'This builds the prompt. Start the environment from its own dashboard or API with it.'}{' '}
                <Link
                  to="/docs/$"
                  params={{ _splat: 'cli/agents' }}
                  className="underline underline-offset-4"
                >
                  How it works
                </Link>
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="brand"
                disabled={phase === 'starting'}
                onClick={start}
              >
                <PlayIcon className="size-4" />
                {phase === 'starting' ? 'Starting' : 'Start now'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
