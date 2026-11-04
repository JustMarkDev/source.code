import * as React from 'react'
import { File } from '@pierre/diffs/react'
import { PlusIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Modal, Panel, SectionLabel, Seg } from './bits'
import type { Repo } from '~/mock/data'
import type { Exception, Rule } from '~/mock/platform'
import { Button } from '~/components/ui/button'
import { useIsDark } from '~/lib/theme'
import {
  dryRunSamples,
  exceptions as initialExceptions,
  rules as initialRules,
  policyYaml,
} from '~/mock/platform'

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
  'agent-authored': (p) => p.author === 'agent',
  'docs-agent': (p) => p.paths.has('docs'),
  findings: () => true,
  'policy-self': (p) => p.paths.has('policy'),
  'secret-recipients': (p) => p.paths.has('secrets'),
  'big-change': (p) => p.size > 400,
}

function RuleCard({ r, onMode }: { r: Rule; onMode: (m: Mode) => void }) {
  const pct = r.evaluated ? Math.round((r.blocked / r.evaluated) * 100) : 0
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{r.name}</h3>
            <Chip tone={modeTone[r.mode]}>{modeLabel[r.mode]}</Chip>
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
        Blocked {r.blocked} of {r.evaluated} changes in 30 days
      </div>
    </Panel>
  )
}

function Tester({ rules }: { rules: Array<Rule> }) {
  const [author, setAuthor] = React.useState<Probe['author']>('agent')
  const [paths, setPaths] = React.useState<Set<string>>(new Set(['src']))
  const [size, setSize] = React.useState(120)
  const probe: Probe = { author, paths, size }
  const hit = rules.filter((r) => r.mode !== 'off' && matches[r.id](probe))
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
            className="w-48 accent-[var(--brand-ink)]"
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

export function PoliciesPage(_props: { repo: Repo }) {
  const dark = useIsDark()
  const [rules, setRules] = React.useState(initialRules)
  const [exceptions, setExceptions] =
    React.useState<Array<Exception>>(initialExceptions)
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
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="space-y-3">
            <SectionLabel>Rules</SectionLabel>
            {rules.map((r) => (
              <RuleCard
                key={r.id}
                r={r}
                onMode={(mode) =>
                  setRules((p) =>
                    p.map((x) => (x.id === r.id ? { ...x, mode } : x)),
                  )
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
                {dryRunSamples.map((d) => (
                  <div key={d.change} className="flex gap-3 px-4 py-3 text-sm">
                    <Chip
                      tone={d.outcome === 'would block' ? 'warning' : 'success'}
                    >
                      {d.outcome}
                    </Chip>
                    <div className="min-w-0">
                      <div className="font-medium">
                        {d.title}{' '}
                        <span className="font-mono text-xs text-muted-foreground">
                          {d.change}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.why}
                      </div>
                    </div>
                  </div>
                ))}
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
                {exceptions.map((e, i) => (
                  <div key={i} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.who}</span>
                      <Chip>{e.rule}</Chip>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Ends {e.expires}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.reason}. Owned by {e.owner}.
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
              file={{ name: 'main.yml', contents: policyYaml }}
              options={{ theme: dark ? 'pierre-dark' : 'pierre-light' }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Changing this file is itself governed by a rule: it needs a human
            from team:policy-owners, and an agent cannot approve it.
          </p>
        </section>
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an exception"
        description="Exceptions are named, owned, and end on a date. They show up in the audit trail."
      >
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Rule</span>
            <select
              value={draft.rule}
              onChange={(e) => setDraft({ ...draft, rule: e.target.value })}
              className="h-9 w-full rounded-lg border bg-background px-2"
            >
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Who</span>
            <input
              value={draft.who}
              onChange={(e) => setDraft({ ...draft, who: e.target.value })}
              placeholder="A person, bot or agent"
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
            <select
              value={draft.days}
              onChange={(e) => setDraft({ ...draft, days: e.target.value })}
              className="h-9 w-full rounded-lg border bg-background px-2"
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!draft.who || !draft.reason}
            onClick={() => {
              setExceptions((p) => [
                ...p,
                {
                  rule: draft.rule,
                  who: draft.who,
                  reason: draft.reason,
                  owner: 'dana',
                  expires: `in ${draft.days} days`,
                },
              ])
              setDraft({ rule: 'core-paths', who: '', reason: '', days: '7' })
              setAdding(false)
            }}
          >
            Add exception
          </Button>
        </div>
      </Modal>
    </>
  )
}
