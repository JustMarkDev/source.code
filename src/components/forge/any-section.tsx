import { Link } from '@tanstack/react-router'
import { ServerIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { Integration, IntegrationGroup } from '~/mock/hub'
import { BrandLogo, brandName } from '~/components/brand'
import { Button } from '~/components/ui/button'
import { catalog, sortIntegrations } from '~/mock/hub'

const labelOf = (i: Integration) =>
  i.id === 'selfhosted'
    ? 'Your own machines'
    : i.id === 'selfhostedreviewer'
      ? 'Your own reviewer'
      : brandName(i.id)

const chipClass =
  'surface inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm'

/** A plain word, for things that are not a product we connect to. */
function Word({ children, mono }: { children: string; mono?: boolean }) {
  return (
    <li className={cn(chipClass, mono && 'font-mono text-xs')}>{children}</li>
  )
}

/**
 * The services in one group, as the integrations page has them: the ones that
 * work today first, and the planned ones faded, so the page never promises
 * more than there is.
 */
function Services({ group }: { group: IntegrationGroup }) {
  const list = sortIntegrations(
    catalog.filter((i) => i.group === group),
    new Set(),
  )
  return (
    <>
      {list.map((i) => {
        const planned = i.status === 'planned'
        return (
          <li
            key={i.id}
            className={cn(chipClass, planned && 'opacity-50 grayscale')}
          >
            {i.id === 'selfhosted' || i.id === 'selfhostedreviewer' ? (
              <ServerIcon className="size-4 text-muted-foreground" />
            ) : (
              <BrandLogo id={i.id} className="size-4" />
            )}
            {labelOf(i)}
            {planned && <span className="sr-only"> (planned)</span>}
          </li>
        )
      })}
    </>
  )
}

const facets: Array<{
  title: string
  body: string
  chips: React.ReactNode
}> = [
  {
    title: 'Any model',
    body: 'Claude, GPT, Gemini, open-weight models, or one you host. You choose the model, on your own keys and your own bill.',
    chips: (
      <>
        <Word>Claude</Word>
        <Word>GPT</Word>
        <Word>Gemini</Word>
        <Word>Open weights</Word>
        <Word>Your own</Word>
      </>
    ),
  },
  {
    title: 'Any harness',
    body: 'The program that drives the model is yours to pick. Claude Code, Codex, OpenCode, or your own.',
    chips: (
      <>
        <Word>Claude Code</Word>
        <Word>Codex</Word>
        <Word>OpenCode</Word>
        <Word>Your own</Word>
      </>
    ),
  },
  {
    title: 'Any agent',
    body: 'Agents are users, with limits. They connect over the CLI or MCP with scoped tokens, follow the same policies as people, and never see a secret you did not grant.',
    chips: (
      <>
        <Word mono>sx</Word>
        <Word mono>MCP</Word>
        <Word>Scoped tokens</Word>
      </>
    ),
  },
  {
    title: 'Any runner',
    body: 'Run your workflows where you like. We do not host runners, so there are no CI minutes to buy.',
    chips: <Services group="runners" />,
  },
  {
    title: 'Any environment',
    body: 'Hand a task to your own computer, or to a clean machine made for the job.',
    chips: <Services group="environments" />,
  },
  {
    title: 'Any reviewer',
    body: 'Findings from AI reviewers land on the diff next to human comments, with a suggested change you can accept in one click.',
    chips: <Services group="review" />,
  },
]

export function AnySection() {
  return (
    <section aria-labelledby="any" className="mx-auto max-w-5xl space-y-10">
      <div className="mx-auto max-w-3xl space-y-3 text-center">
        <h2 id="any" className="text-3xl font-semibold tracking-tight">
          Any model. Any harness. Any agent.
        </h2>
        <p className="text-muted-foreground text-balance">
          And any runner, any environment, any reviewer. source.code does not
          pick for you, and never sells you tokens or compute. Connect what you
          already use, and swap it when something better comes along.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {facets.map((f) => (
          <li key={f.title} className="flex">
            <article className="surface flex w-full flex-col gap-4 rounded-2xl border bg-card p-6">
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
              <ul className="mt-auto flex flex-wrap gap-2">{f.chips}</ul>
            </article>
          </li>
        ))}
      </ul>
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          Faded ones are planned. The rest work today.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            render={
              <Link to="/docs/$" params={{ _splat: 'cli/agent-guide' }} />
            }
            nativeButton={false}
          >
            Teach an agent to use it
          </Button>
          <Button
            variant="ghost"
            render={<Link to="/docs/$" params={{ _splat: 'integrations' }} />}
            nativeButton={false}
          >
            Every integration
          </Button>
        </div>
      </div>
    </section>
  )
}
