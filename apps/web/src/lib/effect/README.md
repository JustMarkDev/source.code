# Effect in this app

Effect is for the **server** and for **async boundaries**: anything that can
fail, time out, retry or needs a dependency swapped in a test. It is not used
for React state, rendering or UI. Components stay plain React.

## The shape

```
errors.ts              tagged errors: NotFound, BackendUnavailable, InvalidInput, Refused
services/              one file per dependency (`forge.ts`: the API, as the signed-in person)
runtime.ts             wires every service's Live layer; `runServer` boundary
client.ts              `settleWithin`: cap a promise, never throw
```

## Add a service

1. Create `services/thing.ts`. Copy `forge.ts`: a class-style
   `Context.Service`, a `ThingLive` layer, methods that return Effects.
2. Merge `ThingLive` into `AppLayer` in `runtime.ts` and add the key to
   `AppServices`.
3. Use it in a server function:

```ts
export const getThing = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(({ data }) =>
    runServer(
      Effect.gen(function* () {
        const id = yield* required(data, 'id')
        const thing = yield* Thing
        return yield* thing.load(id)
      }),
    ),
  )
```

`runServer` runs the program and turns expected errors into what the router
already understands (`NotFound` -> 404, others -> a short error). Bugs are
defects and throw unchanged.

## Reading and writing the forge

A screen's data comes from the public API, through the `Forge` service, never
from the domain, the git store or sample data directly:

```ts
const forge = yield * Forge
const issues = yield * forge.call('issues.list', { owner, repo, state: 'open' })
```

`call` takes an operation id and is typed by it (input and answer come from
the generated client in `packages/sdk`). It runs in this process as the person
whose session cookie the request carries, or as a visitor, so access is the
API's to decide. A `404` is `NotFound`, a refusal (`403`, `409`, `412`, `422`)
is `Refused` with a message for the person, anything else is
`BackendUnavailable`. If a screen needs something no operation gives, add the
operation (`packages/api/README.md`) and then call it.

## Rules

- Expected failures are tagged errors in the type (`Effect<A, NotFound>`).
  Handle them by name with `Effect.catchTag`. Do not `throw` for them.
- Wrap each outside call with `Effect.tryPromise` and map the error there, so
  nothing outside the service sees a raw `unknown`.
- Name effects with `Effect.fn('Service.method')` so traces and logs say where.
- Test a program by providing a different layer
  (`Effect.provide(Layer.succeed(Thing)(Thing.of({...})))`). See
  `effect.test.ts`.
- Do not import `effect` into route components. If a loader needs a timeout,
  use `settleWithin`.
- Do not use Effect inside `convex/`. Convex functions have their own
  validators and transactions.
