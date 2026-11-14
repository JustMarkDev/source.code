/**
 * The rules for an address (`source.code/<handle>`), shared by the server,
 * which enforces them (sign-in in `convex/auth.ts`, organizations in the
 * domain), and the app, which explains them before asking. Plain functions
 * that import nothing, so Convex can bundle this file on its own.
 */

/** 1 to 24 lowercase letters, numbers or dashes; no dash at either end. */
export const isValidHandle = (handle: string) =>
  /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(handle)

/** Names that are routes or belong to us. An account can never be called these. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'support',
  'api',
  'docs',
  'design',
  'discover',
  'dashboard',
  'inbox',
  'new',
  'pricing',
  'status',
  'settings',
  'organizations',
  'privacy',
  'terms',
  'welcome',
  'sign-in',
  'sign-up',
  'forgot-password',
  'compare',
  'mcp',
  'llms',
  'about',
  'help',
  'login',
  'logout',
])

const ADJECTIVES = [
  'quiet',
  'bright',
  'brave',
  'calm',
  'clever',
  'eager',
  'gentle',
  'happy',
  'keen',
  'lucky',
  'mellow',
  'nimble',
  'proud',
  'swift',
  'warm',
  'witty',
]
const NOUNS = [
  'otter',
  'heron',
  'maple',
  'comet',
  'harbor',
  'lantern',
  'meadow',
  'pebble',
  'falcon',
  'willow',
  'ember',
  'summit',
  'river',
  'badger',
  'cedar',
  'orchid',
]

/**
 * The address a new account starts with: two words and a number, like
 * `quiet-otter-482`. It says nothing about who the account is, so nobody can
 * sign up as someone else's name or a company's. `pick` chooses an index
 * below its argument; the default is random.
 */
export function randomHandle(
  pick: (below: number) => number = (below) =>
    Math.floor(Math.random() * below),
): string {
  return `${ADJECTIVES[pick(ADJECTIVES.length)]}-${NOUNS[pick(NOUNS.length)]}-${100 + pick(900)}`
}
