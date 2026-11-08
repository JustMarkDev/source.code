/**
 * Rewrites the "Direct dependencies" table of THIRD_PARTY_NOTICES.md from
 * package.json and the installed packages' own license fields.
 *
 *   bun install && bun scripts/third-party.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { formatSource } from '../src/lib/api/format'

const root = new URL('../', import.meta.url)
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, root), 'utf8'))

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
type License = string | { type?: string } | undefined

function licenseOf(name: string): string {
  // Aliases such as `vite: npm:@voidzero-dev/vite-plus-core` install under the alias.
  const pkg = read(`node_modules/${name}/package.json`) as {
    license?: License
    licenses?: Array<{ type?: string }>
  }
  const raw = pkg.license ?? pkg.licenses?.[0]
  const id = typeof raw === 'string' ? raw : raw?.type
  if (!id) throw new Error(`${name} declares no license`)
  return id
}

const manifest = read('package.json') as Manifest
const rows = (names: Array<string>, runtime: boolean) =>
  names
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, runtime, license: licenseOf(name) }))
const all = [
  ...rows(Object.keys(manifest.dependencies ?? {}), true),
  ...rows(Object.keys(manifest.devDependencies ?? {}), false),
]

const table = [
  '| Package | Used at runtime | License |',
  '| --- | --- | --- |',
  ...all.map(
    (r) => `| ${r.name} | ${r.runtime ? 'yes' : 'build only'} | ${r.license} |`,
  ),
].join('\n')

const file = new URL('THIRD_PARTY_NOTICES.md', root)
const current = readFileSync(file, 'utf8')
const heading = '## Direct dependencies\n'
const at = current.indexOf(heading)
if (at === -1) throw new Error(`no "${heading.trim()}" section`)
writeFileSync(
  file,
  await formatSource(
    'THIRD_PARTY_NOTICES.md',
    `${current.slice(0, at)}${heading}\n${table}\n`,
  ),
)
console.log(`wrote ${all.length} dependencies to THIRD_PARTY_NOTICES.md`)
