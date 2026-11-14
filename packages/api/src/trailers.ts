/**
 * The `Run-Id:` commit trailer: which agent run made a commit, written into
 * the commit itself so the link survives a rebase, a cherry-pick or a copy on
 * another host.
 *
 *   Fix the flaky cache test
 *
 *   Change-Id: I8c1f…
 *   Run-Id: run_01J…
 *
 * Whether a repository keeps it is a setting (`run_trailer`): `auto` keeps it
 * in private repositories and removes it in public ones, where a run id is
 * nobody else's business. When it is off, the trailer is removed before a
 * commit is mirrored; commits that landed here can still be traced through
 * the patch sets their runs pushed.
 */

export const RUN_TRAILER = 'Run-Id'

const LINE = /^Run-Id:[ \t]*(run_[A-Za-z0-9]+)[ \t]*$/m

/** The run a commit message names, if it names one. */
export function runIdOf(message: string): string | null {
  return LINE.exec(message)?.[1] ?? null
}

/** Whether a repository keeps the trailer. */
export function runTrailerOn(repo: {
  visibility: 'public' | 'private'
  run_trailer?: 'auto' | 'on' | 'off'
}): boolean {
  const mode = repo.run_trailer ?? 'auto'
  return mode === 'auto' ? repo.visibility === 'private' : mode === 'on'
}

/**
 * The message with `Run-Id: <run>` among its trailers: right under
 * `Change-Id:` when there is one, otherwise at the end of the trailer block,
 * which is started if the message has none. A message that already names
 * this run is returned as it is; one that names another run is corrected.
 */
export function withRunTrailer(message: string, run: string): string {
  const body = message.replace(/\s+$/, '')
  if (runIdOf(body) === run) return `${body}\n`
  const clean = withoutRunTrailer(body).replace(/\s+$/, '')
  const lines = clean.split('\n')
  const change = lines.findIndex((l) => /^Change-Id:/i.test(l))
  if (change >= 0) {
    lines.splice(change + 1, 0, `${RUN_TRAILER}: ${run}`)
    return `${lines.join('\n')}\n`
  }
  // A trailer block is the last paragraph, when every line in it is `Key: value`.
  const lastBreak = clean.lastIndexOf('\n\n')
  const last = lastBreak >= 0 ? clean.slice(lastBreak + 2) : ''
  const isTrailers =
    lastBreak >= 0 && last.split('\n').every((l) => /^[A-Za-z0-9-]+:\s/.test(l))
  return isTrailers
    ? `${clean}\n${RUN_TRAILER}: ${run}\n`
    : `${clean}\n\n${RUN_TRAILER}: ${run}\n`
}

/** The message without any `Run-Id:` trailer, and without a trailer block it leaves empty. */
export function withoutRunTrailer(message: string): string {
  if (!LINE.test(message)) return message
  const out = message
    .split('\n')
    .filter((l) => !l.startsWith('Run-Id:'))
    .join('\n')
  return out.replace(/\n{3,}/g, '\n\n').replace(/\n\n+$/, '\n')
}

/** A commit message as it goes to a mirror: without the trailer unless the repository keeps it. */
export function messageForMirror(
  message: string,
  repo: Parameters<typeof runTrailerOn>[0],
): string {
  return runTrailerOn(repo) ? message : withoutRunTrailer(message)
}
