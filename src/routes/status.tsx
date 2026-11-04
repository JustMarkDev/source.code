import { createFileRoute } from '@tanstack/react-router'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { seeded } from '~/mock/data'

export const Route = createFileRoute('/status')({
  head: () => ({ meta: [{ title: 'Status · source.code' }] }),
  component: Status,
})

type State = 'up' | 'degraded' | 'down'

const services: Array<{
  name: string
  note: string
  state: State
  uptime: string
}> = [
  {
    name: 'Web app',
    note: 'source.code in your browser',
    state: 'up',
    uptime: '99.99%',
  },
  {
    name: 'Git over HTTPS and SSH',
    note: 'Clone, fetch and push',
    state: 'up',
    uptime: '99.98%',
  },
  { name: 'API', note: 'REST and webhooks', state: 'up', uptime: '99.97%' },
  { name: 'MCP server', note: 'For agents', state: 'up', uptime: '99.95%' },
  {
    name: 'Mirror sync',
    note: 'Copies on other hosts',
    state: 'degraded',
    uptime: '99.71%',
  },
  {
    name: 'Integrations',
    note: 'Reviewers, runners, environments',
    state: 'up',
    uptime: '99.93%',
  },
]

const incidents = [
  {
    date: 'Nov 3',
    title: 'Mirror pushes to GitLab were delayed',
    state: 'Monitoring',
    body: 'Some pushes to GitLab are queued while we retry. Nothing is lost: every commit is stored on source.code first.',
  },
  {
    date: 'Oct 21',
    title: 'Slow clones in one region',
    state: 'Resolved',
    body: 'A storage node was replaced. Clones were up to 4 times slower for 38 minutes.',
  },
  {
    date: 'Oct 9',
    title: 'Sign-in links delayed',
    state: 'Resolved',
    body: 'An email provider queue backed up. Sign-in links arrived late for about an hour.',
  },
]

const tone: Record<State, { dot: string; label: string }> = {
  up: { dot: 'bg-success', label: 'Operational' },
  degraded: { dot: 'bg-warning', label: 'Degraded' },
  down: { dot: 'bg-danger', label: 'Down' },
}

/** 90 days, one bar a day. Deterministic so it does not shift between renders. */
function Days({ seed, state }: { seed: number; state: State }) {
  const rand = seeded(seed)
  return (
    <div
      className="flex h-7 items-end gap-[2px]"
      role="img"
      aria-label="Last 90 days"
    >
      {Array.from({ length: 90 }, (_, i) => {
        const r = rand()
        const bad = r > 0.985
        const slow = r > 0.96
        const recent = state === 'degraded' && i > 86
        return (
          <span
            key={i}
            className={cn(
              'w-[3px] flex-1 rounded-[1px]',
              bad
                ? 'bg-danger'
                : slow || recent
                  ? 'bg-warning'
                  : 'bg-success/70',
            )}
            style={{ height: bad ? '55%' : slow || recent ? '75%' : '100%' }}
          />
        )
      })}
    </div>
  )
}

function Status() {
  const worst = services.some((s) => s.state === 'down')
    ? 'down'
    : services.some((s) => s.state === 'degraded')
      ? 'degraded'
      : 'up'
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
        <div
          className={cn(
            'surface flex items-center gap-3 rounded-2xl border bg-card p-5',
          )}
        >
          {worst === 'up' ? (
            <CheckCircleIcon className="size-6 text-success" />
          ) : (
            <ExclamationTriangleIcon className="size-6 text-warning" />
          )}
          <div className="flex-1">
            <p className="font-medium">
              {worst === 'up'
                ? 'All systems operational'
                : 'Everything works, one service is degraded'}
            </p>
            <p className="text-sm text-muted-foreground">
              Your repositories, history and releases are safe on source.code
              whatever other hosts do.
            </p>
          </div>
          <Button size="sm">Subscribe</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Sample data for this preview.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Services</h2>
        <ul className="surface divide-y rounded-2xl border bg-card">
          {services.map((s, i) => (
            <li key={s.name} className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-sm text-muted-foreground">{s.note}</div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.uptime}
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <span
                    className={cn('size-2 rounded-full', tone[s.state].dot)}
                  />
                  {tone[s.state].label}
                </span>
              </div>
              <Days seed={i + 11} state={s.state} />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>90 days ago</span>
                <span>Today</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Recent incidents</h2>
        <ul className="space-y-4">
          {incidents.map((i) => (
            <li key={i.title} className="flex gap-4">
              <span className="w-14 shrink-0 pt-0.5 text-sm text-muted-foreground">
                {i.date}
              </span>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  {i.title}
                  <Badge tone={i.state === 'Resolved' ? 'success' : 'warning'}>
                    {i.state}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{i.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
