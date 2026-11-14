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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Modal } from '~/components/ui/dialog'
import { Field } from '~/components/ui/input'
import { Select, SelectItem } from '~/components/ui/select'
import { useOp, useWrite } from '~/lib/forge'
import type { Repo } from '~/lib/model/data'

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

const duration = {
  '15m': '15 minutes',
  '1h': '1 hour',
  '8h': '8 hours',
} as const
const minutes = { '15m': 15, '1h': 60, '8h': 480 } as const

function NewGrant({
  open,
  onClose,
  onCreate,
  devVars,
}: {
  open: boolean
  onClose: () => void
  onCreate: (g: { env: 'development' | 'preview'; minutes: number }) => void
  /** Variables with a development value. */
  devVars: Array<string>
}) {
  const [env, setEnv] = React.useState<'development' | 'preview'>('development')
  const [ttl, setTtl] = React.useState<keyof typeof duration>('1h')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Give an agent access"
      description="Agents working in this repository can run commands with these values. They never see them."
    >
      <div className="space-y-4">
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
        <p className="text-sm text-muted-foreground">
          Every variable set for that environment:{' '}
          <span className="font-mono text-xs">
            {devVars.join(', ') || 'none yet'}
          </span>
          .
        </p>
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
            onClick={() => {
              onCreate({ env, minutes: minutes[ttl] })
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
  repo,
  devVars,
}: {
  repo: Repo
  devVars: Array<string>
}) {
  const at = { owner: repo.owner, repo: repo.name }
  const write = useWrite()
  const [error, setError] = React.useState('')
  const done = (r: { error: { message: string } | null }) =>
    setError(r.error?.message ?? '')
  const grants: Array<Grant> = useOp('grants.list', at)
    .data.filter((g) => g.state === 'active' || g.state === 'pending')
    .map((g) => ({
      id: g.id,
      agent: g.requested_by,
      env: g.environment === 'preview' ? 'preview' : 'development',
      vars: g.variables,
      state: g.state === 'pending' ? 'pending' : 'active',
      left: g.expires_at
        ? `ends ${new Date(g.expires_at).toLocaleTimeString()}`
        : '',
      uses: g.uses,
      maxUses: g.max_runs,
      reason: g.reason ?? undefined,
    }))
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
                        onClick={() =>
                          void write('grants.approve', {
                            ...at,
                            grant: g.id,
                            body: { ttl_minutes: 60 },
                          }).then(done)
                        }
                      >
                        <CheckIcon /> Approve for 1 hour
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void write('grants.revoke', {
                            ...at,
                            grant: g.id,
                          }).then(done)
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        void write('grants.revoke', {
                          ...at,
                          grant: g.id,
                        }).then(done)
                      }
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

      {error && <p className="text-sm text-danger">{error}</p>}
      <NewGrant
        open={adding}
        devVars={devVars}
        onClose={() => setAdding(false)}
        onCreate={async (g) => {
          // A person giving access is a request they approve at once.
          const r = await write('grants.request', {
            ...at,
            body: {
              environment: g.env,
              reason: 'Given from the settings page',
            },
          })
          if (r.error) return done(r)
          done(
            await write('grants.approve', {
              ...at,
              grant: r.data.id,
              body: { ttl_minutes: g.minutes },
            }),
          )
        }}
      />
    </section>
  )
}
