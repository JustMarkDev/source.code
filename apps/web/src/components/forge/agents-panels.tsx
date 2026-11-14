import * as React from 'react'
import {
  CloudIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  LockClosedIcon,
  PlusIcon,
  ServerIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type {
  Bot as BotType,
  Scope,
  Target,
  Trigger,
} from '~/lib/model/platform'
import { Chip, Modal, Panel, SectionLabel } from '~/components/forge/bits'
import { CopyField } from '~/components/forge/repo-shell'
import { Toggle } from '~/components/forge/repo-pages'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { triggers } from '~/lib/model/platform'
import type { Repo } from '~/lib/model/data'
import { useOp, useOpMaybe, useWrite } from '~/lib/forge'
import { useMe } from '~/lib/auth/accounts'
import { timeAgo } from '~/lib/repo'

const targetIcon = {
  'T3 Code': ComputerDesktopIcon,
  'boat.dev': CloudIcon,
  E2B: ServerIcon,
} as const

function NewAutomation({
  open,
  onClose,
  onCreate,
  bots,
}: {
  open: boolean
  onClose: () => void
  /** Makes it; answers with what went wrong, or nothing. */
  onCreate: (a: {
    name: string
    bot: string
    triggers: Array<Trigger>
    runtime: string
    target: Target
    instructions: string
    every?: 'hour' | 'day' | 'week'
  }) => Promise<string | null>
  /** The bots installed on the repository, the only ones it can wake. */
  bots: Array<{ slug: string; name: string }>
}) {
  const [name, setName] = React.useState('')
  const [picked0, setBot] = React.useState('')
  // The bots arrive after the form mounts; until one is picked, the first.
  const bot = picked0 || (bots[0]?.slug ?? '')
  const [error, setError] = React.useState('')
  const [picked, setPicked] = React.useState<Array<Trigger>>(['change.opened'])
  const [target, setTarget] = React.useState<Target>('T3 Code')
  const [instructions, setInstructions] = React.useState('')
  const [every, setEvery] = React.useState<'hour' | 'day' | 'week'>('week')
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
              {bots.map((b) => (
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
        {picked.includes('schedule') && (
          <label className="block space-y-1">
            <span className="text-muted-foreground">On a schedule, every</span>
            <Select
              value={every}
              onValueChange={(v) => setEvery(v as typeof every)}
            >
              <SelectItem value="hour">Hour</SelectItem>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </Select>
          </label>
        )}
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
        {error && <p className="mr-auto text-sm text-danger">{error}</p>}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="brand"
          disabled={!ok || !bot}
          onClick={() =>
            void onCreate({
              name: name.trim(),
              bot,
              triggers: picked,
              runtime: 'Claude Code',
              target,
              instructions: instructions.trim(),
              ...(picked.includes('schedule') ? { every } : {}),
            }).then((e) => {
              if (e) return setError(e)
              setError('')
              setName('')
              setInstructions('')
            })
          }
        >
          Create
        </Button>
      </div>
    </Modal>
  )
}

export function Automations({ repo }: { repo: Repo }) {
  const at = { owner: repo.owner, repo: repo.name }
  const list = useOp('automations.list', at).data
  const me = useMe()
  // The bots it can wake are the ones installed here that belong to the owner.
  const owned =
    useOpMaybe('bots.list', { handle: repo.owner }, !!me)?.data ?? []
  const installed = owned.filter((b) =>
    b.installs.includes(`${repo.owner}/${repo.name}`),
  )
  const write = useWrite()
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
          const Icon =
            a.target in targetIcon
              ? targetIcon[a.target as keyof typeof targetIcon]
              : ServerIcon
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
                      Triggered {a.triggered} time{a.triggered === 1 ? '' : 's'}
                      {a.last_triggered_at
                        ? `, last ${timeAgo(a.last_triggered_at)}`
                        : ''}
                    </span>
                    {a.next_run_at && (
                      <span>
                        Every {a.every}, next{' '}
                        {new Date(a.next_run_at).toLocaleString('en', {
                          weekday: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                    {a.last_run && (
                      <span title="The run the last trigger started, for the bot to pick up">
                        Started run{' '}
                        <span className="font-mono">
                          {a.last_run.slice(0, 12)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void write('automations.run', {
                      ...at,
                      automation: a.id,
                    })
                  }
                >
                  Run now
                </Button>
                <div className="w-44">
                  <Toggle
                    checked={a.enabled}
                    onChange={(v) =>
                      void write('automations.update', {
                        ...at,
                        automation: a.id,
                        body: { enabled: v },
                      })
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
        bots={installed}
        onCreate={async (body) => {
          const r = await write('automations.create', { ...at, body })
          if (r.error) return r.error.message
          setCreating(false)
          return null
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
  onScopes,
  onMint,
}: {
  bot: BotType
  /** Saves new scopes; answers with what went wrong, or nothing. */
  onScopes: (scopes: Array<Scope>) => Promise<string | null>
  /** Makes a token; answers with it, or with what went wrong. */
  onMint: () => Promise<{ token: string } | { error: string }>
}) {
  const [token, setToken] = React.useState<string | null>(null)
  const [hint, setHint] = React.useState(false)
  const [error, setError] = React.useState('')
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
            void onMint().then((r) =>
              'token' in r ? setToken(r.token) : setError(r.error),
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
                  void onScopes(
                    on ? bot.scopes.filter((x) => x !== s) : [...bot.scopes, s],
                  ).then((e) => setError(e ?? ''))
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
        {error && <p className="text-xs text-danger">{error}</p>}
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
        description="Shown once. It expires in 30 days."
      >
        {token && <CopyField value={token} prefix="" />}
        <div className="flex justify-end">
          <Button variant="brand" onClick={() => setToken(null)}>
            I saved it
          </Button>
        </div>
      </Modal>
    </Panel>
  )
}

export function Bots() {
  const me = useMe()
  const list =
    useOpMaybe('bots.list', { handle: me?.handle ?? '' }, !!me)?.data ?? []
  const write = useWrite()
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {list.map((b) => (
        <BotCard
          key={b.slug}
          bot={{
            slug: b.slug,
            name: b.name,
            description: b.description,
            scopes: b.scopes as Array<Scope>,
            installs: b.installs,
            tokens: b.tokens,
            state: 'ready',
          }}
          onScopes={async (scopes) => {
            const r = await write('bots.update', {
              bot: b.slug,
              body: { scopes },
            })
            return r.error?.message ?? null
          }}
          onMint={async () => {
            const r = await write('bots.token', {
              bot: b.slug,
              body: { days: 30 },
            })
            return r.error
              ? { error: r.error.message }
              : { token: r.data.token }
          }}
        />
      ))}
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">No bots yet.</p>
      )}
    </div>
  )
}
