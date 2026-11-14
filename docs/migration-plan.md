# Migration plan: the forge's data moves to Convex

Status: built on the branch `modernize/foundations`, 14 Nov 2026, except
where "Where it stands" says otherwise.

## Where it stands

| Phase                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Harness                        | Done. `bun run test:convex` runs the API suite on Convex (convex-test).                                                                                                                                                                                                                                                                                                                                                                             |
| 1 Identity                       | Done. The API signs a 60-second ES256 JWT per caller; Convex reads the actor from it.                                                                                                                                                                                                                                                                                                                                                               |
| 2 Accounts, repositories, access | Done, including idempotency keys marked in the write's own transaction.                                                                                                                                                                                                                                                                                                                                                                             |
| 3 Issues                         | Done.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4 Changes and code.storage       | Changes done. code.storage: the push webhook, the guarded client and the probe script are built; the real client, landing with `expected_source_sha`, ephemeral branches, ref policies, sync failures as findings and the change-id job wait for credentials.                                                                                                                                                                                       |
| 5 Events, sync, notifications    | Done.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6 Runs, pipelines, automations   | Done.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7 Everything else                | Done. Status counts come from a background pass and health from every server's shared minutes.                                                                                                                                                                                                                                                                                                                                                      |
| 8 Pages live                     | Done. Pages read with live Convex queries and write with Convex mutations, signed in as the person (Better Auth), and the server render reads as them too. `packages/api/src/screens.ts` names the function behind each operation a screen uses; `screens.test.ts` runs each both ways and holds the answers equal. Reads that need git, the files on the API server, its search or its health still go through the API. `Callers` stays for those. |
| 9 Switch over and delete         | The app runs on Convex when `CONVEX_URL` is set. `MemoryDomain` stays as the sample and test backend until code.storage holds git. The MVP runs one Railway machine; two copies wait for load that needs them.                                                                                                                                                                                                                                      |
| 10 MCP and CLI                   | Done: `search_operations`, `call_operation`, the 2026-07-28 revision. The offline cache is later, as planned.                                                                                                                                                                                                                                                                                                                                       |
| 11 Running it                    | Waits for a production deployment: backups and the drill, spending limits, alerts.                                                                                                                                                                                                                                                                                                                                                                  |

## Why

The forge's data (accounts, repositories, changes, reviews, issues, policies,
runs, events) lives in JavaScript `Map`s inside the web server
(`packages/api/src/domain/`, about 10,900 lines behind the 177-method
`DomainPort`). Every deploy or crash erases it, and the app can only ever
run as one copy. Convex already does what that code does by hand: records,
indexes, transactions, an event feed and live updates.

The public contract is the valuable part of what exists, and it stays:
operations, schemas, error codes, OpenAPI, the SDK, the CLI and the tests.
Only the storage behind `DomainPort` moves.

## Where we end up

| Layer                      | Runs on                                   | Holds                              | Job                                                         |
| -------------------------- | ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Web app, `/api/v1`, `/mcp` | Railway, 2+ copies                        | nothing but caches                 | first paint, the HTTP contract, MCP                         |
| Forge data and rules       | Convex                                    | every record and event             | permissions, policy, transactions, live queries, scheduling |
| Code                       | code.storage                              | git repositories                   | storage, replication, sync with other hosts                 |
| Large files                | an S3-compatible bucket (Railway buckets) | release files, recordings, CI logs | cheap storage, free downloads                               |
| Around it                  | CI runners, Resend, Pierre diffs          | nothing shared                     | replaceable services                                        |

Five rules hold the design together:

1. **One copy of the rules.** Every permission check and policy decision is a
   Convex function. Web pages, the HTTP API and MCP all call the same
   functions.
2. **Railway holds nothing.** Any copy can be killed at any moment.
3. **Identity comes from a token, never from an argument.** Convex functions
   read the actor from `ctx.auth`, never from a `handle` argument.
4. **One write, one transaction.** A mutation writes the record, its event and
   its idempotency key together.
5. **Big bytes never go into Convex.** Git goes to code.storage. Files and logs
   go to the bucket. Convex stores only their keys.

## Decisions

### Pages call Convex directly

Screens read with live Convex queries (`@convex-dev/react-query`, connected
in `apps/web/src/router.tsx`) and write with Convex mutations, signed in as
the person through Better Auth. The server render reads as them too, so the
first paint has their data.

Parity with the API is kept by construction and checked: a screen calls an
operation by its id (`useOp`, `useWrite`), and `packages/api/src/screens.ts`
names the Convex function and arguments the API itself uses for it.
`screens.test.ts` runs every read and write a screen makes both ways and
holds the answers equal, refusals included. A write's body is checked in
Convex with the same schema the API uses (`packages/api/src/bodies.ts`), so
anyone calling the deployment with their own sign-in is refused the same way.

What needs the API server stays on it: git trees and history, contributors,
insights, the profile and dashboard (they add git history), mirrors and
secrets, uploaded files, search and the status page. Those go through the
API in process as the person (`Callers` in
`apps/web/src/lib/effect/services/forge.ts`, which mints no token), and
`apps/web/src/lib/live.tsx` refreshes them when what they are about moves.
They move to Convex as git moves to code.storage.

### The HTTP API stays on Railway

It keeps everything that is about HTTP: parsing, response shapes, ETags and
`304`s, the body cache, rate-limit pools and costs, `dry_run`, the error
catalog and OpenAPI. Each operation's domain call becomes a call to a Convex
function. It does not move into Convex HTTP actions. Keeping it on Railway
keeps the version cache in front of Convex, so a `304` costs no Convex call,
and keeps the Effect pipeline as it is.

### Identity: one JWT issuer per door

Convex accepts two issuers (`convex/auth.config.ts`):

- **Better Auth** for people in the browser. This exists today.
- **The API** for tokens: after checking a bearer token, the API signs a
  short JWT (60 s) carrying the principal: `sub` (handle), token id, class,
  scopes, `actingAs` and the repository allow-list. It is sent with
  `ConvexHttpClient.setAuth`.

A helper `convex/lib/actor.ts` turns either one into the same `Principal`
that `packages/api/src/auth.ts` uses today. No Convex function takes an
identity as an argument. The `API_STORE_SECRET` pattern stays only for the
two infrastructure stores (rate limits and idempotency).

### No data migration

No real user data exists yet: the preview restarts from sample data. The
sample seed moves to `convex/seed.ts`. This is a rewrite of storage, not a
move of data, so there is no backfill and no dual writes.

### One implementation at the end

`MemoryDomain` is deleted once Convex passes the suite. Tests run the
Convex functions in memory with `convex-test`, the way
`packages/api/src/stores/convex.test.ts` already does. Keeping two
implementations of 177 methods in step is not worth it.

### Git: code.storage, synced with many hosts

code.storage is the git layer (`packages/git/src/index.ts`). Its sync already
covers GitHub (GitHub App, two-way, GitHub stays the source of truth) and,
through generic HTTPS sync, GitLab, Bitbucket, Gitea, Forgejo, Codeberg and
SourceHut, including self-hosted instances (`upstream.host`). We do not run a
git server. See "Syncing with other hosts" below.

### code.storage: what we decided (14 Nov 2026)

1. **Several hosts:** one upstream per repository, plus read-only mirrors
   that our own worker pushes to. See "Syncing with other hosts".
2. **When both sides of a sync change:** agents work on ephemeral branches,
   important branches get a `no-force-push` ref policy, and a
   `repo.sync.failed` event becomes a visible finding on the repository. The
   probe script reproduces a conflict once, and we ask Pierre to put the rule
   in writing.
3. **Atomic pushes and `--force-with-lease`:** tested by the probe script, not
   assumed. Landing doesn't rely on them: it uses code.storage's merge with
   `expected_source_sha`.
4. **Push rate:** no load test against code.storage. We watch real traffic,
   respect their `429`s, keep our own per-repository push budget, and ask
   Pierre for the per-repository limit. See "Push rate".
5. **jj change ids:** a small job fetches only the new commit objects and
   reads the `change-id` header. A `Change-Id:` trailer in the message is the
   fallback.
6. **Copies of the code:** code.storage is the only copy, except for
   repositories synced to another host, which have one there too. We don't
   run our own backups of git data.

### Jujutsu works as git, and we read its change ids

No translation layer. See "Jujutsu" below.

### Better Auth stays

It has two-factor sign-in, passkeys, organizations, an OAuth provider for MCP,
and every git host as a sign-in option. Convex Auth v2 has none of those today.

## Phases

Each phase ends with the whole suite green (`bun run check`, `bun test`,
`bun run build`). Until phase 9, the running app stays on `MemoryDomain`, so
nothing ships half-done.

### Phase 0: freeze and set up the harness

- No new API operations until phase 9. Bug fixes only.
- `harness()` in `packages/api/src/testing.ts` takes a domain factory.
  `bun test` runs the API suite twice: on `MemoryDomain`, and on
  `ConvexDomain` through `convex-test`.
- `ConvexDomain` implements `DomainPort`. Every method throws `not_ported`
  until its area is done. A list `PORTED` in the test file names the
  operations expected to pass on Convex. It only grows, and CI fails if a
  listed operation fails.
- Define the Convex conventions once (see "Convex rules") in
  `convex/lib/`: `actor`, `access`, `emit` (event + version bump), `idem`
  (idempotency in the same transaction) and the `Paginated` helper.

Done when: the suite runs on both, with `PORTED` empty.

### Phase 1: identity and tokens

- Tables: `tokens` (hash only, never the secret), `oauthClients`,
  `oauthGrants`.
- API issuer in `auth.config.ts`, the 60-second JWT, and `convex/lib/actor.ts`.
- `auth.*` and `tokens.*` operations, OAuth for MCP, and revocation, which
  must take effect on the next request.

Done when: the auth, token, OAuth and scope tests pass on Convex.

### Phase 2: accounts, organizations, teams, repositories, access

- Tables: `accounts`, `memberships`, `handleAliases` (these exist and get
  extended), `teams`, `teamAccess`, `repos`, `repoAliases`, `events`,
  `apiIdempotency`.
- `convex/lib/access.ts`: who may see and change what. Every function calls
  it. A private thing stays a `404`.
- `emit()`: every mutation writes exactly one event, carries the object's new
  `version`, and gets a per-repository sequence number.
- Idempotency moves into the write's own mutation (this closes the open item
  in `docs/api-design.md`).
- Repository create, rename and transfer, with old addresses redirecting.

Done when: the accounts, repos, teams, moves and handles tests pass.

### Phase 3: issues

- Issues, comments, labels, assignees, and images and recordings on issues
  (keys into the bucket).
- Full-text search index on issue title and body.
- Change and issue numbers come from one small counter document per
  repository. Keep it small, because every new change and issue writes it.

Done when: the issue tests pass and search returns issues.

### Phase 4: changes, and connecting code.storage

This phase is the heart of the forge.

- Provision code.storage. Swap `fakeRepo` for the real client
  (`packages/git/src/index.ts:18`). Keep the read cache: anything addressed by
  a full SHA is cached for good.
- Signing keys for code.storage JWTs live only on the server (Convex env and
  Railway env), never in the browser.
- `convex/http.ts`: `POST /hooks/code-storage` checks
  `X-Pierre-Signature` (HMAC-SHA256, 5-minute tolerance) and calls an internal
  mutation `recordPush(repo, ref, before, after)`. The same webhook may arrive
  twice, so `recordPush` is idempotent on `(repo, ref, after)`.
- Patch sets, reviews, line comments, checks, policy evaluation, rules a
  repository writes, landing and stacks.
- **Landing** is an action: it calls code.storage's merge with
  `expected_source_sha` (compare-and-set), then a mutation records the result.
  If the branch moved in the meantime, the merge is refused and the change
  stays open with a clear reason.
- Patch sets are keyed by change id (see "Jujutsu"). The `change-id` job runs
  on Railway, triggered from `recordPush`.
- Agents push to ephemeral branches (`+ephemeral`). Landing merges them into
  the target branch with `source_is_ephemeral`, then deletes them. A closed
  change deletes its ephemeral branch too.
- Each repository's default branch and release branches get a
  `no-force-push` ref policy when the repository is created.
- `repo.sync.failed` webhooks become a finding on the repository, with the
  error code shown on its page.
- Every call to code.storage goes through one client that respects `429` and
  `Retry-After`, and records latency and refusals (see "Push rate").
- Run the probe script (see "Syncing with other hosts") before building
  landing.

Done when: the change, review, policy, landing and stack tests pass, a real
`git push` to code.storage shows up as a new patch set, and an agent's
ephemeral branch lands and disappears.

### Phase 5: events, sync and notifications

- `events.stream`, `sync.get` and `?wait=` long-polls: the API server keeps a
  `ConvexClient` subscription to a tiny query (latest sequence per topic) and
  wakes its waiters from it. One subscription per server, not one per waiting
  client.
- Notifications fan out from events through the scheduler, in batches, never
  inside the write that caused them.
- Outgoing webhooks: an action with retries and backoff (the Convex workpool
  component), signed, refusing private addresses as today.

Done when: the sync, events and notifications tests pass, and a long-poll
returns within a second of a write.

### Phase 6: runs, pipelines, runners and automations

- A runner claims a job in a mutation, so two runners can never take the
  same job.
- Step results are reported once per step and logs go to the bucket. Never
  write one Convex call per log line.
- Automations: triggers on events (a push, a new issue, a raised finding)
  are scheduled functions. "schedule" triggers are crons.

Done when: the runs, pipelines, runners and automations tests pass.

### Phase 7: everything else

Releases and their files (bucket, presigned URLs, download counts as sharded
counters), uploads and evidence, secrets (ciphertext only, as today),
integrations, imports and linked accounts, insights (precomputed by
scheduled jobs, not added up on read), people, follows and the directory, and
`/status` (health buckets written by the API servers once a minute).

Done when: `PORTED` lists every operation.

### Phase 8: pages read Convex live

- Screen by screen, in the order of `docs/screens-to-operations.md`:
  `convexQuery` for reads, Convex mutations for writes, preloaded during
  server rendering so the first paint has data.
- `Callers` mints no per-person tokens, and serves only the reads that need
  the API server.
- The parity test goes in (`packages/api/src/screens.test.ts`).

This can start on change and issue pages as soon as phases 3 and 4 are done.

### Phase 9: switch over and delete

- `apps/web/src/lib/api/instance.ts` builds the API on `ConvexDomain`.
- Delete `MemoryDomain` and the in-memory event log, token store and OAuth
  store. The sample data seeds Convex.
- Railway runs one machine for the MVP, with a health check. Two copies
  with rolling deploys come when load needs them; nothing in the app keeps
  state on the machine that would stop that (rate limits, idempotency keys,
  health and events are all in Convex).
- Lift the freeze.

### Phase 10: MCP and CLI

- MCP tools come from the API operations, which already declare safety,
  idempotency and scopes. Keep the curated tools, and add
  `search_operations` + `call_operation` for the rest.
- Move to the 2026-07-28 MCP spec: no sessions, version in `_meta`, the
  `Mcp-Method` header.
- Later: `sx` keeps a local cache of what it read (refreshed with `304`s) and
  queues writes made offline, replaying them with their idempotency keys.

### Phase 11: running it

- Daily Convex backups and a restore drill: restore into a throwaway
  deployment and check the data came back. Repeat every quarter.
- `/status` shows real uptime and latency.
- Load test at agent scale (`scripts/api-bench.ts` against Convex), using the
  numbers in the next section.
- A spending limit on Convex, and alerts on code.storage hot storage and
  outbound traffic.

## Convex rules

From `convex/_generated/ai/guidelines.md` and the plan limits:

- A query or mutation gets 1 second of code time, reads at most 16 MiB and
  32,000 documents, and writes at most 16,000. Work bigger than that is split
  across scheduled functions.
- Every read uses an index (`withIndex`), never `filter` over a table. Lists
  paginate. Nothing calls `.collect()` on something that grows.
- A document is at most 1 MiB. Long text (logs, big descriptions) goes to the
  bucket.
- Keep hot documents small and few. At agent scale, many writers on one
  document cause conflicts and retries: shard counters, and never keep a
  global counter.
- Counts shown on screens (followers, downloads, open changes) are stored
  and updated on write, not counted on read.
- Free and Starter run 16 queries and 16 mutations at once. Launch on Starter
  (pay as you go). Move to Professional when the cost model says so, or when
  peaks need more than 16 at once.

## Agent-scale budget

Agents push 10 to 100 times more than people. The worst-case model
(2,000 agents pushing every 2 minutes, 30,000 fresh clones a day of a 2 GB
repository) says the biggest bills are code.storage outbound traffic, then
hot storage, then Convex calls. The guardrails:

- Agents push work in progress to code.storage **ephemeral branches**
  (the `+ephemeral` remote). They are never forwarded to an upstream host, so
  a synced GitHub or GitLab repository doesn't fill with agent branches.
  Landing promotes or merges them into a normal branch.
- Ephemeral branches are deleted when their change lands or closes. They stay
  until deleted, and hot storage costs about $3.65/GB-month.
- CI runners and agents keep warm checkouts and fetch only new commits.
- One Convex call per push from the webhook, one per CI step, none per log
  line.
- Pages subscribe to small summary queries, not to whole lists.

## Syncing with other hosts

code.storage gives each repository one `upstream`: GitHub through its app, or
GitLab, Bitbucket, Gitea, Forgejo, Codeberg or SourceHut through generic HTTPS
sync. Pushes to code.storage are forwarded upstream, and upstream changes are
copied back. That covers "move a repository over from host X and keep both in
step".

Syncing one repository with several hosts at once is a different problem:
every host accepts writes, so two hosts can each accept a different commit on
the same branch. No forge solves this in general (Forgejo's mirrors are
one-way in each direction, and so are GitLab's). Our design:

- **One writable home per repository.** Either source.code (no `upstream`) or
  one external host (as the `upstream`).
- **Any number of read mirrors.** A worker listens for code.storage push
  webhooks and pushes the new refs to each mirror host using code.storage's
  git access (a short JWT as the password). Before overwriting, it compares
  the mirror's current value with the webhook's `before`. If the mirror moved
  on its own, it stops and raises a finding instead of overwriting someone's
  work.
- **No forge data on mirrors.** Changes, reviews and issues stay ours; the
  mirrors carry code only.

What code.storage's docs settle (Nov 2026):

- **One upstream, chosen at creation.** `upstream` is a single object on
  `repos.create` and can't be changed by `repos.update`. It can only be
  detached (`DELETE /api/repos/{name}/upstream`), and re-attaching is not
  documented. So the import screen asks for the upstream before the
  repository is created, and changing provider means a new repository.
- **The upstream is the source of truth.** Pushes are forwarded to it, then
  its state is copied back. Who wins when both sides changed is not
  documented. We protect branches that matter with a `no-force-push` ref
  policy, and treat `repo.sync.failed` as a finding on the repository.

Phase 4 starts with a probe script (`scripts/code-storage-probe.ts`) run
against a test repository. It records:

- whether `atomic` push is advertised;
- whether `--force-with-lease` is refused when the branch moved;
- what happens when GitHub and code.storage both change a branch.

It makes a handful of pushes, not a load test: hammering a shared,
multi-tenant service to find its limit could get us rate-limited or break
their terms, and the result would depend on their load that day. The questions
only Pierre can answer are listed under "Risks".

### Push rate

code.storage publishes no per-repository push limit; its limit adjusts with
load and it answers `429` with `Retry-After` when we go over. Instead of
measuring their ceiling:

- **Spread the load.** Each agent pushes to its own ephemeral branch, so no
  single branch is a hot spot. Only landing writes to the target branch, one
  change at a time.
- **Our own budget.** The API keeps a per-repository push budget, a rate
  limit we set and can raise. That way a runaway agent hits our limit, with a
  clear error, long before it hits code.storage's.
- **Respect theirs.** One code.storage client retries after `Retry-After`,
  with backoff, and never retries a write that may have gone through without
  checking the branch first.
- **Measure real traffic.** Record push latency and every `429` per
  repository on `/status` and in alerts. A repository that gets near the
  limit shows up there first.
- **Ask.** Pierre is asked for the per-repository limit and how to raise it.

Leaving code.storage stays possible: `packages/git` uses five of its methods,
and code.storage documents exporting repositories.

## Jujutsu

jj stores its history in git and pushes normal git commits and branches, so
code.storage and the forge accept it today. Supporting it well means reading
what jj adds:

- **Change ids.** Since jj 0.30, every commit carries a `change-id` header,
  and it stays the same when jj rewrites the commit. We key patch sets by:
  1. the `change-id` header, if present;
  2. else a `Change-Id:` trailer (the Gerrit convention);
  3. else the branch name.

  Plain `git rebase` and `cherry-pick` drop the header, so 2 and 3 stay as
  fallbacks. code.storage's commit API does not return extra headers (only
  signed commits come with their raw object). So, on each push webhook, a
  small job on Railway fetches only the new commit objects
  (`git fetch --filter=tree:0`, a few KB, no files), reads `change-id` with
  `git cat-file`, and stores it in Convex. The `Change-Id:` trailer needs no
  fetch: it's in the message the API returns. We also ask Pierre to return
  extra headers, which would remove the fetch.

- **Conflicts.** jj can commit a conflict and resolve it later. A commit that
  still holds a jj conflict is shown as conflicted and cannot land.
- **Docs.** A page on using source.code with `jj git push`, and `sx` accepts
  jj revisions where it takes a commit.

No other version control system is worth supporting now. Sapling works as a
git client; Pijul, Fossil and Mercurial would each need their own storage,
for very few users.

## Risks

| Risk                                                                | What we do                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex is the one hard dependency                                   | Backups and restore drills. Railway serves cached pages read-only during an outage, and code.storage keeps git working                                                               |
| A Convex function outgrows 1 s or 32k scanned documents             | The rules above, plus the agent-scale load test before switching over                                                                                                                |
| Hot documents conflict under agents                                 | Per-repository counters stay tiny; shard anything shared                                                                                                                             |
| code.storage limits are unknown                                     | The probe script, our own push budget, `429` handling and monitoring (see "Push rate")                                                                                               |
| code.storage is the only copy of repositories with no external sync | Accepted. Their SLA is 99.99% a month (status page: 99.97% to 100% per region, Aug to Nov 2026), with service credits. A synced repository also has a copy on its host               |
| Only Pierre can answer                                              | Divergence rules, the per-repository push limit, replication count, the SOC 2 report, re-attaching an upstream, extra commit headers, and fixing the SLA's "Availability" definition |
| code.storage cost at agent scale                                    | The guardrails above; negotiate volume pricing (their Enterprise tier lists it)                                                                                                      |
| The freeze stalls product work                                      | Phase 8 can start after phases 3 and 4, so screens improve during the move                                                                                                           |

## Rollback

Until phase 9, the app runs on `MemoryDomain` and Convex only gains new
tables, so rolling back means not switching. After phase 9, roll back the
Railway deploy. The Convex schema only ever adds tables and fields, so an
older build still reads it.
