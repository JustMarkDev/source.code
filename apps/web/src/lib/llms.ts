/**
 * The docs as plain text for agents. Models have not seen source.code or sx,
 * so we publish an index (/llms.txt) and the full text (/llms-full.txt).
 */
const raw = import.meta.glob<string>('/content/docs/**/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

type Page = { url: string; title: string; description: string; body: string }

function parse(path: string, src: string): Page {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/)
  const front = m?.[1] ?? ''
  const field = (k: string) =>
    front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? ''
  const slug = path
    .replace('/content/docs/', '')
    .replace(/\.mdx$/, '')
    .replace(/(^|\/)index$/, '')
  return {
    url: `/docs${slug ? `/${slug}` : ''}`,
    title: field('title'),
    description: field('description'),
    body: src.slice(m?.[0].length ?? 0).trim(),
  }
}

export const pages: Array<Page> = Object.entries(raw)
  .map(([p, s]) => parse(p, s))
  .sort((a, b) => a.url.localeCompare(b.url))

export function llmsIndex(origin: string) {
  return [
    '# source.code',
    '',
    '> A git host that keeps your history, reviews changes, and is built for people who work with agents. Its command line is `sx`. Neither is in any model training data: read the pages below instead of guessing.',
    '',
    '## Start here',
    `- [Teach an agent to use sx](${origin}/docs/cli/agent-guide): the skill, \`sx context\`, \`sx commands\`.`,
    `- [The HTTP API for agents](${origin}/docs/api/agents): discovery, planning with simulate and dry run, safe retries, what to do on each error.`,
    `- [Full docs as one file](${origin}/llms-full.txt)`,
    '',
    '## Docs',
    ...pages.map((p) => `- [${p.title}](${origin}${p.url}): ${p.description}`),
    '',
  ].join('\n')
}

export function llmsFull(origin: string) {
  return pages
    .map((p) => `# ${p.title}\nSource: ${origin}${p.url}\n\n${p.body}`)
    .join('\n\n---\n\n')
}
