import { resolveRepo } from '../repo'
import { SxError, exit, print } from '../output'
import { has, str } from '../args'
import { resolve } from '../config'
import type { Command } from './types'

const targets = ['t3', 'boat', 'e2b'] as const

export const agent: Command = async (
  { rest: [sub = 'start', ...rest], flags },
  ctx,
) => {
  const repo = resolveRepo(str(flags, 'repo'))
  if (sub !== 'start')
    throw new SxError(
      'unknown_command',
      `agent ${sub} is not a command.`,
      'sx agent start <issue|change> hands work to an agent.',
      exit.usage,
    )
  const subject = rest.at(0)
  if (!subject)
    throw new SxError(
      'missing_argument',
      'agent start needs an issue or change.',
      'Example: sx agent start 4   or   sx agent start 216',
      exit.usage,
    )
  const target = str(flags, 'target') ?? resolve('agent.target').value
  if (!(targets as ReadonlyArray<string>).includes(target))
    throw new SxError(
      'bad_target',
      `${target} is not an agent target.`,
      `Use one of: ${targets.join(', ')}.`,
      exit.usage,
    )
  const runtime = str(flags, 'runtime') ?? resolve('agent.runtime').value
  const n = subject.replace(/^#/, '')
  // A number is a change or an issue; the API says which.
  const api = ctx.api()
  const ref = (await api.get(`${repo.path}/numbers/${n}`).catch(() => null))
    ?.json
  if (!ref)
    throw new SxError(
      'not_found',
      `${subject} is not an issue or change here.`,
      'sx issue list and sx change list show what exists.',
      exit.notFound,
    )
  const title = (
    await api.get(
      `${repo.path}/${ref.type === 'change' ? 'changes' : 'issues'}/${n}`,
    )
  ).json.title as string
  // The prompt carries names and structure only. Secret values are a separate,
  // expiring grant, never part of this.
  const prompt = `Work on ${repo.slug} #${n}: ${title}. Open a draft change. If you have not used sx, run "sx skill" first, then "sx context" for policies and the env schema.`
  const command =
    target === 't3'
      ? `t3 thread start . ${JSON.stringify(prompt)} --worktree main`
      : `# ${target} is started from the ${target} dashboard or its API; paste this prompt there`
  print(
    ctx,
    {
      target,
      runtime,
      subject,
      type: ref.type,
      prompt,
      command,
      started: false,
      dryRun: has(flags, 'dry-run'),
    },
    () => command,
  )
}
