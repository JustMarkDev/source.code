import { describe, expect, test } from 'bun:test'
import { sharedStore, storeConfig } from './instance'

const SECRET = 'test-secret-0123456789'

describe('shared store configuration', () => {
  test('stays in memory without Convex', () => {
    expect(sharedStore(undefined, undefined)).toBeNull()
  })

  test('Convex without a long enough secret fails fast', () => {
    expect(() =>
      sharedStore('https://example.convex.cloud', undefined),
    ).toThrow(/API_STORE_SECRET/)
    expect(() => sharedStore('https://example.convex.cloud', 'short')).toThrow(
      /16/,
    )
  })

  test('the frontend Convex URL alone does not turn on the shared store', () => {
    expect(
      storeConfig(undefined, 'http://127.0.0.1:3210', undefined),
    ).toBeUndefined()
    expect(
      storeConfig(undefined, 'http://127.0.0.1:3210', 'short'),
    ).toBeUndefined()
    expect(storeConfig(undefined, 'http://127.0.0.1:3210', SECRET)).toBe(
      'http://127.0.0.1:3210',
    )
    expect(
      storeConfig(
        'http://api.convex.cloud',
        'http://127.0.0.1:3210',
        undefined,
      ),
    ).toBe('http://api.convex.cloud')
  })
})
