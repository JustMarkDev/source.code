import { describe, expect, test } from 'bun:test'
import { sharedStore } from './instance'

describe('shared store configuration', () => {
  test('stays in memory without Convex', () => {
    expect(sharedStore(undefined, undefined)).toBeNull()
  })

  test('Convex without a long enough secret fails fast', () => {
    expect(() => sharedStore('https://example.convex.cloud', undefined)).toThrow(/API_STORE_SECRET/)
    expect(() => sharedStore('https://example.convex.cloud', 'short')).toThrow(/16/)
  })
})
