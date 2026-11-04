# source.code

A source-available, agent-native git forge. TanStack Start + Convex, git storage on [code.storage](https://code.storage), diffs and file trees from [Pierre](https://diffs.com).

## Run it

```sh
bun install
CONVEX_AGENT_MODE=anonymous bun run dev   # local Convex backend, no account needed
bunx convex run seed:seed                 # demo data, in a second terminal
```

Open http://localhost:3000/dana.

## Layout

- `convex/`: social data (users, repos, activity).
- `src/git/`: git access. `index.ts` is the code.storage `Repo` subset the app uses. It is currently backed by in-memory fixtures (`fake.ts`). Server-only, called through `server.ts`.
- `src/routes/`: profile `/$handle`, repo `/$handle/$repo`, commit `/$handle/$repo/commit/$sha`.
- Screens, backed by sample data in `src/mock/` (no backend needed): Home `/`, Discover `/discover`, profile `/$handle`, `/inbox`, `/new`, `/settings/{profile,accounts,integrations,agents,privacy,appearance,notifications}`, and the repository at `/$handle/$repo/{code,issues,changes,actions,releases,insights,settings}`. Repository settings hold Mirrors and sync, Secrets, Policies, Integrations and Automations (`?section=`). The design system is at `/design`.
- Integrations live in two places without repeating: connect a service once under account Integrations, turn it on per repository under repository Integrations. Both use `src/components/forge/integrations-panel.tsx`.
- Docs at `/docs` use [Fumadocs](https://fumadocs.dev). Pages are MDX in `content/docs/`, loaded by `src/lib/source.ts`, rendered by `src/routes/docs/$.tsx`, searched through `src/routes/api/search.ts`.
- `cli/`: `sx`, the command line. It never prompts, prints JSON when piped, and runs on sample data until the hosted API exists. Try it with `bun cli/src/main.ts --help`. Tests: `bun test`.
- `src/components/ui/`: our shadcn/ui components, restyled on Base UI. `src/components/dither-kit/` is vendored from the Dither Kit registry (add more with `bunx shadcn@latest add Boring-Software-Inc/dither-kit/<item>`). `src/components/brand.tsx` holds logos (Simple Icons, plus vendor icon files in `public/logos/`). Icons are Heroicons; `src/components/icons.tsx` adds four version-control glyphs drawn to match.
- `src/components/forge/`: shared product UI. `src/lib/theme.ts` handles light and dark, `src/lib/platform.ts` detects the visitor's OS and CPU so download buttons pick the right file.

Where a project came from (GitHub, GitLab, Codeberg, Gitea) is private by design. It only appears in settings and in the owner-only repo settings page, never on Discover, profiles or public repo pages.

## License

Business Source License 1.1 (see `LICENSE`). The code is public so you can read it, build integrations and run the CLI against the hosted service. Production use of the server code needs a commercial license, and self-hosting is not offered or supported. Each version converts to Apache-2.0 four years after it is published.

Any version published before this license change was under AGPL-3.0-only, and those versions stay available under that license to whoever received them.

Third-party components keep their own licenses: see `THIRD_PARTY_NOTICES.md`.

## Contributing

Outside contributions are not being accepted yet. When they are, a contributor license agreement will be required.
