import * as React from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { ChatBubbleLeftIcon, WrenchIcon } from '@heroicons/react/24/outline'
import { Chip, EmptyState, Panel } from './bits'
import type { ChangeComment } from '@source-code/sdk'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { Textarea } from '~/components/ui/input'
import { useOp, useOpMaybe, useWrite } from '~/lib/forge'
import { codeTheme } from '~/lib/highlight'
import { useIsDark } from '~/lib/theme'
import { timeAgo } from '~/lib/repo'

type At = { owner: string; repo: string; number: string }

/** Comments grouped into threads: the one that starts it, then its replies. */
function threadsOf(all: Array<ChangeComment>) {
  const starts = all.filter((c) => c.reply_to === null)
  return starts.map((s) => ({
    start: s,
    replies: all.filter((c) => c.reply_to === s.id),
  }))
}

const whereOf = (c: ChangeComment) =>
  c.file === null
    ? 'The whole change'
    : c.line === null
      ? c.file
      : `${c.file}:${c.current_line ?? c.line}`

/**
 * The code a thread is about. Where it is now, when the code is still there;
 * when it is gone, the code as it was written on, with the newest patch set
 * near the same place a toggle away.
 */
function ThreadCode({
  start,
  files,
  latest,
}: {
  start: ChangeComment
  files: Record<string, string>
  latest: number
}) {
  const [showLatest, setShowLatest] = React.useState(false)
  if (start.file === null || start.line === null) return null
  const now = (files[start.file] ?? '').split('\n')
  const pre = (lines: Array<string>, mark?: number) => (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
      {lines.map((l, i) => (
        <div
          key={i}
          className={i === mark ? 'text-foreground' : 'text-muted-foreground'}
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  )
  if (!start.outdated) {
    const at = start.current_line
    if (at === null) return null
    return pre([now[at - 1] ?? ''], 0)
  }
  const a = start.anchor
  const near = Math.max(1, start.line - 3)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {showLatest
            ? `Patch set ${latest}, near line ${start.line}`
            : `As written on patch set ${start.patch_set}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={() => setShowLatest((v) => !v)}
        >
          {showLatest ? 'View as written' : 'View latest'}
        </Button>
      </div>
      {showLatest
        ? pre(now.slice(near - 1, near + 6))
        : a
          ? pre(
              [...a.before, ...a.quote.split('\n'), ...a.after],
              a.before.length,
            )
          : null}
    </div>
  )
}

/**
 * What the fix changed, for this thread only: its file, from the patch set
 * the comment was written on to the one that addressed it.
 */
function FixDiff({
  at,
  file,
  from,
  to,
}: {
  at: At
  file: string
  from: number
  to: number
}) {
  const dark = useIsDark()
  const before = useOpMaybe('patch_sets.files', { ...at, patchSet: from })
  const after = useOpMaybe('patch_sets.files', { ...at, patchSet: to })
  if (before === undefined || after === undefined)
    return <p className="text-xs text-muted-foreground">Loading the fix…</p>
  const a = before?.files.find((f) => f.path === file)?.content ?? null
  const b = after?.files.find((f) => f.path === file)?.content ?? null
  if (!before?.available || !after?.available)
    return (
      <p className="text-xs text-muted-foreground">
        These patch sets came without their files, so the fix cannot be shown
        here.
      </p>
    )
  return (
    <div className="pierre overflow-hidden rounded-md border">
      <MultiFileDiff
        oldFile={{ name: file, contents: a ?? '' }}
        newFile={{ name: file, contents: b ?? '' }}
        options={{ theme: codeTheme(dark), diffStyle: 'unified' }}
      />
    </div>
  )
}

function Thread({
  at,
  start,
  replies,
  files,
  latest,
}: {
  at: At
  start: ChangeComment
  replies: Array<ChangeComment>
  files: Record<string, string>
  latest: number
}) {
  const write = useWrite()
  const [reply, setReply] = React.useState('')
  const [error, setError] = React.useState('')
  const [fix, setFix] = React.useState(false)
  const addressed = start.addressed
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{whereOf(start)}</span>
        <span>
          {start.patch_set === latest || start.line === null
            ? `on patch set ${start.patch_set}`
            : `written on patch set ${start.patch_set}, line ${start.line}`}
        </span>
        {start.outdated && <Chip tone="muted">Outdated</Chip>}
        {addressed && (
          <button
            type="button"
            onClick={() => setFix((v) => !v)}
            aria-expanded={fix}
            className="inline-flex items-center gap-1 rounded-md bg-info/12 px-1.5 py-0.5 font-medium text-info hover:bg-info/20"
          >
            <WrenchIcon className="size-3" />
            Addressed in patch set {addressed.patch_set}
          </button>
        )}
        {start.resolved ? (
          <Chip tone="success">Resolved</Chip>
        ) : (
          <Chip tone="warning">Open</Chip>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            void write('change_comments.update', {
              ...at,
              comment: start.id,
              body: { resolved: !start.resolved },
            }).then((r) => setError(r.error?.message ?? ''))
          }
        >
          {start.resolved ? 'Reopen' : 'Resolve'}
        </Button>
      </div>
      <ThreadCode start={start} files={files} latest={latest} />
      {addressed && fix && start.file !== null && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {addressed.by.handle}: {addressed.note || 'no note'}. What changed
            in {start.file} from patch set {start.patch_set} to{' '}
            {addressed.patch_set}:
          </p>
          <FixDiff
            at={at}
            file={start.file}
            from={start.patch_set}
            to={addressed.patch_set}
          />
        </div>
      )}
      <ul className="space-y-3">
        {[start, ...replies].map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {c.author.handle}
              </span>
              {c.author.class !== 'human' && <span>{c.author.class}</span>}
              <span>{timeAgo(c.created_at)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!reply.trim()) return
          void write('change_comments.create', {
            ...at,
            body: { body: reply.trim(), reply_to: start.id },
          }).then((r) => {
            setError(r.error?.message ?? '')
            if (!r.error) setReply('')
          })
        }}
      >
        <Textarea
          value={reply}
          rows={1}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply"
          aria-label={`Reply to ${whereOf(start)}`}
          className="min-h-9"
        />
        <Button type="submit" size="sm" disabled={!reply.trim()}>
          Reply
        </Button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Panel>
  )
}

/**
 * The review discussion: comments on lines, on files and on the whole change,
 * each with its replies, and a way to start one.
 */
export function ChangeDiscussion({
  at,
  files,
  latest,
}: {
  at: At
  /** The files at the newest patch set, by path. */
  files: Record<string, string>
  latest: number
}) {
  const all = useOp('change_comments.list', at).data
  const write = useWrite()
  const threads = threadsOf(all)
  const open = threads.filter((t) => !t.start.resolved).length
  const paths = Object.keys(files).sort()
  const [file, setFile] = React.useState('')
  const [line, setLine] = React.useState('')
  const [body, setBody] = React.useState('')
  const [error, setError] = React.useState('')
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">
          {threads.length === 0
            ? 'No comments yet.'
            : `${threads.length} thread${threads.length === 1 ? '' : 's'}, ${open} open.`}
        </p>
        {threads.length === 0 ? (
          <EmptyState title="Nothing said yet">
            Comment on a line, a file or the whole change.
          </EmptyState>
        ) : (
          threads.map((t) => (
            <Thread
              key={t.start.id}
              at={at}
              start={t.start}
              replies={t.replies}
              files={files}
              latest={latest}
            />
          ))
        )}
      </div>
      <Panel className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ChatBubbleLeftIcon className="size-4" /> Start a thread
        </h3>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">On</span>
          <Select
            value={file || '*'}
            onValueChange={(v) => setFile(v === '*' ? '' : String(v))}
          >
            <SelectItem value="*">The whole change</SelectItem>
            {paths.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </Select>
        </label>
        {file && (
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">
              Line (empty for the whole file)
            </span>
            <input
              value={line}
              inputMode="numeric"
              onChange={(e) => setLine(e.target.value.replace(/\D/g, ''))}
              className="h-9 w-full rounded-lg border bg-background px-3"
            />
          </label>
        )}
        {file && line && (
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
            {(files[file] ?? '').split('\n')[Number(line) - 1] ?? ' '}
          </pre>
        )}
        <Textarea
          value={body}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What should change, or what is unclear?"
          aria-label="Comment"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          variant="brand"
          disabled={!body.trim()}
          onClick={() =>
            void write('change_comments.create', {
              ...at,
              body: {
                body: body.trim(),
                ...(file ? { file } : {}),
                ...(file && line ? { line: Number(line) } : {}),
              },
            }).then((r) => {
              setError(r.error?.message ?? '')
              if (!r.error) {
                setBody('')
                setLine('')
              }
            })
          }
        >
          Comment
        </Button>
      </Panel>
    </div>
  )
}
