import { Link } from '@tanstack/react-router'
import {
  ArrowsRightLeftIcon,
  CommandLineIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { Chip, Panel, SectionLabel } from './bits'
import type { Repo } from '~/lib/model/data'
import { useOpMaybe } from '~/lib/forge'
import { timeAgo } from '~/lib/repo'

/**
 * The issue as the conversation: the agent runs working on it, what each
 * said and pushed, and the changes that link it. Read from its timeline.
 */
export function IssueHistory({ repo, n }: { repo: Repo; n: number }) {
  const at = { owner: repo.owner, repo: repo.name }
  const timeline = useOpMaybe('issues.timeline', {
    ...at,
    number: n,
    limit: 200,
  })
  if (!timeline) return null
  const entries = timeline.data
  const runs = [
    ...new Set(
      entries.filter((e) => e.kind === 'run_note' && e.run).map((e) => e.run!),
    ),
  ]
  const refs = entries.filter((e) => e.kind === 'reference')
  if (!runs.length && !refs.length) return null
  return (
    <section className="space-y-3">
      <SectionLabel>Agent work and linked changes</SectionLabel>
      {refs.map((e) =>
        e.item.object === 'reference' ? (
          <Panel key={e.id} className="flex items-center gap-2 p-3 text-sm">
            <ArrowsRightLeftIcon className="size-4 text-muted-foreground" />
            <Link
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
              search={{ n: e.item.change }}
              className="min-w-0 flex-1 truncate font-medium hover:underline"
            >
              #{e.item.change} {e.item.title}
            </Link>
            <Chip tone={e.item.closes ? 'success' : 'muted'}>
              {e.item.closes ? 'fixes this' : 'refers to this'}
            </Chip>
            <Chip tone="outline">{e.item.state}</Chip>
          </Panel>
        ) : null,
      )}
      {runs.map((id) => (
        <RunCard
          key={id}
          repo={repo}
          id={id}
          notes={entries.filter((e) => e.run === id && e.kind === 'run_note')}
        />
      ))}
    </section>
  )
}

function RunCard({
  repo,
  id,
  notes,
}: {
  repo: Repo
  id: string
  notes: Array<{ id: string; created_at: string; summary: string }>
}) {
  const run = useOpMaybe('runs.get', { owner: repo.owner, repo: repo.name, id })
  return (
    <Panel className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CommandLineIcon className="size-4 text-muted-foreground" />
        <Link
          to="/$handle/$repo/run/$id"
          params={{ handle: repo.owner, repo: repo.name, id }}
          className="font-medium hover:underline"
        >
          {run?.task ?? id}
        </Link>
        {run && <Chip tone="info">{run.actor.handle}</Chip>}
        {run?.harness && <Chip tone="outline">{run.harness}</Chip>}
        {run && <Chip tone="muted">{run.state}</Chip>}
      </div>
      <ul className="space-y-1 text-muted-foreground">
        {notes.map((x) => (
          <li key={x.id}>
            <span className="text-xs">{timeAgo(x.created_at)}</span> {x.summary}
          </li>
        ))}
      </ul>
      {run && (run.patch_sets.length > 0 || run.transcript) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {run.patch_sets.map((ps) => (
            <Link
              key={`${ps.change}/${ps.patch_set}`}
              to="/$handle/$repo/$tab"
              params={{ handle: repo.owner, repo: repo.name, tab: 'changes' }}
              search={{ n: ps.change }}
              className="hover:underline"
            >
              #{ps.change} patch set {ps.patch_set}
            </Link>
          ))}
          {run.transcript && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <DocumentTextIcon className="size-3.5" /> Transcript kept
              {run.transcript.redactions > 0 &&
                `, ${run.transcript.redactions} secret${run.transcript.redactions === 1 ? '' : 's'} masked`}
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}
