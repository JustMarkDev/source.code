/** A tiny argument parser: `--flag`, `--key value`, `--key=value`, `-R value`, positionals. */

export type Parsed = {
  positionals: Array<string>
  flags: Record<string, string | boolean>
}

const short: Record<string, string> = {
  R: 'repo',
  j: 'json',
  y: 'yes',
  n: 'dry-run',
  h: 'help',
}

/** Flags that never take a value, so `--json foo` keeps `foo` positional. */
const booleans = new Set([
  'json',
  'yes',
  'dry-run',
  'help',
  'wait',
  'draft',
  'no-color',
  'version',
  'all',
])

export function parse(argv: ReadonlyArray<string>): Parsed {
  const out: Parsed = { positionals: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out.positionals.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const parts = a.slice(2).split(/=(.*)/s, 2)
      const rawKey = parts.at(0) ?? ''
      const inline = parts.at(1)
      if (inline !== undefined) out.flags[rawKey] = inline
      else if (booleans.has(rawKey) || rawKey.startsWith('no-'))
        out.flags[rawKey] = true
      else {
        const next = argv.at(i + 1)
        if (next === undefined || next.startsWith('-')) out.flags[rawKey] = true
        else {
          out.flags[rawKey] = next
          i++
        }
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = short[a[1]] as string | undefined
      if (key === undefined) {
        out.flags[a[1]] = true
      } else if (booleans.has(key)) out.flags[key] = true
      else {
        out.flags[key] = argv.at(i + 1) ?? true
        i++
      }
    } else out.positionals.push(a)
  }
  return out
}

export function str(flags: Parsed['flags'], key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

export const has = (flags: Parsed['flags'], key: string) => flags[key] === true
