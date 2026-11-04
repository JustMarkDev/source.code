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
  commands  every command as JSON (for agents)
  skill     print or install the agent skill that teaches sx
  mcp       serve the MCP server over stdio
  auth      status, login
  completion  bash, zsh, fish

Using an agent? Run: sx skill install   (then it knows sx), or: sx commands

Flags on every command
  -R, --repo owner/name   which repository (default: the git remote)
  -j, --json              JSON output (default when piped)
  -n, --dry-run           say what would happen, change nothing
      --no-color          or set NO_COLOR

Exit codes
  0 ok  1 error  2 usage  3 not found  4 not signed in  5 policy blocked  6 needs a human
`

export const groupHelp: Record<string, string> = {
  change: `sx change <command>

  list [--all]            open changes, or every change
  view [id]               one change and what blocks it (default: current branch)
  create [--draft]        make a change from the current branch
                          title = last commit, base = default branch
                          run again to add a patch set
  land [id]               land a change if policy allows
  checkout <id>           print the git command to switch to its branch
`,
  repo: `sx repo <command>

  list                    repositories you can see
  view                    the current repository
  create owner/name       create one (--private, --description)
  clone owner/name        print the clone command (uses clone.protocol)
`,
  issue: `sx issue <command>

  list [--state all]      open issues by default
  view <n>
  create <title>          --label bug,docs. Same title twice returns the open one.
  close <n>
`,
  env: `sx env <command>   (--env development|preview|production)

  list                    names, kinds and whether each has a value. Never values.
  set <NAME> <value|->    encrypt a value for an environment (- reads stdin)
  pull                    write .env.local for an environment
  run -- <command>        run with values injected into that process only; output is scrubbed
  grant request|list|approve|revoke   time-limited access for agents (development only)
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
  config: `sx config <command>

  list                    every setting, its value and where it came from
  get <key>
  set <key> <value>
  path                    where the file lives
`,
}

export const completions: Record<string, string> = {
  bash: `_sx() { COMPREPLY=($(compgen -W "repo change issue env policy mirror agent context config auth skill mcp commands completion" -- "\${COMP_WORDS[COMP_CWORD]}")); }
complete -F _sx sx
`,
  zsh: `#compdef sx
_arguments '1: :(repo change issue env policy mirror agent context config auth skill mcp commands completion)'
`,
  fish: `complete -c sx -f -a "repo change issue env policy mirror agent context config auth skill mcp commands completion"
`,
}
