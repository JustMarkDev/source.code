import type * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CommandLineIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { Chip } from './bits'
import type { Repo } from '~/lib/model/data'
import { Modal } from '~/components/ui/dialog'
import { useOpMaybe } from '~/lib/forge'
import { timeAgo } from '~/lib/repo'

/**
 * "Why is this line here?": from a line of code to the commit that wrote
 * it, the change it landed through, the patch set, and the agent run that
 * pushed it, with the run's task, summary, links and transcript.
 */
export function LineProvenance({
  repo,
  path,
  line,
  gitRef,
  change,
  onClose,
}: {
  repo: Repo
  path: string
  line: number | null
  gitRef?: string
  /** Ask about the line in this change's newest patch set. */
  change?: number
  onClose: () => void
}) {
  const open = line !== null
  const p = useOpMaybe(
    'repos.provenance',
    {
      owner: repo.owner,
      repo: repo.name,
      path,
      line: line ?? 1,
      ...(change ? { change } : gitRef ? { ref: gitRef } : {}),
    },
    open,
  )
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Why is line ${line ?? ''} here?`}
      description={path}
      wide
    >
      {p === undefined ? (
        <p className="text-sm text-muted-foreground">Following the line…</p>
      ) : p === null ? (
        <p className="text-sm text-muted-foreground">
          This line could not be followed back.
        </p>
      ) : (
        <dl className="space-y-4 text-sm">
          {p.commit && (
            <Row label="Commit">
              <Link
                to="/$handle/$repo/commit/$sha"
                params={{
                  handle: repo.owner,
                  repo: repo.name,
                  sha: p.commit.sha,
                }}
                className="font-medium hover:underline"
              >
                {p.commit.message.split('\n')[0]}
              </Link>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{p.commit.sha.slice(0, 7)}</span> by{' '}
                {p.commit.author.name}, {timeAgo(p.commit.date)}
              </p>
            </Row>
          )}
          <Row label="Change">
            {p.change ? (
              <Link
                to="/$handle/$repo/$tab"
                params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
                search={{ n: p.change.number }}
                className="font-medium hover:underline"
              >
                #{p.change.number} {p.change.title}
              </Link>
            ) : (
              <span className="text-muted-foreground">
                No change here brought this line in.
              </span>
            )}
            {p.patch_set !== null && (
              <p className="text-xs text-muted-foreground">
                Written in patch set {p.patch_set}
              </p>
            )}
          </Row>
          <Row label="Run">
            {p.run ? (
              <div className="space-y-2">
                <p className="flex flex-wrap items-center gap-2">
                  <CommandLineIcon className="size-4 text-muted-foreground" />
                  <Link
                    to="/$handle/$repo/run/$id"
                    params={{
                      handle: repo.owner,
                      repo: repo.name,
                      id: p.run.id,
                    }}
                    className="font-medium hover:underline"
                  >
                    {p.run.task}
                  </Link>
                  <Chip tone="info">{p.run.actor.handle}</Chip>
                  {p.run.harness && <Chip tone="outline">{p.run.harness}</Chip>}
                </p>
                {p.run.summary && (
                  <p className="text-muted-foreground">{p.run.summary}</p>
                )}
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {p.run.links.map((href) => (
                    <li key={href}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <ChatBubbleLeftRightIcon className="size-3.5" />
                        {new URL(href).host}
                        <ArrowTopRightOnSquareIcon className="size-3" />
                      </a>
                    </li>
                  ))}
                  {p.run.transcript && (
                    <li className="inline-flex items-center gap-1 text-muted-foreground">
                      <DocumentTextIcon className="size-3.5" />
                      Transcript kept
                      {p.run.transcript.redactions > 0 &&
                        `, ${p.run.transcript.redactions} secret${p.run.transcript.redactions === 1 ? '' : 's'} masked`}
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <span className="text-muted-foreground">
                No agent run is recorded for it.
              </span>
            )}
          </Row>
        </dl>
      )}
    </Modal>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 space-y-1">{children}</dd>
    </div>
  )
}
