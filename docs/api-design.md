# API design record

2026-11-07. This is the reasoning behind the API, the evidence it rests on and
what is still open. The contract itself is in `apps/web/content/docs/api/`; this file
says why it is that way. The code is `packages/api/src/` (read its README to change
it).

Status: built and tested on sample data. 192 operations: OAuth 2.1, tokens,
webhooks, search, uploads and evidence, repository rename/edit/delete, teams,
agent runs, git data, labels and issue comments, `Accept: text/markdown`, a generated TypeScript client.
`sx` and the MCP server are clients of the API. Rate limits and idempotency
keys also exist on Convex, tested against Convex's in-memory runtime. Types,
lint (`--max-warnings 0`) and the whole test suite are green. Not built: the
domain on Convex, a shared event log, and shared token and OAuth state. See `apps/web/content/docs/api/roadmap.mdx`.

## Goal

The most complete, stable, fast and readable forge API, for people and for
agents, for a very large number of clients. In that order of tie-break: when
two goals conflict, stable beats clever, and readable beats terse.

## Evidence

Read in the vendors' own documentation on 6 and 7 November 2026; each fact with
its link is in `apps/web/content/docs/api/compared.mdx`. What shaped the design:

- **GitHub** publishes its secondary limits (100 concurrent requests, 900
  points a minute) but also says some endpoint costs are "not shared
  publicly" and that there is no way to check secondary-limit status. A `304`
  is free. `mergeable` is `null` until a background job finishes. Search stops
  at 1,000. Failed webhooks are not redelivered automatically. Default page 30.
- **GitLab** has keyset pagination only as an opt-in per endpoint, drops
  totals past 10,000 records, returns errors as `{"message": …}` in more than
  one shape, and (in the pages read) documents no ETag or idempotency support.
  Its webhooks follow Standard Webhooks.
- **Forgejo and Gitea** publish page-size limits at an endpoint and an OpenAPI
  file at `/swagger.v1.json`; offset pagination, maximum 50. No rate limit
  documented.
- **Bitbucket** says page sizes and limits "are not part of the API". Its REST
  introduction page would not load, so its pagination, errors and query
  language are unverified.
- **git.cafe**, the closest and strongest: problem+json, cursor lists,
  `expectedVersion`, `requestId` for repeats and `202` operations, OpenAPI
  3.1 with per-operation rate-limit policy, always-expiring tokens, `wait` on
  one endpoint, webhooks with documented retries (beta). It sends the limit
  but not what is left, documents no page size or version scheme, and uses
  separate credentials for REST and MCP.

Corrections to the first draft of this document, found by reading the pages
instead of remembering them: GitHub's secondary limits are documented, not
only an error message; git.cafe's webhook retries are documented; GitLab's
webhooks already follow Standard Webhooks; GitLab sends `RateLimit-Remaining`.

## Decisions

| Decision                                                                                           | Why                                                                                                                                                                                                                                                                            | Revisit if                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| REST and JSON only, no GraphQL                                                                     | `fields`, `expand`, rollups, `batch` and `sync` cover what GraphQL is used for, and keep shared caches, ETags and a published cost per call                                                                                                                                    | A real client cannot be served       |
| Own the contract layer on a plain `Request → Response` handler and zod, not `effect/http-api`      | `effect/http-api` and `HttpRouter.toWebHandler` are marked `@stability unstable` in the installed Effect 4.1.2. A public API that promises years of stability should not sit on an unstable library. Effect is still used for services and errors inside, as the repo requires | The module is declared stable        |
| One operation registry                                                                             | One definition gives the route, validation, OpenAPI, rate-limit cost, safety metadata and the generated reference. A CLI command, an MCP tool and an endpoint cannot drift                                                                                                     |                                      |
| Public ids separate from the database's                                                            | Keeps leaving Convex possible                                                                                                                                                                                                                                                  | You accept the lock-in for one index |
| `If-Match`/`ETag`, not a version in the body                                                       | Standard HTTP; any client knows it                                                                                                                                                                                                                                             |                                      |
| `expected_tree` required to land                                                                   | Policy is about one tree. The thing that lands is the thing that was checked                                                                                                                                                                                                   |                                      |
| `policy` and `checks` rolled up on the change, never `null`                                        | Removes the fetch-per-item pattern and GitHub's `mergeable: null`                                                                                                                                                                                                              |                                      |
| Unknown query parameters are `400`                                                                 | A misspelled filter that returns everything is worse than an error, especially for an agent                                                                                                                                                                                    |                                      |
| Private is `404`, not `403`                                                                        | Existence does not leak                                                                                                                                                                                                                                                        |                                      |
| `308` for renames                                                                                  | Keeps the method and body, unlike a `301` on a `POST`                                                                                                                                                                                                                          |                                      |
| Idempotency keys on every write except secret-bearing responses, plus naturally idempotent creates | Retries are safe; the CLI already behaves this way                                                                                                                                                                                                                             |                                      |
| Rate limits leased from a shared store, not in process memory                                      | See below                                                                                                                                                                                                                                                                      |                                      |

## The bolder parts, and why

- **Version-addressed body cache.** A read keys its serialized body by object
  version and by what the caller can do. Versions only rise, so an entry is
  never stale, only superseded: nothing to invalidate. The ETag is decided from
  the version before any body is built, so a `304` skips serialization. This
  asks one thing of every object: its `version` must cover its whole
  representation.
- **`wait` on any read.** `If-None-Match` plus `?wait=` holds a request until
  the ETag would change. Waiters are registered per repository, so an event
  wakes only the clients that care. git.cafe has this on one endpoint.
- **`sync`.** One call for a snapshot, then only what changed, newest state of
  each object, with a reset when the cursor is older than the log or ahead of it. It replaces
  polling every list.
- **`policy/simulate`.** "If this check passed and that finding were resolved,
  could it land?" Plan before acting, nothing written. Possible because
  policy is code and evaluation is cheap.
- **`actions` on objects, `requirements` on policy errors, `hint` and
  `retryable` on every error.** The API says what to do next. `retryable` on a
  policy block is true only when nothing has failed.
- **`dry_run` on every write** through the same code path, and
  `x-sx-safety`/`x-sx-idempotent`/`x-sx-errors` on every operation, so an agent
  can decide what to confirm before calling.
- **A build check that v1 only adds.** The committed OpenAPI snapshot is
  compared with the generated one; a removal, rename, type change or newly
  required input fails the test.
- **A generated reference with real examples** captured by running the API on
  the sample data, and a test that fails when the pages drift or a number
  quoted in prose is wrong. It already caught a wrong operation count.
- **`ndjson` lists, SSE with `Last-Event-ID`, a batch endpoint.**

## Many clients

The first draft kept rate limits in process memory, which only works for one
node. The built design:

- The API process holds no state correctness depends on. Rate limits,
  idempotency keys and the event log sit behind interfaces.
- **Leased counters.** A shared store holds one counter per login (agent, bot and run tokens: per token), pool and
  window and never grants more than is left. A node leases a block (a
  twentieth of the limit, at most 50), spends it locally and asks again. The
  store sees one write per block. Unspent units are lost until the window ends,
  so a token over N nodes is under-served by at most N blocks. When the store
  has nothing left, the node denies locally, so abuse does not become a write
  flood. Tested: 4 nodes, limit 1,000, 3,000 requests, 1,000 admitted, under
  60 store calls; 20,000 requests against a limit of 100, under 40 calls.
- **Concurrency per login is per node**, the one limit that is not shared,
  because exact global concurrency costs a write per request and per
  response.
- **Anonymous limits key on the address our proxy appended**, not the start of
  `X-Forwarded-For`, which a client controls. Tested.
- **Built, on Convex:** the rate-limit store and the idempotency store
  (`convex/apiStores.ts`, `packages/api/src/stores/convex.ts`). One mutation per
  lease or per key, so the database orders nodes. Verified with convex-test:
  never over the limit, twenty simultaneous asks for fifty units grant exactly
  fifty, two nodes racing for one key yield one `new`. Failure rules: an
  unreachable limit store admits a 1% block per node (limits must not take the
  service down); an unreachable idempotency store refuses keyed writes
  (`backend_unavailable`); a refused secret is an error, never a silent
  fallback. Not run against a live deployment, and not driven from several
  processes under load.
- **Not built:** a shared event log, shared tokens and OAuth state, the domain
  on Convex. Until then the second node would have its own events, tokens and
  sign-ins.

## Measured

Three kinds of evidence, all in `apps/web/content/docs/api/performance.mdx` with their
method and caveats.

**Our code, in process** (`bun scripts/api-bench.ts`, Apple M5, one server
process, three client processes of 32 connections, real HTTP, 10,000 changes,
server CPU printed per row). Baseline is the first passing version
(`docs/bench/baseline.json`), result the final code (`docs/bench/after.json`),
req/s before to after:

- cached change 58.6k to 111.6k; `304` 60.0k to 121.3k; root 90.8k to 111.9k
- cache-miss change 42.7k to 68.7k; 1,000 different tokens 37.7k to 57.6k
- list of 50 changes 7.8k to 29.3k (p99 15.4 to 5.4 ms); issues 16.6k to 37.4k
- `openapi.json` conditional 2.1k to 104.7k
- issue create 3.5k to 43.7k (p99 43.2 to 8.5 ms); reviews 23.7k to 40.0k; check runs 31.6k to 42.0k
- mixed 80/15/5 workload 21.1k to 44.5k
- webhook-subscribed writes 20.7k a second
- search, one query 27.3k to 40.8k; 500 different queries 36.0k to 34.5k (p99 5.0 to 9.6 ms)
- uploads: 12.1k/s of 100 KB, no valid baseline (it counted 150k failures)

Memory: 100,000 issues in an idle server went from 168 MB of live heap to 109 MB
(585 MB resident to 348 MB). The event log keeps one JSON string per event
instead of an object graph and is bounded by size (24 MB) as well as count; the
idempotency store is bounded by size (24 MB); the search index uses integer
postings and cached results are capped; revoked tokens, unsent uploads and
per-person token scans are bounded or indexed.

**Other forges, from a client** (`bun scripts/probe-competitors.ts`, one
machine in Europe, 7 Nov 2026, reads only). A single issue: GitHub 324 ms,
GitLab 303, Codeberg 164, git.cafe 129 (117 of it the network), Gitea 196
(190 network). A list of 50 takes 0.5 to 15 seconds and 160 KB to 1.2 MB. A
`304` is not faster than a 200 on GitHub or GitLab. A GitHub pull request is
22.7 KB; our change is 1.8 KB. Caveats: public popular repositories, CDNs in
front of some, 4 to 8 samples for the slow endpoints, GitHub's search paced
under its own limit.

**Over a network, a model** (`bun scripts/api-network.ts`): the same server
behind a delaying TCP proxy at RTT 0/5/30/90/180 ms, with 15 ms per database
round trip assumed for what misses the caches (0 for cached reads and `304`s,
1 for lists and searches, 2 for writes). Cached read: RTT + about 1 ms; uncached
or list: RTT + 17 to 20 ms; write: RTT + about 33 ms. The 15 ms and the
Railway assumptions (cores 2 to 4 times slower than an M5, 1 to 5 ms for its
edge) are estimates until the hosted service is measured.

What this does not show: a real database or git store, several nodes under
load, and behaviour over hours.

### Optimisations that carried the result

Pre-serialized items per version for changes and issues (a list is cache hits
and a join; the list `ETag` is built from item digests), indexes for the scans
writes repeated (open issue by title, open change by branch, pending uploads,
tokens by owner, cached counts), append fast path on the ordered indexes, a
policy memo per change version, a cached OpenAPI body with a `304`, pooled
randomness for ids, the last formatted millisecond kept, a lookup cache by raw
token string, a version-keyed body cache that answers a probe before any Effect
runs, cheap search scoring with snippets made only for the page and cached
results kept when the writes since could not match them, and the memory bounds
above.

## Open

- Sign-in is real (Better Auth on Convex, `convex/auth.ts`), and the consent
  page uses the same session (`apps/web/src/lib/api/sessions.ts`). Open: email
  verification and reset by email, other providers, and accounts in the
  domain. Until then a signed-in person is added to the sample domain when
  first seen, and a changed address is a new person there.
- Bots and installs management, git branches/tags/compare/blame/archive and
  history beyond 1,000 commits, transfers, labels, releases, notifications.
- A multi-node benchmark against a live Convex deployment.
- Rate-limit numbers are starting values. Latency targets are goals.
- Actions are attributed by handle **and class**: a run token acts as the
  person but is recorded as an agent, so policy's "a person has to approve"
  cannot be satisfied by an agent holding someone's run token. A bug of this
  kind existed before runs (any agent-class token sharing a handle with a
  person would have been recorded as the person) and is fixed and tested.
- Bitbucket's REST pages and the rest of git.cafe's OpenAPI and MCP card were
  not fully read; SourceHut (GraphQL only) was not probed.
- The sample tokens are live only in development or with
  `SX_API_SAMPLE_TOKENS=1`, so a deployed preview cannot be written to.
