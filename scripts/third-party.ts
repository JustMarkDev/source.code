/**
 * Rewrites the "Direct dependencies" table of THIRD_PARTY_NOTICES.md from
 * package.json and the installed packages' own license fields.
 *
 *   bun install && bun scripts/third-party.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { formatSource } from '@source-code/api/format'

const root = new URL('../', import.meta.url)
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, root), 'utf8'))

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
type License = string | { type?: string } | undefined

/** Where a package is installed: beside the workspace package that declares it, or at the root. */
function licenseOf(name: string, dirs: ReadonlyArray<string>): string {
  // Aliases such as `vite: npm:@voidzero-dev/vite-plus-core` install under the alias.
  const at = [...dirs, '']
    .map((dir) => `${dir}node_modules/${name}/package.json`)
    .find((path) => existsSync(new URL(path, root)))
  if (!at) throw new Error(`${name} is not installed; run bun install`)
  const pkg = read(at) as {
    license?: License
    licenses?: Array<{ type?: string }>
  }
  const raw = pkg.license ?? pkg.licenses?.[0]
  const id = typeof raw === 'string' ? raw : raw?.type
  if (!id) throw new Error(`${name} declares no license`)
  return id
}

// Every workspace package declares its own dependencies. A package that is a
// runtime dependency anywhere is listed as one; our own packages are left out.
const manifests = [
  '',
  'apps/web/',
  'packages/api/',
  'packages/cli/',
  'packages/git/',
  'packages/sdk/',
].map((dir) => ({ dir, ...(read(`${dir}package.json`) as Manifest) }))
const external = (deps: Record<string, string> | undefined) =>
  Object.keys(deps ?? {}).filter((name) => !name.startsWith('@source-code/'))
const declaredIn = (name: string) =>
  manifests
    .filter(
      (m) =>
        name in (m.dependencies ?? {}) || name in (m.devDependencies ?? {}),
    )
    .map((m) => m.dir)
const runtime = new Set(manifests.flatMap((m) => external(m.dependencies)))
const build = new Set(
  manifests
    .flatMap((m) => external(m.devDependencies))
    .filter((name) => !runtime.has(name)),
)
const rows = (names: Set<string>, atRuntime: boolean) =>
  [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      runtime: atRuntime,
      license: licenseOf(name, declaredIn(name)),
    }))
const all = [...rows(runtime, true), ...rows(build, false)]

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
