export const version = '0.1.0'

export const topHelp = `sx ${version}: the source.code command line

It never asks a question. Anything it cannot work out, it tells you to pass.
Output is JSON when piped or with --json.

Commands
  repo      list, view, create, clone
  change    list, view, create, land, checkout
  issue     list, view, create, close
  env       list, set, pull, run, grant, rotate, recipients
  policy    check, explain
  mirror    list, add, sync, remove
  agent     start (hand an issue or change to an agent)
  context   everything an agent needs, no secret values
  config    list, get, set, path
  account   list, current, switch (one login, any account)
  commands  every command as JSON (for agents)
  skill     print or install the agent skill that teaches sx
  mcp       serve the MCP server over stdio
  auth      status, login
  completion  bash, zsh, fish

Using an agent? Run: sx skill install   (then it knows sx), or: sx commands

Flags on every command
  -R, --repo owner/name   which repository (default: the git remote)
  -A, --account handle    act as this account (default: the repo's owner,
                          else the one you switched to, else you)
  -j, --json              JSON output (default when piped)
  -n, --dry-run           say what would happen, change nothing
      --no-color          or set NO_COLOR

Exit codes
  0 ok  1 error  2 usage  3 not found  4 not signed in  5 policy blocked  6 needs a human
`

export const groupHelp: Record<string, string> = {
  change: `sx change <command>

  list [--all]            open changes, or every change
  view [number]           one change and what blocks it (default: current branch)
  create [--draft]        make a change from the current branch
                          title = last commit, base = default branch
                          run again to add a patch set
                          --addresses cmt_1,cmt_2  threads the patch set fixes
                          in an agent run (SX_RUN), adds a Run-Id: trailer
  timeline [number]       everything that happened to it, oldest first
  presence [number]       who else is looking, and at which file
                          --here [--path f] says you are; --leave that you left
  guide [number]          what it does and the order to read its files in
                          --set '{"summary":…,"order":[{"path","why","risk"}]}'
  land [number]           land exactly the tree it just read, if policy allows
  checkout <number>       print the git command to switch to its branch
`,
  repo: `sx repo <command>

  list [--all]            repositories of the account you act as (--all: every account)
  view                    the current repository
  create <name>           create one in the account you act as (--private, --description)
                          or name the owner: create owner/name
  clone owner/name        print the clone command (uses clone.protocol)
`,
  issue: `sx issue <command>

  list [--state all]      open issues by default
  view <n>
  timeline <n>            comments, runs, linked changes, oldest first
  presence <n>            who else is looking (--here, --leave)
  create <title>          --label bug,docs. Same title twice returns the open one.
  close <n>
`,
  env: `sx env <command>   (--env development|preview|production)

  list                    names, kinds and whether each has a value. Never values.
  set <NAME> <value|->    encrypt a value for an environment (- reads stdin)
  pull                    write .env.local for an environment
  run -- <command>        run with values injected into that process only; output is scrubbed (short values when standalone)
  grant request|list|approve|revoke   time-limited access for agents (development or preview)
  rotate                  rotate the data key
  recipients              who can decrypt
`,
  policy: `sx policy <command>

  check <change>          exits 5 when the change is blocked
  explain <change>        the same, listing each requirement
`,
  mirror: `sx mirror <command>

  list
  add <host> <owner/name> --direction push|pull|two-way
  sync <id>
  remove <id>             stops mirroring. History here is untouched.
`,
  agent: `sx agent start <issue|change>   (--target t3|boat|e2b, --runtime claude|codex)

  Builds the prompt from the issue or change, the policies that apply and the
  env schema (never values), then prints the command that starts the agent.
`,
  account: `sx account <command>

  list                    every account you can act as, and your role in each
  current                 who you act as now, and why (flag, env, repo, setting, default)
  switch <handle>         act as that account from now on (saved in your settings)

  One login covers yourself and every organization you belong to, so there is
  nothing to sign in to again. Which account a command acts as, in order:
    1. -A, --account handle
    2. SX_ACCOUNT
    3. the owner of the repository you are in, when you can act as it
    4. the account saved by sx account switch
    5. you
`,
  auth: `sx auth <command>

  status                  signed in? to what, as whom, with which scopes (exit 4: no)
  login [--scope "a b"]   sign in with a code you approve in a browser (saves a token that refreshes)
  logout                  revoke the saved sign-in and delete it

  SX_TOKEN in the environment always wins over a saved sign-in. SX_API (or
  \`sx config set api <url>\`) says which server; with neither, sx runs the
  preview's sample data in this process.
`,
  config: `sx config <command>

  list                    every setting, its value and where it came from
  get <key>
  set <key> <value>
  path                    where the file lives
`,
}

export const completions: Record<string, string> = {
  bash: `_sx() { COMPREPLY=($(compgen -W "repo change issue env policy mirror agent context config account auth skill mcp commands completion" -- "\${COMP_WORDS[COMP_CWORD]}")); }
complete -F _sx sx
`,
  zsh: `#compdef sx
_arguments '1: :(repo change issue env policy mirror agent context config account auth skill mcp commands completion)'
`,
  fish: `complete -c sx -f -a "repo change issue env policy mirror agent context config account auth skill mcp commands completion"
`,
}
