import {
  CheckCircleIcon,
  MinusCircleIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { Level } from '~/lib/compare'
import { levelLabel, products, rows } from '~/lib/compare'

const tone: Record<Level, string> = {
  yes: 'text-success',
  partly: 'text-warning',
  no: 'text-muted-foreground',
  unclear: 'text-muted-foreground',
}

/** The mark for a level. The words are there for screen readers and for the legend. */
export function LevelMark({
  level,
  className,
}: {
  level: Level
  className?: string
}) {
  const props = {
    'aria-label': levelLabel[level],
    role: 'img',
    className: cn('size-5 shrink-0', tone[level], className),
  }
  if (level === 'yes') return <CheckCircleIcon {...props} />
  if (level === 'partly') return <MinusCircleIcon {...props} />
  if (level === 'no') return <XCircleIcon {...props} />
  return <QuestionMarkCircleIcon {...props} />
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
      {(['yes', 'partly', 'no', 'unclear'] as const).map((l) => (
        <li key={l} className="inline-flex items-center gap-1.5">
          <LevelMark level={l} className="size-4" />
          {levelLabel[l]}
        </li>
      ))}
    </ul>
  )
}

/** One mark per cell: enough to see the shape of it, with the notes a click away. */
export function CompareMatrix() {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">
          How source.code compares with GitHub, GitLab, Bitbucket, GitCafe, and
          Gitea and Forgejo
        </caption>
        <thead>
          <tr className="border-b text-left">
            <th
              scope="col"
              className="px-5 py-3 font-medium text-muted-foreground"
            >
              <span className="sr-only">Capability</span>
            </th>
            {products.map((p) => (
              <th
                key={p.id}
                scope="col"
                className={cn(
                  'px-3 py-3 text-center font-medium whitespace-nowrap',
                  p.id === 'us' && 'bg-muted/60',
                )}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="px-5 py-3 text-left font-normal">
                {r.question}
              </th>
              {products.map((p) => (
                <td
                  key={p.id}
                  className={cn('px-3 py-3', p.id === 'us' && 'bg-muted/60')}
                >
                  <span className="flex justify-center">
                    <LevelMark level={r.cells[p.id].level} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The same rows with what each product does and the page we read it on. */
export function CompareDetails() {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[80rem] text-sm">
        <caption className="sr-only">
          What each product does, row by row, with sources
        </caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="w-56 px-5 py-3 font-medium">
              <span className="sr-only">Capability</span>
            </th>
            {products.map((p) => (
              <th
                key={p.id}
                scope="col"
                className={cn(
                  'px-4 py-3 font-medium',
                  p.id === 'us' && 'bg-muted/60',
                )}
              >
                {p.name}
                {p.note && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {p.note}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="px-5 py-4 text-left">
                <span className="block text-xs font-normal text-muted-foreground">
                  {r.topic}
                </span>
                <span className="font-medium">{r.question}</span>
              </th>
              {products.map((p) => {
                const c = r.cells[p.id]
                return (
                  <td
                    key={p.id}
                    className={cn('px-4 py-4', p.id === 'us' && 'bg-muted/60')}
                  >
                    <div className="flex gap-2.5">
                      <LevelMark level={c.level} className="mt-0.5" />
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-muted-foreground">
                          <b className="font-medium text-foreground">
                            {levelLabel[c.level]}.
                          </b>{' '}
                          {c.text}
                        </p>
                        {c.sources && (
                          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                            {c.sources.map((s) => (
                              <li key={s.href}>
                                <a
                                  href={s.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                                >
                                  {s.label}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
