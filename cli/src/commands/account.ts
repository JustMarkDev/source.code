import { SxError, exit, print, table } from '../output'
import { readConfig, writeConfig } from '../config'
import {
  accountNotFound,
  activeAccount,
  findAccount,
  personal,
} from '../account'
import { store } from '../fixtures'
import type { Command } from './types'

/** Who you are acting as. One login, any account you belong to, switched in one command. */
export const account: Command = (
  { rest: [sub = 'current', ...rest], flags },
  ctx,
) => {
  if (sub === 'list') {
    const active = activeAccount(flags)
    const rows = store.accounts.map((a) => ({
      handle: a.handle,
      name: a.name,
      kind: a.kind,
      role: a.role,
      active: a.handle === active.handle,
    }))
    print(ctx, rows, () =>
      table(
        rows.map((r) => [
          r.active ? '*' : '',
          r.handle,
          r.kind,
          r.role,
          r.name,
        ]),
        ['', 'ACCOUNT', 'KIND', 'ROLE', 'NAME'],
      ),
    )
    return
  }
  if (sub === 'current') {
    const a = activeAccount(flags)
    const data = {
      handle: a.handle,
      name: a.name,
      kind: a.kind,
      role: a.role,
      from: a.from,
      login: store.login,
    }
    print(
      ctx,
      data,
      () =>
        `${a.handle}  ${a.kind}, ${a.role}  (from ${a.from})\nsigned in as ${store.login}`,
    )
    return
  }
  if (sub === 'switch') {
    const handle = rest.at(0)
    if (!handle)
      throw new SxError(
        'missing_argument',
        'account switch needs a handle.',
        'Example: sx account switch northwind. sx account list shows yours.',
        exit.usage,
      )
    const target = findAccount(handle)
    if (!target) throw accountNotFound(handle)
    const previous = readConfig().account || personal().handle
    // Switching to where you already are changes nothing, so it is safe to repeat.
    const switched = previous !== target.handle
    if (switched && flags['dry-run'] !== true)
      writeConfig({ ...readConfig(), account: target.handle })
    // SX_ACCOUNT beats the saved account, so say so rather than let it look broken.
    const overriddenBy =
      process.env.SX_ACCOUNT && process.env.SX_ACCOUNT !== target.handle
        ? 'SX_ACCOUNT'
        : null
    const data = {
      handle: target.handle,
      name: target.name,
      kind: target.kind,
      role: target.role,
      switched,
      previous,
      overriddenBy,
    }
    print(ctx, data, () =>
      overriddenBy
        ? `saved ${target.handle}, but SX_ACCOUNT is set in this shell and wins`
        : switched
          ? `now acting as ${target.handle}`
          : `already acting as ${target.handle}`,
    )
    return
  }
  throw new SxError(
    'unknown_command',
    `account ${sub} is not a command.`,
    'sx account --help lists them.',
    exit.usage,
  )
}
