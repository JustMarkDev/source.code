import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  CheckIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, Panel, Seg, Tile } from './bits'
import { CopyField, slugOf } from './repo-shell'
import { StateIcon, StatusCard } from './status-card'
import { WorkWithAgent } from './work-with-agent'
import type { StatusItem } from './status-card'
import type { Repo } from '~/mock/data'
import type { Author, ChangeItem, Finding } from '~/mock/platform'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { StateTabs } from '~/components/ui/tabs'
import { useIsDark } from '~/lib/theme'
import {
  changes,
  findings,
  interdiffPatch,
  refsPatch,
  refsTestPatch,
} from '~/mock/platform'

function AuthorMark({ author }: { author: Author }) {
  if (author.kind === 'human')
    return <Tile name={author.name} round className="size-5 text-[10px]" />
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-muted">
      <CpuChipIcon className="size-3" />
    </span>
  )
}

function ReviewerMark({ r }: { r: ChangeItem['reviewers'][number] }) {
  const dot =
    r.state === 'approved'
      ? 'bg-success'
      : r.state === 'changes'
        ? 'bg-danger'
        : 'bg-muted-foreground/40'
  return (
    <span
      title={`${r.name}, ${r.state}`}
      className="relative inline-flex shrink-0"
    >
      {r.kind === 'human' ? (
        <Tile name={r.name} round className="size-6 text-[10px]" />
      ) : (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted">
          {r.kind === 'agent' ? (
            <CpuChipIcon className="size-3.5" />
          ) : (
            <MagnifyingGlassIcon className="size-3.5" />
          )}
        </span>
      )}
      <span
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
          dot,
        )}
      />
    </span>
  )
}

function standing(c: ChangeItem) {
  if (c.state === 'landed') return { tone: 'merged', text: 'Landed' } as const
  if (c.stack && c.stack.index > 1)
    return { tone: 'muted', text: 'Waits for parent' } as const
  if (c.ci === 'fail') return { tone: 'danger', text: 'Blocked: CI' } as const
  if (c.id === 'ch_7f3a')
    return { tone: 'danger', text: 'Blocked: 1 finding' } as const
  if (c.reviewers.some((r) => r.state === 'changes'))
    return { tone: 'warning', text: 'Changes requested' } as const
  return { tone: 'success', text: 'Ready to land' } as const
}

function Row({ c, repo, index }: { c: ChangeItem; repo: Repo; index: number }) {
  const s = standing(c)
  const latest = c.patchSets.at(-1)
  return (
    <li className="relative">
      <Link
        to="/$handle/$repo/$tab"
        params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
        search={{ n: index + 1 }}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
      >
        <StateIcon state={c.state === 'landed' ? 'pass' : c.ci} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.title}</span>
            {c.state === 'draft' && <Chip>Draft</Chip>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{c.id}</span>
            <span className="inline-flex items-center gap-1">
              <AuthorMark author={c.author} />
              {c.author.name}
            </span>
            <span>{c.when}</span>
          </div>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          PS{latest?.n}
        </span>
        <span className="font-mono text-xs">
          <span className="text-success">+{c.additions}</span>{' '}
          <span className="text-danger">-{c.deletions}</span>
        </span>
        <span className="flex gap-1.5">
          {c.reviewers.map((r) => (
            <ReviewerMark key={r.name} r={r} />
          ))}
        </span>
        <Chip tone={s.tone}>{s.text}</Chip>
      </Link>
    </li>
  )
}

function ChangeList({ repo }: { repo: Repo }) {
  const [filter, setFilter] = React.useState<'open' | 'draft' | 'landed'>(
    'open',
  )
  const show = (c: ChangeItem) =>
    filter === 'open' ? c.state === 'open' : c.state === filter
  const rows = changes.filter(show)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            ['open', 'Open'],
            ['draft', 'Drafts'],
            ['landed', 'Landed'],
          ]}
        />
        <p className="text-sm text-muted-foreground">
          One page per change tells you if it can land, and why not.
        </p>
      </div>
      <Panel className="overflow-hidden">
        <ul className="divide-y">
          {rows.map((c) => (
            <Row key={c.id} c={c} repo={repo} index={changes.indexOf(c)} />
          ))}
          {rows.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing here.
            </li>
          )}
        </ul>
      </Panel>
    </div>
  )
}

type FindingState =
  | { s: 'open' }
  | { s: 'sending' }
  | { s: 'fixed'; in: string }
  | { s: 'dismissed'; reason: string }
  | { s: 'resolved' }

const sevTone = { high: 'danger', medium: 'warning', low: 'muted' } as const

function FindingCard({
  f,
  st,
  onSend,
  onDismiss,
  onResolve,
}: {
  f: Finding
  st: FindingState
  onSend: () => void
  onDismiss: (reason: string) => void
  onResolve: () => void
}) {
  const [dismissing, setDismissing] = React.useState(false)
  const [reason, setReason] = React.useState('Not a problem here')
  const closed = st.s === 'dismissed' || st.s === 'resolved' || st.s === 'fixed'
  return (
    <div
      className={cn(
        'm-2 space-y-2 rounded-lg border bg-card p-3 font-sans text-sm',
        closed && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {f.kind === 'human' ? (
          <Tile name={f.by} round className="size-5 text-[10px]" />
        ) : (
          <span className="flex size-5 items-center justify-center rounded-full bg-muted">
            <MagnifyingGlassIcon className="size-3" />
          </span>
        )}
        <span className="font-medium">{f.by}</span>
        {f.kind === 'reviewer' && <Chip tone="info">Reviewer</Chip>}
        <Chip tone={sevTone[f.severity]}>{f.severity}</Chip>
        <span className="ml-auto font-mono text-muted-foreground">{f.id}</span>
      </div>
      <div className="font-medium">{f.title}</div>
      <p className="text-muted-foreground">{f.body}</p>
      {st.s === 'fixed' && (
        <Chip tone="success">
          <CheckIcon className="size-3" />
          Addressed in {st.in}
        </Chip>
      )}
      {st.s === 'dismissed' && <Chip>Dismissed: {st.reason}</Chip>}
      {st.s === 'resolved' && <Chip tone="success">Resolved</Chip>}
      {st.s === 'sending' && <Chip tone="warning">Agent is writing a fix</Chip>}
      {st.s === 'open' && !dismissing && (
        <div className="flex flex-wrap gap-2">
          {f.kind === 'reviewer' && (
            <Button size="sm" variant="brand" onClick={onSend}>
              <CpuChipIcon className="size-3.5" />
              Send to agent
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onResolve}>
            Resolve
          </Button>
          {f.kind === 'reviewer' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissing(true)}
            >
              Dismiss
            </Button>
          )}
        </div>
      )}
      {st.s === 'open' && dismissing && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option>Not a problem here</option>
            <option>Out of scope for this change</option>
            <option>Already handled elsewhere</option>
            <option>Reviewer is wrong</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => onDismiss(reason)}>
            Dismiss with reason
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissing(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * The change page. One question answered first: can this land, and if not,
 * what is in the way. The same answer is what an agent reads from
 * `sx change view --json` or the MCP `get_change` tool.
 * ------------------------------------------------------------------------- */

type Tab = 'summary' | 'guide' | 'timeline' | 'code'

type TimelineEvent = {
  who: string
  kind: 'human' | 'agent' | 'bot'
  what: string
  when: string
}

const baseTimeline: Array<TimelineEvent> = [
  {
    who: 'dana',
    kind: 'human',
    what: 'pushed patch set 1',
    when: '3 days ago',
  },
  {
    who: 'coderabbit',
    kind: 'bot',
    what: 'left 1 medium finding (F-1)',
    when: '3 days ago',
  },
  {
    who: 'greptile',
    kind: 'bot',
    what: 'left 1 high finding (F-2): NegCache is unbounded',
    when: '3 days ago',
  },
  {
    who: 'hollis',
    kind: 'human',
    what: 'asked for a rename',
    when: '2 days ago',
  },
  {
    who: 'dana',
    kind: 'human',
    what: 'pushed patch set 2',
    when: '2 days ago',
  },
  {
    who: 'hollis',
    kind: 'human',
    what: 'approved patch set 2',
    when: '2 days ago',
  },
  {
    who: 'dana',
    kind: 'human',
    what: 'rebased onto main: patch set 3. The approval carried over because only one call was renamed.',
    when: 'yesterday',
  },
]

const guide = [
  {
    title: 'Start with the new type',
    body: 'NegCache remembers names that do not exist so repeat lookups skip the disk. Everything else depends on it.',
    file: 'src/refs.rs',
    lines: '1 to 4',
  },
  {
    title: 'Then the lookup',
    body: 'lookup() now checks the cache first and records a miss. This is where behaviour changes. Greptile’s high finding is on the line that stores the miss.',
    file: 'src/refs.rs',
    lines: '6 to 15',
  },
  {
    title: 'Finish with the test',
    body: 'One test asserts two misses cost one disk read. It does not yet cover eviction.',
    file: 'tests/refs_test.rs',
    lines: '38 to 46',
  },
]

function ChangeDetail({ repo, change }: { repo: Repo; change: ChangeItem }) {
  const latest = change.patchSets.length
  const [tab, setTab] = React.useState<Tab>('summary')
  const [ps, setPs] = React.useState(latest)
  const [compare, setCompare] = React.useState(false)
  const [style, setStyle] = React.useState<'split' | 'unified'>('unified')
  const [state, setState] = React.useState<Record<string, FindingState>>(() =>
    Object.fromEntries(findings.map((f) => [f.id, { s: 'open' } as const])),
  )
  const [ci, setCi] = React.useState<ChangeItem['ci']>(change.ci)
  const [landing, setLanding] = React.useState<'idle' | 'landing' | 'landed'>(
    change.state === 'landed' ? 'landed' : 'idle',
  )
  const [events, setEvents] = React.useState<Array<TimelineEvent>>([])
  const [agentView, setAgentView] = React.useState<'sx' | 'mcp'>('sx')

  React.useEffect(() => {
    if (change.ci !== 'pending') return
    const t = setTimeout(() => {
      setCi('pass')
      setEvents((e) => [
        ...e,
        {
          who: 'ci/test',
          kind: 'bot',
          what: 'passed on tree 9c4d7e1',
          when: 'just now',
        },
      ])
    }, 4000)
    return () => clearTimeout(t)
  }, [change.ci])

  const isMain = change.id === 'ch_7f3a'
  const list = isMain ? findings : []
  const openFindings = list.filter(
    (f) => state[f.id].s === 'open' || state[f.id].s === 'sending',
  )
  const highOpen = openFindings.filter((f) => f.severity === 'high')
  const approved = change.reviewers.filter((r) => r.state === 'approved')
  const parentWaiting = Boolean(change.stack && change.stack.index > 1)

  const items: Array<StatusItem> = [
    {
      id: 'checks',
      label:
        ci === 'pass'
          ? 'Checks passed'
          : ci === 'fail'
            ? 'Checks failed'
            : 'Checks are running',
      detail: `ci/test on tree ${change.patchSets.at(-1)?.tree ?? ''}, the tree that will land`,
      state: ci,
    },
    {
      id: 'approval',
      label:
        approved.length > 0
          ? `Approved by ${approved.map((a) => a.name).join(', ')}`
          : 'Needs one approval',
      detail:
        approved.length > 0
          ? '1 of 1 required. Carried over from patch set 2: only one call was renamed.'
          : 'A human from team:maintainers, because this touches src/.',
      state: approved.length > 0 ? 'pass' : 'pending',
    },
    {
      id: 'findings',
      label: highOpen.length
        ? `${highOpen.length} high finding to handle`
        : 'No blocking findings',
      detail: highOpen.length
        ? `${highOpen[0].by}: ${highOpen[0].title}`
        : openFindings.length
          ? `${openFindings.length} lower-severity finding${openFindings.length > 1 ? 's' : ''} left, none block landing.`
          : 'Reviewers have nothing open.',
      state: highOpen.length ? 'fail' : 'pass',
      goto: 'code',
    },
    ...(change.stack
      ? [
          {
            id: 'stack',
            label: parentWaiting
              ? 'Lands after ch_7f3a'
              : `Lands first in a stack of ${change.stack.of}`,
            detail: parentWaiting
              ? 'Changes in a stack land in order. This one waits for its parent.'
              : 'The other changes in the stack are rebased onto it and keep their approvals.',
            state: parentWaiting ? ('pending' as const) : ('pass' as const),
          },
        ]
      : []),
  ]
  const blockers = items.filter((i) => i.state !== 'pass')
  const canLand = blockers.length === 0 && change.state !== 'draft'

  const note =
    change.state === 'draft'
      ? 'This is a draft. Mark it ready first.'
      : blockers.length
        ? `${blockers.length} thing${blockers.length > 1 ? 's' : ''} in the way. Click a row to see it.`
        : 'Policy is satisfied. Children are rebased and keep their approvals.'

  const log = (e: TimelineEvent) => setEvents((x) => [...x, e])
  const set = (id: string, next: FindingState) =>
    setState((s) => ({ ...s, [id]: next }))
  const send = (id: string) => {
    set(id, { s: 'sending' })
    log({
      who: 'you',
      kind: 'human',
      what: `sent ${id} to an agent`,
      when: 'just now',
    })
    setTimeout(() => {
      set(id, { s: 'fixed', in: 'ch_81b2' })
      log({
        who: 'claude via T3 Code',
        kind: 'agent',
        what: `opened draft ch_81b2 to address ${id}`,
        when: 'just now',
      })
    }, 1400)
  }

  const asJson = JSON.stringify(
    {
      id: change.id,
      state: landing === 'landed' ? 'landed' : change.state,
      canLand,
      blockers: blockers.map((b) => ({ code: b.id, detail: b.label })),
      patchSets: latest,
    },
    null,
    2,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to="/$handle/$repo/$tab"
          params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          All changes
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">
              {change.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <AuthorMark author={change.author} />
                <span className="text-foreground">{change.author.name}</span>
              </span>
              <span>{change.when}</span>
              <span className="font-mono text-xs">{change.id}</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
                main ← {change.id === 'ch_7f3a' ? 'neg-cache' : 'topic'}
              </span>
              {change.stack && (
                <span>
                  {change.stack.index} of {change.stack.of} in a stack
                </span>
              )}
            </div>
          </div>
          <WorkWithAgent
            repo={slugOf(repo)}
            subject={{ kind: 'change', ref: change.id, title: change.title }}
            label="Continue with an agent"
          />
        </div>
      </div>

      <StateTabs
        label="Change"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'summary', label: 'Summary' },
          { id: 'guide', label: 'Guide' },
          {
            id: 'timeline',
            label: 'Timeline',
            count: baseTimeline.length + events.length,
          },
          { id: 'code', label: 'Code', count: change.files },
        ]}
      />

      {tab === 'summary' && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div className="min-w-0 space-y-6">
            <StatusCard
              items={items}
              landing={landing}
              canLand={canLand}
              changeId={change.id}
              note={note}
              onGoto={setTab}
              onLand={() => {
                setLanding('landing')
                setTimeout(() => {
                  setLanding('landed')
                  log({
                    who: 'you',
                    kind: 'human',
                    what: `landed ${change.id}`,
                    when: 'just now',
                  })
                }, 1100)
              }}
            />
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Description</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Remembers lookups for refs that do not exist, so asking again
                skips the disk. Added to{' '}
                <code className="font-mono text-xs">lookup()</code> in{' '}
                <code className="font-mono text-xs">src/refs.rs</code>, with a
                test that two misses cost one read. The next change in the stack
                bounds the cache.
              </p>
            </section>
          </div>

          <aside className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                The same status, for agents
              </h3>
              <Seg
                value={agentView}
                onChange={setAgentView}
                options={[
                  ['sx', 'CLI'],
                  ['mcp', 'MCP'],
                ]}
              />
            </div>
            <Panel className="space-y-3 p-4">
              <CopyField
                value={
                  agentView === 'sx'
                    ? `sx change view ${change.id} --json`
                    : `get_change { "id": "${change.id}" }`
                }
              />
              <pre className="well overflow-x-auto rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed">
                {asJson}
              </pre>
              <p className="text-xs text-muted-foreground">
                An agent reads this, fixes what is in the way, and pushes a new
                patch set. The id and the reviews survive.
              </p>
            </Panel>
          </aside>
        </div>
      )}

      {tab === 'guide' && (
        <div className="max-w-3xl space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              A reading order for this change, written by an agent from the diff
              and the findings. Follow it instead of reading files
              alphabetically.
            </p>
            <Button size="sm">Regenerate</Button>
          </div>
          <ol className="space-y-3">
            {guide.map((g, i) => (
              <li key={g.title}>
                <Panel className="flex gap-4 p-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="font-medium">{g.title}</div>
                    <p className="text-sm text-muted-foreground">{g.body}</p>
                    <button
                      type="button"
                      onClick={() => setTab('code')}
                      className="font-mono text-xs underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      {g.file}, lines {g.lines}
                    </button>
                  </div>
                </Panel>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === 'timeline' && (
        <ol className="max-w-3xl space-y-4">
          {[...baseTimeline, ...events].map((e, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              {e.kind === 'human' ? (
                <Tile
                  name={e.who}
                  round
                  className="mt-0.5 size-6 text-[10px]"
                />
              ) : (
                <span className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-muted">
                  {e.kind === 'agent' ? (
                    <CpuChipIcon className="size-3.5" />
                  ) : (
                    <MagnifyingGlassIcon className="size-3.5" />
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <b className="font-medium">{e.who}</b>{' '}
                <span className="text-muted-foreground">{e.what}</span>
                {e.kind !== 'human' && (
                  <Badge className="ml-2">
                    {e.kind === 'agent' ? 'agent' : 'reviewer'}
                  </Badge>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {e.when}
              </span>
            </li>
          ))}
        </ol>
      )}

      {tab === 'code' && (
        <CodeReview
          change={change}
          list={list}
          state={state}
          ps={ps}
          setPs={setPs}
          compare={compare}
          setCompare={setCompare}
          style={style}
          setStyle={setStyle}
          send={send}
          set={set}
        />
      )}
    </div>
  )
}

function CodeReview({
  change,
  list,
  state,
  ps,
  setPs,
  compare,
  setCompare,
  style,
  setStyle,
  send,
  set,
}: {
  change: ChangeItem
  list: Array<Finding>
  state: Record<string, FindingState>
  ps: number
  setPs: (n: number) => void
  compare: boolean
  setCompare: (b: boolean) => void
  style: 'split' | 'unified'
  setStyle: (s: 'split' | 'unified') => void
  send: (id: string) => void
  set: (id: string, s: FindingState) => void
}) {
  const dark = useIsDark()
  const latest = change.patchSets.length
  const files = ['src/refs.rs', 'tests/refs_test.rs']
  const { model } = useFileTree({
    paths: files,
    initialExpansion: 'open',
    gitStatus: files.map((path) => ({ path, status: 'modified' as const })),
    onSelectionChange: ([path]) => {
      if (path)
        document
          .getElementById(`file-${path}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })
  const annotations = (file: string) =>
    list
      .filter((f) => f.file === file)
      .map((f) => ({
        side: 'additions' as const,
        lineNumber: f.line,
        metadata: f,
      }))
  const patches: Array<[string, string]> = compare
    ? [['src/refs.rs', interdiffPatch]]
    : [
        ['src/refs.rs', refsPatch],
        ['tests/refs_test.rs', refsTestPatch],
      ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Seg
            value={String(ps)}
            onChange={(v) => {
              setPs(Number(v))
              setCompare(false)
            }}
            options={change.patchSets.map((p): [string, string] => [
              String(p.n),
              `Patch set ${p.n}`,
            ])}
          />
          {latest > 1 && (
            <label className="inline-flex items-center gap-2 text-sm">
              <Switch
                checked={compare}
                onCheckedChange={(v) => {
                  setCompare(v)
                  setPs(latest)
                }}
                aria-label="Only what changed since the last patch set"
              />
              Only what changed since patch set {latest - 1}
            </label>
          )}
        </div>
        <Seg
          value={style}
          onChange={setStyle}
          options={[
            ['unified', 'Unified'],
            ['split', 'Split'],
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="pierre surface h-fit overflow-hidden rounded-2xl border bg-card p-1 md:sticky md:top-20">
          <FileTree model={model} className="block h-36" />
        </div>
        <div className="min-w-0 space-y-4">
          {patches.map(([path, raw]) => (
            <div
              key={path}
              id={`file-${path}`}
              className="pierre surface scroll-mt-20 overflow-hidden rounded-2xl border bg-card"
            >
              <PatchDiff
                patch={raw}
                lineAnnotations={compare ? [] : annotations(path)}
                renderAnnotation={(a) => {
                  const f = a.metadata
                  return (
                    <FindingCard
                      f={f}
                      st={state[f.id] ?? { s: 'open' }}
                      onSend={() => send(f.id)}
                      onDismiss={(reason) =>
                        set(f.id, { s: 'dismissed', reason })
                      }
                      onResolve={() => set(f.id, { s: 'resolved' })}
                    />
                  )
                }}
                options={{
                  theme: dark ? 'pierre-dark' : 'pierre-light',
                  diffStyle: style,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ChangesPage({ repo, n }: { repo: Repo; n?: number }) {
  const change = n ? changes.at(n - 1) : undefined
  return (
    <>
      {change ? (
        <ChangeDetail key={change.id} repo={repo} change={change} />
      ) : (
        <ChangeList repo={repo} />
      )}
    </>
  )
}
