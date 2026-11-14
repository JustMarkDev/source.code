/**
 * Serves the production build: `bun run build`, then `bun run start`.
 *
 * `vp build` writes the browser files to `dist/client` and a request handler
 * to `dist/server/server.js`. This puts the two behind one port: a request for
 * a built file gets the file, everything else goes to the handler.
 */
import { join, sep } from 'node:path'

type Handler = { fetch: (request: Request) => Response | Promise<Response> }

const client = join(import.meta.dir, 'dist', 'client')
// Resolved at run time, so type checking does not need a build to exist.
const entry = new URL('./dist/server/server.js', import.meta.url).href
const app = ((await import(entry)) as { default: Handler }).default

/** The built file a path names, or null. Never a path outside `dist/client`. */
async function builtFile(pathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.endsWith('/') || decoded.includes('\0')) return null
  const path = join(client, decoded)
  if (!path.startsWith(client + sep)) return null
  const file = Bun.file(path)
  return (await file.exists()) ? file : null
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const { pathname } = new URL(request.url)
      const file = await builtFile(pathname)
      if (file)
        return new Response(file, {
          headers: {
            // Files under /assets carry a content hash in their name.
            'cache-control': pathname.startsWith('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
          },
        })
    }
    return app.fetch(request)
  },
})

console.log(`source.code is listening on ${server.url}`)
