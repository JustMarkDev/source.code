import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useOpMaybe, useWrite } from '~/lib/forge'
import { CheckIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { RequireAuth } from '~/components/forge/auth'
import { PageTitle, SectionLabel } from '~/components/forge/bits'
import { CopyField } from '~/components/forge/repo-shell'
import { Toggle } from '~/components/forge/repo-pages'
import { Button } from '~/components/ui/button'
import { manages, useAccounts, useMe } from '~/lib/auth/accounts'
import { Segmented } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'

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

function NewRepo() {
  const { mode = 'create' } = Route.useSearch()
  const { me, accounts, active } = useAccounts()
  // Every account you may create in: yourself, and organizations you own or administer.
  const creatable = accounts.filter((a) => me && manages(a))
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
  const [description, setDescription] = React.useState('')
  const [isPrivate, setPrivate] = React.useState(false)
  const [created, setCreated] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const write = useWrite()
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)

  if (created) {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-success/15">
            <CheckIcon className="size-4 text-success" />
          </span>
          <div>
            <Link
              to="/$handle/$repo/$tab"
              params={{ handle: owner.handle, repo: created, tab: 'code' }}
              className="font-semibold hover:underline"
            >
              {owner.handle}/{created} is ready
            </Link>
            <div className="text-sm text-muted-foreground">
              {owner.kind === 'organization'
                ? `It belongs to ${owner.name}, not to you. Push your first commit to see it here.`
                : 'Push your first commit to see it here.'}
            </div>
          </div>
        </div>
        <CopyField
          value={`git remote add origin https://source.code/${owner.handle}/${created}.git`}
        />
        <CopyField value="git push -u origin main" />
        <Button
          variant="outline"
          onClick={() => {
            setCreated(null)
            setName('')
            setDescription('')
          }}
        >
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
        if (!valid) return
        setBusy(true)
        setError('')
        void write('repos.create', {
          body: {
            name,
            owner: owner.handle,
            description: description || undefined,
            visibility: isPrivate ? 'private' : 'public',
          },
        }).then((r) => {
          setBusy(false)
          if (r.error) setError(r.error.message)
          else setCreated(r.data.name)
        })
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
              ? 'Start with a letter or number; then letters, numbers, dots, dashes and underscores.'
              : 'Short and memorable works best.'}
          </span>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          className="h-9 w-full rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <Toggle
        checked={isPrivate}
        onChange={setPrivate}
        label="Private"
        hint="Only you and the people you add can see it."
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button
          variant="brand"
          size="lg"
          type="submit"
          disabled={!valid || busy}
        >
          Create repository
        </Button>
      </div>
    </form>
  )
}

const hostLabel: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  codeberg: 'Codeberg',
  gitea: 'Gitea',
}

function Import({ owner }: { owner: Owner }) {
  const me = useMe()
  const links =
    useOpMaybe('links.list', { handle: me?.handle ?? '' }, !!me)?.data ?? []
  const write = useWrite()
  type Host = 'github' | 'gitlab' | 'codeberg' | 'gitea'
  const [chosen, setChosen] = React.useState<Host | null>(null)
  const first = links.at(0)
  const host: Host = chosen ?? first?.host ?? 'github'
  const login = links.find((l) => l.host === host)?.login
  const [text, setText] = React.useState('')
  const slugs = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.includes('/') || !login ? t : `${login}/${t}`))
  const valid = slugs.every((t) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(t))
  const [results, setResults] = React.useState<
    Partial<Record<string, { ok: boolean; text: string }>>
  >({})
  const [busy, setBusy] = React.useState(false)
  const done = slugs.length > 0 && slugs.every((t) => results[t]?.ok) && !busy

  async function run() {
    setBusy(true)
    for (const slug of slugs) {
      const r = await write('imports.create', {
        body: { host, slug, owner: owner.handle },
      })
      setResults((all) => ({
        ...all,
        [slug]: r.error
          ? { ok: false, text: r.error.message }
          : { ok: true, text: `${r.data.owner}/${r.data.name}` },
      }))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SectionLabel>Import from</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['github', 'gitlab', 'codeberg', 'gitea'] as const).map((h) => {
            const link = links.find((l) => l.host === h)
            return (
              <button
                key={h}
                type="button"
                aria-pressed={host === h}
                onClick={() => {
                  setChosen(h)
                  setResults({})
                }}
                className={cn(
                  'rounded-xl border bg-card px-3 py-3 text-left text-sm transition-colors hover:border-foreground/40',
                  host === h && 'border-foreground/60 bg-muted',
                )}
              >
                <div className="font-medium">{hostLabel[h]}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {link ? `@${link.login}` : 'not linked'}
                </div>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Listing your repositories there needs signing in with that host, which
          is not built yet. Name them below.{' '}
          <Link
            to="/settings/$section"
            params={{ section: 'accounts' }}
            className="underline-offset-4 hover:underline"
          >
            Link an account
          </Link>
        </p>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">
          Repositories on {hostLabel[host]}, one per line
        </span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setResults({})
          }}
          rows={4}
          placeholder={login ? `dotfiles\n${login}/blog` : 'owner/name'}
          className="w-full rounded-lg border bg-background px-3 py-2 font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!valid && (
          <span className="text-xs text-danger">
            Write each one as owner/name.
          </span>
        )}
      </label>

      {Object.keys(results).length > 0 && (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {slugs.map((t) => (
            <li key={t} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 font-mono">{t}</span>
              <span
                className={cn(
                  'text-xs',
                  results[t]?.ok ? 'text-success' : 'text-danger',
                )}
              >
                {(() => {
                  const r = results[t]
                  if (!r) return 'Waiting'
                  return r.ok ? `Imported as ${r.text}, syncing` : r.text
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          Each one becomes a repository here that pulls from where it came from.
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
            disabled={slugs.length === 0 || !valid || busy}
            onClick={() => void run()}
          >
            {busy ? 'Importing' : `Import ${slugs.length || ''}`.trim()}
          </Button>
        )}
      </div>
    </div>
  )
}
