import * as React from 'react'
import { Callout } from '~/components/ui/callout'

/**
 * The frame the policy pages share. Both are written in plain words and say,
 * at the top, that they are a draft: source.code is a preview, so they
 * describe how the service is designed to treat people, not a promise yet.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
  children,
}: {
  title: string
  updated: string
  intro: string
  sections: Array<[id: string, title: string]>
  children: React.ReactNode
}) {
  return (
    <article className="mx-auto max-w-3xl space-y-10 pb-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="font-mono text-xs text-muted-foreground">{updated}</p>
        <p className="max-w-[65ch] text-lg text-muted-foreground">{intro}</p>
        <Callout tone="warning" title="A draft for a preview">
          source.code is not open for real accounts yet. This page describes how
          the service is designed to work. It has not been reviewed by a lawyer,
          and the last section lists what is still to be decided. It will be
          finished before launch.
        </Callout>
      </header>
      <nav aria-label="On this page" className="rounded-xl border bg-card p-4">
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {sections.map(([id, label], i) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <span className="mr-2 font-mono text-xs">{i + 1}</span>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="space-y-10">{children}</div>
    </article>
  )
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="max-w-[68ch] space-y-3 text-[15px] leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}
