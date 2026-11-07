/**
 * Writes the TypeScript client, `sdk/typescript/index.ts`, from the API's own
 * definitions. Run it after changing an operation or a schema; a test fails
 * until you do.
 *
 *   bun scripts/api-sdk.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { format } from 'prettier'
import { allOperations } from '../src/lib/api'
import { buildOpenApi } from '../src/lib/api/openapi'
import { generateSdk } from '../src/lib/api/sdk'

export async function sdkSource(): Promise<string> {
  const ops = allOperations()
  const doc = buildOpenApi(ops, 'https://api.source.code/v1')
  return format(generateSdk(JSON.parse(JSON.stringify(doc))), {
    parser: 'typescript',
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
  })
}

if (import.meta.main) {
  mkdirSync('sdk/typescript', { recursive: true })
  writeFileSync('sdk/typescript/index.ts', await sdkSource())
  console.log('wrote sdk/typescript/index.ts')
}
