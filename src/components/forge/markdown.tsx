import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CheckIcon,
  ClipboardDocumentIcon,
  LinkIcon,
  ListBulletIcon,
} from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { LicenseView } from './license-view'
import type { Components } from 'react-markdown'
import type { ReactNode } from 'react'
import type { Repo } from '~/mock/data'
import { Button } from '~/components/ui/button'
import { StateTabs } from '~/components/ui/tabs'
import { Dropdown, MenuItem } from '~/components/ui/menu'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : React.isValidElement<{ children?: ReactNode }>(node)
        ? textOf(node.props.children)
        : ''

function Heading({
  level,
  children,
}: {
  level: 1 | 2 | 3
  children?: ReactNode
}) {
  const id = slug(textOf(children))
  const size =
    level === 1
      ? 'mt-0 text-3xl font-semibold tracking-tight'
      : level === 2
        ? 'mt-10 border-b pb-2 text-xl font-semibold tracking-tight'
        : 'mt-7 text-base font-semibold'
  // The repository page already has the h1. A README's # is the next level down.
  const Tag = (['h2', 'h3', 'h4'] as const)[level - 1]
  return (
    <Tag id={id} className={cn('group scroll-mt-24', size)}>
      {children}
      {level > 1 && (
        <a
          href={`#${id}`}
          aria-label="Link to this section"
          className="ml-1 inline-flex size-6 items-center justify-center align-middle text-muted-foreground/0 transition-colors group-hover:text-muted-foreground focus-visible:text-muted-foreground"
        >
          <LinkIcon className="size-4" />
        </a>
      )}
    </Tag>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="well my-5 overflow-hidden rounded-xl border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3.5 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-success" />
          ) : (
            <ClipboardDocumentIcon className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed"
      >
        {code}
      </pre>
    </div>
  )
}

const components: Components = {
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  p: ({ children }) => (
    <p className="my-4 leading-[1.75] text-foreground/85">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-4 space-y-1.5 pl-6 leading-[1.7] marker:text-muted-foreground',
        className?.includes('contains-task-list')
          ? 'list-none pl-1'
          : 'list-disc',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-1.5 pl-6 leading-[1.7] marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      tabIndex={-1}
      aria-label={checked ? 'Done' : 'Not done'}
      className="mr-2 size-4 translate-y-0.5 accent-[var(--brand-ink)]"
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-5 border-l-2 pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  table: ({ children }) => (
    <div
      tabIndex={0}
      className="surface my-5 overflow-x-auto rounded-xl border bg-card"
    >
      <table className="w-full border-collapse text-left text-[14px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b px-4 py-2.5 align-top [tr:last-child>&]:border-0">
      {children}
    </td>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const code = textOf(children).replace(/\n$/, '')
    const lang = /language-(\w+)/.exec(className ?? '')?.[1]
    // react-markdown gives block code a language class or a trailing newline.
    if (lang || textOf(children).endsWith('\n'))
      return <CodeBlock lang={lang ?? ''} code={code} />
    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em]">
        {children}
      </code>
    )
  },
}

export function headingsOf(
  source: string,
): Array<{ id: string; text: string; level: number }> {
  let fenced = false
  const out: Array<{ id: string; text: string; level: number }> = []
  for (const line of source.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const m = !fenced && /^(#{2,3})\s+(.+)$/.exec(line)
    if (m) out.push({ id: slug(m[2]), text: m[2], level: m[1].length })
  }
  return out
}

/** Renders markdown the way a README should read: calm type, anchors, copyable code. */
export function MarkdownBody({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  return (
    <div className={cn('text-[15.5px]', className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  )
}

/** A sample README for a project. Descriptions only: install and facts live in About. */
export function readmeFor(repo: Repo): string {
  const n = repo.name
  return `# ${n}

${repo.description}

${n} is small on purpose. It does one thing, keeps its dependencies to a minimum, and behaves the same on every platform.

## Why ${n}

- **Small and fast.** A single binary with no runtime to install.
- **Honest releases.** Every release is signed and ships with checksums.
- **The same everywhere.** macOS, Windows and Linux behave alike.
- **Local first.** Nothing leaves your machine unless you ask it to.

## A quick look

\`\`\`bash
${n} init
${n} run --watch
${n} --help
\`\`\`

## Configuration

${n} reads a small file in the project root. Every option has a sensible default.

| Option | Default | What it does |
| --- | --- | --- |
| \`watch\` | \`false\` | Rebuild when files change |
| \`cache\` | \`true\` | Keep results between runs |
| \`threads\` | \`auto\` | How many workers to use |
| \`log\` | \`warn\` | How much to say while working |

## Roadmap

- [x] Stable file format
- [x] Signed releases
- [ ] Plugin API
- [ ] A hosted mirror
`
}

/** CONTRIBUTING.md for a project. It has its own tab, so the README stays about the product. */
export function contributingFor(repo: Repo): string {
  const n = repo.name
  return `# Contributing to ${n}

Bug reports and small fixes are welcome. For anything larger, open an issue first so we can agree on the shape of it.

## Reporting a bug

Include the version (\`${n} --version\`), your platform, and the smallest steps that reproduce it. A failing test is even better.

## Sending a change

1. Fork the repository and branch from \`main\`.
2. Keep the change focused. One fix or feature per change.
3. Add or update tests, and run the full suite before you push.
4. Open a change and describe what it does and why.

## Local setup

\`\`\`bash
git clone https://source.code/${repo.owner}/${n}.git
cd ${n}
${n} init
${n} run --watch
\`\`\`

## Style

Follow the formatter. If a rule gets in your way, say so in the change and we will talk about it.

## Conduct

Be kind. Assume good faith. Maintainers may close threads that are not constructive.
`
}

const BSD_BODY = (
  year: number,
  owner: string,
) => `Copyright (c) ${year}, ${owner}
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

const PERMISSIVE_WARRANTY = `THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

/** The LICENSE file. Permissive licenses are shown in full; the long ones show their notice. */
export function licenseFor(repo: Repo): string {
  const year = 2026
  switch (repo.license) {
    case 'MIT':
      return `MIT License

Copyright (c) ${year} ${repo.owner}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

${PERMISSIVE_WARRANTY}`
    case 'ISC':
      return `ISC License

Copyright (c) ${year}, ${repo.owner}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
    case 'BSD-3-Clause':
      return `BSD 3-Clause License\n\n${BSD_BODY(year, repo.owner)}`
    default:
      return `${repo.name}
Copyright (c) ${year} ${repo.owner}

Licensed under the ${repo.license} license. You may not use this software except in compliance with the license.

The full license text is distributed with every release and can be read at
https://spdx.org/licenses/${repo.license}.html

Unless required by applicable law or agreed to in writing, the software is distributed on an "AS IS" basis, without warranties or conditions of any kind, either express or implied.`
  }
}

export type RepoDoc = 'readme' | 'contributing' | 'license'

/** The README card: README, Contributing and License swap in place, like tabs on one page. */
export function ReadmeCard({
  repo,
  doc,
  onDoc,
}: {
  repo: Repo
  doc: RepoDoc
  onDoc: (doc: RepoDoc) => void
}) {
  const source = React.useMemo(
    () =>
      doc === 'readme'
        ? readmeFor(repo)
        : doc === 'contributing'
          ? contributingFor(repo)
          : '',
    [repo, doc],
  )
  const outline = React.useMemo(() => headingsOf(source), [source])
  return (
    <section className="surface rounded-2xl border bg-card px-6 py-6 sm:px-9">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <StateTabs
          label="Documents"
          value={doc}
          onChange={onDoc}
          options={[
            { id: 'readme', label: 'README' },
            { id: 'contributing', label: 'Contributing' },
            { id: 'license', label: 'License' },
          ]}
        />
        {outline.length > 0 && (
          <Dropdown
            trigger={
              <Button size="sm" variant="ghost">
                <ListBulletIcon /> Outline
              </Button>
            }
          >
            {outline.map((h) => (
              <MenuItem
                key={h.id}
                render={<a href={`#${h.id}`} />}
                className={h.level === 3 ? 'pl-6' : undefined}
              >
                {h.text}
              </MenuItem>
            ))}
          </Dropdown>
        )}
      </div>
      {doc === 'license' ? (
        <LicenseView id={repo.license} text={licenseFor(repo)} />
      ) : (
        <MarkdownBody source={source} />
      )}
    </section>
  )
}
