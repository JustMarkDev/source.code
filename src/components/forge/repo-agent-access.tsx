import * as React from 'react'
import {
  CheckIcon,
  CpuChipIcon,
  LockClosedIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { CopyField } from './repo-shell'
import { Panel } from './bits'
import type { AuditEvent } from '~/mock/platform'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Modal } from '~/components/ui/dialog'
import { Field } from '~/components/ui/input'
import { Select, SelectItem } from '~/components/ui/select'
import { envVars } from '~/mock/platform'

type Grant = {
  id: string
  agent: string
  env: 'development' | 'preview'
  vars: Array<string>
  state: 'active' | 'pending'
  left: string
  uses: number
  maxUses: number
  reason?: string
}

const devVars = envVars.filter((v) => v.set.development).map((v) => v.name)

const initial: Array<Grant> = [
  {
    id: 'gr_4c21',
    agent: 'fix-agent',
    env: 'development',
    vars: devVars,
    state: 'active',
    left: '38 min left',
    uses: 3,
    maxUses: 20,
  },
  {
    id: 'gr_4c32',
    agent: 'claude via T3 Code',
    env: 'development',
    vars: devVars,
    state: 'pending',
    left: '',
    uses: 0,
    maxUses: 20,
    reason: 'Run the test suite for ch_81b2',
  },
]

const duration = {
  '15m': '15 minutes',
  '1h': '1 hour',
  '8h': '8 hours',
} as const

function NewGrant({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (g: Grant, ttl: string) => void
}) {
  const [agent, setAgent] = React.useState('fix-agent')
  const [env, setEnv] = React.useState<'development' | 'preview'>('development')
  const [picked, setPicked] = React.useState<Set<string>>(new Set(devVars))
  const [ttl, setTtl] = React.useState<keyof typeof duration>('1h')
  const toggle = (n: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Give an agent access"
      description="The agent can run commands with these values. It never sees them."
    >
      <div className="space-y-4">
        <Field label="Agent">
          <Select value={agent} onValueChange={(v) => setAgent(v)}>
            <SelectItem>fix-agent</SelectItem>
            <SelectItem>claude via T3 Code</SelectItem>
            <SelectItem>review-bot</SelectItem>
          </Select>
        </Field>
        <Field
          label="Environment"
          hint="Production is never available to agents. A person runs those commands."
        >
          <Select
            value={env}
            onValueChange={(v) =>
              setEnv(v === 'preview' ? 'preview' : 'development')
            }
          >
            <SelectItem value="development">development</SelectItem>
            <SelectItem value="preview">preview</SelectItem>
            <SelectItem disabled>production (not available)</SelectItem>
          </Select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Variables</legend>
          {devVars.map((n) => (
            <label key={n} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.has(n)}
                onChange={() => toggle(n)}
                className="size-4 accent-[var(--brand-ink)]"
              />
              <span className="font-mono text-xs">{n}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Lasts">
          <Select
            value={ttl}
            onValueChange={(v) => setTtl(v === '15m' || v === '8h' ? v : '1h')}
          >
            {Object.entries(duration).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={picked.size === 0}
            onClick={() => {
              onCreate(
                {
                  id: `gr_${Math.random().toString(16).slice(2, 6)}`,
                  agent,
                  env,
                  vars: [...picked],
                  state: 'active',
                  left: duration[ttl],
                  uses: 0,
                  maxUses: 20,
                },
                duration[ttl],
              )
              onClose()
            }}
          >
            Give access
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Who may run commands with values, for how long, and how often. Values are never shown. */
export function AgentAccess({
  log,
}: {
  log: (e: Omit<AuditEvent, 'when'>) => void
}) {
  const [grants, setGrants] = React.useState(initial)
  const [adding, setAdding] = React.useState(false)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h3 className="text-sm font-medium">Agent access</h3>
          <p className="text-sm text-muted-foreground">
            Agents do not get values. They run commands through{' '}
            <code className="font-mono text-xs">sx env run</code>: the values
            reach that one process, and are scrubbed from what the agent reads
            back. Access expires, is development only, and is logged.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon /> Give access
        </Button>
      </div>

      <Panel className="overflow-hidden">
        {grants.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No agent can run commands with values right now.
          </p>
        ) : (
          <ul className="divide-y">
            {grants.map((g) => (
              <li key={g.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-muted">
                    <CpuChipIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {g.agent}
                      <Badge tone="outline">{g.env}</Badge>
                      {g.state === 'pending' ? (
                        <Badge tone="warning">Asks for access</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {g.state === 'pending'
                        ? g.reason
                        : `${g.vars.length} variables · ${g.left} · ${g.uses} of ${g.maxUses} runs`}
                    </p>
                  </div>
                  {g.state === 'pending' ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="brand"
                        onClick={() => {
                          setGrants((p) =>
                            p.map((x) =>
                              x.id === g.id
                                ? { ...x, state: 'active', left: '1 hour' }
                                : x,
                            ),
                          )
                          log({
                            who: 'you',
                            action: 'approved agent access',
                            target: `${g.agent}, ${g.env}, 1 hour`,
                            kind: 'grant',
                          })
                        }}
                      >
                        <CheckIcon /> Approve for 1 hour
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setGrants((p) => p.filter((x) => x.id !== g.id))
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setGrants((p) => p.filter((x) => x.id !== g.id))
                        log({
                          who: 'you',
                          action: 'ended agent access',
                          target: `${g.agent}, ${g.env}`,
                          kind: 'revoke',
                        })
                      }}
                    >
                      <XMarkIcon /> End now
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LockClosedIcon className="size-4" />
            What an agent does
          </div>
          <CopyField value="sx env run --env development -- bun test" />
          <pre
            tabIndex={0}
            className="well overflow-x-auto rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed"
          >
            {`connecting to «DATABASE_URL»
18 passed
(2 variables injected, 1 scrubbed)`}
          </pre>
          <p className="text-xs text-muted-foreground">
            No grant yet? The agent asks with{' '}
            <code className="font-mono">sx env grant request</code>, which stops
            until you approve it here.
          </p>
        </Panel>
        <Callout tone="warning" title="What this cannot stop">
          A command you let an agent run can still send a value somewhere, for
          example over the network. So keep access to development values, keep
          it short, run agents where outbound traffic is limited, and use
          throwaway credentials in development. Rotation and the audit log below
          are your backstop.
        </Callout>
      </div>

      <NewGrant
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={(g, ttl) => {
          setGrants((p) => [g, ...p])
          log({
            who: 'you',
            action: 'gave agent access',
            target: `${g.agent}, ${g.env}, ${ttl}`,
            kind: 'grant',
          })
        }}
      />
    </section>
  )
}
