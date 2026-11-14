/**
 * Writes the TypeScript client, `packages/sdk/index.ts`, from the API's own
 * definitions. Run it after changing an operation or a schema; a test fails
 * until you do.
 *
 *   bun scripts/api-sdk.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { allOperations } from '@source-code/api'
import { buildOpenApi } from '@source-code/api/openapi'
import { formatSource } from '@source-code/api/format'
import { generateSdk } from '@source-code/api/sdk'

export async function sdkSource(): Promise<string> {
  const ops = allOperations()
  const doc = buildOpenApi(ops, 'https://api.source.code/v1')
  return formatSource('index.ts', generateSdk(JSON.parse(JSON.stringify(doc))))
}

if (import.meta.main) {
  mkdirSync('packages/sdk', { recursive: true })
  writeFileSync('packages/sdk/index.ts', await sdkSource())
  console.log('wrote packages/sdk/index.ts')
}
