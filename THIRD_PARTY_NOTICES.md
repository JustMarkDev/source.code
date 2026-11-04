# Third-party notices

source.code includes or depends on the components below. Each keeps its own license, which applies to that component and not to source.code's own code (see `LICENSE`). This file is generated from `package.json` and the installed packages; re-run it when dependencies change.

## Vendored code

| Component | Where | License | Notes |
| --- | --- | --- | --- |
| Dither Kit | `src/components/dither-kit/` | MIT (declared in its npm package metadata) | Copied from the Dither Kit shadcn registry (https://github.com/Boring-Software-Inc/dither-kit). The repository and the npm tarball contain no license file, only the `license: MIT` field and the author name (ripgrim). We have asked for a LICENSE file to be added. Heavily inspired by Evil Charts, per its README. |
| shadcn/ui patterns | `src/components/ui/` | MIT | Components were generated with the shadcn CLI and then restyled. |

## Notices carried by dependencies

- **@pierre/trees** (Apache-2.0) includes code derived from `@headless-tree/core` (MIT). Its `NOTICE.md` is shipped in the package and must be kept when redistributing.
- **@pierre/diffs** (Apache-2.0). Keep its license and any notices when redistributing.
- **Simple Icons** (`simple-icons`, CC0-1.0). The package is public domain, but individual brand icons may be subject to the trademark and usage rules of their owners. See https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md.
- **Geist and Geist Mono** (via `@fontsource-variable`, SIL Open Font License 1.1). Ship the license with the fonts.
- **Heroicons** (MIT).

## Brand names and logos

Names and logos of other companies and products (for example CodeRabbit, Greptile, Blacksmith, T3 Code) are trademarks of their owners. They appear only to identify integrations and imply no endorsement or partnership. Logo files in `public/logos/` were taken from the vendors' own websites and have not been licensed to us; replace them with official press-kit assets or get written permission before launch.

## Direct dependencies

| Package | Used at runtime | License |
| --- | --- | --- |
| @base-ui/react | yes | MIT |
| @convex-dev/react-query | yes | Apache-2.0 |
| @fontsource-variable/geist | yes | OFL-1.1 |
| @fontsource-variable/geist-mono | yes | OFL-1.1 |
| @heroicons/react | yes | MIT |
| @modelcontextprotocol/sdk | yes | MIT |
| @pierre/diffs | yes | apache-2.0 |
| @pierre/storage | yes | MIT |
| @pierre/trees | yes | apache-2.0 |
| @tanstack/react-query | yes | MIT |
| @tanstack/react-router | yes | MIT |
| @tanstack/react-router-ssr-query | yes | MIT |
| @tanstack/react-start | yes | MIT |
| class-variance-authority | yes | Apache-2.0 |
| clsx | yes | MIT |
| cn | yes | MIT |
| convex | yes | Apache-2.0 |
| d3-scale | yes | ISC |
| d3-shape | yes | ISC |
| diff | yes | BSD-3-Clause |
| fumadocs-core | yes | MIT |
| fumadocs-mdx | yes | MIT |
| fumadocs-ui | yes | MIT |
| lucide-react | yes | ISC |
| motion | yes | MIT |
| react | yes | MIT |
| react-dom | yes | MIT |
| shadcn | yes | MIT |
| simple-icons | yes | CC0-1.0 |
| tailwind-merge | yes | MIT |
| tw-animate-css | yes | MIT |
| zod | yes | MIT |
| @convex-dev/eslint-plugin | build only | Apache-2.0 |
| @tailwindcss/vite | build only | MIT |
| @tanstack/eslint-config | build only | MIT |
| @typescript/native | build only | Apache-2.0 |
| @vitejs/plugin-react | build only | MIT |
| prettier | build only | MIT |
| tailwindcss | build only | MIT |
| typescript | build only | Apache-2.0 |
| vite | build only | MIT |
| vite-tsconfig-paths | build only | MIT |
