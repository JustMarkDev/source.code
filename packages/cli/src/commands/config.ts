import { SxError, exit, print, table } from '../output'
import {
  configPath,
  isKey,
  keys,
  readConfig,
  resolve,
  writeConfig,
} from '../config'
import type { Command } from './types'

export const config: Command = ({ rest }, ctx) => {
  const sub = rest.at(0) ?? 'list'
  const key = rest.at(1)
  const value = rest.at(2)
  if (sub === 'path') {
    print(ctx, { path: configPath() }, () => configPath())
    return
  }
  if (sub === 'list') {
    const rows = keys.map((k) => ({ key: k, ...resolve(k) }))
    print(ctx, rows, () =>
      table(
        rows.map((r) => [r.key, r.value, r.from]),
        ['KEY', 'VALUE', 'FROM'],
      ),
    )
    return
  }
  if (key === undefined || !isKey(key))
    throw new SxError(
      'unknown_key',
      `${key ?? '(none)'} is not a setting.`,
      `Settings: ${keys.join(', ')}.`,
      exit.usage,
    )
  if (sub === 'get') {
    const r = resolve(key)
    print(ctx, { key, ...r }, () => r.value)
    return
  }
  if (sub === 'set') {
    if (value === undefined)
      throw new SxError(
        'missing_argument',
        'config set needs a key and a value.',
        'Example: sx config set agent.target boat',
        exit.usage,
      )
    writeConfig({ ...readConfig(), [key]: value })
    print(ctx, { key, value }, () => `${key} = ${value}`)
    return
  }
  throw new SxError(
    'unknown_command',
    `config ${sub} is not a command.`,
    'sx config --help lists them.',
    exit.usage,
  )
}
