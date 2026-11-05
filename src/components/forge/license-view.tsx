import * as React from 'react'
import {
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { Chip } from './bits'
import { Button } from '~/components/ui/button'

type Facts = {
  kind: string
  summary: string
  permissions: Array<string>
  conditions: Array<string>
  limitations: Array<string>
}

const PERMITS = [
  'Commercial use',
  'Modification',
  'Distribution',
  'Private use',
]
const WITH_PATENTS = [...PERMITS.slice(0, 3), 'Patent use', 'Private use']
const NOTICE = 'License and copyright notice'
const AS_IS = ['Liability', 'Warranty']

/** What each license lets you do, in the same terms for every license. */
const facts: Record<string, Facts> = {
  MIT: {
    kind: 'Permissive',
    summary:
      'Do almost anything with it, as long as the notice goes with the code.',
    permissions: PERMITS,
    conditions: [NOTICE],
    limitations: AS_IS,
  },
  ISC: {
    kind: 'Permissive',
    summary:
      'Like MIT, in fewer words. Keep the notice and use it however you like.',
    permissions: PERMITS,
    conditions: [NOTICE],
    limitations: AS_IS,
  },
  'BSD-3-Clause': {
    kind: 'Permissive',
    summary:
      'Use it freely. You may not use the authors’ names to promote your product.',
    permissions: PERMITS,
    conditions: [NOTICE],
    limitations: AS_IS,
  },
  'Apache-2.0': {
    kind: 'Permissive, with a patent grant',
    summary:
      'Use it freely, and contributors grant you the patents their code needs.',
    permissions: WITH_PATENTS,
    conditions: [NOTICE, 'State changes'],
    limitations: ['Trademark use', ...AS_IS],
  },
  'MPL-2.0': {
    kind: 'Weak copyleft',
    summary:
      'Changes to these files stay open. The rest of your project can stay yours.',
    permissions: WITH_PATENTS,
    conditions: ['Disclose source', NOTICE, 'Same license (file)'],
    limitations: ['Trademark use', ...AS_IS],
  },
  'GPL-3.0': {
    kind: 'Strong copyleft',
    summary:
      'Anything you distribute that includes it must be open under the same license.',
    permissions: WITH_PATENTS,
    conditions: ['Disclose source', NOTICE, 'Same license', 'State changes'],
    limitations: AS_IS,
  },
  'AGPL-3.0': {
    kind: 'Network copyleft',
    summary:
      'Like the GPL, and it also applies when people use your modified version over a network.',
    permissions: WITH_PATENTS,
    conditions: [
      'Disclose source',
      NOTICE,
      'Network use is distribution',
      'Same license',
      'State changes',
    ],
    limitations: AS_IS,
  },
}

const fallback = (id: string): Facts => ({
  kind: 'See the license',
  summary: `Licensed under ${id}. Read the text below for what it allows.`,
  permissions: [],
  conditions: [],
  limitations: [],
})

function Column({
  title,
  hint,
  items,
  icon,
  tone,
}: {
  title: string
  hint: string
  items: Array<string>
  icon: React.ReactNode
  tone: string
}) {
  if (items.length === 0) return null
  return (
    <div className="min-w-0 space-y-2.5">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 ${tone}`}>{icon}</span>
            {i}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The text as it would be read: a heading, then paragraphs. Capitals stay as the license has them. */
function Text({ text }: { text: string }) {
  const [title, ...rest] = text.split('\n\n')
  return (
    <div className="max-w-[80ch] space-y-3.5 text-[15px] leading-relaxed">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {rest.map((p, i) => {
        const shouted = p === p.toUpperCase() && p.length > 80
        return (
          <p
            key={i}
            className={
              shouted
                ? 'text-[13px] leading-relaxed text-muted-foreground'
                : undefined
            }
          >
            {p}
          </p>
        )
      })}
    </div>
  )
}

/**
 * A license for a person: what it allows, what it asks and what it rules out,
 * then the text itself. The summary is ours, the text is the file.
 */
export function LicenseView({ id, text }: { id: string; text: string }) {
  const f = facts[id] ?? fallback(id)
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{id}</h2>
            <Chip tone="outline">{f.kind}</Chip>
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            {f.summary}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? (
              <ClipboardDocumentCheckIcon />
            ) : (
              <ClipboardDocumentIcon />
            )}
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={
              <a
                href={`https://spdx.org/licenses/${id}.html`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            SPDX
          </Button>
        </div>
      </div>

      {(f.permissions.length > 0 ||
        f.conditions.length > 0 ||
        f.limitations.length > 0) && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border bg-muted/30 p-5 sm:grid-cols-3">
          <Column
            title="Permissions"
            hint="What you can do"
            items={f.permissions}
            tone="text-success"
            icon={<CheckCircleIcon className="size-4" />}
          />
          <Column
            title="Conditions"
            hint="What you must do"
            items={f.conditions}
            tone="text-info"
            icon={<InformationCircleIcon className="size-4" />}
          />
          <Column
            title="Limitations"
            hint="What it rules out"
            items={f.limitations}
            tone="text-danger"
            icon={<XCircleIcon className="size-4" />}
          />
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The text below is the LICENSE file. The summary above is not part of
          it.
        </p>
        <Text text={text} />
      </div>
    </div>
  )
}
