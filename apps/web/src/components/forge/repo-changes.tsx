import * as React from 'react'
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
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
import { ChangeDiscussion } from './change-comments'
import { EvidenceSection, TestReport } from './evidence'
import { slugOf } from './repo-shell'
import { StateIcon, StatusCard } from './status-card'
import { WorkWithAgent } from './work-with-agent'
import type { TimelineEvent } from './change-timeline'
import type { StatusItem } from './status-card'
import type { Repo } from '~/lib/model/data'
import type { Change } from '@source-code/sdk'
import type {
  Author,
  ChangeItem,
  FileVersions,
  Finding,
  PatchSet,
} from '~/lib/model/platform'
import { hostName, hostTerms } from '~/lib/change-sync'
import { codeTheme, useCodeOverflow } from '~/lib/highlight'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { StateTabs } from '~/components/ui/tabs'
import { Select, SelectItem } from '~/components/ui/select'
import { useIsDark } from '~/lib/theme'
import { opQuery, useOp, useWrite } from '~/lib/forge'
import {
  timelineOf,
  toChangeItem,
  toFinding,
  toMedia,
  toTestRun,
  toVersions,
} from '~/lib/change'
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
  if (c.state === 'abandoned')
    return { tone: 'muted', text: 'Abandoned' } as const
  if (c.blocking)
    return {
      tone: 'danger',
      text: `Blocked: ${c.blocking} requirement${c.blocking > 1 ? 's' : ''}`,
    } as const
  if (c.reviewers.some((r) => r.state === 'changes'))
    return { tone: 'warning', text: 'Changes requested' } as const
  return { tone: 'success', text: 'Ready to land' } as const
}

function Row({ c, repo }: { c: ChangeItem; repo: Repo }) {
  const s = standing(c)
  const latest = c.patchSets.at(-1)
  return (
    <li className="relative">
      <Link
        to="/$handle/$repo/$tab"
        params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
        search={{ n: Number(c.id) }}
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
  const all = useOp('changes.list', {
    owner: repo.owner,
    repo: repo.name,
    state: 'all',
    limit: 100,
  }).data.map((c) => toChangeItem(c))
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
              <Row c={c} repo={repo} />
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

type Tab = 'summary' | 'discussion' | 'timeline' | 'code'

/** A short stand-in for a tree id, from the text itself. */
function treeOf(text: string) {
  let h = 5381
  for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0
  return h.toString(16).padStart(7, '0').slice(-7)
}

/** Everything the change page reads, loaded before it draws. */
function ChangeLoader({ repo, n }: { repo: Repo; n: number }) {
  const at = { owner: repo.owner, repo: repo.name, number: String(n) }
  const api = useOp('changes.get', { ...at, expand: 'findings,check_runs' })
  const sets = useOp('patch_sets.list', at).data
  const files = useSuspenseQueries({
    queries: sets.map((p) =>
      opQuery('patch_sets.files', { ...at, patchSet: p.number }),
    ),
  }).map((q) => q.data)
  const evidence = useSuspenseQuery(opQuery('evidence.list', at)).data.data
  const all = useOp('changes.list', {
    owner: repo.owner,
    repo: repo.name,
    state: 'all',
    limit: 100,
  }).data
  const humans = new Set(
    api.reviewers
      .filter((r) => r.actor.class === 'human')
      .map((r) => r.actor.handle),
  )
  const findingsApi = api.findings ?? []
  return (
    <ChangeDetail
      key={`${api.number}.${api.version}`}
      repo={repo}
      api={api}
      change={toChangeItem(api, sets)}
      all={all.map((c) => toChangeItem(c))}
      history={toVersions(files)}
      editable={files.at(-1)?.available ?? false}
      list={findingsApi.map((f) => toFinding(f, humans))}
      initial={Object.fromEntries(
        findingsApi.map((f) => [
          f.label,
          f.state === 'resolved'
            ? ({ s: 'resolved' } as const)
            : f.state === 'dismissed'
              ? ({ s: 'dismissed', reason: f.reason ?? '' } as const)
              : ({ s: 'open' } as const),
        ]),
      )}
      testRun={toTestRun(api.check_runs ?? [])}
      media={toMedia(evidence)}
      events={timelineOf(api, sets, findingsApi, api.check_runs ?? [])}
    />
  )
}

function ChangeDetail({
  repo,
  api,
  change,
  all: stack,
  history,
  editable,
  list,
  initial,
  testRun,
  media,
  events: past,
}: {
  repo: Repo
  api: Change
  change: ChangeItem
  all: Array<ChangeItem>
  history: { base: FileVersions; versions: Array<FileVersions> }
  editable: boolean
  list: Array<Finding>
  initial: Record<string, FindingState>
  testRun: ReturnType<typeof toTestRun>
  media: ReturnType<typeof toMedia>
  events: Array<TimelineEvent>
}) {
  const write = useWrite()
  const at = { owner: repo.owner, repo: repo.name, number: String(api.number) }
  // Edits on top of the newest patch set, not shared until they are saved.
  const [draft, setDraft] = React.useState<FileVersions>({})
  const patchSets = change.patchSets
  const latest = patchSets.length
  const saved = history.versions
  const working: FileVersions = { ...saved[latest - 1], ...draft }
  const [tab, setTab] = React.useState<Tab>('summary')
  const [ps, setPs] = React.useState(latest)
  const [compare, setCompare] = React.useState(false)
  const [style, setStyle] = React.useState<'split' | 'unified'>('unified')
  const [state, setState] =
    React.useState<Record<string, FindingState>>(initial)
  const [error, setError] = React.useState('')
  const ci = change.ci
  const [landing, setLanding] = React.useState<'idle' | 'landing' | 'landed'>(
    change.state === 'landed' ? 'landed' : 'idle',
  )
  const [events, setEvents] = React.useState<Array<TimelineEvent>>([])

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
  const approved = api.reviewers
    .filter((r) => r.state === 'approved' && r.carries_to_head)
    .map((r) => ({ name: r.actor.handle }))
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
          ? 'Counts for the newest patch set.'
          : 'From a maintainer of this repository.',
      state: approved.length > 0 ? 'pass' : 'pending',
    },
    {
      id: 'findings',
      label: highOpen.length
        ? `${highOpen.length} high finding${highOpen.length === 1 ? '' : 's'} to handle`
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
              ? `Lands after #${api.stack?.parent ?? ''}`
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
  const fail = (r: { error: { message: string } | null }) => {
    if (r.error) setError(r.error.message)
    return !r.error
  }
  // Resolving and dismissing are the API's; the rest is this page's state.
  const set = (id: string, next: FindingState) => {
    setState((s) => ({ ...s, [id]: next }))
    if (next.s === 'resolved')
      void write('findings.resolve', { ...at, finding: id }).then(fail)
    if (next.s === 'dismissed')
      void write('findings.dismiss', {
        ...at,
        finding: id,
        body: { reason: next.reason },
      }).then(fail)
  }
  const send = (id: string) => {
    const f = list.find((x) => x.id === id)
    set(id, { s: 'sending' })
    void write('runs.start', {
      owner: repo.owner,
      repo: repo.name,
      body: {
        task: (f?.prompt ?? `Address ${id}: ${f?.title ?? ''}`).slice(0, 500),
        change: api.number,
      },
    }).then((r) => {
      if (!fail(r)) return set(id, { s: 'open' })
      log({
        kind: 'agent',
        who: 'you',
        actor: 'human',
        what: `sent ${id} to an agent`,
        detail: 'A run started with this finding as its task.',
        hoursAgo: 0,
      })
    })
  }

  const apply = (id: string) => {
    const f = list.find((x) => x.id === id)
    const sug = f?.suggestion
    if (!sug) return
    const r = applySuggestion(working[sug.file] ?? '', sug)
    if (!r.ok) return
    setDraft((d) => ({ ...d, [sug.file]: r.contents }))
    setState((s) => ({ ...s, [id]: { s: 'applied' } }))
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
  const saveDraft = async () => {
    const ids = Object.entries(state)
      .filter(([, v]) => v.s === 'applied' && v.ps === undefined)
      .map(([k]) => k)
    const summary = ids.length
      ? `Applied ${ids.join(', ')}`
      : 'Edited in the browser'
    const r = await write('patch_sets.create', {
      ...at,
      body: { files: draft, note: summary },
    })
    if (!fail(r)) return
    // The findings the edit applied are done: say so where everyone sees it.
    for (const id of ids)
      await write('findings.resolve', { ...at, finding: id }).then(fail)
  }
  const anchors = React.useMemo(
    () =>
      Object.fromEntries(
        list.map((f) => [
          f.id,
          (history.versions.at(-1)?.[f.file] ?? '').split('\n')[f.line - 1] ??
            '',
        ]),
      ),
    [history, list],
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
                {api.base} ← {api.branch}
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
          { id: 'discussion', label: 'Discussion' },
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
                void write('changes.land', {
                  ...at,
                  body: { expected_tree: api.head.tree },
                }).then((r) => {
                  if (!fail(r)) return setLanding('idle')
                  setLanding('landed')
                  log({
                    kind: 'land',
                    who: 'you',
                    actor: 'human',
                    what: `landed #${change.id}`,
                    hoursAgo: 0,
                    tone: 'success',
                  })
                })
              }}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <StackCard repo={repo} change={change} all={stack} />
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Description</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {api.description || 'No description.'}
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
          </div>

          <aside className="space-y-3">
            <h3 className="text-sm font-medium">On other hosts</h3>
            <MirrorCard repo={repo} change={change} />
          </aside>
        </div>
      )}

      {tab === 'discussion' && (
        <React.Suspense fallback={null}>
          <ChangeDiscussion
            at={at}
            files={saved[latest - 1] ?? {}}
            latest={latest}
          />
        </React.Suspense>
      )}

      {tab === 'timeline' && (
        <Timeline
          events={past}
          live={events}
          onOpenPatchSet={(n, sinceLast) => {
            setPs(n)
            setCompare(sinceLast)
            setTab('code')
          }}
        />
      )}

      {tab === 'code' && Object.keys(history.base).length === 0 && (
        <EmptyState title="No files to show">
          This change came without its files, so its diff cannot be drawn here
          yet. Fetch its branch to read it.
        </EmptyState>
      )}
      {tab === 'code' && Object.keys(history.base).length > 0 && (
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
          onSave={() => void saveDraft()}
          editable={editable}
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
  editable,
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
  /** False when the change came without its files: there is nothing to edit. */
  editable: boolean
}) {
  const dark = useIsDark()
  const overflow = useCodeOverflow()
  const latest = patchSets.length
  const names = Object.keys(base)
  const [editing, setEditing] = React.useState(false)
  const factory = useEditorFactory(editing)
  const canEdit = editable && ps === latest && !compare
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
  return n ? (
    <ChangeLoader key={n} repo={repo} n={n} />
  ) : (
    <ChangeList repo={repo} />
  )
}
