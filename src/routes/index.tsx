import { Link, createFileRoute } from '@tanstack/react-router'
import type { BrandId } from '~/components/brand'
import type { StatusItem } from '~/components/forge/status-card'
import { brandName } from '~/components/brand'
import { Sparkline } from '~/components/dither-kit'
import { CopyField } from '~/components/forge/repo-shell'
import { StatusCard } from '~/components/forge/status-card'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'source.code: a home for your code that keeps your history' },
    ],
  }),
  component: Landing,
})

const preview: Array<StatusItem> = [
  {
    id: 'checks',
    label: 'Checks passed',
    detail: 'ci/test on the tree that will land',
    state: 'pass',
  },
  {
    id: 'approval',
    label: 'Approved by hollis',
    detail: '1 of 1 required. Carried over from the last patch set.',
    state: 'pass',
  },
  {
    id: 'findings',
    label: '1 high finding to handle',
    detail: 'greptile: NegCache is unbounded',
    state: 'fail',
  },
]

const agents: Array<BrandId> = [
  'claudereview',
  't3code',
  'boat',
  'e2b',
  'daytona',
  'modal',
  'coderabbit',
  'greptile',
  'blacksmith',
  'namespace',
]

const history = [4, 6, 5, 9, 8, 12, 10, 14, 13, 18, 16, 22, 20, 26]

function Landing() {
  return (
    <div className="space-y-28">
      <section className="mx-auto max-w-3xl space-y-7 pt-10 text-center">
        <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-balance md:text-6xl">
          Your code and its history, in one place that outlasts every host.
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground text-balance">
          source.code hosts your repositories, keeps everything you have done
          elsewhere, and lets any model, harness or agent do the work, under
          rules you set.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="brand"
            size="lg"
            render={<Link to="/new" />}
            nativeButton={false}
          >
            Get started
          </Button>
          <Button
            size="lg"
            render={<Link to="/discover" />}
            nativeButton={false}
          >
            Explore projects
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring your own runner, model and agent. We never resell compute or
          tokens.
        </p>
      </section>

      <section className="mx-auto max-w-4xl space-y-6">
        <div className="surface rounded-[28px] border bg-muted/40 p-3 md:p-5">
          <div className="grid gap-5 rounded-2xl bg-background p-5 md:grid-cols-[1fr_1.1fr] md:p-8">
            <div className="space-y-4 self-center">
              <p className="font-mono text-xs text-muted-foreground">ch_7f3a</p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Cache negative ref lookups
              </h2>
              <p className="text-muted-foreground">
                Every change says whether it can land and what is in the way.
                People, reviewers and agents all read the same answer, so no one
                has to ask.
              </p>
              <CopyField value="sx change view ch_7f3a" />
            </div>
            <StatusCard
              items={preview}
              landing="idle"
              canLand={false}
              changeId="ch_7f3a"
              note="1 thing in the way."
              onLand={() => undefined}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {[
          {
            title: 'Keep everything',
            body: 'Import your history from the hosts you have used and mirror out to them. If one goes away, nothing here changes.',
            visual: (
              <div className="h-16">
                <Sparkline data={history} color="green" bloom="low" />
              </div>
            ),
          },
          {
            title: 'Review changes, not branches',
            body: 'A change keeps its identity through rebases, shows only what is new, and lands under policies you write as code.',
            visual: (
              <ul className="space-y-1.5 font-mono text-xs text-muted-foreground">
                <li>patch set 1 → 2 → 3</li>
                <li>approval carries over</li>
                <li>lands in order</li>
              </ul>
            ),
          },
          {
            title: 'Agents are users, with limits',
            body: 'Agents connect over the CLI or MCP with scoped tokens, follow the same policies as people, and never see a secret unless you grant it.',
            visual: (
              <ul className="space-y-1.5 font-mono text-xs text-muted-foreground">
                <li>sx skill install</li>
                <li>/mcp</li>
                <li>exit 5 = stop</li>
              </ul>
            ),
          },
        ].map((f) => (
          <article
            key={f.title}
            className="surface flex flex-col gap-5 rounded-3xl border bg-card p-7"
          >
            <div className="well rounded-2xl bg-muted/60 p-4">{f.visual}</div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-3xl space-y-8 text-center">
        <div className="space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight">
            Any model. Any harness. Any agent.
          </h2>
          <p className="text-muted-foreground">
            source.code does not pick for you or sell you tokens. Connect the
            reviewers, runners and environments you already use, and swap them
            when something better comes along.
          </p>
        </div>
        <ul className="flex flex-wrap justify-center gap-3">
          {agents.map((id) => (
            <li
              key={id}
              className="surface rounded-xl border bg-card px-3.5 py-2 text-sm"
            >
              {brandName(id)}
            </li>
          ))}
        </ul>
        <div className="flex justify-center gap-3">
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
            render={<Link to="/pricing" />}
            nativeButton={false}
          >
            See pricing
          </Button>
        </div>
      </section>
    </div>
  )
}
