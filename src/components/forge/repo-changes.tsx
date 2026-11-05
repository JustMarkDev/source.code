import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { MultiFileDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  CheckIcon,
  ClipboardDocumentIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Chip, EmptyState, Panel, Seg, Tile } from './bits'
import { MirrorCard, StackCard } from './change-mirror'
import { EditingProvider, useEditorFactory } from './diff-editing'
import { Timeline } from './change-timeline'
import { EvidenceSection, TestReport } from './evidence'
import { slugOf } from './repo-shell'
import { StateIcon, StatusCard } from './status-card'
import { WorkWithAgent } from './work-with-agent'
import type { TimelineEvent } from './change-timeline'
import type { StatusItem } from './status-card'
import type { Repo } from '~/mock/data'
import type {
  Author,
  ChangeItem,
  FileVersions,
  Finding,
  PatchSet,
} from '~/mock/platform'
import { branchFor, hostName, hostTerms } from '~/lib/change-sync'
import { mediaForChange, testRunFor } from '~/mock/evidence'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { StateTabs } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'
import { useIsDark } from '~/lib/theme'
import { changeVersions, changesFor, findings } from '~/mock/platform'
import { applySuggestion, canApply, lineOf } from '~/lib/suggestions'

function AuthorMark({ author }: { author: Author }) {
  if (author.kind === 'human')
    return <Tile name={author.name} round className="size-6 text-xs" />
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
        <Tile name={r.name} round className="size-6 text-xs" />
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
  if (c.id === '216')
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
            {c.mirror && (
              <Chip>
                {hostName[c.mirror.host]}{' '}
                {hostTerms[c.mirror.host].ref(c.mirror.number)}
              </Chip>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">#{c.id}</span>
            {c.stack && (
              <span>
                {c.stack.index} of {c.stack.of} in the stack
              </span>
            )}
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
  const all = changesFor(repo)
  const rows = all.filter(show)
  if (all.length === 0)
    return (
      <EmptyState title="No changes yet">
        Push a branch and run{' '}
        <code className="font-mono text-xs">sx change create</code> to open one.
        With a two-way mirror, a pull request opened on another host shows up
        here as a change too.
      </EmptyState>
    )
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
          {rows.map((c, i) => (
            <React.Fragment key={c.id}>
              {c.stack && !rows.slice(0, i).some((r) => r.stack) && (
                <li className="bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  <b className="font-medium text-foreground">
                    Stack of {c.stack.of}
                  </b>{' '}
                  · lands in order, bottom first
                </li>
              )}
              <Row c={c} repo={repo} index={all.indexOf(c)} />
            </React.Fragment>
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
  /** A reviewer's suggestion, applied. Without a patch set it is only in the draft. */
  | { s: 'applied'; ps?: number }

const sevTone = { high: 'danger', medium: 'warning', low: 'muted' } as const

/** The proposed change as a small diff: what goes, what comes. */
function SuggestedChange({ f }: { f: Finding }) {
  const s = f.suggestion
  if (!s) return null
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        Suggested change: {s.summary}
      </div>
      <pre className="overflow-x-auto py-1 font-mono text-xs leading-relaxed">
        {s.replace.length === 0 && s.after && (
          <div className="px-3 text-muted-foreground">{`  ${s.after}`}</div>
        )}
        {s.replace.map((l, i) => (
          <div
            key={`d${i}`}
            className="bg-danger/10 px-3 text-danger"
          >{`- ${l}`}</div>
        ))}
        {s.lines.map((l, i) => (
          <div
            key={`a${i}`}
            className="bg-success/10 px-3 text-success"
          >{`+ ${l}`}</div>
        ))}
      </pre>
    </div>
  )
}

function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <details className="group rounded-lg border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground marker:hidden [&::-webkit-details-marker]:hidden">
        <CpuChipIcon className="size-3.5" />
        Prompt for an agent
        <span className="ml-auto transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2">
        <p className="text-xs leading-relaxed">{prompt}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <CheckIcon /> : <ClipboardDocumentIcon />}
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </div>
    </details>
  )
}

function FindingCard({
  f,
  st,
  applicable,
  onSend,
  onApply,
  onDismiss,
  onResolve,
}: {
  f: Finding
  st: FindingState
  /** Whether the suggestion still fits the code as it is now. */
  applicable: boolean
  onSend: () => void
  onApply: () => void
  onDismiss: (reason: string) => void
  onResolve: () => void
}) {
  const [dismissing, setDismissing] = React.useState(false)
  const [reason, setReason] = React.useState('Not a problem here')
  const closed =
    st.s === 'dismissed' ||
    st.s === 'resolved' ||
    st.s === 'fixed' ||
    (st.s === 'applied' && st.ps !== undefined)
  return (
    <div
      className={cn(
        'm-2 space-y-2 rounded-lg border bg-card p-3 font-sans text-sm',
        closed && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {f.kind === 'human' ? (
          <Tile name={f.by} round className="size-6 text-xs" />
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
      {(st.s === 'open' || st.s === 'sending') && <SuggestedChange f={f} />}
      {(st.s === 'open' || st.s === 'sending') && f.prompt && (
        <CopyPrompt prompt={f.prompt} />
      )}
      {st.s === 'applied' && (
        <Chip tone={st.ps ? 'success' : 'warning'}>
          <CheckIcon className="size-3" />
          {st.ps
            ? `Applied in patch set ${st.ps}`
            : 'Applied to your draft. Save it as a patch set to share it.'}
        </Chip>
      )}
      {st.s === 'open' && f.suggestion && !applicable && (
        <p className="text-xs text-muted-foreground">
          The code this points at has changed, so the suggestion no longer fits.
          Send it to an agent instead.
        </p>
      )}
      {st.s === 'fixed' && (
        <Chip tone="success">
          <CheckIcon className="size-3" />
          Addressed in #{st.in}
        </Chip>
      )}
      {st.s === 'dismissed' && <Chip>Dismissed: {st.reason}</Chip>}
      {st.s === 'resolved' && <Chip tone="success">Resolved</Chip>}
      {st.s === 'sending' && <Chip tone="warning">Agent is writing a fix</Chip>}
      {st.s === 'open' && !dismissing && (
        <div className="flex flex-wrap gap-2">
          {f.suggestion && (
            <Button
              size="sm"
              variant="brand"
              disabled={!applicable}
              onClick={onApply}
            >
              <CheckIcon className="size-3.5" />
              Accept suggestion
            </Button>
          )}
          {f.kind === 'reviewer' && (
            <Button
              size="sm"
              variant={f.suggestion ? 'outline' : 'brand'}
              onClick={onSend}
            >
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
          <Select
            aria-label="Reason"
            value={reason}
            onValueChange={(v) => setReason(v)}
            className="h-8 w-auto text-xs"
          >
            <SelectItem>Not a problem here</SelectItem>
            <SelectItem>Out of scope for this change</SelectItem>
            <SelectItem>Already handled elsewhere</SelectItem>
            <SelectItem>Reviewer is wrong</SelectItem>
          </Select>
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

type Tab = 'summary' | 'timeline' | 'code'

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

/** A short stand-in for a tree id, from the text itself. */
function treeOf(text: string) {
  let h = 5381
  for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0
  return h.toString(16).padStart(7, '0').slice(-7)
}

function ChangeDetail({ repo, change }: { repo: Repo; change: ChangeItem }) {
  const history = React.useMemo(
    () => changeVersions(change.id, change.patchSets.length),
    [change],
  )
  // Patch sets saved from the browser join the ones the change came with.
  const [added, setAdded] = React.useState<
    Array<{ patchSet: PatchSet; files: FileVersions }>
  >([])
  // Edits on top of the newest patch set, not shared until they are saved.
  const [draft, setDraft] = React.useState<FileVersions>({})
  const patchSets = [...change.patchSets, ...added.map((a) => a.patchSet)]
  const latest = patchSets.length
  const saved = [...history.versions, ...added.map((a) => a.files)]
  const working: FileVersions = { ...saved[latest - 1], ...draft }
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

  React.useEffect(() => {
    if (change.ci !== 'pending') return
    const t = setTimeout(() => {
      setCi('pass')
      setEvents((e) => [
        ...e,
        {
          kind: 'ci',
          who: 'ci/test',
          actor: 'bot',
          what: 'passed on tree 9c4d7e1',
          hoursAgo: 0,
          tone: 'success',
        },
      ])
    }, 4000)
    return () => clearTimeout(t)
  }, [change.ci])

  const isMain = change.id === '216'
  const media = mediaForChange(change.id)
  const testRun = testRunFor(change.id)
  const list = isMain ? findings : []
  // A suggestion applied only to the draft has not fixed anything yet.
  const openFindings = list.filter((f) => {
    const st = state[f.id]
    return (
      st.s === 'open' ||
      st.s === 'sending' ||
      (st.s === 'applied' && st.ps === undefined)
    )
  })
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
      detail: `ci/test on tree ${patchSets.at(-1)?.tree ?? ''}, the tree that will land`,
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
              ? 'Lands after #216'
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
      kind: 'finding',
      who: 'you',
      actor: 'human',
      what: `sent ${id} to an agent`,
      hoursAgo: 0,
    })
    setTimeout(() => {
      set(id, { s: 'fixed', in: '217' })
      log({
        kind: 'agent',
        who: 'claude via T3 Code',
        actor: 'agent',
        what: `opened draft #217 to address ${id}`,
        hoursAgo: 0,
      })
    }, 1400)
  }

  const apply = (id: string) => {
    const f = findings.find((x) => x.id === id)
    const sug = f?.suggestion
    if (!sug) return
    const r = applySuggestion(working[sug.file] ?? '', sug)
    if (!r.ok) return
    setDraft((d) => ({ ...d, [sug.file]: r.contents }))
    set(id, { s: 'applied' })
    setPs(latest)
    setCompare(false)
  }
  const edited = (file: string, contents: string) =>
    setDraft((d) => ({ ...d, [file]: contents }))
  const discard = () => {
    setDraft({})
    setState((all) =>
      Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          v.s === 'applied' && v.ps === undefined ? { s: 'open' } : v,
        ]),
      ),
    )
  }
  const saveDraft = () => {
    const n = latest + 1
    const ids = Object.entries(state)
      .filter(([, v]) => v.s === 'applied' && v.ps === undefined)
      .map(([k]) => k)
    const summary = ids.length
      ? `Applied ${ids.join(', ')}`
      : 'Edited in the browser'
    const tree = treeOf(Object.values(working).join('\n'))
    setAdded((a) => [
      ...a,
      {
        patchSet: { n, when: 'just now', note: summary, tree },
        files: working,
      },
    ])
    setDraft({})
    setState((all) =>
      Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          v.s === 'applied' && v.ps === undefined ? { s: 'applied', ps: n } : v,
        ]),
      ),
    )
    setPs(n)
    setCompare(false)
    setCi('pending')
    log({
      kind: 'patchset',
      who: 'you',
      actor: 'human',
      what: `pushed patch set ${n}`,
      detail: summary,
      hoursAgo: 0,
      patchSet: n,
    })
    if (change.mirror)
      log({
        kind: 'mirror',
        who: 'source.code',
        actor: 'bot',
        what: `updated ${hostName[change.mirror.host]} ${hostTerms[change.mirror.host].ref(change.mirror.number)}`,
        detail: `Pushed to ${branchFor(Number(change.id), change.title)}`,
        hoursAgo: 0,
      })
    setTimeout(() => {
      setCi('pass')
      log({
        kind: 'ci',
        who: 'ci/test',
        actor: 'bot',
        what: `passed on tree ${tree}`,
        hoursAgo: 0,
        tone: 'success',
      })
    }, 3500)
  }
  const anchors = React.useMemo(
    () =>
      Object.fromEntries(
        findings.map((f) => [
          f.id,
          (history.versions.at(-1)?.[f.file] ?? '').split('\n')[f.line - 1] ??
            '',
        ]),
      ),
    [history],
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
              <span className="font-mono text-xs">#{change.id}</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
                main ← {change.id === '216' ? 'neg-cache' : 'topic'}
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
          { id: 'timeline', label: 'Timeline' },
          { id: 'code', label: 'Code', count: change.files },
        ]}
      />

      {tab === 'summary' && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
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
                    kind: 'land',
                    who: 'you',
                    actor: 'human',
                    what: `landed #${change.id}`,
                    hoursAgo: 0,
                    tone: 'success',
                  })
                }, 1100)
              }}
            />
            <StackCard repo={repo} change={change} all={changesFor(repo)} />
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
            {media.length > 0 ? (
              <EvidenceSection items={media} />
            ) : (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">
                  What changed, to look at
                </h3>
                <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                  No images or recordings yet. An agent or a test can attach a
                  before and after, or add them to the description.
                </p>
              </section>
            )}
            {testRun && <TestReport run={testRun} />}
            {isMain && (
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium">Where to start</h3>
                    <p className="text-sm text-muted-foreground">
                      A reading order written by an agent from the diff and the
                      findings.
                    </p>
                  </div>
                  <Button size="sm">Regenerate</Button>
                </div>
                <ol className="space-y-2">
                  {guide.map((g, i) => (
                    <li key={g.title} className="flex gap-3 text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                        {i + 1}
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-medium">{g.title}</div>
                        <p className="text-muted-foreground">{g.body}</p>
                        <button
                          type="button"
                          onClick={() => setTab('code')}
                          className="py-0.5 font-mono text-xs underline decoration-border underline-offset-4 hover:decoration-foreground"
                        >
                          {g.file}, lines {g.lines}
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <aside className="space-y-3">
            <h3 className="text-sm font-medium">On other hosts</h3>
            <MirrorCard repo={repo} change={change} />
          </aside>
        </div>
      )}

      {tab === 'timeline' && (
        <Timeline
          change={change}
          live={events}
          onOpenPatchSet={(n, sinceLast) => {
            setPs(n)
            setCompare(sinceLast)
            setTab('code')
          }}
        />
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
          patchSets={patchSets}
          base={history.base}
          saved={saved}
          working={working}
          draftCount={Object.keys(draft).length}
          anchors={anchors}
          onApply={apply}
          onEdited={edited}
          onSave={saveDraft}
          onDiscard={discard}
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
  patchSets,
  base,
  saved,
  working,
  draftCount,
  anchors,
  onApply,
  onEdited,
  onSave,
  onDiscard,
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
  patchSets: Array<PatchSet>
  base: FileVersions
  saved: Array<FileVersions>
  working: FileVersions
  draftCount: number
  anchors: Record<string, string>
  onApply: (id: string) => void
  onEdited: (file: string, contents: string) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const latest = patchSets.length
  const names = Object.keys(base)
  const [editing, setEditing] = React.useState(false)
  const factory = useEditorFactory(editing)
  const canEdit = ps === latest && !compare
  React.useEffect(() => {
    if (!canEdit) setEditing(false)
  }, [canEdit])
  const { model } = useFileTree({
    paths: names,
    initialExpansion: 'open',
    gitStatus: names.map((path) => ({ path, status: 'modified' as const })),
    onSelectionChange: ([path]) => {
      if (path)
        document
          .getElementById(`file-${path}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })

  const contentsAt = (n: number) => (n === latest ? working : saved[n - 1])
  const sets = names
    .map((name) => ({
      name,
      before: compare && ps > 1 ? contentsAt(ps - 1)[name] : base[name],
      after: contentsAt(ps)[name],
    }))
    .filter((f) => !compare || f.before !== f.after)

  // Findings sit on the newest patch set. Older ones show the code as it was.
  const showFindings = !compare && ps === latest
  const lineFor = (f: Finding, contents: string) => {
    const there = lineOf(contents, anchors[f.id] ?? '', -1)
    if (there > 0) return there
    const first = f.suggestion?.lines[0]
    return first ? lineOf(contents, first, f.line) : f.line
  }
  const annotations = (file: string, contents: string) =>
    list
      .filter((f) => f.file === file)
      .map((f) => ({
        side: 'additions' as const,
        lineNumber: lineFor(f, contents),
        metadata: f,
      }))
  const current = patchSets.find((p) => p.n === ps)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Seg
            value={String(ps)}
            onChange={(v) => {
              const n = Number(v)
              setPs(n)
              if (n === 1) setCompare(false)
            }}
            options={patchSets.map((p): [string, string] => [
              String(p.n),
              `Patch set ${p.n}`,
            ])}
          />
          {latest > 1 && (
            <label
              className={cn(
                'inline-flex items-center gap-2 text-sm',
                ps === 1 && 'text-muted-foreground',
              )}
            >
              <Switch
                checked={compare && ps > 1}
                disabled={ps === 1}
                onCheckedChange={setCompare}
                aria-label="Only what changed since the previous patch set"
              />
              {ps === 1
                ? 'Patch set 1 has nothing before it'
                : `Only what changed since patch set ${ps - 1}`}
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={editing ? 'brand' : 'outline'}
            disabled={!canEdit}
            title={canEdit ? undefined : 'Open the newest patch set to edit it'}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? <CheckIcon /> : <PencilSquareIcon />}
            {editing ? 'Done editing' : 'Edit'}
          </Button>
          <Seg
            value={style}
            onChange={setStyle}
            options={[
              ['unified', 'Unified'],
              ['split', 'Split'],
            ]}
          />
        </div>
      </div>

      {editing && (
        <p className="rounded-xl border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          Click into the new version and type. Undo with ⌘Z or Ctrl+Z. Nothing
          is shared until you save it as a patch set.
        </p>
      )}
      {draftCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          <span className="mr-auto">
            You have unsaved edits in {draftCount} file
            {draftCount > 1 ? 's' : ''}. They are not part of the change yet.
          </span>
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" variant="brand" disabled={editing} onClick={onSave}>
            {editing
              ? 'Finish editing first'
              : `Save as patch set ${latest + 1}`}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="pierre surface h-fit overflow-hidden rounded-2xl border bg-card p-1 md:sticky md:top-20">
          <FileTree model={model} className="block h-36" />
        </div>
        <div className="min-w-0 space-y-4">
          {current && (
            <p className="text-sm text-muted-foreground">
              <b className="font-medium text-foreground">
                Patch set {current.n}
              </b>
              {compare && ps > 1 && ` against patch set ${ps - 1}`}
              {': '}
              {current.note}
              <span className="ml-2 font-mono text-xs">{current.tree}</span>
              <span className="ml-2 text-xs">{current.when}</span>
              {!showFindings && !compare && (
                <span className="block text-xs">
                  Findings are shown on the newest patch set.
                </span>
              )}
            </p>
          )}
          <EditingProvider factory={factory}>
            {sets.map(({ name, before, after }) => (
              <div
                key={`${ps}-${compare}-${name}`}
                id={`file-${name}`}
                className="pierre surface scroll-mt-20 overflow-hidden rounded-2xl border bg-card"
              >
                <MultiFileDiff
                  oldFile={{
                    name,
                    contents: before,
                    cacheKey: `${change.id}:${ps}:${compare}:old:${name}:${treeOf(before)}`,
                  }}
                  newFile={{
                    name,
                    contents: after,
                    cacheKey: `${change.id}:${ps}:${compare}:new:${name}:${treeOf(after)}`,
                  }}
                  lineAnnotations={showFindings ? annotations(name, after) : []}
                  renderAnnotation={(a) => {
                    const f = a.metadata
                    const sug = f.suggestion
                    return (
                      <FindingCard
                        f={f}
                        st={state[f.id] ?? { s: 'open' }}
                        applicable={
                          sug ? canApply(working[sug.file] ?? '', sug) : false
                        }
                        onSend={() => send(f.id)}
                        onApply={() => {
                          setEditing(false)
                          onApply(f.id)
                        }}
                        onDismiss={(reason) =>
                          set(f.id, { s: 'dismissed', reason })
                        }
                        onResolve={() => set(f.id, { s: 'resolved' })}
                      />
                    )
                  }}
                  edit={editing && canEdit && Boolean(factory)}
                  editStateKey={`${change.id}:${name}`}
                  onEditComplete={(e) => {
                    if (e.newFile && e.newFile.contents !== after)
                      onEdited(name, e.newFile.contents)
                    return 'accept'
                  }}
                  options={{
                    theme: codeTheme(dark),
                    overflow,
                    diffStyle: style,
                  }}
                />
              </div>
            ))}
            {sets.length === 0 && (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing changed between these two patch sets.
              </p>
            )}
          </EditingProvider>
        </div>
      </div>
    </div>
  )
}

export function ChangesPage({ repo, n }: { repo: Repo; n?: number }) {
  const change = n ? changesFor(repo).at(n - 1) : undefined
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
