import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ClockIcon,
  CurrencyDollarIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import type { StatusItem } from '~/components/forge/status-card'
import { Sparkline } from '~/components/dither-kit'
import { CopyField } from '~/components/forge/repo-shell'
import { AnySection } from '~/components/forge/any-section'
import { CompareMatrix, Legend } from '~/components/forge/compare-table'
import { StatusCard } from '~/components/forge/status-card'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth/client'

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

const history = [4, 6, 5, 9, 8, 12, 10, 14, 13, 18, 16, 22, 20, 26]

function Landing() {
  const { data: session } = authClient.useSession()
  return (
    <div className="space-y-28">
      <section className="mx-auto max-w-3xl space-y-7 pt-10 text-center">
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
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
            render={<Link to={session ? '/new' : '/sign-up'} />}
            nativeButton={false}
          >
            {session ? 'Start a repository' : 'Get started'}
          </Button>
          <Button
            size="lg"
            render={<Link to="/compare" />}
            nativeButton={false}
          >
            How it compares
          </Button>
        </div>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">
          Bring your own runner, model and agent. We never resell compute or
          tokens.
        </p>
      </section>

      <section className="mx-auto max-w-4xl space-y-6">
        <div className="surface rounded-[28px] border bg-muted/40 p-3 md:p-5">
          <div className="grid grid-cols-1 gap-5 rounded-2xl bg-background p-5 md:grid-cols-[1fr_1.1fr] md:p-8">
            <div className="space-y-4 self-center">
              <p className="font-mono text-xs text-muted-foreground">#216</p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Cache negative ref lookups
              </h2>
              <p className="text-muted-foreground">
                Every change says whether it can land and what is in the way.
                People, reviewers and agents all read the same answer, so no one
                has to ask.
              </p>
              <CopyField value="sx change view 216" />
            </div>
            {/* An illustration of the real screen, so it takes no focus and says nothing twice. */}
            <div inert aria-hidden="true">
              <StatusCard
                items={preview}
                landing="idle"
                canLand={false}
                changeId="216"
                note="1 thing in the way."
                onLand={() => undefined}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
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
            <div className="well flex h-24 items-center rounded-2xl bg-muted/60 p-4 [&>*]:w-full">
              {f.visual}
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          </article>
        ))}
      </section>

      <AnySection />

      <section
        aria-labelledby="compare"
        className="mx-auto max-w-5xl space-y-6"
      >
        <div className="space-y-3 text-center">
          <h2 id="compare" className="text-3xl font-semibold tracking-tight">
            How it compares
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground text-balance">
            GitHub, GitLab, Bitbucket, GitCafe and Forgejo are good products.
            Here is where we differ, including the rows where they are ahead.
          </p>
        </div>
        <CompareMatrix />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Legend />
          <Button
            variant="ghost"
            render={<Link to="/compare" />}
            nativeButton={false}
          >
            Read the notes and sources
          </Button>
        </div>
      </section>

      <section aria-labelledby="teams" className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-3 text-center">
          <h2 id="teams" className="text-3xl font-semibold tracking-tight">
            Built for teams that answer to someone
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Rules, records and limits that hold up when the people who set them
            are not in the room.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            [
              ShieldCheckIcon,
              'Rules that apply to everyone',
              'Landing policies are code, reviewed like code. People and agents follow the same ones, and an agent cannot approve its own change.',
            ],
            [
              ClockIcon,
              'A record you can export',
              'An audit log of sensitive actions, kept for up to five years. Enterprise adds SSO, audit export, data residency and an SLA.',
            ],
            [
              KeyIcon,
              'Secrets agents never see',
              'Agents run commands that have the values. They never receive them, and production stays with people.',
            ],
            [
              CurrencyDollarIcon,
              'Limits on what agents cost',
              'Spend caps and token history for agents, on top of per-repository grants that expire.',
            ],
          ].map(([Icon, title, body]) => (
            <li
              key={title as string}
              className="surface flex gap-4 rounded-2xl border bg-card p-5"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Icon className="size-5" />
              </span>
              <div className="space-y-1">
                <h3 className="font-semibold tracking-tight">
                  {title as string}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {body as string}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            render={<Link to="/pricing" />}
            nativeButton={false}
            size="lg"
          >
            See plans
          </Button>
          <Button
            variant="ghost"
            size="lg"
            render={
              <Link to="/docs/$" params={{ _splat: 'concepts/policies' }} />
            }
            nativeButton={false}
          >
            How policies work
          </Button>
        </div>
      </section>
    </div>
  )
}
