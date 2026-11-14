import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { File } from '@pierre/diffs/react'
import { PlusIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Modal, Panel, SectionLabel, Seg } from './bits'
import type { Repo } from '~/lib/model/data'
import type { Rule } from '~/lib/model/platform'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { useIsDark } from '~/lib/theme'
import { useOp, useWrite } from '~/lib/forge'
import { dayOf } from '~/lib/repo'

type Mode = Rule['mode']
const modeTone = {
  enforce: 'success',
  'dry-run': 'warning',
  off: 'muted',
} as const
const modeLabel = {
  enforce: 'Enforcing',
  'dry-run': 'Dry run',
  off: 'Off',
} as const

type Probe = {
  author: 'human' | 'agent' | 'bot'
  paths: Set<string>
  size: number
}

const matches: Record<string, (p: Probe) => boolean> = {
  'core-paths': (p) => p.paths.has('src'),
  'ci-evidence': () => true,
  'agent-authored': (p) => p.author === 'agent',
  'docs-agent': (p) => p.paths.has('docs'),
  findings: () => true,
  'policy-self': (p) => p.paths.has('policy'),
  'secret-recipients': (p) => p.paths.has('secrets'),
  'big-change': (p) => p.size > 400,
}

/**
 * For a rule the repository wrote: `any change` always applies, and `paths a, b`
 * applies when the change touches a folder one of the globs starts with.
 */
function fromWhen(when: string): (p: Probe) => boolean {
  if (!when.startsWith('paths ')) return () => true
  const tops = when
    .slice(6)
    .split(',')
    .map((g) => g.trim().split('/')[0])
  return (p) => tops.some((t) => p.paths.has(t) || t.includes('*'))
}

function RuleCard({
  r,
  custom,
  onMode,
  onDelete,
}: {
  r: Rule
  custom?: boolean
  onMode: (m: Mode) => void
  onDelete?: () => void
}) {
  const pct = r.evaluated ? Math.round((r.blocked / r.evaluated) * 100) : 0
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{r.name}</h3>
            <Chip tone={modeTone[r.mode]}>{modeLabel[r.mode]}</Chip>
            {custom && <Chip tone="muted">This repository's</Chip>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            when {r.when}
          </p>
        </div>
        <Seg
          value={r.mode}
          onChange={onMode}
          options={[
            ['enforce', 'Enforce'],
            ['dry-run', 'Dry run'],
            ['off', 'Off'],
          ]}
        />
      </div>
      <ul className="space-y-1 text-sm">
        {r.requires.map((q) => (
          <li key={q} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-brand-ink" />
            {q}
          </li>
        ))}
      </ul>
      {r.note && <p className="text-xs text-warning">{r.note}</p>}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-brand"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        Blocked {r.blocked} of {r.evaluated} changes
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto rounded-md px-2 py-1 hover:bg-danger/10 hover:text-danger"
          >
            Delete rule
          </button>
        )}
      </div>
    </Panel>
  )
}

function Tester({ rules }: { rules: Array<Rule> }) {
  const [author, setAuthor] = React.useState<Probe['author']>('agent')
  const [paths, setPaths] = React.useState<Set<string>>(new Set(['src']))
  const [size, setSize] = React.useState(120)
  const probe: Probe = { author, paths, size }
  const hit = rules.filter(
    (r) => r.mode !== 'off' && (matches[r.id] ?? fromWhen(r.when))(probe),
  )
  const toggle = (p: string) =>
    setPaths((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  return (
    <Panel className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Describe a change and see which rules would apply, before anyone opens
        it.
      </p>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-muted-foreground">Author</span>
          <Seg
            value={author}
            onChange={setAuthor}
            options={[
              ['human', 'Person'],
              ['agent', 'Agent'],
              ['bot', 'Bot'],
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-muted-foreground">Touches</span>
          {[
            ['src', 'src/'],
            ['docs', 'docs/'],
            ['policy', '.source/policy/'],
            ['secrets', '.source/secrets/'],
          ].map(([id, label]) => (
            <label key={id} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={paths.has(id)}
                onChange={() => toggle(id)}
                className="size-4 accent-[var(--brand-ink)]"
              />
              <span className="font-mono text-xs">{label}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-16 text-muted-foreground">Size</span>
          <input
            type="range"
            min={10}
            max={900}
            step={10}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Lines changed"
            className="h-6 w-48 accent-[var(--brand-ink)]"
          />
          <span className="font-mono text-xs tabular-nums">{size} lines</span>
        </div>
      </div>
      <ul className="space-y-2 border-t pt-4">
        {hit.map((r) => (
          <li key={r.id} className="flex gap-2 text-sm">
            <ShieldCheckIcon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                r.mode === 'dry-run' ? 'text-warning' : 'text-success',
              )}
            />
            <span>
              <span className="font-medium">{r.name}</span>
              {r.mode === 'dry-run' && (
                <span className="text-warning"> (dry run, not blocking)</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {r.requires.join('. ')}
              </span>
            </span>
          </li>
        ))}
        {hit.length === 0 && (
          <li className="text-sm text-muted-foreground">No rules apply.</li>
        )}
      </ul>
    </Panel>
  )
}

export function PoliciesPage({ repo }: { repo: Repo }) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const at = { owner: repo.owner, repo: repo.name }
  const set = useOp('policy.rules', at)
  const write = useWrite()
  const [error, setError] = React.useState('')
  const rules: Array<Rule> = set.rules.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    when: r.when,
    requires: r.requires,
    evaluated: r.evaluated,
    blocked: r.blocked,
    note:
      r.mode === 'dry-run'
        ? `In dry run. Would block ${r.would_block.length} open change${r.would_block.length === 1 ? '' : 's'} now.`
        : undefined,
  }))
  const dryRun = set.rules
    .filter((r) => r.mode === 'dry-run')
    .flatMap((r) => r.would_block.map((w) => ({ ...w, rule: r.name })))
  const exceptions = set.exceptions
  const done = (r: { error: { message: string } | null }) =>
    setError(r.error?.message ?? '')
  // Once the rules live in the file, saving here proposes: a change to it.
  const inFile = set.source.state !== 'settings'
  const [proposed, setProposed] = React.useState<{
    change: number
    created: boolean
  } | null>(null)
  const propose = async (edit: PolicyEditBody) => {
    const r = await write('policy.proposals.create', {
      ...at,
      body: { edits: [edit] },
    })
    done(r)
    if (r.data?.change)
      setProposed({ change: r.data.change, created: r.data.created })
    return r
  }
  const custom = new Set(set.rules.filter((r) => r.custom).map((r) => r.id))
  const [writing, setWriting] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState({
    rule: 'core-paths',
    who: '',
    reason: '',
    days: '7',
  })

  return (
    <>
      <div className="space-y-10">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Policies</h2>
          <p className="text-muted-foreground">
            Rules that decide what can land, kept as code in the repo. They
            judge people, agents and reviewers by the same terms, and every
            exception has an owner and an end date.
          </p>
          {error && !adding && <p className="text-sm text-danger">{error}</p>}
        </div>

        <PolicySource
          repo={repo}
          source={set.source}
          proposed={proposed}
          onMove={() => void propose({ op: 'set_landing' })}
        />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>Rules</SectionLabel>
              <Button size="sm" onClick={() => setWriting(true)}>
                <PlusIcon /> Write a rule
              </Button>
            </div>
            {rules.map((r) => (
              <RuleCard
                key={r.id}
                r={r}
                custom={custom.has(r.id)}
                onDelete={
                  custom.has(r.id)
                    ? () =>
                        void (
                          inFile
                            ? propose({ op: 'delete_rule', rule: r.id })
                            : write('policy.delete_rule', {
                                ...at,
                                rule: r.id,
                              })
                        ).then(done)
                    : undefined
                }
                onMode={(mode) =>
                  void (
                    inFile
                      ? propose({ op: 'set_mode', rule: r.id, mode })
                      : write('policy.update_rule', {
                          ...at,
                          rule: r.id,
                          body: { mode },
                        })
                  ).then(done)
                }
              />
            ))}
          </section>

          <div className="space-y-8">
            <section className="space-y-3">
              <SectionLabel>Try a change</SectionLabel>
              <Tester rules={rules} />
            </section>

            <section className="space-y-3">
              <SectionLabel>Dry run results</SectionLabel>
              <Panel className="divide-y overflow-hidden">
                {dryRun.map((d) => (
                  <div
                    key={`${d.rule}-${d.change}`}
                    className="flex gap-3 px-4 py-3 text-sm"
                  >
                    <Chip tone="warning">would block</Chip>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {d.title}{' '}
                        <span className="font-mono text-xs text-muted-foreground">
                          #{d.change}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.rule}: {d.why}
                      </div>
                    </div>
                  </div>
                ))}
                {dryRun.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No rule in dry run would block an open change.
                  </p>
                )}
              </Panel>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionLabel>Exceptions</SectionLabel>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAdding(true)}
                >
                  <PlusIcon className="size-4" />
                  Add
                </Button>
              </div>
              <Panel className="divide-y overflow-hidden">
                {exceptions.map((e) => (
                  <div key={e.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.who}</span>
                      <Chip>{e.rule}</Chip>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Ends {dayOf(e.expires_at)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void (
                            inFile
                              ? propose({
                                  op: 'remove_exception',
                                  exception: e.id,
                                })
                              : write('policy.remove_exception', {
                                  ...at,
                                  exception: e.id,
                                })
                          ).then(done)
                        }
                      >
                        End now
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.reason}. Added by {e.created_by}.
                    </div>
                  </div>
                ))}
                {exceptions.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No exceptions.
                  </p>
                )}
              </Panel>
            </section>
          </div>
        </div>

        <section className="space-y-3">
          <SectionLabel>As code, .source/policy/main.yml</SectionLabel>
          <div className="overflow-hidden rounded-xl border">
            <File
              file={{ name: 'main.yml', contents: set.yaml }}
              options={{ theme: codeTheme(dark), overflow }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {inFile
              ? 'The file on the default branch. Edit it in a change, or here: saving opens one.'
              : 'Written from the settings on this page, as the move into the file would write it.'}
          </p>
        </section>

        <section className="space-y-3">
          <SectionLabel>How changes land</SectionLabel>
          <LandingSettings
            landing={set.landing}
            editable={inFile}
            onChange={(landing) =>
              void propose({ op: 'set_landing', ...landing })
            }
          />
        </section>
      </div>

      <WriteRule
        open={writing}
        onClose={() => setWriting(false)}
        onSave={async (body) => {
          const r = inFile
            ? await propose({ op: 'create_rule', ...body })
            : await write('policy.create_rule', { ...at, body })
          done(r)
          if (!r.error) setWriting(false)
          return r.error?.message ?? ''
        }}
      />

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an exception"
        description="Exceptions are named, owned, and end on a date. They show up in the audit trail."
      >
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Rule</span>
            <Select
              value={draft.rule}
              onValueChange={(v) => setDraft({ ...draft, rule: v })}
            >
              {rules.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Who</span>
            <input
              value={draft.who}
              onChange={(e) => setDraft({ ...draft, who: e.target.value })}
              placeholder="A person's handle"
              className="h-9 w-full rounded-lg border bg-background px-3"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Reason</span>
            <input
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              className="h-9 w-full rounded-lg border bg-background px-3"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Ends after</span>
            <Select
              value={draft.days}
              onValueChange={(v) => setDraft({ ...draft, days: v })}
            >
              <SelectItem value="1">1 day</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
            </Select>
          </label>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!draft.who || !draft.reason}
            onClick={() => {
              const body = {
                rule: draft.rule,
                who: draft.who.trim(),
                reason: draft.reason,
                expires_at: new Date(
                  Date.now() + Number(draft.days) * 86_400_000,
                ).toISOString(),
              }
              void (
                inFile
                  ? propose({ op: 'add_exception', ...body })
                  : write('policy.add_exception', { ...at, body })
              ).then((r) => {
                done(r)
                if (r.error) return
                setDraft({ rule: 'core-paths', who: '', reason: '', days: '7' })
                setAdding(false)
              })
            }}
          >
            Add exception
          </Button>
        </div>
      </Modal>
    </>
  )
}

type PolicyEditBody = Extract<
  Parameters<ReturnType<typeof useWrite>>[1],
  { body: { edits: Array<unknown> } }
>['body']['edits'][number]

type Landing = ReturnType<typeof useOp<'policy.rules'>>['landing']

/** Where the rules come from, a file that does not read, and open policy changes. */
function PolicySource({
  repo,
  source,
  proposed,
  onMove,
}: {
  repo: Repo
  source: ReturnType<typeof useOp<'policy.rules'>>['source']
  proposed: { change: number; created: boolean } | null
  onMove: () => void
}) {
  const link = (n: number, text: React.ReactNode) => (
    <Link
      to="/$handle/$repo/$tab"
      params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
      search={{ n }}
      className="font-medium text-foreground hover:underline"
    >
      {text}
    </Link>
  )
  return (
    <Panel className="max-w-3xl space-y-3 p-4 text-sm">
      {source.state === 'settings' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-muted-foreground">
            These rules are repository settings for now. Move them into{' '}
            <span className="font-mono text-xs">.source/policy/main.yml</span>{' '}
            to review changes to them like code. They stay in force until that
            change lands.
          </p>
          {!source.pending.length && (
            <Button size="sm" variant="outline" onClick={onMove}>
              Move into the file
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">
          The rules live in{' '}
          <span className="font-mono text-xs">.source/policy/main.yml</span>
          {source.sha && (
            <>
              {' '}
              at{' '}
              <span className="font-mono text-xs">
                {source.sha.slice(0, 7)}
              </span>
            </>
          )}
          . Saving here opens a change to it; nothing applies until it lands.
        </p>
      )}
      {source.state === 'errors' && (
        <div className="space-y-1 rounded-lg bg-danger/8 px-3 py-2 text-danger">
          <p className="font-medium">Policy file has errors</p>
          <p className="text-xs">The last valid rules stay in force.</p>
          <ul className="list-disc pl-5 text-xs">
            {source.errors.map((e) => (
              <li key={`${e.path}:${e.line ?? ''}:${e.message}`}>
                {e.path && <span className="font-mono">{e.path}</span>}
                {e.line !== null && ` (line ${e.line})`}
                {e.path || e.line !== null ? ': ' : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposed && (
        <p className="text-success">
          {proposed.created ? 'Opened' : 'Added to'}{' '}
          {link(proposed.change, `change #${proposed.change}`)}. It applies once
          it lands.
        </p>
      )}
      {source.pending.map((x) => (
        <p key={x.change} className="flex flex-wrap items-center gap-2">
          <Chip tone="warning">Pending</Chip>
          {link(x.change, `#${x.change} ${x.title}`)}
          <span className="text-xs text-muted-foreground">by {x.author}</span>
        </p>
      ))}
    </Panel>
  )
}

/** The policy file's `landing:` section, editable once the rules live in the file. */
function LandingSettings({
  landing,
  editable,
  onChange,
}: {
  landing: Landing
  editable: boolean
  /** Steps are edited in the file; the page sets the rest. */
  onChange: (l: Partial<Omit<Landing, 'steps'>>) => void
}) {
  const steps = landing.steps.map((s) =>
    'wait_checks' in s
      ? `Wait for ${(s.wait_checks as Array<string>).join(', ')}`
      : 'run_pipeline' in s
        ? `Run the ${String(s.run_pipeline)} pipeline`
        : `Call ${String(s.webhook)}`,
  )
  return (
    <Panel className="max-w-3xl divide-y text-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-medium">Strategy</p>
          <p className="text-xs text-muted-foreground">
            How a change goes onto the base branch.
          </p>
        </div>
        {editable ? (
          <Select
            value={landing.strategy}
            onValueChange={(v) =>
              onChange({ strategy: v as Landing['strategy'] })
            }
          >
            <SelectItem value="squash">Squash</SelectItem>
            <SelectItem value="rebase">Rebase</SelectItem>
            <SelectItem value="merge">Merge</SelectItem>
          </Select>
        ) : (
          <Chip>{landing.strategy}</Chip>
        )}
      </div>
      <label className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-medium">Fresh approvals</p>
          <p className="text-xs text-muted-foreground">
            Approvals count only on the newest patch set, even after a rebase.
          </p>
        </div>
        <input
          type="checkbox"
          checked={landing.fresh_approvals}
          disabled={!editable}
          onChange={(e) => onChange({ fresh_approvals: e.target.checked })}
          className="size-4 accent-current"
        />
      </label>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="font-medium">Who settles a thread</p>
          <p className="text-xs text-muted-foreground">
            The person who started it, or any reviewer.
          </p>
        </div>
        {editable ? (
          <Select
            value={landing.resolve}
            onValueChange={(v) =>
              onChange({ resolve: v as Landing['resolve'] })
            }
          >
            <SelectItem value="any_reviewer">Any reviewer</SelectItem>
            <SelectItem value="author">Its author</SelectItem>
          </Select>
        ) : (
          <Chip>
            {landing.resolve === 'author' ? 'Its author' : 'Any reviewer'}
          </Chip>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="font-medium">Steps</p>
        {steps.length ? (
          <ol className="mt-1 list-decimal pl-5 text-muted-foreground">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">
            None: a change lands as soon as policy allows. Add steps in the
            file.
          </p>
        )}
      </div>
      {!editable && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          These are the defaults. Move the rules into the file to change them.
        </p>
      )}
    </Panel>
  )
}

type RuleBody = {
  id: string
  name: string
  kind: 'required_check' | 'path_approval' | 'max_lines'
  check?: string
  paths?: Array<string>
  approvals?: number
  from?: Array<string>
  max_lines?: number
}

/** A rule the repository writes for itself: a check, a path owner, or a size limit. */
function WriteRule({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (body: RuleBody) => Promise<string>
}) {
  const [kind, setKind] = React.useState<RuleBody['kind']>('path_approval')
  const [name, setName] = React.useState('')
  const [check, setCheck] = React.useState('ci/lint')
  const [paths, setPaths] = React.useState('docs/**')
  const [from, setFrom] = React.useState('')
  const [approvals, setApprovals] = React.useState('1')
  const [max, setMax] = React.useState('800')
  const [error, setError] = React.useState('')
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'rule'
  const list = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  const input = 'h-9 w-full rounded-lg border bg-background px-3'
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Write a rule"
      description="It is added to the policy file and checked on every open change."
    >
      <div className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Docs need a docs owner"
            className={input}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">Kind</span>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as RuleBody['kind'])}
          >
            <SelectItem value="path_approval">
              Changes to some paths need approval
            </SelectItem>
            <SelectItem value="required_check">A check has to pass</SelectItem>
            <SelectItem value="max_lines">Changes stay small</SelectItem>
          </Select>
        </label>
        {kind === 'path_approval' && (
          <>
            <label className="block space-y-1">
              <span className="text-muted-foreground">
                Paths, separated by commas
              </span>
              <input
                value={paths}
                onChange={(e) => setPaths(e.target.value)}
                className={cn(input, 'font-mono')}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-muted-foreground">Approvals</span>
                <Select
                  value={approvals}
                  onValueChange={(v) => setApprovals(String(v))}
                >
                  {['1', '2', '3'].map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">From (optional)</span>
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="hollis, ines"
                  className={input}
                />
              </label>
            </div>
          </>
        )}
        {kind === 'required_check' && (
          <label className="block space-y-1">
            <span className="text-muted-foreground">Check</span>
            <input
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              className={cn(input, 'font-mono')}
            />
          </label>
        )}
        {kind === 'max_lines' && (
          <label className="block space-y-1">
            <span className="text-muted-foreground">
              Most lines added and removed
            </span>
            <input
              value={max}
              inputMode="numeric"
              onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
              className={input}
            />
          </label>
        )}
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!name.trim()}
            onClick={() =>
              void onSave({
                id,
                name: name.trim(),
                kind,
                ...(kind === 'required_check' ? { check: check.trim() } : {}),
                ...(kind === 'path_approval'
                  ? {
                      paths: list(paths),
                      approvals: Number(approvals),
                      from: list(from),
                    }
                  : {}),
                ...(kind === 'max_lines' ? { max_lines: Number(max) } : {}),
              }).then((message) => {
                setError(message)
                if (!message) setName('')
              })
            }
          >
            Add rule
          </Button>
        </div>
      </div>
    </Modal>
  )
}
