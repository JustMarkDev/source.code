<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Effect

Server-side async code (server functions, anything that calls Convex or the git
store) is written with [Effect](https://effect.website) (v4). **Read
`src/lib/effect/README.md` first**: it has the layout, how to add a service and
the rules. Components and `convex/` do not use Effect.
