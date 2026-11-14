/**
 * The `Run-Id:` commit trailer, as sx writes it. The server's reading of it
 * is `@source-code/api/trailers`; `trailer.test.ts` holds the two equal. It
 * is copied rather than imported so sx keeps no runtime dependency on the API.
 */

/** Whether a repository keeps the trailer: `auto` means private ones only. */
export function runTrailerOn(repo: {
  visibility: 'public' | 'private'
  run_trailer?: 'auto' | 'on' | 'off'
}): boolean {
  const mode = repo.run_trailer ?? 'auto'
  return mode === 'auto' ? repo.visibility === 'private' : mode === 'on'
}

/** The message with `Run-Id: <run>` under `Change-Id:`, or ending its trailers. */
export function withRunTrailer(message: string, run: string): string {
  const body = message.replace(/\s+$/, '')
  const clean = body
    .split('\n')
    .filter((l) => !l.startsWith('Run-Id:'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '')
  const lines = clean.split('\n')
  const change = lines.findIndex((l) => /^Change-Id:/i.test(l))
  if (change >= 0) {
    lines.splice(change + 1, 0, `Run-Id: ${run}`)
    return `${lines.join('\n')}\n`
  }
  const lastBreak = clean.lastIndexOf('\n\n')
  const last = lastBreak >= 0 ? clean.slice(lastBreak + 2) : ''
  const isTrailers =
    lastBreak >= 0 && last.split('\n').every((l) => /^[A-Za-z0-9-]+:\s/.test(l))
  return isTrailers
    ? `${clean}\nRun-Id: ${run}\n`
    : `${clean}\n\nRun-Id: ${run}\n`
}
