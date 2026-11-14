/**
 * Writes the API reference pages under apps/web/content/docs/api/reference from the
 * operations and from real responses of the sample API.
 *
 *   bun scripts/api-docs.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateReference } from '@source-code/api/docs'

const root = new URL('../apps/web/content/docs/api/', import.meta.url).pathname
for (const [file, text] of await generateReference()) {
  const path = `${root}${file}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  console.log(`wrote apps/web/content/docs/api/${file}`)
}
process.exit(0)
