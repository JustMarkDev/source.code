# The HTTP API

The public contract is in `content/docs/api/`. The reasoning and the evidence
behind it are in `docs/api-design.md`. This file is for changing the code.

## The shape

```
registry.ts     defineOp, the router, Reply/Raw, the Domain service
pipeline.ts     everything that is the same for every operation
schemas.ts      the public shape of every object (zod, strict)
problem.ts      the error catalog and ApiError
ops/*.ts        one file per area; each exports a list of operations
domain.ts       the data behind the API, in memory, async by design
events.ts       the event log and its per-topic waiters
limiter.ts      leased rate limits over a shared store, concurrency guard
idempotency.ts  idempotency store (interface + memory)
auth.ts         tokens, principals, scopes
openapi.ts      OpenAPI 3.1 from the operations
openapi-diff.ts the "v1 only adds" check
docs.ts         the generated reference pages
sample.ts       sample data and tokens; also what the tests run on
testing.ts      harness: an API, a call helper, a movable clock
```

`src/routes/api/v1/$.ts` mounts it at `/api/v1`. `scripts/api-bench.ts` is the
load test, `scripts/api-snapshot.ts` and `scripts/api-docs.ts` regenerate the
committed files.

## Add an operation

1. Add the object schema to `schemas.ts` if it is new. Use `obj(...)` (strict)
   and `named('Name', ...)` so OpenAPI gets a component.
2. Write `defineOp({...})` in `ops/<area>.ts` and add it to that file's list.
   Say what it is: `safety`, `idempotent`, `scopes`, `pool`, `cost`, `errors`,
   `dryRun`, `shapeable`, `waitOn`. They are published in OpenAPI and tell an
   agent what is safe, so they must be true.
3. Put the data work in `MemoryDomain` as an `async` method. A write bumps the
   object's `version` and emits **one event** that carries the object.
4. If the object is read often, give the operation a `version` probe so it gets
   `304`s and the body cache. The object's `version` must cover **everything in
   its representation**: if something derived from another object appears in
   it, bump the version when that changes.
5. Add the path to `SHAPE_PATHS` in `api.test.ts`, and a case for each error
   the operation can return.
6. Run `bun scripts/api-snapshot.ts` (it refuses a non-additive change),
   `bun scripts/api-docs.ts` and `bun scripts/api-sdk.ts`, then
   `bun test src/lib/api`. Commit the changed snapshot, reference pages and
   client with the change.

## Rules that are tested

- v1 only adds. Never remove, rename or retype a field; do not make an
  optional parameter required. `openapi.snapshot.json` is the record.
- Every error code is in `errorCatalog` before it is thrown, and has a section
  on the errors page. Branch on `code` in clients, never on `detail`.
- Every response matches its schema exactly, with no member undocumented.
- An unknown query parameter is a `400`. A private thing is a `404`.
- A cached body is keyed by version **and** what the caller can do.
- A flood of denied requests must not become a flood of store writes.

## What is not real yet

The domain, the event log, tokens and OAuth state are in memory. The
rate-limit store and the idempotency store also exist on Convex
(`stores/convex.ts`, `convex/apiStores.ts`), used when `CONVEX_URL` and
`API_STORE_SECRET` are set. Each sits behind an interface so the hosted version
swaps them without touching the pipeline or the operations. See `content/docs/api/roadmap.mdx`.
