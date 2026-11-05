import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SxError, exit } from './output'

/** Every key sx reads, with its default. Documented in docs/cli/config. */
export const defaults = {
  host: 'https://source.code',
  account: '',
  output: 'auto',
  'agent.target': 't3',
  'agent.runtime': 'claude',
  'change.base': 'main',
  'change.draft': 'false',
  'clone.protocol': 'ssh',
} as const

export type Key = keyof typeof defaults
export const keys = Object.keys(defaults) as Array<Key>

export function isKey(k: string): k is Key {
  return (keys as Array<string>).includes(k)
}

export function configPath(): string {
  const dir =
    process.env.SX_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sx')
  return join(dir, 'config.json')
}

export function readConfig(): Partial<Record<Key, string>> {
  const p = configPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Partial<Record<Key, string>>
  } catch {
    throw new SxError(
      'config_invalid',
      `${p} is not valid JSON.`,
      `Fix the file or delete it. sx config path prints its location.`,
      exit.error,
    )
  }
}

export function writeConfig(next: Partial<Record<Key, string>>) {
  const p = configPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n')
}

/** Environment beats the file, the file beats the default. `SX_HOST`, `SX_AGENT_TARGET`, … */
export function resolve(key: Key): { value: string; from: string } {
  const env = process.env[`SX_${key.toUpperCase().replace('.', '_')}`]
  if (env) return { value: env, from: 'env' }
  const file = readConfig()[key]
  if (file !== undefined) return { value: file, from: 'file' }
  return { value: defaults[key], from: 'default' }
}
