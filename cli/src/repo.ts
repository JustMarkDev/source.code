import { SxError, exit } from './output'
import { store } from './fixtures'
import type { Repo } from './fixtures'

function git(args: Array<string>): string | undefined {
  try {
    const r = Bun.spawnSync(['git', ...args], { stderr: 'ignore' })
    return r.exitCode === 0 ? r.stdout.toString().trim() : undefined
  } catch {
    return undefined
  }
}

/** What sx can work out from the folder you are in, so you never have to say it. */
export function gitContext() {
  const remote = git(['remote', 'get-url', 'origin'])
  const match = remote?.match(/source\.code[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
  return {
    slug: match?.at(1),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    subject: git(['log', '-1', '--format=%s']),
  }
}

/** `-R owner/name`, then `SX_REPO`, then the git remote. */
export function resolveRepo(flag: string | undefined): Repo {
  const slug = flag ?? process.env.SX_REPO ?? gitContext().slug
  if (!slug)
    throw new SxError(
      'repo_unknown',
      'Could not tell which repository you mean.',
      'Run inside a clone, pass -R owner/name, or set SX_REPO.',
      exit.usage,
    )
  const repo = store.repos.find((r) => r.slug === slug)
  if (!repo)
    throw new SxError(
      'repo_not_found',
      `No repository named ${slug}.`,
      'sx repo list shows what you can see.',
      exit.notFound,
    )
  return repo
}
