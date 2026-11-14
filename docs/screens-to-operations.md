# Screens and the operations behind them

2026-11-14. Every screen of the web app, the data it shows, the API
operations behind it, and what the API still lacks. Every screen has moved
off the old mock data; what is left of it is the screens' view types and
helpers, in `apps/web/src/lib/model/`.

Status: **covered** (the operations exist), **partly** (some of the screen),
**missing** (no operation), **moved** (the screen reads what the operation
answers, as the signed-in person, see "How a screen reads and writes").

## Signed-out and static screens

`/`, `/pricing`, `/privacy`, `/terms`, `/compare`, `/design`, `/docs/*`,
`/llms.txt` need no operation. `/status` reads `status.get`: what this server
measured of its own answers, and mirrors and runners as the domain holds them. `/sign-in`, `/sign-up`, `/forgot-password`
and `/welcome` belong to sign-in, not to the API (see Linked accounts below
for the import step of `/welcome`).

## Chrome, on every signed-in screen

| Part             | Calls                       | Operations                                     | Status | Missing |
| ---------------- | --------------------------- | ---------------------------------------------- | ------ | ------- |
| Who is signed in | Better Auth session         | `auth.principal`                               | moved  |         |
| Account switcher | `accounts.list`             | `accounts.list`                                | moved  |         |
| Search and jump  | `repos.list`, `people.list` | `search.query`, `repos.list`, `people.list`    | moved  |         |
| Unread count     | `notifications.count`       | `notifications.count`                          | moved  |         |
| Live updates     | Convex queries              | `events.stream`, `sync.get`, `?wait=` on reads | moved  |         |

## Account screens

| Screen                            | Calls                                                      | Operations                                                                               | Status | Missing                                                                       |
| --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `/dashboard`                      | `dashboard.get`, `repos.list`                              | `dashboard.get`                                                                          | moved  | Downloads by day before counting began                                        |
| `/discover`                       | `repos.list`, `people.list`                                | `repos.list`, `people.list`                                                              | moved  | Listing by category on the server                                             |
| `/inbox`                          | `notifications.*`                                          | `notifications.list`, `read`, `read_all`                                                 | moved  | Release notices wait for Releases                                             |
| `/new`                            | `repos.create`, `imports.create`, `links.list`             | `repos.create`, `imports.create`                                                         | moved  | Listing repositories on another host                                          |
| `/$handle` (profile)              | `accounts.profile`, `follows.*`, `repos.list`              | `accounts.profile`, `follows.add`, `follows.remove`, `repos.list?owner=`                 | moved  | Contributions from linked hosts                                               |
| `/organizations/new`              | `accounts.create`                                          | `accounts.create`                                                                        | moved  |                                                                               |
| `/organizations/$handle/$section` | `accounts.*`, `members.*`, `invitations.*`                 | `accounts.get`, `accounts.update`, `members.*`, `invitations.*`, `repos.list`, `teams.*` | moved  | Changing the address (dropped for now)                                        |
| `/settings/profile`               | `lib/auth/client.ts`                                       | `accounts.update` (name, bio)                                                            | partly | Changing the handle goes through sign-in today; the domain does not follow it |
| `/settings/accounts`              | `links.*`, `imports.list`                                  | `links.*`, `imports.list`                                                                | moved  | Verified links, contributions from other hosts, more than one email           |
| `/settings/integrations`          | `integrations.*` through the API; the catalog is the app's | `integrations.list`, `connect`, `disconnect`                                             | moved  | The services doing their work                                                 |
| `/settings/agents`                | `bots.*`                                                   | `bots.list`, `update`, `token`, `tokens.*`, `authorizations.*`                           | moved  |                                                                               |
| `/settings/privacy`, `downloads`  | `preferences.*`                                            | `preferences.get`, `preferences.update`                                                  | moved  | Exporting and deleting an account                                             |
| `/settings/notifications`         | `notifications.preferences`                                | `notifications.preferences`, `update_preferences`                                        | moved  | Sending the weekly digest                                                     |

## Repository screens

| Screen                           | Calls                                                                        | Operations                                                                                                                | Status | Missing                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| Header and About                 | `repos.get`, `stars.*`, `repos.contributors`                                 | `repos.get` (languages, licence, forks, category, links), `stars.*`, `repos.contributors`                                 | moved  | Forking, who starred, releases (from the sample)                                         |
| Code: tree and file              | `git.tree`, `git.blob`                                                       | `git.tree` (`recursive`, `last_commit`), `git.blob`, `git.raw`                                                            | moved  | Branches and tags                                                                        |
| Code: history                    | `git.commits`, `repos.contributors`                                          | `git.commits`                                                                                                             | moved  | History of a path, beyond 1,000 commits, filtering on the server                         |
| Commit `/commit/$sha`            | `git.commit`, `git.diff`                                                     | `git.commit`, `git.diff`                                                                                                  | moved  |                                                                                          |
| Issues                           | `issues.*`, `labels.list`, `comments.*`                                      | `issues.list`, `get`, `create`, `update` (`assignees`), `labels.*`, `comments.*`, `issue_evidence.list`, `create`         | moved  | Images in a comment, editing labels from the screen                                      |
| Changes: list and one change     | `changes.*`, `patch_sets.*`, `findings.*`, `change_comments.*`, `runs.start` | `changes.*`, `patch_sets.*`, `reviews.create`, `findings.*`, `change_comments.*`, `checks.*`, `policy.*`, `stacks.land`   | moved  | Commenting from a line in the diff itself, a reading guide                               |
| Changes: evidence and tests      | `evidence.list`, check `cases`                                               | `evidence.list`, `evidence.create`, `uploads.*`, `checks.report` (`cases`)                                                | moved  | Screenshots per test                                                                     |
| Changes: timeline                | built from the change, its patch sets, findings and checks                   | `changes.get`, `patch_sets.list`                                                                                          | moved  | Mirror activity                                                                          |
| Pipelines                        | `pipelines.*`                                                                | `pipelines.list`, `get`, `log`, `start`, `rerun`, `cancel`, `claim`, `report`                                             | moved  | A runner process of our own (it needs the code checked out, so it waits for git hosting) |
| Releases                         | `releases.*`, `uploads.*`                                                    | `releases.list`, `get`, `create` (with uploaded files), `update`, `download`                                              | moved  |                                                                                          |
| Insights                         | `repos.insights`, `repos.contributors`                                       | `repos.insights`                                                                                                          | moved  |                                                                                          |
| Settings: General                | `repos.update`, `repos.transfer`, `repos.delete`                             | `repos.update`, `repos.transfer`, `repos.delete`                                                                          | moved  |                                                                                          |
| Settings: Mirrors and sync       | `mirrors.*`                                                                  | `mirrors.list`, `create`, `sync`, `update` (pause), `delete`                                                              | moved  | Issues and changes across hosts, only accepting pushes here                              |
| Settings: Secrets                | `env.*`, `grants.*`                                                          | `env.list`, `env.set` (sealed in the browser), `env.recipients`, `env.add_recipient`, `env.remove_recipient`, `env.audit` | moved  | Encrypting to each recipient's public key, push guard rules                              |
| Settings: Policies               | `policy.*`                                                                   | `policy.rules`, `update_rule`, `create_rule`, `delete_rule`, `add_exception`, `remove_exception`                          | moved  |                                                                                          |
| Settings: Integrations           | `integrations.repo`, `integrations.set`                                      | `integrations.repo`, `integrations.set`                                                                                   | moved  |                                                                                          |
| Settings: Automations            | `automations.*`, `bots.list`                                                 | `automations.*`, `runs.claim`                                                                                             | moved  | The `schedule` and `finding.raised` triggers                                             |
| Agent access, Work with an agent | `grants.*`, `runs.start`                                                     | `runs.start`, `grants.*`, `env.audit`                                                                                     | moved  |                                                                                          |

The word "run" means two things. In the API a run is a bounded task for an
agent (`runs.*`). On the Pipelines tab it is one execution of a pipeline, which
the API does not have. The new operations should be `pipelines.*`.

## Operations no screen uses yet

`webhooks.*` (11), `teams.*` beyond a list, `tokens.*`, `authorizations.*`,
`runs.*`, `uploads.*`, `policy.simulate`, `stacks.land`, `api.batch`,
`operations.get`, `sync.get`, `events.stream`. Each needs a place in the app
or a decision that it is API-only. Webhooks have none: a section under
repository settings is the obvious home.

## How a screen reads and writes

1. The component reads with `useOp('issues.list', {...})` (or `useOpMaybe`
   for a part that may be absent) and writes with `useWrite()`, from
   `apps/web/src/lib/forge.ts`. A route that needs the object before it
   renders loads it with `loadOp(queryClient, id, input)`, which makes a
   missing or hidden object the router's 404.
2. When `packages/api/src/screens.ts` lists the operation, the call goes
   straight to the Convex function the API uses for it, signed in as the
   person, and a read stays live: the page changes when the data does. The
   answer is the operation's own, envelope and cursor included.
3. Otherwise (git, uploaded files, mirrors and secrets, search, the status
   page) the call runs the operation on the server, in process, as the
   person whose session cookie the request carries, or as a visitor.
4. To move an operation to Convex, add it to `screens.ts` and to
   `screens.test.ts`, which runs it both ways and compares the answers. A
   write's body schema goes in `packages/api/src/bodies.ts` and the Convex
   function checks it with `bodyOf`.

## What the API needs, in the order the screens need it

Ordered so that each step unblocks whole screens, most-used first. Every item
is also on the public roadmap (`apps/web/content/docs/api/roadmap.mdx`).

1. **Accounts.** Built: bio, edit an account, create an organization,
   members and roles, invitations by email, account preferences, follows,
   profiles counted from what a person did, the people directory,
   transferring a repository. Left: changing a handle in the domain (dropped
   for now).
2. **Repository facts.** Built: languages, licence, forks, category, links,
   starring, contributors. Left: branches and tags (with git, later), forking,
   a public listing by category for Discover.
3. **Labels and issue comments.** Built: labels with a colour, comments,
   assignees, images and recordings on an issue. Issues has moved.
4. **Review extras.** Built: the files of a patch set, a patch set from
   edited files, suggestions and prompts on findings, test cases on checks.
   Line comments and threads, recordings and previews drawn on the page.
   Changes has moved. Left: commenting from a line in the diff itself.
5. **Notifications.** Built: the inbox, fed from events, its unread count
   and preferences. Inbox, the badge and settings/notifications have moved.
   Email goes through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set.
   Left: sending the weekly digest (the domain does not know addresses).
6. **Releases.** Built: releases, channels, signed files, withdrawing,
   download counts. The Releases tab, the download button and the about
   panel have moved. Files uploaded with a release are stored and served
   from its download address; publishing works from the screen. Left:
   Discover's cards.
7. **Pipelines.** Built: runs, jobs, steps, logs, starting a workflow, run
   again, cancel, and the runner protocol (claim a job, report each step).
   The Pipelines tab has moved. Left: a runner process of our own, which
   needs the code checked out and so waits for git hosting.
8. **Policy rules.** Built: modes, counts, dry-run results, exceptions, the
   policy file, and rules a repository writes (a required check, path
   owners, a size limit). settings/Policies has moved.
9. **Integrations.** Built: connections per account, switches per
   repository. Both Integrations screens have moved. Left: the services
   doing their work.
10. **Bots and automations.** Built: bots, installs, scopes, tokens,
    automations that start a run for their bot when triggered (including a
    comment that mentions the bot), which the bot picks up with
    `runs.claim`. settings/agents and settings/Automations have moved.
    Schedules (every hour, day or week), `finding.raised` from
    `findings.create`, and starting one by hand.
11. **Linked accounts and imports.** Built: imports, linked accounts
    (unverified). `/new`, `/welcome` and settings/accounts have moved. Left:
    signing in with other hosts.
12. **Insights and the dashboard.** Built: `repos.insights`,
    `dashboard.get`. Insights and the dashboard have moved.
