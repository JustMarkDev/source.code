import { SxError, exit, print } from '../output'
import { activeAccount } from '../account'
import { resolve } from '../config'
import type { Command } from './types'

export const auth: Command = ({ rest: [sub = 'status'], flags }, ctx) => {
  const token = process.env.SX_TOKEN
  if (sub === 'status') {
    const data = {
      host: resolve('host').value,
      authenticated: !!token,
      via: token ? 'SX_TOKEN' : null,
      // Who the token acts as, once signed in. `sx account list` shows the others.
      account: token ? activeAccount(flags).handle : null,
    }
    print(ctx, data, () =>
      token
        ? `signed in to ${data.host} with SX_TOKEN`
        : `not signed in to ${data.host}`,
    )
    return token ? exit.ok : exit.auth
  }
  if (sub === 'login')
    throw new SxError(
      'not_available',
      'Browser sign-in needs the hosted service, which is not live yet.',
      'In scripts and agents, set SX_TOKEN to a token from Settings, Agents and tokens.',
      exit.error,
    )
  throw new SxError(
    'unknown_command',
    `auth ${sub} is not a command.`,
    'sx auth --help lists them.',
    exit.usage,
  )
}
