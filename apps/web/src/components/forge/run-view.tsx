import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CommandLineIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { Chip, EmptyState, Panel, SectionLabel } from './bits'
import type { Repo } from '~/lib/model/data'
import { Button } from '~/components/ui/button'
import { useOpMaybe } from '~/lib/forge'
import { timeAgo } from '~/lib/repo'

const stateTone = {
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'muted',
  expired: 'muted',
} as const

/**
 * One agent run: its task, who ran it and with what, what it said as it
 * went, the patch sets it pushed, where it was discussed, and its
 * transcript when the repository keeps them.
 */
export function RunView({ repo, id }: { repo: Repo; id: string }) {
  const at = { owner: repo.owner, repo: repo.name }
  const run = useOpMaybe('runs.get', { ...at, id })
  const [reading, setReading] = React.useState(false)
  const transcript = useOpMaybe(
    'runs.transcript.get',
    { ...at, id },
    reading && !!run?.transcript,
  )
  if (run === undefined)
    return <p className="text-sm text-muted-foreground">Loading the run…</p>
  if (run === null)
    return (
      <EmptyState title="No such run">
        It may have been cleaned up, or you may not be able to read it.
      </EmptyState>
    )
  const changes = (n: number, text: React.ReactNode) => (
    <Link
      to="/$handle/$repo/$tab"
      params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
      search={{ n }}
      className="font-medium hover:underline"
    >
      {text}
    </Link>
  )
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CommandLineIcon className="size-4" />
          <span className="font-mono text-xs">{run.id}</span>
          <Chip tone={stateTone[run.state]}>{run.state}</Chip>
          <Chip tone="info">{run.actor.handle}</Chip>
          {run.harness && <Chip tone="outline">{run.harness}</Chip>}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{run.task}</h2>
        <p className="text-sm text-muted-foreground">
          Started {timeAgo(run.started_at)}
          {run.finished_at && `, finished ${timeAgo(run.finished_at)}`}
          {run.change !== null && (
            <> · works on {changes(run.change, `change #${run.change}`)}</>
          )}
          {run.issue !== null && (
            <>
              {' '}
              · for{' '}
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: repo.owner, repo: repo.name, tab: 'issues' }}
                search={{ n: run.issue }}
                className="font-medium hover:underline"
              >
                issue #{run.issue}
              </Link>
            </>
          )}
        </p>
        {run.summary && <p className="max-w-3xl">{run.summary}</p>}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <SectionLabel>What it said</SectionLabel>
          <Panel className="divide-y text-sm">
            {run.notes.map((n) => (
              <div key={`${n.at}:${n.text}`} className="flex gap-3 px-4 py-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">
                  {timeAgo(n.at)}
                </span>
                <span>{n.text}</span>
              </div>
            ))}
            {!run.notes.length && (
              <p className="px-4 py-6 text-center text-muted-foreground">
                No notes.
              </p>
            )}
          </Panel>
        </section>

        <div className="space-y-8">
          <section className="space-y-3">
            <SectionLabel>Patch sets it pushed</SectionLabel>
            <Panel className="divide-y text-sm">
              {run.patch_sets.map((ps) => (
                <div key={`${ps.change}/${ps.patch_set}`} className="px-4 py-2">
                  {changes(ps.change, `#${ps.change}`)}{' '}
                  <span className="text-muted-foreground">
                    patch set {ps.patch_set}
                  </span>
                </div>
              ))}
              {!run.patch_sets.length && (
                <p className="px-4 py-6 text-center text-muted-foreground">
                  None yet.
                </p>
              )}
            </Panel>
          </section>

          {run.links.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Discussed in</SectionLabel>
              <ul className="space-y-1 text-sm">
                {run.links.map((href) => (
                  <li key={href}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <ChatBubbleLeftRightIcon className="size-4" />
                      {new URL(href).host}
                      <ArrowTopRightOnSquareIcon className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <SectionLabel>Transcript</SectionLabel>
            {run.transcript ? (
              <Panel className="space-y-3 p-4 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <DocumentTextIcon className="size-4" />
                  {Math.ceil(run.transcript.size / 1024)} KB
                  {run.transcript.redactions > 0 &&
                    `, ${run.transcript.redactions} secret${run.transcript.redactions === 1 ? '' : 's'} masked`}
                </p>
                {!reading && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReading(true)}
                  >
                    Read it
                  </Button>
                )}
                {reading && transcript === null && (
                  <p className="text-xs text-muted-foreground">
                    Reading a transcript needs the runs:transcripts scope.
                  </p>
                )}
                {transcript && (
                  <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                    {transcript.content}
                  </pre>
                )}
              </Panel>
            ) : (
              <p className="text-sm text-muted-foreground">
                None kept. A repository keeps transcripts when its Agent history
                setting is on.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
