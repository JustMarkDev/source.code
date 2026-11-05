import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CheckIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { Provider } from '~/mock/extra'
import { RequireAuth } from '~/components/forge/auth'
import { PageTitle, SectionLabel } from '~/components/forge/bits'
import { CopyField } from '~/components/forge/repo-shell'
import { Toggle } from '~/components/forge/repo-pages'
import { Button } from '~/components/ui/button'
import { directory, useAccounts } from '~/lib/auth/accounts'
import { Segmented } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'
import { providers } from '~/mock/extra'

export const Route = createFileRoute('/new')({
  head: () => ({ meta: [{ title: 'New repository · source.code' }] }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { mode?: 'create' | 'import' } => ({
    mode:
      s.mode === 'import'
        ? 'import'
        : s.mode === 'create'
          ? 'create'
          : undefined,
  }),
  component: () => (
    <RequireAuth>
      <NewRepo />
    </RequireAuth>
  ),
})

const remote: Record<Provider['id'], Array<string>> = {
  github: ['dotfiles', 'advent-of-code', 'rust-playground', 'blog', 'dana.dev'],
  gitlab: ['old-site', 'infra-notes'],
  codeberg: ['zine', 'keyboards'],
  gitea: ['homelab'],
  native: [],
}

function NewRepo() {
  const { mode = 'create' } = Route.useSearch()
  const { me, accounts, active } = useAccounts()
  // Every account you may create in: yourself, and organizations you own or administer.
  const creatable = accounts.filter(
    (a) => me && directory.canManage(me, a.handle),
  )
  const [picked, setPicked] = React.useState<string | null>(null)
  const owner =
    creatable.find((a) => a.id === picked) ??
    creatable.find((a) => a.id === active?.id) ??
    creatable.at(0)
  const picker = owner && (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">Owner</span>
      <Select value={owner.id} onValueChange={(v) => setPicked(v)}>
        {creatable.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.kind === 'organization'
              ? `${a.name} (organization)`
              : `${a.name} (you)`}
          </SelectItem>
        ))}
      </Select>
    </label>
  )
  const navigate = Route.useNavigate()
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="New repository">
        Start something here, or bring a project and its history with you.
      </PageTitle>
      <div className="mb-6">
        <Segmented
          label="How to start"
          value={mode}
          onChange={(id) =>
            void navigate({ search: { mode: id }, replace: true })
          }
          options={[
            ['create', 'Create new'],
            ['import', 'Import existing'],
          ]}
        />
      </div>
      {owner &&
        (mode === 'create' ? (
          <Create owner={owner} picker={picker} />
        ) : (
          <Import owner={owner} />
        ))}
    </div>
  )
}

type Owner = { handle: string; name: string; kind: 'person' | 'organization' }

function Create({ owner, picker }: { owner: Owner; picker: React.ReactNode }) {
  const [name, setName] = React.useState('')
  const [created, setCreated] = React.useState(false)
  const [readme, setReadme] = React.useState(true)
  const valid = /^[a-z0-9._-]+$/i.test(name)

  if (created) {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-success/15">
            <CheckIcon className="size-4 text-success" />
          </span>
          <div>
            <div className="font-semibold">
              {owner.handle}/{name} is ready
            </div>
            <div className="text-sm text-muted-foreground">
              {owner.kind === 'organization'
                ? `It belongs to ${owner.name}, not to you. Push your first commit to see it here.`
                : 'Push your first commit to see it here.'}
            </div>
          </div>
        </div>
        <CopyField
          value={`git remote add origin https://source.code/${owner.handle}/${name}.git`}
        />
        <CopyField value="git push -u origin main" />
        <Button variant="outline" onClick={() => setCreated(false)}>
          Create another
        </Button>
      </div>
    )
  }
  return (
    <form
      className="space-y-6 rounded-xl border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) setCreated(true)
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
        {picker}
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Repository name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={name !== '' && !valid}
            className="h-9 w-full rounded-lg border bg-background px-3 font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"
          />
          <span
            className={cn(
              'block text-xs',
              name && !valid ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {name && !valid
              ? 'Use letters, numbers, dots, dashes and underscores.'
              : 'Short and memorable works best.'}
          </span>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Description</span>
        <input className="h-9 w-full rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      <Toggle
        checked={readme}
        onChange={setReadme}
        label="Add a README"
        hint="Shown on the overview page."
      />
      <div className="flex justify-end">
        <Button variant="brand" size="lg" type="submit" disabled={!valid}>
          Create repository
        </Button>
      </div>
    </form>
  )
}

function Import({ owner }: { owner: Owner }) {
  const [providerId, setProviderId] = React.useState<Provider['id']>('github')
  const [picked, setPicked] = React.useState<Set<string>>(new Set(['dotfiles']))
  const [progress, setProgress] = React.useState<Record<string, number> | null>(
    null,
  )
  const names = remote[providerId]

  React.useEffect(() => {
    if (!progress) return
    if (Object.values(progress).every((p) => p >= 100)) return
    const t = setTimeout(
      () =>
        setProgress(
          (p) =>
            p &&
            Object.fromEntries(
              Object.entries(p).map(([k, v]) => [
                k,
                Math.min(100, v + 12 + (k.length % 5)),
              ]),
            ),
        ),
      220,
    )
    return () => clearTimeout(t)
  }, [progress])

  const done = progress && Object.values(progress).every((p) => p >= 100)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SectionLabel>Import from</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={providerId === p.id}
              onClick={() => {
                setProviderId(p.id)
                setPicked(new Set())
                setProgress(null)
              }}
              className={cn(
                'rounded-xl border bg-card px-3 py-3 text-left text-sm transition-colors hover:border-foreground/40',
                providerId === p.id && 'border-foreground/60 bg-muted',
              )}
            >
              <div className="font-medium">{p.name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                @{p.account.handle}
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Only accounts you linked appear here.{' '}
          <Link
            to="/settings/$section"
            params={{ section: 'accounts' }}
            className="underline-offset-4 hover:underline"
          >
            Link another
          </Link>
        </p>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm">
          <span className="font-medium">{names.length} repositories</span>
          <button
            type="button"
            className="-my-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() =>
              setPicked(
                picked.size === names.length ? new Set() : new Set(names),
              )
            }
          >
            {picked.size === names.length ? 'Clear' : 'Select all'}
          </button>
        </div>
        <ul className="divide-y">
          {names.map((n) => {
            const p = progress?.[n]
            return (
              <li key={n}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={picked.has(n)}
                    disabled={progress !== null}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(n)
                      else next.delete(n)
                      setPicked(next)
                    }}
                    className="size-4 accent-[var(--brand-ink)]"
                  />
                  <span className="flex-1 font-mono">{n}</span>
                  {p !== undefined && (
                    <span className="flex w-40 items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full bg-brand-ink transition-[width] duration-300 ease-out"
                          style={{ width: `${p}%` }}
                        />
                      </span>
                      {p >= 100 ? 'Done' : `${p}%`}
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <Toggle
          checked
          label="Bring commit history"
          hint="Keeps authorship and dates. Your profile activity updates automatically."
          onChange={() => undefined}
        />
        <Toggle
          checked
          label="Bring releases and tags"
          hint="Release files are copied so downloads keep working."
          onChange={() => undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          Where a project came from is only visible to you.
        </p>
        {done ? (
          <Button
            variant="brand"
            size="lg"
            render={
              <Link
                to="/$handle"
                params={{ handle: owner.handle }}
                search={{ tab: 'repositories' }}
              />
            }
            nativeButton={false}
          >
            View your repositories
          </Button>
        ) : (
          <Button
            variant="brand"
            size="lg"
            disabled={picked.size === 0 || progress !== null}
            onClick={() =>
              setProgress(Object.fromEntries([...picked].map((n) => [n, 0])))
            }
          >
            {progress ? 'Importing' : `Import ${picked.size || ''}`.trim()}
          </Button>
        )}
      </div>
    </div>
  )
}
