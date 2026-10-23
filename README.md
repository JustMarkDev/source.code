# source.code

An open-source, agent-native git forge. TanStack Start + Convex, git storage on [code.storage](https://code.storage), diffs and file trees from [Pierre](https://diffs.com).

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

## License

AGPL-3.0-only
