import { SxError, exit } from './output'
import { gitContext } from './repo'
import { resolve } from './config'
import { str } from './args'
import type { Ctx } from './output'
import type { Parsed } from './args'

export type Account = {
  handle: string
  name: string
  kind: 'person' | 'organization'
  role: 'owner' | 'admin' | 'member' | null
}

/** Where the account in use came from. `sx account` says so, so a surprise is easy to trace. */
export type From = 'flag' | 'env' | 'repo' | 'config' | 'default'
export type Active = Account & { from: From }

/** Every account you can act as, with your role in each. */
export async function accounts(ctx: Ctx): Promise<Array<Account>> {
  const r = await ctx.api().once('/accounts')
  return r.json.data as Array<Account>
}

/** Who the token is. */
export async function whoami(ctx: Ctx): Promise<{
  login: string
  class: 'human' | 'agent' | 'bot'
  scopes: Array<string>
}> {
  const r = await ctx.api().once('/auth/principal')
  return r.json
}

export async function findAccount(
  ctx: Ctx,
  handle: string,
): Promise<Account | undefined> {
  return (await accounts(ctx)).find((a) => a.handle === handle)
}

/** The person the token belongs to. Always one of the accounts. */
export async function personal(ctx: Ctx): Promise<Account> {
  const login = (await whoami(ctx)).login
  const own = await findAccount(ctx, login)
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

async function named(ctx: Ctx, handle: string, from: From): Promise<Active> {
  const a = await findAccount(ctx, handle)
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
export async function activeAccount(
  ctx: Ctx,
  flags: Parsed['flags'],
): Promise<Active> {
  const flag = str(flags, 'account')
  if (flag) return named(ctx, flag, 'flag')
  const env = process.env.SX_ACCOUNT
  if (env) return named(ctx, env, 'env')
  const slug = str(flags, 'repo') ?? process.env.SX_REPO ?? gitContext().slug
  const owner = slug?.split('/').at(0)
  if (owner && (await findAccount(ctx, owner))) return named(ctx, owner, 'repo')
  const saved = resolve('account').value
  if (saved) return named(ctx, saved, 'config')
  return { ...(await personal(ctx)), from: 'default' }
}
