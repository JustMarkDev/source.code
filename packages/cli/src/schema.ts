/**
 * The CLI described as data. `sx commands` prints it so an agent can learn the
 * whole surface in one call instead of guessing from help text.
 */

export type CommandSpec = {
  command: string
  summary: string
  args: string
  /** Changes something, so `--dry-run` is worth running first. */
  mutates: boolean
  /** Safe to run twice: the second run returns the existing thing. */
  idempotent: boolean
  /** Exit codes beyond 0 this command can return. */
  exits: Array<number>
  example: string
}

export const schema: Array<CommandSpec> = [
  {
    command: 'context',
    summary:
      'Everything needed to start: repo, open changes and what blocks them, open issues, policy, env schema. No secret values.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [2, 3],
    example: 'sx context',
  },
  {
    command: 'account list',
    summary:
      'Every account you can act as (yourself and your organizations), your role in each, and which one is in use.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [],
    example: 'sx account list',
  },
  {
    command: 'account current',
    summary:
      'Who commands act as now and why: -A, SX_ACCOUNT, the repository you are in, a saved setting, or your own account.',
    args: '[-A handle]',
    mutates: false,
    idempotent: true,
    exits: [3],
    example: 'sx account current',
  },
  {
    command: 'account switch',
    summary:
      'Act as another account from now on. Saved in settings; repeating it changes nothing. For one command only, pass -A handle instead.',
    args: '<handle>',
    mutates: true,
    idempotent: true,
    exits: [2, 3],
    example: 'sx account switch northwind',
  },
  {
    command: 'repo list',
    summary:
      'Repositories of the account you act as. Add --all for every account you can act as.',
    args: '[--all]',
    mutates: false,
    idempotent: true,
    exits: [],
    example: 'sx repo list',
  },
  {
    command: 'repo view',
    summary: 'The current repository.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [2, 3],
    example: 'sx repo view -R dana/gitfs',
  },
  {
    command: 'repo create',
    summary:
      'Create a repository. A bare name goes in the account you act as; owner/name picks the owner. Members of an organization cannot create there.',
    args: '<name | owner/name> [--private] [--description t]',
    mutates: true,
    idempotent: true,
    exits: [2, 3, 5],
    example: 'sx repo create notes -A northwind',
  },
  {
    command: 'repo clone',
    summary: 'Print the git clone command.',
    args: '<owner/name>',
    mutates: false,
    idempotent: true,
    exits: [2],
    example: 'sx repo clone dana/gitfs',
  },
  {
    command: 'change list',
    summary: 'Open changes (--all for landed too).',
    args: '[--all]',
    mutates: false,
    idempotent: true,
    exits: [2, 3],
    example: 'sx change list',
  },
  {
    command: 'change view',
    summary:
      'One change and every requirement blocking it. Defaults to the current branch.',
    args: '[id]',
    mutates: false,
    idempotent: true,
    exits: [2, 3],
    example: 'sx change view 216',
  },
  {
    command: 'change create',
    summary:
      'Make a change from the current branch. Title = last commit. Run again to add a patch set.',
    args: '[--draft] [--branch b] [--title t] [--base b]',
    mutates: true,
    idempotent: true,
    exits: [2],
    example: 'sx change create --draft',
  },
  {
    command: 'change land',
    summary:
      'Land a change if policy allows. Exits 5 and lists what is missing otherwise.',
    args: '[id]',
    mutates: true,
    idempotent: false,
    exits: [3, 5],
    example: 'sx change land 216',
  },
  {
    command: 'change checkout',
    summary: 'Print the git command that switches to a change branch.',
    args: '<id>',
    mutates: false,
    idempotent: true,
    exits: [3],
    example: 'sx change checkout 216',
  },
  {
    command: 'issue list',
    summary: 'Issues, open by default.',
    args: '[--state open|closed|all]',
    mutates: false,
    idempotent: true,
    exits: [2],
    example: 'sx issue list --state all',
  },
  {
    command: 'issue view',
    summary: 'One issue.',
    args: '<n>',
    mutates: false,
    idempotent: true,
    exits: [3],
    example: 'sx issue view 4',
  },
  {
    command: 'issue create',
    summary: 'Open an issue. The same open title returns the existing issue.',
    args: '<title> [--label a,b]',
    mutates: true,
    idempotent: true,
    exits: [2],
    example: 'sx issue create "Crash on empty repo" --label bug',
  },
  {
    command: 'issue close',
    summary: 'Close an issue.',
    args: '<n>',
    mutates: true,
    idempotent: true,
    exits: [3],
    example: 'sx issue close 4',
  },
  {
    command: 'env list',
    summary:
      'Variable names, kinds and whether each environment has a value. Never values.',
    args: '[--env development|preview|production]',
    mutates: false,
    idempotent: true,
    exits: [2],
    example: 'sx env list --env production',
  },
  {
    command: 'env set',
    summary:
      'Encrypt a value for an environment. Use - to read the value from stdin.',
    args: '<NAME> <value|-> [--env e]',
    mutates: true,
    idempotent: true,
    exits: [2],
    example: 'printf %s "$V" | sx env set STRIPE_KEY - --env production',
  },
  {
    command: 'env pull',
    summary: 'Write .env.local for an environment.',
    args: '[--env e]',
    mutates: true,
    idempotent: true,
    exits: [2],
    example: 'sx env pull --env development',
  },
  {
    command: 'policy check',
    summary: 'Exit 0 if a change meets every policy, 5 if blocked.',
    args: '<change>',
    mutates: false,
    idempotent: true,
    exits: [2, 5],
    example: 'sx policy check 216',
  },
  {
    command: 'policy explain',
    summary: 'The same, listing each requirement.',
    args: '<change>',
    mutates: false,
    idempotent: true,
    exits: [2, 5],
    example: 'sx policy explain 216',
  },
  {
    command: 'mirror list',
    summary: 'Copies of the repository on other hosts and their state.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [2],
    example: 'sx mirror list',
  },
  {
    command: 'mirror sync',
    summary: 'Sync one mirror now.',
    args: '<id>',
    mutates: true,
    idempotent: true,
    exits: [3],
    example: 'sx mirror sync m2',
  },
  {
    command: 'agent start',
    summary:
      'Build the prompt for an issue or change and print the command that starts an agent.',
    args: '<number> [--target t3|boat|e2b] [--runtime r]',
    mutates: false,
    idempotent: true,
    exits: [2, 3],
    example: 'sx agent start #4 --target t3',
  },
  {
    command: 'auth status',
    summary:
      'Whether you are signed in, to what, as whom, and with which scopes.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [4],
    example: 'sx auth status',
  },
  {
    command: 'auth login',
    summary:
      'Sign in with a code you approve in a browser (the device flow). Saves a token that refreshes itself, readable only by you. SX_TOKEN always wins.',
    args: '[--scope "a b c"]',
    mutates: true,
    idempotent: true,
    exits: [1, 2],
    example: 'sx auth login',
  },
  {
    command: 'auth logout',
    summary: 'Revoke the saved sign-in on the server and delete it here.',
    args: '',
    mutates: true,
    idempotent: true,
    exits: [],
    example: 'sx auth logout',
  },
  {
    command: 'skill',
    summary:
      'Print the agent skill that teaches sx. `skill install` writes it into the repository.',
    args: '[install [--target claude|agents]]',
    mutates: false,
    idempotent: true,
    exits: [],
    example: 'sx skill install',
  },
  {
    command: 'config list',
    summary: 'Every setting, its value and where it came from.',
    args: '',
    mutates: false,
    idempotent: true,
    exits: [],
    example: 'sx config list',
  },
]

export const exitMeaning: Record<number, string> = {
  0: 'ok',
  1: 'unexpected error',
  2: 'usage: a flag or argument is missing or wrong; the hint says which',
  3: 'not found',
  4: 'not signed in; set SX_TOKEN',
  5: 'policy blocked; stop and report the listed requirements, do not work around',
  6: 'needs a human',
}
