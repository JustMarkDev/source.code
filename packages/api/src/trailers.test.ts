import { describe, expect, test } from 'bun:test'
import {
  messageForMirror,
  runIdOf,
  runTrailerOn,
  withRunTrailer,
  withoutRunTrailer,
} from './trailers'

describe('the Run-Id trailer', () => {
  test('goes right under Change-Id', () => {
    const m = withRunTrailer(
      'Fix the cache\n\nChange-Id: I8c1f\nSigned-off-by: Dana <d@x>\n',
      'run_01ABC',
    )
    expect(m).toBe(
      'Fix the cache\n\nChange-Id: I8c1f\nRun-Id: run_01ABC\nSigned-off-by: Dana <d@x>\n',
    )
    expect(runIdOf(m)).toBe('run_01ABC')
  })

  test('starts a trailer block when there is none, and joins one that exists', () => {
    expect(withRunTrailer('Fix it', 'run_1')).toBe('Fix it\n\nRun-Id: run_1\n')
    expect(withRunTrailer('Fix it\n\nSigned-off-by: D <d@x>', 'run_1')).toBe(
      'Fix it\n\nSigned-off-by: D <d@x>\nRun-Id: run_1\n',
    )
  })

  test('is written once, and corrected when it names another run', () => {
    const once = withRunTrailer('Fix it\n\nRun-Id: run_1\n', 'run_1')
    expect(once).toBe('Fix it\n\nRun-Id: run_1\n')
    expect(runIdOf(withRunTrailer(once, 'run_2'))).toBe('run_2')
  })

  test('auto keeps it in private repositories only', () => {
    expect(runTrailerOn({ visibility: 'private' })).toBe(true)
    expect(runTrailerOn({ visibility: 'public' })).toBe(false)
    expect(runTrailerOn({ visibility: 'public', run_trailer: 'on' })).toBe(true)
    expect(runTrailerOn({ visibility: 'private', run_trailer: 'off' })).toBe(
      false,
    )
  })

  test("a public repository's mirrored commit has no trailer", () => {
    const m = 'Fix it\n\nChange-Id: I8c1f\nRun-Id: run_1\n'
    expect(messageForMirror(m, { visibility: 'public' })).toBe(
      'Fix it\n\nChange-Id: I8c1f\n',
    )
    expect(messageForMirror(m, { visibility: 'private' })).toBe(m)
    expect(withoutRunTrailer('Fix it\n\nRun-Id: run_1\n')).toBe('Fix it\n')
  })
})
