# The HTTP API

The public contract is in `apps/web/content/docs/api/`. The reasoning and the evidence
behind it are in `docs/api-design.md`. This file is for changing the code.

## The shape

```
registry.ts     defineOp, the router, Reply/Raw, the Domain service
pipeline.ts     everything that is the same for every operation
schemas.ts      the public shape of every object (zod, strict)
problem.ts      the error catalog and ApiError
ops/*.ts        one file per area; each exports a list of operations
domain/         the data behind the API. `port.ts` is the interface the
                pipeline and the operations are typed against; the rest
                is the in-memory implementation, one file per layer
                (see domain/index.ts)
events.ts       the event log and its per-topic waiters
limiter.ts      leased rate limits over a shared store, concurrency guard
idempotency.ts  idempotency store (interface + memory)
auth.ts         tokens, principals, scopes
openapi.ts      OpenAPI 3.1 from the operations
openapi-diff.ts the "v1 only adds" check
docs.ts         the generated reference pages
mail.ts         the mailer (logs links until a provider is connected)
handles.ts      what a handle may be, shared with sign-in
integrations.ts which services can be connected
sample*.ts      sample data and tokens; also what the tests run on
screens.ts      the Convex function behind each operation a page calls
                itself (`screens.test.ts` holds the answers equal)
bodies.ts       write bodies checked the same way here and in Convex
testing.ts      harness: an API, a call helper, a movable clock
```

`apps/web/src/routes/api/v1/$.ts` mounts it at `/api/v1`, and
`apps/web/src/lib/api/instance.ts` builds the one API the app serves. `scripts/api-bench.ts` is the
load test, `scripts/api-snapshot.ts` and `scripts/api-docs.ts` regenerate the
committed files.

## Add an operation

1. Add the object schema to `schemas.ts` if it is new. Use `obj(...)` (strict)
   and `named('Name', ...)` so OpenAPI gets a component.
2. Write `defineOp({...})` in `ops/<area>.ts` and add it to that file's list.
   Say what it is: `safety`, `idempotent`, `scopes`, `pool`, `cost`, `errors`,
   `dryRun`, `shapeable`, `waitOn`. They are published in OpenAPI and tell an
   agent what is safe, so they must be true.
3. Add the method to `DomainPort` (`domain/port.ts`), in terms of the public
   objects, then implement it in the `domain/` layer that owns it, as an
   `async` method. A write bumps the
   object's `version` and emits **one event** that carries the object.
4. If the object is read often, give the operation a `version` probe so it gets
   `304`s and the body cache. The object's `version` must cover **everything in
   its representation**: if something derived from another object appears in
   it, bump the version when that changes.
5. Add the path to `SHAPE_PATHS` in `api.test.ts`, and a case for each error
   the operation can return.
6. If a page uses it and it needs nothing but Convex, add it to
   `screens.ts` and `screens.test.ts`, so the page calls Convex itself. A
   write's body schema goes in `bodies.ts`, and the Convex function checks it
   with `bodyOf` (`convex/lib/input.ts`).
7. Run `bun scripts/api-snapshot.ts` (it refuses a non-additive change),
   `bun scripts/api-docs.ts` and `bun scripts/api-sdk.ts`, then
   `bun test packages/api`. Commit the changed snapshot, reference pages and
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
- A page that calls Convex itself gets what the operation answers, refusals
  included (`screens.test.ts`).

## What is not real yet

The app's data is in Convex: `convex-api.ts` builds the API on `ConvexDomain`
when the deployment and the API's signing key are set (see the README's
"Running on Convex"). `MemoryDomain` is the sample the CLI, the docs examples
and the fast test suite run on; `bun run test:convex` runs the same suite on
Convex. Git still comes from the local store until code.storage is connected,
and uploaded files from a folder or a bucket. See
`apps/web/content/docs/api/roadmap.mdx`.
