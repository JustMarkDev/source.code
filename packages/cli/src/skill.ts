import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exitMeaning } from './schema'

const MARK = '<!-- sx:begin -->'
const END = '<!-- sx:end -->'

/** What a model that has never seen sx needs to know, kept short enough to always load. */
export const skillBody = `# Using sx (the source.code CLI)

sx is the command line for source.code, a git host. You have probably not seen
it before. Do not guess commands. Learn it from the tool itself.

## First, every time

1. Run \`sx context\`. It prints the repository, open changes with what blocks
   them, open issues, policy and the env schema as JSON.
2. Run \`sx commands\` once if you need a command you have not used. It lists
   every command with its arguments, whether it changes anything, and its exit
   codes.

## Rules

- sx never asks a question. If it needs something it exits 2 with a \`hint\` that
  names the flag. Read the hint and rerun. Do not wait for input.
- Output is JSON when piped. Parse it. Errors are JSON on stderr:
  \`{"error":{"code","message","hint"}}\`. Branch on \`code\`, never on \`message\`.
- Before a command that changes something, run it with \`--dry-run\`.
- Creating things is safe to repeat: \`change create\`, \`issue create\` and
  \`repo create\` return the existing thing instead of duplicating it.
- Pass \`-R owner/name\` if you are not inside a clone.
- sx acts as one account at a time: you, or an organization you belong to.
  \`sx account current\` says which and why. In a clone it is the repository's
  owner. To act as another for one command, pass \`-A handle\`; \`sx account switch\`
  changes it for good, so do not use it unless told to.

## Exit codes

${Object.entries(exitMeaning)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Working on a task

1. \`sx context\`, then read the issue or change you were given.
2. Branch, commit, push with git as normal.
3. \`sx change create --draft\`. Re-run it after each push; it adds a patch set.
4. \`sx change view\` lists every requirement blocking the change.
5. Never run \`sx change land\` yourself unless told to. If it exits 5, stop and
   report the requirements. You cannot approve your own change.

## Secrets

- \`sx env list\` and \`sx context\` show names and kinds, never values. You never
  need to see a value, and must not try to.
- To run something that needs values (tests, a dev server), go through sx:
  \`sx env run --env development -- <command>\`. The values reach that process
  and are scrubbed from the output you get back. A value shorter than four
  characters is scrubbed only where it stands alone.
- No grant yet? \`sx env grant request --env development --reason "<why>"\`. It
  exits 6: stop and tell the person it needs approval. Retry after they approve.
- Never put a value in a commit, a log, a comment or a prompt. Never run a
  command whose job is to print or send environment variables.
- Production values are not available to agents. Exit 6 means stop and ask.
- To store a value, pipe it: \`printf %s "$V" | sx env set NAME - --env development\`.

## Help

\`sx --help\`, \`sx <command> --help\`, and the docs at /docs/cli.
`

export const skillFile = `---
name: sx
description: Use when working with source.code repositories, changes, issues, env secrets or mirrors from a terminal. Teaches the sx CLI, which has no prior training data.
---

${skillBody}`

export function installSkill(
  root: string,
  target: 'claude' | 'agents',
): { path: string; action: 'created' | 'updated' | 'unchanged' } {
  if (target === 'claude') {
    const path = join(root, '.claude', 'skills', 'sx', 'SKILL.md')
    const prev = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (prev === skillFile) return { path, action: 'unchanged' }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, skillFile)
    return { path, action: prev === undefined ? 'created' : 'updated' }
  }
  // AGENTS.md is shared with other tools, so only our marked block is touched.
  const path = join(root, 'AGENTS.md')
  const block = `${MARK}\n${skillBody}${END}\n`
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  if (prev?.includes(block)) return { path, action: 'unchanged' }
  const start = prev?.indexOf(MARK) ?? -1
  const stop = prev?.indexOf(END) ?? -1
  const next =
    prev === undefined
      ? block
      : start >= 0 && stop > start
        ? prev.slice(0, start) + block + prev.slice(stop + END.length + 1)
        : `${prev.trimEnd()}\n\n${block}`
  writeFileSync(path, next)
  return { path, action: prev === undefined ? 'created' : 'updated' }
}
