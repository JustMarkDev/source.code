import { SxError, exit } from './output'
import { gitContext } from './repo'
import { resolve } from './config'
import { str } from './args'
import { store } from './fixtures'
import type { Account } from './fixtures'
import type { Parsed } from './args'

/** Where the account in use came from. `sx account` says so, so a surprise is easy to trace. */
export type From = 'flag' | 'env' | 'repo' | 'config' | 'default'
export type Active = Account & { from: From }

export const findAccount = (handle: string): Account | undefined =>
  store.accounts.find((a) => a.handle === handle)

/** The person the token belongs to. Always one of the accounts. */
export function personal(): Account {
  const own = findAccount(store.login)
  if (!own) throw new Error('The login has no account of its own.')
  return own
}

export function accountNotFound(handle: string): SxError {
  return new SxError(
    'account_not_found',
    `You cannot act as ${handle}.`,
    'sx account list shows the accounts you can act as. Ask an owner to invite you to an organization.',
    exit.notFound,
  )
}

function named(handle: string, from: From): Active {
  const a = findAccount(handle)
  if (!a) throw accountNotFound(handle)
  return { ...a, from }
}

/**
 * The account a command acts as. In order:
 *
 *  1. `-A, --account handle`
 *  2. `SX_ACCOUNT`
 *  3. the owner of the repository you are in (or pass with -R, or SX_REPO),
 *     when you can act as it: working in a clone needs no switching
 *  4. the account saved by `sx account switch`
 *  5. yourself
 *
 * One login covers every account, so there is nothing to sign in to again.
 */
export function activeAccount(flags: Parsed['flags']): Active {
  const flag = str(flags, 'account')
  if (flag) return named(flag, 'flag')
  const env = process.env.SX_ACCOUNT
  if (env) return named(env, 'env')
  const slug = str(flags, 'repo') ?? process.env.SX_REPO ?? gitContext().slug
  const owner = slug?.split('/').at(0)
  if (owner && findAccount(owner)) return named(owner, 'repo')
  const saved = resolve('account').value
  if (saved) return named(saved, 'config')
  return { ...personal(), from: 'default' }
}
