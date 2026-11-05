import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PauseIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Automations } from './agents-panels'
import { IntegrationsPanel } from './integrations-panel'
import { PoliciesPage } from './repo-policies'
import { SecretsPage } from './repo-secrets'
import { slugOf } from './repo-shell'
import type { Host, Mirror } from '~/mock/hub'
import type { Repo } from '~/mock/data'
import { BrandLogo } from '~/components/brand'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Field, Input, Textarea } from '~/components/ui/input'
import { Modal } from '~/components/ui/dialog'
import { SwitchRow } from '~/components/ui/switch'
import { Select, SelectItem } from '~/components/ui/select'
import { hostNames, mirrorsFor } from '~/mock/hub'

const sections = [
  ['general', 'General'],
  ['mirrors', 'Mirrors and sync'],
  ['secrets', 'Secrets'],
  ['policies', 'Policies'],
  ['integrations', 'Integrations'],
  ['automations', 'Automations'],
] as const

type Section = (typeof sections)[number][0]

function Title({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children && (
        <p className="max-w-[60ch] text-sm text-muted-foreground">{children}</p>
      )}
    </div>
  )
}

function General({ repo }: { repo: Repo }) {
  const [description, setDescription] = React.useState(repo.description)
  const [visibility, setVisibility] = React.useState('public')
  const [sign, setSign] = React.useState(true)
  const [saved, setSaved] = React.useState(false)
  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-5">
        <Field label="Description">
          <Textarea
            value={description}
            rows={2}
            onChange={(e) => {
              setDescription(e.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="Visibility">
          <Select value={visibility} onValueChange={(v) => setVisibility(v)}>
            <SelectItem value="public">
              Public: anyone can find it and download releases
            </SelectItem>
            <SelectItem value="private">
              Private: only people you invite
            </SelectItem>
          </Select>
        </Field>
        <SwitchRow
          checked={sign}
          onChange={setSign}
          label="Sign release files"
          hint="Adds a signature and a SHA-256 checksum to every asset."
        />
        <div className="flex items-center gap-3">
          <Button variant="brand" onClick={() => setSaved(true)}>
            Save changes
          </Button>
          {saved && <span className="text-sm text-success">Saved</span>}
        </div>
      </div>
      <div className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-medium text-danger">Danger zone</h3>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Transfer ownership or delete this project.
          </span>
          <div className="flex gap-2">
            <Button>Transfer</Button>
            <Button variant="danger">Delete</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const stateTone = {
  'in-sync': 'success',
  syncing: 'info',
  behind: 'warning',
  failing: 'danger',
} as const
const stateLabel = {
  'in-sync': 'In sync',
  syncing: 'Syncing',
  behind: 'Behind',
  failing: 'Needs attention',
} as const
const directionLabel = {
  'two-way': 'Two-way',
  push: 'Push to host',
  pull: 'Pull from host',
} as const

function MirrorRow({
  m,
  onChange,
  onRemove,
}: {
  m: Mirror
  onChange: (m: Mirror) => void
  onRemove: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const carried = (
    [
      ['issues', 'Issues'],
      ['changes', 'Pull requests'],
      ['releases', 'Releases'],
      ['wiki', 'Wiki'],
    ] as const
  ).filter(([k]) => m.carries[k])
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-card">
          <BrandLogo id={m.host} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {hostNames[m.host]}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {m.slug}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {directionLabel[m.direction]} · last synced {m.last}
          </p>
        </div>
        <Badge tone={stateTone[m.state]}>
          {m.state === 'in-sync' && <CheckCircleIcon />}
          {m.state === 'failing' && <ExclamationTriangleIcon />}
          {stateLabel[m.state]}
        </Badge>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setTimeout(() => {
              setBusy(false)
              onChange({
                ...m,
                state: 'in-sync',
                last: 'just now',
                detail: undefined,
              })
            }, 900)
          }}
        >
          <ArrowPathIcon className={cn(busy && 'animate-spin')} />
          {m.state === 'failing' ? 'Reconnect' : 'Sync now'}
        </Button>
      </div>
      {m.detail && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {m.detail}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          Carries:{' '}
          <span className="text-foreground">
            Git history
            {carried.map(([, l]) => `, ${l.toLowerCase()}`).join('')}
          </span>
        </span>
        <button
          type="button"
          className="-my-1 inline-flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground"
          onClick={() =>
            onChange({
              ...m,
              state: m.state === 'behind' ? 'in-sync' : 'behind',
            })
          }
        >
          <PauseIcon className="size-3.5" />
          {m.state === 'behind' ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="-my-1 rounded-md px-2 py-1.5 hover:bg-danger/10 hover:text-danger"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function AddMirror({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (m: Mirror) => void
}) {
  const [host, setHost] = React.useState<Host>('github')
  const [slug, setSlug] = React.useState('')
  const [direction, setDirection] = React.useState<Mirror['direction']>('push')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a mirror"
      description="source.code stays the primary. The mirror keeps a copy on another host."
    >
      <div className="space-y-4">
        <Field label="Host">
          <Select value={host} onValueChange={(v) => setHost(v as Host)}>
            {(Object.keys(hostNames) as Array<Host>).map((h) => (
              <SelectItem key={h} value={h}>
                {hostNames[h]}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label="Repository on that host" hint="owner/name">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="dana/gitfs"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Direction">
          <Select
            value={direction}
            onValueChange={(v) => setDirection(v as Mirror['direction'])}
          >
            <SelectItem value="push">Push: send everything there</SelectItem>
            <SelectItem value="two-way">
              Two-way: also bring back issues and pull requests
            </SelectItem>
            <SelectItem value="pull">
              Pull: only receive from that host
            </SelectItem>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!slug.includes('/')}
            onClick={() => {
              onAdd({
                id: `m${Date.now()}`,
                host,
                slug,
                direction,
                state: 'syncing',
                last: 'just now',
                carries: {
                  issues: direction === 'two-way',
                  changes: direction === 'two-way',
                  releases: true,
                  wiki: false,
                },
              })
              onClose()
              setSlug('')
            }}
          >
            Add mirror
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Mirrors({ repo }: { repo: Repo }) {
  const [list, setList] = React.useState(() => mirrorsFor(repo))
  const [adding, setAdding] = React.useState(false)
  const [primary, setPrimary] = React.useState(false)
  return (
    <div className="max-w-3xl space-y-8">
      <div className="rounded-xl border bg-card p-4 text-sm">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="space-y-1">
            <p className="font-medium">
              Everything lives here, whatever the other hosts do.
            </p>
            <p className="text-muted-foreground">
              Commits, branches, tags, issues, changes with their reviews, and
              releases are stored on source.code. If a host goes down or you
              stop using it, nothing here changes, and mirrors catch up when it
              returns.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Mirrors</h3>
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon /> Add a mirror
          </Button>
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No mirrors. This repository only exists here.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {list.map((m) => (
              <MirrorRow
                key={m.id}
                m={m}
                onChange={(next) =>
                  setList((p) => p.map((x) => (x.id === m.id ? next : x)))
                }
                onRemove={() => setList((p) => p.filter((x) => x.id !== m.id))}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          People who visit this project never see these hosts. They are shown to
          you only.
        </p>
      </section>

      <section className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-medium">Leaving a host</h3>
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          When you are ready to stop using another host for this project, make
          source.code the only place people push. Mirrors keep receiving a copy
          until you remove them.
        </p>
        <SwitchRow
          checked={primary}
          onChange={setPrimary}
          label="Only accept pushes here"
          hint="Pushes to mirrors are rejected on their side with a link back to this repository."
        />
        <Link
          to="/settings/$section"
          params={{ section: 'accounts' }}
          className="inline-block py-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Manage connected accounts and imported history
        </Link>
      </section>
      <AddMirror
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(m) => setList((p) => [...p, m])}
      />
    </div>
  )
}

export function RepoSettings({
  repo,
  section,
}: {
  repo: Repo
  section?: string
}) {
  const current: Section =
    sections.find(([id]) => id === section)?.[0] ?? 'general'
  const slug = slugOf(repo)
  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Repository settings"
          className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:self-start"
        >
          {sections.map(([id, label]) => (
            <Link
              key={id}
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'settings' }}
              search={{ section: id }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                id === current && 'bg-muted font-medium text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          {current === 'general' && (
            <>
              <Title title="General" />
              <General repo={repo} />
            </>
          )}
          {current === 'mirrors' && (
            <>
              <Title title="Mirrors and sync">
                Keep copies of this repository on other hosts, without making
                them depend on each other.
              </Title>
              <Mirrors repo={repo} />
            </>
          )}
          {current === 'secrets' && <SecretsPage repo={repo} />}
          {current === 'policies' && <PoliciesPage repo={repo} />}
          {current === 'integrations' && (
            <>
              <Title title="Integrations">
                Services this repository uses. Connect a service once in your
                account settings; turn it on here.{' '}
                <Link
                  to="/settings/$section"
                  params={{ section: 'integrations' }}
                  className="underline underline-offset-4"
                >
                  Account integrations
                </Link>
              </Title>
              <IntegrationsPanel repo={slug} />
            </>
          )}
          {current === 'automations' && (
            <>
              <Title title="Automations">
                Start an agent when something happens in this repository.
              </Title>
              <Automations />
            </>
          )}
        </div>
      </div>
    </>
  )
}
