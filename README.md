# source.code

A source-available, agent-native git forge. TanStack Start + Convex, git storage on [code.storage](https://code.storage), diffs and file trees from [Pierre](https://diffs.com).

## Run it

```sh
bun install
CONVEX_AGENT_MODE=anonymous bun run dev   # local Convex backend, no account needed
```

The forge's data is on Convex once the API has the key it signs its Convex calls with. Make the pair once per deployment and set both halves (the script prints the commands):

```sh
bun scripts/api-keys.ts http://localhost:3000
# then: bunx convex env set API_JWT_ISSUER ... and API_JWT_JWKS ... on the deployment,
# and API_JWT_ISSUER and API_JWT_PRIVATE_KEY in .env.local for the app
```

An empty development deployment is filled from the sample on first start. Without the key the app runs on the same sample in memory, and a restart forgets every write. `bun run test:convex` runs the API suite against Convex functions in process.

Sign-in needs two settings on the Convex deployment, once (with the local backend, keep `CONVEX_AGENT_MODE=anonymous` in front):

```sh
bunx convex env set SITE_URL http://localhost:3000
bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

Until they are set, sign-in answers that it is not configured. Accounts use email and password. No email is sent yet: a password reset link is written to the Convex log. The "demo account" button on the sign-in page creates `dana` on a local deployment.

Open http://localhost:3000/dana.

## Layout

A Bun workspace. Lint, format and type checking run from the root over everything (`bun run check`); each package only declares what it depends on.

| Directory       | Package            | What it is                                                                |
| --------------- | ------------------ | ------------------------------------------------------------------------- |
| `apps/web/`     | `@source-code/web` | The web app (TanStack Start), the docs and the routes that mount the API. |
| `packages/api/` | `@source-code/api` | The HTTP API: operations, pipeline, domain.                               |
| `packages/git/` | `@source-code/git` | Git access: the code.storage slice, a read cache, in-memory fixtures.     |
| `packages/cli/` | `@source-code/cli` | `sx`, the command line, and the MCP server.                               |
| `packages/sdk/` | `@source-code/sdk` | The generated TypeScript client.                                          |
| `convex/`       |                    | Convex functions and schema, at the root where `convex dev` expects them. |
| `scripts/`      |                    | Generators and benchmarks for the API.                                    |

Future apps (mobile, desktop) go under `apps/` and share `packages/sdk` and `packages/api`'s schemas, not the web components.

`bun run build` then `bun run start` serves the production build on `PORT` (default 3000).

- `convex/`: social data (users, repos, activity).
- `packages/git/src/`: git access. `index.ts` is the code.storage `Repo` subset the app uses. It is currently backed by in-memory fixtures (`fake.ts`). Server-only, called through `server.ts`.
- `apps/web/src/routes/`: profile `/$handle`, repo `/$handle/$repo`, commit `/$handle/$repo/commit/$sha`.
- Screens, backed by sample data in `apps/web/src/mock/` (no backend needed): Home `/`, Discover `/discover`, profile `/$handle`, `/inbox`, `/new`, `/settings/{profile,accounts,integrations,agents,privacy,appearance,notifications}`, and the repository at `/$handle/$repo/{code,issues,changes,actions,releases,insights,settings}`. Repository settings hold Mirrors and sync, Secrets, Policies, Integrations and Automations (`?section=`). The design system is at `/design`.
- Integrations live in two places without repeating: connect a service once under account Integrations, turn it on per repository under repository Integrations. Both use `apps/web/src/components/forge/integrations-panel.tsx`.
- Docs at `/docs` use [Fumadocs](https://fumadocs.dev). Pages are MDX in `apps/web/content/docs/`, loaded by `apps/web/src/lib/source.ts`, rendered by `apps/web/src/routes/docs/$.tsx`, searched through `apps/web/src/routes/api/search.ts`.
- `packages/api/src/`: the HTTP API (`/api/v1`), one registry of operations that gives the routes, validation, OpenAPI, limits and docs. Its data is on Convex (`domain/convex.ts`, the functions in `convex/forge/`) when the key is set, and in memory on sample data otherwise. Read `packages/api/README.md` first. Docs: `apps/web/content/docs/api/`. Load test: `bun scripts/api-bench.ts`; over a simulated network: `bun scripts/api-network.ts`; against other forges: `bun scripts/probe-competitors.ts`. After changing an operation: `bun scripts/api-snapshot.ts`, `bun scripts/api-docs.ts` and `bun scripts/api-sdk.ts` (tests fail until you do). The typed client is `packages/sdk/`. Rate limits and idempotency keys can be shared between API nodes through Convex: set `CONVEX_URL` and `API_STORE_SECRET` (also `npx convex env set API_STORE_SECRET <same value>`).
- `packages/cli/`: `sx`, the command line. It never prompts, prints JSON when piped, and calls the HTTP API when `SX_API` and `SX_TOKEN` are set (or after `sx auth login`); otherwise it runs the same API in-process on sample data. Try it with `bun packages/cli/src/main.ts --help`. Tests: `bun test`.
- `apps/web/src/components/ui/`: our shadcn/ui components, restyled on Base UI. `apps/web/src/components/dither-kit/` is vendored from the Dither Kit registry (add more with `bunx shadcn@latest add Boring-Software-Inc/dither-kit/<item>`). `apps/web/src/components/brand.tsx` holds logos (Simple Icons, plus vendor icon files in `apps/web/public/logos/`). Icons are Heroicons; `apps/web/src/components/icons.tsx` adds four version-control glyphs drawn to match.
- `apps/web/src/components/forge/`: shared product UI. `apps/web/src/lib/theme.ts` handles light and dark, `apps/web/src/lib/platform.ts` detects the visitor's OS and CPU so download buttons pick the right file.

Where a project came from (GitHub, GitLab, Codeberg, Gitea) is private by design. It only appears in settings and in the owner-only repo settings page, never on Discover, profiles or public repo pages.

## License

Server and web app: Business Source License 1.1 (see `LICENSE`). The code is public so you can read it, build integrations and run the CLI against the hosted service. Production use of the server code needs a commercial license, and self-hosting is not offered or supported. Each server version converts to Apache-2.0 four years after it is published.

`packages/cli/` and `packages/sdk/` are Apache-2.0 (see `packages/cli/LICENSE`, `packages/sdk/LICENSE`), so you can use and fork the clients freely. They only talk to the hosted service; they do not let anyone host the service itself.

Any version published before the BSL-1.1 change was under AGPL-3.0-only, and those versions stay available under that license to whoever received them.

Third-party components keep their own licenses: see `THIRD_PARTY_NOTICES.md`.

## Contributing

Read `CONTRIBUTING.md`. Outside contributions are accepted under `CLA.md`: you keep ownership of your work, and grant the project the rights to include it under BSL-1.1, Apache-2.0 (on Change Date, or immediately for `packages/cli/` and `packages/sdk/`), and any commercial license, so only the project owner can sell hosting. Sign by adding yourself to `CONTRIBUTORS.md` in your first pull request. Report security problems as `SECURITY.md` says. `CODE_OF_CONDUCT.md` applies.
