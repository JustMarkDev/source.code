import { describe, expect, test } from 'bun:test'
import { applySuggestion, canApply, lineOf } from './suggestions'
import type { Suggestion } from './suggestions'

const file = [
  'pub struct Refs {',
  '    disk: Disk,',
  '    neg: NegCache,',
  '}',
  '',
  'impl Refs {',
  '    fn lookup(&self) {',
  '        if self.neg.contains(name) {',
  '            return None;',
  '        }',
  '    }',
  '}',
  '',
].join('\n')

const swap: Suggestion = {
  summary: 'Read a snapshot',
  file: 'src/refs.rs',
  replace: ['        if self.neg.contains(name) {'],
  lines: ['        if self.neg.peek(name) {'],
}

const doc: Suggestion = {
  summary: 'Document the field',
  file: 'src/refs.rs',
  replace: [],
  after: '    disk: Disk,',
  lines: ['    /// Names known not to exist.'],
}

describe('applying a suggestion', () => {
  test('replaces the lines it points at', () => {
    const r = applySuggestion(file, swap)
    expect(r.ok && r.contents).toContain('self.neg.peek(name)')
    expect(r.ok && r.contents).not.toContain('self.neg.contains(name)')
    expect(r.ok && r.at).toBe(8)
  })

  test('inserts after the line it follows', () => {
    const r = applySuggestion(file, doc)
    expect(r.ok && r.contents.split('\n')[2]).toBe(
      '    /// Names known not to exist.',
    )
    expect(r.ok && r.at).toBe(3)
  })

  test('keeps the trailing newline', () => {
    const r = applySuggestion(file, swap)
    expect(r.ok && r.contents.endsWith('\n')).toBe(true)
  })

  test('still finds its place after another suggestion shifted the lines', () => {
    const first = applySuggestion(file, doc)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applySuggestion(first.contents, swap)
    expect(second.ok && second.at).toBe(9)
  })

  test('says so when the code it points at is gone', () => {
    const r = applySuggestion(file.replace('contains', 'has'), swap)
    expect(r).toEqual({ ok: false, reason: 'moved' })
    expect(canApply(file.replace('contains', 'has'), swap)).toBe(false)
  })

  test('refuses to guess between two matches', () => {
    const twice = `${file}${file}`
    expect(applySuggestion(twice, swap)).toEqual({
      ok: false,
      reason: 'ambiguous',
    })
  })

  test('deletes when there are no new lines', () => {
    const r = applySuggestion(file, { ...swap, lines: [] })
    expect(r.ok && r.contents).not.toContain('neg.contains')
  })
})

describe('where a comment sits', () => {
  test('follows its line when lines are added above', () => {
    const moved = applySuggestion(file, doc)
    if (!moved.ok) throw new Error('did not apply')
    expect(lineOf(file, '        if self.neg.contains(name) {', 1)).toBe(8)
    expect(
      lineOf(moved.contents, '        if self.neg.contains(name) {', 1),
    ).toBe(9)
  })

  test('falls back to its own number when the text is not unique', () => {
    expect(lineOf(file, '}', 4)).toBe(4)
  })
})
