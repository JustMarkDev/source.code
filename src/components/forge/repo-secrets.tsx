import * as React from 'react'
import { File, PatchDiff } from '@pierre/diffs/react'
import {
  ArrowPathIcon,
  CloudIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  KeyIcon,
  LifebuoyIcon,
  LockClosedIcon,
  PlusIcon,
  ShieldExclamationIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Modal, Panel, SectionLabel, Seg } from './bits'
import { AgentAccess } from './repo-agent-access'
import { CopyField } from './repo-shell'
import { Toggle } from './repo-pages'
import type { Repo } from '~/mock/data'
import type { AuditEvent, EnvName, EnvVar, Recipient } from '~/mock/platform'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Button } from '~/components/ui/button'
import { useIsDark } from '~/lib/theme'
import {
  auditLog,
  encryptedDiff,
  envNames,
  envSchema,
  envVars,
  recipients as initialRecipients,
} from '~/mock/platform'

const kindIcon = {
  member: UserIcon,
  deploy: CloudIcon,
  ci: ArrowPathIcon,
  agent: CpuChipIcon,
  escrow: LifebuoyIcon,
} as const

const kindLabel = {
  member: 'Member',
  deploy: 'Deploy',
  ci: 'CI job',
  agent: 'Agent',
  escrow: 'Recovery',
} as const

function Variables({
  env,
  vars,
  onRotate,
}: {
  env: EnvName
  vars: Array<EnvVar>
  onRotate: (v: EnvVar) => void
}) {
  return (
    <Panel className="overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Variable</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">In {env}</th>
            <th className="px-4 py-2 font-medium">Rotated</th>
            <th className="relative px-4 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {vars.map((v) => {
            const has = v.set[env]
            const needed = v.required.includes(env)
            return (
              // A missing required value is the one thing here that needs doing, so it stands out.
              <tr key={v.name} className={cn(!has && needed && 'bg-danger/5')}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                    {v.sensitive && (
                      <LockClosedIcon className="size-3 text-muted-foreground" />
                    )}
                    {v.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.description}
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {v.type}
                </td>
                <td className="px-4 py-2.5">
                  {has ? (
                    <Chip tone="success">
                      {v.sensitive ? 'Encrypted' : 'Set'}
                    </Chip>
                  ) : needed ? (
                    <Chip tone="danger">Missing, required</Chip>
                  ) : (
                    <Chip>Not set</Chip>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {v.rotated}
                  {v.by !== '—' && ` by ${v.by}`}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRotate(v)}
                  >
                    {has ? 'Rotate' : 'Set'}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

function RotateDialog({
  v,
  env,
  onClose,
  onDone,
}: {
  v: EnvVar | null
  env: EnvName
  onClose: () => void
  onDone: (v: EnvVar) => void
}) {
  const [value, setValue] = React.useState('')
  const [phase, setPhase] = React.useState<'edit' | 'encrypting' | 'done'>(
    'edit',
  )
  const reset = () => {
    setValue('')
    setPhase('edit')
    onClose()
  }
  return (
    <Modal
      open={v !== null}
      onClose={reset}
      title={v ? `${v.set[env] ? 'Rotate' : 'Set'} ${v.name}` : ''}
      description={`Encrypted in your browser to every recipient with access to ${env}. The plaintext never reaches source.code.`}
    >
      {v && phase !== 'done' && (
        <>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              v.sensitive ? 'Paste the new secret' : 'Enter the new value'
            }
            className="h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:border-foreground/50"
          />
          <p className="text-xs text-muted-foreground">
            Rotating here does not change the provider. Also create the new
            credential at the service that issued it, then revoke the old one.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!value || phase === 'encrypting'}
              onClick={() => {
                setPhase('encrypting')
                setTimeout(() => setPhase('done'), 1000)
              }}
            >
              {phase === 'encrypting' ? 'Encrypting' : 'Encrypt and commit'}
            </Button>
          </div>
        </>
      )}
      {v && phase === 'done' && (
        <>
          <div className="rounded-lg border bg-background p-3 text-sm">
            <p className="font-medium">Committed as ciphertext</p>
            <p className="mt-1 text-muted-foreground">
              The commit changes one line in{' '}
              <span className="font-mono">.source/secrets/{env}.env</span>.
              Reviewers see the key name changed, not the value.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              variant="brand"
              onClick={() => {
                onDone(v)
                reset()
              }}
            >
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function Recipients({
  list,
  onRemove,
}: {
  list: Array<Recipient>
  onRemove: (r: Recipient) => void
}) {
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y">
        {list.map((r) => {
          const Icon = kindIcon[r.kind]
          return (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Chip>{kindLabel[r.kind]}</Chip>
                  {r.envs.map((e) => (
                    <Chip
                      key={e}
                      tone={e === 'production' ? 'warning' : 'muted'}
                    >
                      {e}
                    </Chip>
                  ))}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {r.fingerprint}
                </div>
                <div className="text-xs text-muted-foreground">
                  Added {r.added}. Last used {r.lastUsed}.
                  {r.note && ` ${r.note}.`}
                </div>
              </div>
              {r.kind !== 'escrow' && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => onRemove(r)}
                >
                  <XMarkIcon className="size-4" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function PushGuard() {
  const [rules, setRules] = React.useState({
    plaintext: true,
    recipients: true,
    escrow: true,
    signed: false,
  })
  const [line, setLine] = React.useState('STRIPE_KEY=sk_live_51Nf8aXyz')
  const [result, setResult] = React.useState<null | {
    ok: boolean
    text: string
  }>(null)

  const run = () => {
    const [key, ...rest] = line.split('=')
    const value = rest.join('=')
    const v = envVars.find((x) => x.name === key.trim())
    if (!v) {
      setResult({ ok: true, text: 'Accepted. The key is not in the schema.' })
      return
    }
    if (v.sensitive && !value.startsWith('enc:') && rules.plaintext) {
      setResult({
        ok: false,
        text: `Rejected. ${v.name} is secret in the schema but this value is plaintext. Run: source secrets set ${v.name} --env production`,
      })
      return
    }
    setResult({
      ok: true,
      text: `Accepted. ${v.name} is ${value.startsWith('enc:') ? 'ciphertext' : 'public'}.`,
    })
  }

  return (
    <Panel className="space-y-4 p-4">
      <div className="space-y-3">
        <Toggle
          checked={rules.plaintext}
          onChange={(v) => setRules((r) => ({ ...r, plaintext: v }))}
          label="Reject plaintext in secret keys"
          hint="Checked on every push, before it is stored."
        />
        <Toggle
          checked={rules.recipients}
          onChange={(v) => setRules((r) => ({ ...r, recipients: v }))}
          label="Recipient changes need an owner"
          hint="Adding or removing a recipient needs team:security."
        />
        <Toggle
          checked={rules.escrow}
          onChange={(v) => setRules((r) => ({ ...r, escrow: v }))}
          label="Require a recovery recipient"
          hint="One lost key never means lost secrets."
        />
        <Toggle
          checked={rules.signed}
          onChange={(v) => setRules((r) => ({ ...r, signed: v }))}
          label="Signed commits on secret files"
          hint="Stops tampering with recipients or file attributes."
        />
      </div>
      <div className="space-y-2 border-t pt-4">
        <SectionLabel>Try a push</SectionLabel>
        <div className="flex gap-2">
          <input
            aria-label="A line to push"
            value={line}
            onChange={(e) => {
              setLine(e.target.value)
              setResult(null)
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-xs outline-none focus:border-foreground/50"
          />
          <Button variant="outline" onClick={run}>
            Push
          </Button>
        </div>
        {result && (
          <p
            role="status"
            className={cn(
              'rounded-lg border p-3 text-sm',
              result.ok
                ? 'border-success/40 bg-success/10'
                : 'border-danger/40 bg-danger/10',
            )}
          >
            {result.text}
          </p>
        )}
      </div>
    </Panel>
  )
}

function Audit({ events }: { events: Array<AuditEvent> }) {
  const tone = {
    rotate: 'info',
    grant: 'success',
    revoke: 'warning',
    read: 'muted',
    reject: 'danger',
  } as const
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y">
        {events.map((e, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Chip tone={tone[e.kind]} className="w-16 justify-center">
              {e.kind}
            </Chip>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{e.who}</span>{' '}
              {e.action.toLowerCase()}{' '}
              <span className="text-muted-foreground">{e.target}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {e.when}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function SecretsPage(_props: { repo: Repo }) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const theme = codeTheme(dark)
  const [env, setEnv] = React.useState<EnvName>('production')
  const [vars, setVars] = React.useState(envVars)
  const [rotating, setRotating] = React.useState<EnvVar | null>(null)
  const [list, setList] = React.useState(initialRecipients)
  const [removing, setRemoving] = React.useState<Recipient | null>(null)
  const [events, setEvents] = React.useState(auditLog)
  const [file, setFile] = React.useState<'schema' | 'diff'>('schema')
  const [adding, setAdding] = React.useState(false)

  const required = vars.filter((v) => v.required.includes(env))
  const missing = required.filter((v) => !v.set[env])

  const log = (e: Omit<AuditEvent, 'when'>) =>
    setEvents((p) => [{ ...e, when: 'just now' }, ...p])

  return (
    <>
      <div className="space-y-10">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Secrets</h2>
          <p className="text-muted-foreground">
            Commit your environment variables. Values are encrypted to the
            people and machines that need them. This page shows names, types and
            status, never values.
          </p>
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Seg
              value={env}
              onChange={setEnv}
              options={envNames.map((e): [EnvName, string] => [e, e])}
            />
            <div className="flex items-center gap-2 text-sm">
              {missing.length === 0 ? (
                <Chip tone="success">
                  {required.length} of {required.length} required set
                </Chip>
              ) : (
                <Chip tone="danger">
                  {required.length - missing.length} of {required.length}{' '}
                  required set. Missing {missing.map((m) => m.name).join(', ')}
                </Chip>
              )}
            </div>
          </div>
          <Variables env={env} vars={vars} onRotate={setRotating} />
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>Who can decrypt</SectionLabel>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdding(true)}
              >
                <PlusIcon className="size-4" />
                Add recipient
              </Button>
            </div>
            <Recipients list={list} onRemove={setRemoving} />
          </section>
          <section className="space-y-3">
            <SectionLabel>Push guard</SectionLabel>
            <PushGuard />
          </section>
        </div>

        <AgentAccess log={log} />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>In the repository</SectionLabel>
            <Seg
              value={file}
              onChange={setFile}
              options={[
                ['schema', '.env.schema'],
                ['diff', 'A rotation, as reviewed'],
              ]}
            />
          </div>
          <div className="overflow-hidden rounded-xl border">
            {file === 'schema' ? (
              <File
                file={{ name: '.env.schema', contents: envSchema }}
                options={{ theme, overflow }}
              />
            ) : (
              <PatchDiff
                patch={encryptedDiff}
                options={{ theme, overflow, diffStyle: 'unified' }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The schema is public to anyone who can read the repo: names, types
            and which keys are secret. Values live in ciphertext next to it.
            Review shows a changed line per key, so a rotation is reviewable
            without exposing the value.
          </p>
        </section>

        <section className="space-y-3">
          <SectionLabel>Audit log</SectionLabel>
          <Audit events={events} />
        </section>

        <Panel className="space-y-3 p-5">
          <div className="flex items-center gap-2 font-medium">
            <ShieldExclamationIcon className="size-4" />
            What this cannot do
          </div>
          <ul className="grid grid-cols-1 gap-3 text-sm text-muted-foreground md:grid-cols-3">
            <li>
              <span className="font-medium text-foreground">
                Hide old history.
              </span>{' '}
              Anyone who could decrypt a past commit still can. Removing a
              person rotates the data key, and you still need to rotate the real
              secrets at each provider.
            </li>
            <li>
              <span className="font-medium text-foreground">
                Hide variable names.
              </span>{' '}
              Names and types are in the schema on purpose. Do not name a
              variable after the thing it protects.
            </li>
            <li>
              <span className="font-medium text-foreground">
                Recover a lost key alone.
              </span>{' '}
              That is what the recovery recipient is for. Keep it offline with
              two owners.
            </li>
          </ul>
        </Panel>
      </div>

      <RotateDialog
        v={rotating}
        env={env}
        onClose={() => setRotating(null)}
        onDone={(v) => {
          setVars((p) =>
            p.map((x) =>
              x.name === v.name
                ? {
                    ...x,
                    set: { ...x.set, [env]: true },
                    rotated: 'just now',
                    by: 'dana',
                  }
                : x,
            ),
          )
          log({
            who: 'dana',
            action: v.set[env] ? 'Rotated' : 'Set',
            target: `${v.name} in ${env}`,
            kind: 'rotate',
          })
        }}
      />

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}` : ''}
        description="This changes who can decrypt from now on."
      >
        {removing && (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>The data key is rotated in the same commit.</li>
              <li>
                {removing.name} can still read commits made before today. That
                is{' '}
                <span className="font-medium">
                  {removing.envs.length} environment
                  {removing.envs.length === 1 ? '' : 's'}
                </span>{' '}
                of history.
              </li>
              <li>
                Rotate the real credentials they could see:{' '}
                {vars
                  .filter(
                    (v) => v.sensitive && removing.envs.some((e) => v.set[e]),
                  )
                  .map((v) => v.name)
                  .join(', ')}
                .
              </li>
            </ol>
            <CopyField
              value={`source secrets remove ${removing.name} --rotate`}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setList((p) => p.filter((r) => r.id !== removing.id))
                  log({
                    who: 'dana',
                    action: 'Revoked',
                    target: `${removing.name} and rotated the data key`,
                    kind: 'revoke',
                  })
                  setRemoving(null)
                }}
              >
                Remove and rotate
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a recipient"
        description="They get their own wrapped copy of the data key. A recipient change needs approval from team:security."
      >
        <div className="grid grid-cols-1 gap-2">
          {[
            ['A person', 'Their device key, from their profile', UserIcon],
            [
              'A deploy target',
              'A key held by your deploy platform',
              CloudIcon,
            ],
            ['A CI job', 'Short-lived identity minted per run', KeyIcon],
            [
              'An agent',
              'Runs commands with values it never sees; see Agent access',
              ComputerDesktopIcon,
            ],
          ].map(([name, body, Icon]) => {
            const I = Icon as typeof UserIcon
            return (
              <button
                key={name as string}
                type="button"
                onClick={() => {
                  setAdding(false)
                  log({
                    who: 'dana',
                    action: 'Requested',
                    target: `a new recipient: ${(name as string).toLowerCase()}`,
                    kind: 'grant',
                  })
                }}
                className="flex items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted"
              >
                <I className="size-4" />
                <span>
                  <span className="block font-medium">{name as string}</span>
                  <span className="text-xs text-muted-foreground">
                    {body as string}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Modal>
    </>
  )
}
