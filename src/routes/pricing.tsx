import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CheckIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { BrandId } from '~/components/brand'
import type { Plan } from '~/lib/pricing'
import { brandName } from '~/components/brand'
import { Button } from '~/components/ui/button'
import { Segmented } from '~/components/ui/tabs'
import { overage, perMonth, perYear, plans, trial } from '~/lib/pricing'

export const Route = createFileRoute('/pricing')({
  head: () => ({ meta: [{ title: 'Pricing · source.code' }] }),
  component: Pricing,
})

const own: Array<{ title: string; body: string; names: Array<BrandId> }> = [
  {
    title: 'Runners',
    body: 'Run workflows on any runner you like.',
    names: ['blacksmith', 'namespace', 'depot', 'warpbuild', 'runson'],
  },
  {
    title: 'Models and agents',
    body: 'Claude Code, Codex, OpenCode or your own. Your keys, your bill.',
    names: ['claudereview', 'bugbot', 'coderabbit', 'greptile', 'qodo'],
  },
  {
    title: 'Environments',
    body: 'Hand work to a machine you choose.',
    names: ['t3code', 'boat', 'e2b', 'daytona', 'modal'],
  },
]

const questions: Array<[string, string]> = [
  [
    'Is there a free plan?',
    'No. Hosting git repositories, with replication and every clone, costs real money for each repository, so every plan is paid. You can try any plan for 14 days first.',
  ],
  [
    'What does the trial include?',
    `${trial.days} days of any plan, limited to ${trial.storageGb} GB of storage and ${trial.transferGb} GB of transfer. A card is required and nothing is charged until the trial ends. Cancel before then and you pay nothing, and your data stays downloadable.`,
  ],
  [
    'Why are there no CI minutes or AI credits?',
    'Because we would have to pick for you. source.code works with any runner, model, harness and agent, and stays out of the way of the ones you already pay for. We never resell compute or tokens, so there is no markup and no credit to run out of.',
  ],
  [
    'What counts as transfer?',
    'Data leaving source.code: clones, fetches and mirror pushes. Agents and CI clone a lot, so heavy automation uses more. Pushing data in has its own, smaller allowance. Release downloads do not count.',
  ],
  [
    'What happens if I go over?',
    `Nothing breaks. Extra storage is $${overage.storagePerGbMonth.toFixed(2)} per GB a month and extra transfer is $${overage.transferPerGb.toFixed(2)} per GB, billed after the month. You can set a cap.`,
  ],
  [
    'What happens to my history if I stop paying?',
    'It stays readable and downloadable for 90 days. Going over your limits pauses new pushes; it never deletes anything. Mirrors on other hosts keep their copy.',
  ],
  [
    'Is there a self-hosted version?',
    'No. We do not offer or support a self-hosted version. Your repositories are plain git, and mirrors keep copies on other hosts, so you are never locked in.',
  ],
  [
    'Do agents cost extra?',
    'Agents use the same seats as people. What they cost to run is between you and the provider you chose. Their use of storage and transfer counts toward your allowance.',
  ],
]

function limitLines(plan: Plan): Array<[string, string]> {
  const l = plan.limits
  const unit = plan.perSeat ? ' per seat' : ''
  return [
    ['Storage', `${l.storageGb} GB${unit}`],
    ['Transfer out', `${l.transferGb} GB a month${unit}`],
    ['Mirrors', l.mirrors === 'unlimited' ? 'Unlimited' : String(l.mirrors)],
  ]
}

function Pricing() {
  const [billing, setBilling] = React.useState<'month' | 'year'>('year')
  return (
    <div className="space-y-20">
      <header className="mx-auto max-w-2xl space-y-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Pay to keep your work, not to run it.
        </h1>
        <p className="text-lg text-muted-foreground">
          Plans cover storage, transfer, history and seats. Bring your own
          runner, model and agent. We never resell compute or tokens.
        </p>
        <div className="pt-2">
          <Segmented
            label="Billing"
            value={billing}
            onChange={setBilling}
            options={[
              ['year', 'Yearly, save about 20%'],
              ['month', 'Monthly'],
            ]}
          />
        </div>
      </header>

      <section className="grid gap-5 md:grid-cols-3">
        {plans.map((p) => (
          <article
            key={p.id}
            className={cn(
              'surface flex flex-col gap-6 rounded-3xl border bg-card p-7',
              p.featured && 'ring-2 ring-brand',
            )}
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="text-sm text-muted-foreground">{p.blurb}</p>
            </div>
            <div>
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                ${perMonth(p, billing)}
              </span>
              <span className="ml-1.5 text-sm text-muted-foreground">
                {p.perSeat ? 'per seat, per month' : 'per month'}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">
                {billing === 'year'
                  ? `Billed yearly, $${perYear(p)}${p.perSeat ? ' per seat' : ''}`
                  : 'Billed monthly'}
              </p>
            </div>
            <Button
              size="lg"
              variant={p.featured ? 'brand' : 'outline'}
              render={<Link to="/new" />}
              nativeButton={false}
            >
              Start {trial.days}-day trial
            </Button>
            <dl className="well space-y-2 rounded-xl bg-muted/60 p-4 text-sm">
              {limitLines(p).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-3 text-sm">
              {p.lead && <p className="font-medium">{p.lead}</p>}
              <ul className="space-y-2.5">
                {p.features.map((i) => (
                  <li key={i} className="flex gap-2.5">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                    <span className="text-muted-foreground">{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>

      <p className="-mt-12 text-center text-sm text-muted-foreground">
        Beyond a plan: ${overage.storagePerGbMonth.toFixed(2)} per extra GB of
        storage a month, ${overage.transferPerGb.toFixed(2)} per extra GB
        transferred. Prices are in USD and exclude tax.
      </p>

      <section className="surface rounded-3xl border bg-card p-8 md:p-10">
        <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              Enterprise
            </h2>
            <p className="text-muted-foreground">
              SSO, audit export, data residency and an SLA, with someone to
              call.
            </p>
            <div className="pt-2">
              <Button>Talk to us</Button>
            </div>
          </div>
          <ul className="grid gap-x-6 gap-y-2.5 text-sm text-muted-foreground sm:grid-cols-2">
            {[
              'SAML and SCIM',
              'Audit log export',
              'Data residency',
              'Uptime SLA',
              'Volume pricing on storage and transfer',
              'Dedicated support',
            ].map((i) => (
              <li key={i} className="flex gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                {i}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-8">
        <div className="mx-auto max-w-2xl space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Bring your own
          </h2>
          <p className="text-muted-foreground">
            These are things you connect, not things we sell. The list is open:
            anything that speaks to a git host can join it.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {own.map((o) => (
            <div
              key={o.title}
              className="surface space-y-4 rounded-2xl border bg-card p-6"
            >
              <div>
                <h3 className="font-medium">{o.title}</h3>
                <p className="text-sm text-muted-foreground">{o.body}</p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {o.names.map((id) => (
                  <li
                    key={id}
                    className="well rounded-lg bg-muted/70 px-2.5 py-1 text-sm"
                  >
                    {brandName(id)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl space-y-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          Common questions
        </h2>
        <div className="surface divide-y rounded-2xl border bg-card">
          {questions.map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
