import { expect, test } from 'bun:test'
import { RESERVED_HANDLES, isValidHandle, randomHandle } from './handles'

test('an address is 1 to 24 lowercase letters, numbers or dashes', () => {
  for (const ok of ['a', 'dana', 'quiet-otter-482', 'a'.repeat(24), 'x1'])
    expect(isValidHandle(ok)).toBe(true)
  for (const bad of [
    '',
    'Dana',
    '-dana',
    'dana-',
    'da na',
    'dana.o',
    'a'.repeat(25),
    'dana/x',
  ])
    expect(isValidHandle(bad)).toBe(false)
})

test('a generated address is valid, not reserved, and in range', () => {
  for (let i = 0; i < 500; i++) {
    const handle = randomHandle()
    expect(isValidHandle(handle)).toBe(true)
    expect(RESERVED_HANDLES.has(handle)).toBe(false)
  }
  expect(randomHandle(() => 0)).toBe('quiet-otter-100')
  expect(randomHandle((below) => below - 1)).toBe('witty-orchid-999')
})

test('every route a person could shadow is reserved', () => {
  for (const route of ['settings', 'docs', 'api', 'compare', 'sign-in'])
    expect(RESERVED_HANDLES.has(route)).toBe(true)
})
