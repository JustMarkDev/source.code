/**
 * A short, readable form of the objects an agent reads first, for
 * `Accept: text/markdown`. It carries the same facts as the JSON, in less text,
 * and it is built from the JSON, so the two cannot disagree.
 */
type Json = Record<string, any>

const line = (...parts: Array<string | null | undefined | false>) =>
  parts.filter(Boolean).join(' ')
const who = (a: Json | null | undefined) =>
  a ? `@${a.handle}${a.class !== 'human' ? ` (${a.class})` : ''}` : 'nobody'

export function changeMarkdown(c: Json): string {
  const out: Array<string> = []
  out.push(`# #${c.number} ${c.title}`)
  out.push(
    line(
      `**${c.state}**`,
      `by ${who(c.author)}`,
      `· ${c.repo.full_name} · \`${c.branch}\` → \`${c.base}\``,
      c.stack ? `· stack ${c.stack.position}/${c.stack.size}` : '',
    ),
  )
  out.push(
    `Patch set ${c.head.patch_set} (tree \`${c.head.tree}\`) · ${c.stats.files} files, +${c.stats.additions} −${c.stats.deletions} · checks ${c.checks.state} (${c.checks.passed} passed, ${c.checks.failed} failed, ${c.checks.pending} pending)`,
  )
  if (c.description) out.push('', c.description.trim())
  out.push('', `## Policy: ${c.policy.state}`)
  if (c.policy.blocking.length)
    for (const b of c.policy.blocking) out.push(`- blocking: ${b}`)
  else out.push('Nothing is blocking.')
  if (c.reviewers.length) {
    out.push('', '## Reviews')
    for (const r of c.reviewers)
      out.push(
        `- ${who(r.actor)}: ${r.state} on patch set ${r.patch_set}${r.carries_to_head ? '' : ' (does not carry to head)'}`,
      )
  }
  if (c.findings?.length) {
    out.push('', '## Findings')
    for (const f of c.findings)
      out.push(
        `- ${f.label} [${f.severity}, ${f.state}] ${f.by}${f.reason ? `: ${f.reason}` : ''}`,
      )
  }
  if (c.actions) {
    out.push('', '## You can')
    for (const [name, a] of Object.entries(c.actions as Record<string, Json>))
      out.push(
        `- ${name}: ${a.allowed ? 'yes' : `no${a.reasons.length ? ` (${a.reasons.join('; ')})` : ''}`}`,
      )
  }
  out.push('', `<${c.url}> · version ${c.version}`)
  return `${out.join('\n')}\n`
}

export function issueMarkdown(i: Json): string {
  const out = [
    `# #${i.number} ${i.title}`,
    line(
      `**${i.state}**`,
      `by ${who(i.author)}`,
      `· ${i.repo.full_name}`,
      i.labels.length ? `· labels: ${i.labels.join(', ')}` : '',
    ),
  ]
  if (i.body) out.push('', i.body.trim())
  out.push('', `<${i.url}> · version ${i.version}`)
  return `${out.join('\n')}\n`
}

export function contextMarkdown(c: Json): string {
  const out: Array<string> = [`# ${c.repo.full_name}`]
  if (c.repo.description) out.push(c.repo.description)
  out.push(
    `${c.repo.visibility} · default branch \`${c.repo.default_branch}\` · policy ${c.policy.mode} (${c.policy.rules} rules)`,
  )
  out.push('', `## Changes (${c.changes.length} open)`)
  if (!c.changes.length) out.push('None.')
  for (const ch of c.changes)
    out.push(
      `- #${ch.number} ${ch.title} — ${ch.state}, ${who(ch.author)}, checks ${ch.checks}, policy ${ch.policy}${ch.blocking.length ? `, blocking: ${ch.blocking.join('; ')}` : ''}`,
    )
  out.push('', `## Issues (${c.issues.length} open)`)
  if (!c.issues.length) out.push('None.')
  for (const i of c.issues)
    out.push(
      `- #${i.number} ${i.title}${i.labels.length ? ` [${i.labels.join(', ')}]` : ''}`,
    )
  if (c.env.length) {
    out.push('', '## Environment (names only)')
    for (const e of c.env)
      out.push(
        `- ${e.name} (${e.kind}) set in: ${e.set.length ? e.set.join(', ') : 'nowhere'}`,
      )
  }
  out.push(
    '',
    `Continue with \`GET /sync?repo=${c.repo.full_name}&cursor=${c.cursor}\`.`,
  )
  return `${out.join('\n')}\n`
}
