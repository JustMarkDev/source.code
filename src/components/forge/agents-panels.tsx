import * as React from 'react'
import {
  ChevronRightIcon,
  CloudIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  LockClosedIcon,
  PlusIcon,
  ServerIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type {
  Automation,
  Bot as BotType,
  Run,
  Scope,
  Target,
  Trigger,
} from '~/mock/platform'
import { Chip, Modal, Panel, SectionLabel } from '~/components/forge/bits'
import { CopyField } from '~/components/forge/repo-shell'
import { Toggle } from '~/components/forge/repo-pages'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import {
  automations as initialAutomations,
  bots as initialBots,
  triggers,
} from '~/mock/platform'

const targetIcon = {
  'T3 Code': ComputerDesktopIcon,
  'boat.dev': CloudIcon,
  E2B: ServerIcon,
} as const

function NewAutomation({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (a: Automation) => void
}) {
  const [name, setName] = React.useState('')
  const [bot, setBot] = React.useState('fix-agent')
  const [picked, setPicked] = React.useState<Array<Trigger>>(['change.opened'])
  const [target, setTarget] = React.useState<Target>('T3 Code')
  const [instructions, setInstructions] = React.useState('')
  const ok = name.trim() && picked.length && instructions.trim()
  const toggle = (t: Trigger) =>
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="New automation"
      description="Runs as a bot, with only the scopes that bot has. The bot's scopes cap what the automation can do."
    >
      <div className="space-y-4 text-sm">
        <label className="block space-y-1">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Runs as</span>
            <Select value={bot} onValueChange={(v) => setBot(v)}>
              {initialBots.map((b) => (
                <SelectItem key={b.slug} value={b.slug}>
                  {b.name}
                </SelectItem>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Runs on</span>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as Target)}
            >
              <SelectItem>T3 Code</SelectItem>
              <SelectItem>boat.dev</SelectItem>
              <SelectItem>E2B</SelectItem>
            </Select>
          </label>
        </div>
        <div className="space-y-2">
          <span className="text-muted-foreground">When</span>
          <div className="flex flex-wrap gap-2">
            {triggers.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={picked.includes(t)}
                onClick={() => toggle(t)}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-xs transition-colors hover:bg-muted',
                  picked.includes(t) &&
                    'border-foreground bg-muted font-medium',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-muted-foreground">Instructions</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            className="w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="brand"
          disabled={!ok}
          onClick={() => {
            onCreate({
              id: `a${Date.now()}`,
              name: name.trim(),
              bot,
              triggers: picked,
              runtime: 'Claude Code',
              target,
              instructions: instructions.trim(),
              enabled: true,
              lastRun: 'never',
              runs: 0,
            })
            setName('')
            setInstructions('')
          }}
        >
          Create
        </Button>
      </div>
    </Modal>
  )
}

export function Automations() {
  const [list, setList] = React.useState(initialAutomations)
  const [creating, setCreating] = React.useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          An automation waits for an event, then hands a task to an agent. It
          can open drafts and comment. It cannot land anything on its own.
        </p>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <PlusIcon className="size-4" />
          New automation
        </Button>
      </div>
      <Panel className="divide-y overflow-hidden">
        {list.map((a) => {
          const Icon = targetIcon[a.target]
          return (
            <div key={a.id} className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">{a.name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CpuChipIcon className="size-3" />
                      {a.bot}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon className="size-3" />
                      {a.target}
                    </span>
                    <span>{a.runtime}</span>
                    <span>
                      {a.runs} runs, last {a.lastRun}
                    </span>
                  </div>
                </div>
                <div className="w-44">
                  <Toggle
                    checked={a.enabled}
                    onChange={(v) =>
                      setList((p) =>
                        p.map((x) =>
                          x.id === a.id ? { ...x, enabled: v } : x,
                        ),
                      )
                    }
                    label={a.enabled ? 'On' : 'Off'}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {a.triggers.map((t) => (
                  <Chip key={t} className="font-mono">
                    {t}
                  </Chip>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{a.instructions}</p>
            </div>
          )
        })}
      </Panel>
      <NewAutomation
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(a) => {
          setList((p) => [a, ...p])
          setCreating(false)
        }}
      />
    </div>
  )
}

const grantable: Array<Scope> = [
  'repo:read',
  'repo:write',
  'issues:read',
  'issues:comment',
  'issues:write',
  'pulls:read',
  'pulls:comment',
  'pulls:write',
  'pulls:merge',
  'secrets:schema',
  'secrets:decrypt',
]

function BotCard({
  bot,
  onChange,
}: {
  bot: BotType
  onChange: (b: BotType) => void
}) {
  const [token, setToken] = React.useState<string | null>(null)
  const [hint, setHint] = React.useState(false)
  const installed = bot.installs.length > 0
  return (
    <Panel className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
              <CpuChipIcon className="size-4" />
            </span>
            <div>
              <div className="font-medium">{bot.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                @{bot.slug}
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {bot.description}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setToken(
              `sc_bot_${bot.slug.replaceAll('-', '')}_${Math.random().toString(36).slice(2, 14)}`,
            )
          }
        >
          Mint token
        </Button>
      </div>

      <div className="space-y-2">
        <SectionLabel>Scopes</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {grantable.map((s) => {
            const on = bot.scopes.includes(s)
            const locked = installed && !on
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (locked) {
                    setHint(true)
                    return
                  }
                  onChange({
                    ...bot,
                    scopes: on
                      ? bot.scopes.filter((x) => x !== s)
                      : [...bot.scopes, s],
                  })
                }}
                className={cn(
                  'inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors hover:border-foreground/40',
                  on
                    ? 'border-foreground bg-muted font-medium'
                    : 'text-muted-foreground',
                  locked && 'border-dashed',
                )}
              >
                {locked && <LockClosedIcon className="size-3" />}
                {s}
              </button>
            )
          })}
        </div>
        {hint && (
          <p role="status" className="text-xs text-warning">
            While a bot is installed its scopes can be reduced but not expanded.
            To add one, remove every install, save, and reinstall where you
            approve it.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>Installed on {bot.installs.join(', ') || 'no repositories'}</span>
        <span>
          {bot.tokens} active token{bot.tokens === 1 ? '' : 's'}
        </span>
        <span>Runs get a token limited to one repository and one run</span>
      </div>

      <Modal
        open={token !== null}
        onClose={() => setToken(null)}
        title="New bot token"
        description="Shown once. It expires in 30 days and can be revoked from this page."
      >
        {token && <CopyField value={token} prefix="" />}
        <div className="flex justify-end">
          <Button
            variant="brand"
            onClick={() => {
              onChange({ ...bot, tokens: bot.tokens + 1 })
              setToken(null)
            }}
          >
            I saved it
          </Button>
        </div>
      </Modal>
    </Panel>
  )
}

export function Bots() {
  const [list, setList] = React.useState(initialBots)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {list.map((b) => (
        <BotCard
          key={b.slug}
          bot={b}
          onChange={(next) =>
            setList((p) => p.map((x) => (x.slug === b.slug ? next : x)))
          }
        />
      ))}
    </div>
  )
}

export function RunRow({ r }: { r: Run }) {
  const [open, setOpen] = React.useState(false)
  const tone = {
    succeeded: 'success',
    running: 'info',
    failed: 'danger',
  } as const
  const Icon = targetIcon[r.target]
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/50"
      >
        <ChevronRightIcon
          className={cn('size-4 transition-transform', open && 'rotate-90')}
        />
        <Chip tone={tone[r.status]}>{r.status}</Chip>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{r.automation}</span>
          <span className="block text-xs text-muted-foreground">
            {r.trigger}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Icon className="size-3" />
          {r.target}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {r.duration} · {r.cost}
        </span>
        <span className="text-xs text-muted-foreground">{r.when}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t bg-muted/30 px-4 py-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Result:</span> {r.result}
          </p>
          <pre
            tabIndex={0}
            className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs leading-6"
          >
            {r.log
              .map((l, i) => `${String(i + 1).padStart(2, '0')}  ${l}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}
