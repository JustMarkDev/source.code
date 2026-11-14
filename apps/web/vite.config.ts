import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'

// Lint and format settings are in the root `vite.config.ts`.
export default defineConfig({
  // `.env.local` is written by `convex dev` at the workspace root.
  envDir: '../..',
  server: {
    port: 3000,
  },
  // Bundled into the server build: left external, its imports do not resolve
  // during server rendering.
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  build: {
    // The chunks over 500 kB are shiki grammars (cpp, emacs-lisp, wasm) that
    // the diff and code viewers fetch on demand; none of them is on the initial
    // load.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        // fumadocs-mdx's shared runtime imports node:fs/promises dynamically,
        // only to read a page's raw text on the server. Nothing in the browser
        // reaches it, and the package gives no way to leave it out.
        if (
          log.message.includes('"node:fs/promises" has been externalized') &&
          log.message.includes('fumadocs-mdx/dist/runtime/server.js')
        )
          return
        defaultHandler(level, log)
      },
    },
  },
  plugins: lazyPlugins(() => [
    fumadocsMdx(),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ]),
})
