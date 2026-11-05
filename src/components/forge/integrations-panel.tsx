import * as React from 'react'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ServerIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Modal } from './bits'
import type { Integration, IntegrationGroup } from '~/mock/hub'
import { BrandLogo, brandName } from '~/components/brand'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Field, Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { StateTabs } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'
import { catalog, connections, groups, useConnections } from '~/mock/hub'

const nameOf = (i: Integration) =>
  i.id === 'selfhosted' ? 'Self-hosted runners' : brandName(i.id)

function Logo({ i }: { i: Integration }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card">
      {i.id === 'selfhosted' ? (
        <ServerIcon className="size-5 text-muted-foreground" />
      ) : (
        <BrandLogo id={i.id} />
      )}
    </span>
  )
}

/** Per-kind settings. Kept short: a setting only appears if it changes behaviour. */
function RepoSettings({ group }: { group: IntegrationGroup }) {
  if (group === 'review')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="A high-severity finding">
          <Select defaultValue="block">
            <SelectItem value="block">Blocks landing until handled</SelectItem>
            <SelectItem value="warn">Warns, never blocks</SelectItem>
          </Select>
        </Field>
        <Field label="Review">
          <Select defaultValue="all">
            <SelectItem value="all">Every change</SelectItem>
            <SelectItem value="ready">Only when marked ready</SelectItem>
            <SelectItem value="mention">Only when mentioned</SelectItem>
          </Select>
        </Field>
      </div>
    )
  if (group === 'runners')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Runs jobs labelled"
          hint="Workflows that ask for this label run here."
        >
          <Input defaultValue="ubuntu-latest" className="font-mono text-xs" />
        </Field>
        <Field label="Concurrent jobs">
          <Input type="number" defaultValue={8} />
        </Field>
      </div>
    )
  if (group === 'environments')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Access an agent gets">
          <Select defaultValue="supervised">
            <SelectItem value="read">Read only</SelectItem>
            <SelectItem value="supervised">
              Supervised: you approve actions
            </SelectItem>
            <SelectItem value="full">Full access</SelectItem>
          </Select>
        </Field>
        <Field label="Spending limit per task">
          <Input defaultValue="$2.00" />
        </Field>
      </div>
    )
  if (group === 'secrets')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Schema file">
          <Input defaultValue=".env.schema" className="font-mono text-xs" />
        </Field>
        <Field label="Check on">
          <Select defaultValue="push">
            <SelectItem value="push">Every push</SelectItem>
            <SelectItem value="change">Every change</SelectItem>
          </Select>
        </Field>
      </div>
    )
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Move issues when">
        <Select defaultValue="land">
          <SelectItem value="land">A change lands</SelectItem>
          <SelectItem value="open">A change opens</SelectItem>
          <SelectItem value="never">Never</SelectItem>
        </Select>
      </Field>
    </div>
  )
}

function ConnectDialog({
  item,
  repo,
  onClose,
}: {
  item: Integration | null
  repo?: string
  onClose: () => void
}) {
  const [secret, setSecret] = React.useState('')
  const [done, setDone] = React.useState(false)
  React.useEffect(() => {
    setSecret('')
    setDone(false)
  }, [item])
  if (!item) return null
  const needs = item.credential
  return (
    <Modal
      open
      onClose={onClose}
      title={done ? `${nameOf(item)} is connected` : `Connect ${nameOf(item)}`}
      description={
        done
          ? repo
            ? `It is on for ${repo}. You can turn it off any time.`
            : 'Turn it on for a repository from that repository’s settings.'
          : item.tagline
      }
    >
      {done ? (
        <div className="flex justify-end">
          <Button variant="brand" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <div className="font-medium">It will be able to</div>
            <ul className="space-y-1 text-muted-foreground">
              {item.access.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
          {needs && (
            <Field label={needs.label}>
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={needs.placeholder}
                className="font-mono text-xs"
                type="password"
              />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!!needs && secret.length < 3}
              onClick={() => {
                connections.connect(item.id, repo)
                setDone(true)
              }}
            >
              {needs ? 'Connect' : 'Authorize and connect'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/**
 * Account scope: connect or disconnect a service once.
 * Repo scope: choose which connected services this repository uses.
 */
export function IntegrationsPanel({ repo }: { repo?: string }) {
  const { connected, enabled } = useConnections()
  const [tab, setTab] = React.useState<IntegrationGroup | 'all'>('all')
  const [query, setQuery] = React.useState('')
  const [connecting, setConnecting] = React.useState<Integration | null>(null)
  const [picker, setPicker] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)

  const visible = catalog.filter(
    (i) =>
      (tab === 'all' || i.group === tab) &&
      nameOf(i).toLowerCase().includes(query.toLowerCase()),
  )

  if (repo) {
    const used = catalog.filter((i) => connected.has(i.id))
    const on = enabled[repo] ?? new Set<string>()
    return (
      <div className="space-y-4">
        {used.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing is connected yet. Add a reviewer, a runner or an agent
            environment.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {used.map((i) => (
              <li key={i.id} className="p-4">
                <div className="flex items-center gap-3">
                  <Logo i={i} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {nameOf(i)}
                      <Badge>{groups[i.group].title}</Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {groups[i.group].repoHint}
                    </p>
                  </div>
                  {on.has(i.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={open === i.id}
                      onClick={() => setOpen(open === i.id ? null : i.id)}
                    >
                      Settings
                      <ChevronDownIcon
                        className={cn(
                          'size-3.5 transition-transform',
                          open === i.id && 'rotate-180',
                        )}
                      />
                    </Button>
                  )}
                  <Switch
                    checked={on.has(i.id)}
                    onCheckedChange={(v) =>
                      connections.setEnabled(repo, i.id, v)
                    }
                    aria-label={`Use ${nameOf(i)} in this repository`}
                  />
                </div>
                {open === i.id && on.has(i.id) && (
                  <div className="mt-4 border-t pt-4">
                    <RepoSettings group={i.group} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button onClick={() => setPicker(true)}>
          <PlusIcon /> Add an integration
        </Button>
        <Modal
          open={picker}
          onClose={() => setPicker(false)}
          title="Add an integration"
          description="Services you have not connected yet."
          wide
        >
          <ul className="divide-y">
            {catalog
              .filter((i) => !connected.has(i.id))
              .map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <Logo i={i} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{nameOf(i)}</div>
                    <p className="truncate text-xs text-muted-foreground">
                      {groups[i.group].title} · {i.tagline}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setPicker(false)
                      setConnecting(i)
                    }}
                  >
                    Connect
                  </Button>
                </li>
              ))}
          </ul>
        </Modal>
        <ConnectDialog
          item={connecting}
          repo={repo}
          onClose={() => setConnecting(null)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StateTabs
          label="Kind"
          value={tab}
          onChange={setTab}
          className="border-b-0"
          options={[
            { id: 'all', label: 'All' },
            ...(Object.keys(groups) as Array<IntegrationGroup>).map((g) => ({
              id: g,
              label: groups[g].title,
            })),
          ]}
        />
        <div className="relative w-full sm:w-56">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a service"
            aria-label="Find a service"
            className="pl-8"
          />
        </div>
      </div>
      {visible.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      )}
      {(Object.keys(groups) as Array<IntegrationGroup>).map((g) => {
        const rows = visible.filter((i) => i.group === g)
        if (rows.length === 0) return null
        return (
          <section key={g} className="space-y-2">
            <div>
              <h2 className="text-sm font-medium">{groups[g].title}</h2>
              <p className="text-sm text-muted-foreground">{groups[g].blurb}</p>
            </div>
            <ul className="divide-y rounded-xl border bg-card">
              {rows.map((i) => {
                const isOn = connected.has(i.id)
                return (
                  <li key={i.id} className="flex items-center gap-3 p-4">
                    <Logo i={i} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {nameOf(i)}
                        {isOn && <Badge tone="success">Connected</Badge>}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {i.tagline}
                      </p>
                    </div>
                    {isOn ? (
                      <Button
                        size="sm"
                        onClick={() => connections.disconnect(i.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setConnecting(i)}>
                        Connect
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      <ConnectDialog item={connecting} onClose={() => setConnecting(null)} />
    </div>
  )
}
