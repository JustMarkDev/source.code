# Contributing

Thanks for helping. Read this before you open a pull request.

## Before you start

- Open an issue first for anything bigger than a fix, so we agree on the shape
  before you write it.
- Sign the [CLA](CLA.md): add yourself to [`CONTRIBUTORS.md`](CONTRIBUTORS.md)
  in your first pull request. A check fails until you do. You keep ownership of
  your work; the CLA lets the project license it under BSL-1.1, Apache-2.0 and
  commercial terms. See the README's License section for what that means.
- Be kind. [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies.
- Report security problems privately: [`SECURITY.md`](SECURITY.md).

## Set up

You need [Bun](https://bun.com) 1.4.4 (`devEngines` in `package.json` pins it).

```sh
bun install
CONVEX_AGENT_MODE=anonymous bun run dev   # app and a local Convex backend
bunx convex run seed:seed                 # demo data, in a second terminal
```

The app is at http://localhost:3000/dana.

## Before you push

CI runs exactly these. Run them first:

```sh
bun run check   # format, lint and types (Vite+: Oxfmt, Oxlint, tsgo)
bun test
bun run build
```

`bun run format` fixes formatting. A pre-commit hook runs `vp check --fix` on
what you staged.

If you change the HTTP API, also regenerate what is committed from it, or its
tests fail:

```sh
bun scripts/api-snapshot.ts   # refuses a change that is not additive
bun scripts/api-docs.ts
bun scripts/api-sdk.ts
```

If you add or remove a dependency: `bun scripts/third-party.ts`.

## Where things go

Read the README of the area you touch first.

| Area                   | Read                                 |
| ---------------------- | ------------------------------------ |
| HTTP API (`/api/v1`)   | `packages/api/README.md`             |
| Server-side async code | `apps/web/src/lib/effect/README.md`  |
| Convex (`convex/`)     | `convex/_generated/ai/guidelines.md` |
| The `sx` CLI           | `packages/cli/`, with `bun test`     |

## Code

- Lint is a gate: `denyWarnings` is on. Fix the cause. Do not add a disable
  comment; if a rule is wrong for a whole area, say why in `vite.config.ts`.
- Type the honest case. If a lookup can miss, its type says so.
- Do not silence a build warning without a comment that says why it is safe.
- Vendored code (`apps/web/src/components/dither-kit/`) stays as shipped.
- Add or update tests with the change.

## Pull requests

- Keep one change per pull request.
- The title is a [Conventional Commit](https://www.conventionalcommits.org)
  (`fix(api): ...`, `feat(cli): ...`). A check enforces it, and squash merging
  uses it as the commit message.
- Say what changed and why, and how you checked it.

## License of your contribution

The server and web app are BSL-1.1. `packages/cli/` and `packages/sdk/` are
Apache-2.0. Your contribution goes under the license of the directory it lands
in, as `CLA.md` describes.
