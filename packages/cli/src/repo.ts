import { SxError, exit } from './output'

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

/** The commit HEAD is, with its whole message. */
export function headCommit(): { sha: string; message: string } | undefined {
  const sha = git(['rev-parse', 'HEAD'])
  const message = git(['log', '-1', '--format=%B'])
  return sha && message !== undefined ? { sha, message } : undefined
}

/** Rewrites HEAD's message, keeping its tree. Answers the new commit. */
export function amendHead(message: string): string | undefined {
  try {
    const r = Bun.spawnSync(
      ['git', 'commit', '--amend', '--no-verify', '--allow-empty', '-F', '-'],
      { stdin: new TextEncoder().encode(message), stderr: 'ignore' },
    )
    return r.exitCode === 0 ? git(['rev-parse', 'HEAD']) : undefined
  } catch {
    return undefined
  }
}

export type RepoRef = {
  slug: string
  owner: string
  name: string
  path: string
}

/** `-R owner/name`, then `SX_REPO`, then the git remote. Whether it exists is the API's to say. */
export function resolveRepo(flag: string | undefined): RepoRef {
  const slug = flag ?? process.env.SX_REPO ?? gitContext().slug
  if (!slug)
    throw new SxError(
      'repo_unknown',
      'Could not tell which repository you mean.',
      'Run inside a clone, pass -R owner/name, or set SX_REPO.',
      exit.usage,
    )
  const [owner, name, ...extra] = slug.split('/')
  if (!owner || !name || extra.length)
    throw new SxError(
      'repo_unknown',
      `${slug} is not owner/name.`,
      'Pass -R owner/name.',
      exit.usage,
    )
  return { slug, owner, name, path: `/repos/${owner}/${name}` }
}
