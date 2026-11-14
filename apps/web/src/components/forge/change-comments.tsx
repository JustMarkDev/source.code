import * as React from 'react'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { Chip, EmptyState, Panel } from './bits'
import type { ChangeComment } from '@source-code/sdk'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { Textarea } from '~/components/ui/input'
import { useOp, useWrite } from '~/lib/forge'
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
      : `${c.file}:${c.line}`

function Thread({
  at,
  start,
  replies,
  lineText,
}: {
  at: At
  start: ChangeComment
  replies: Array<ChangeComment>
  lineText?: string
}) {
  const write = useWrite()
  const [reply, setReply] = React.useState('')
  const [error, setError] = React.useState('')
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{whereOf(start)}</span>
        <span>on patch set {start.patch_set}</span>
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
      {lineText !== undefined && (
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
          {lineText || ' '}
        </pre>
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
              lineText={
                t.start.file !== null &&
                t.start.line !== null &&
                t.start.patch_set === latest
                  ? (files[t.start.file] ?? '').split('\n')[t.start.line - 1]
                  : undefined
              }
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
