import { expect, test } from 'bun:test'
import * as server from '@source-code/api/trailers'
import { runTrailerOn, withRunTrailer } from './trailer'

test('sx writes the Run-Id trailer exactly as the server reads it', () => {
  for (const m of [
    'Fix it',
    'Fix it\n',
    'Fix it\n\nChange-Id: I8c1f\nSigned-off-by: D <d@x>\n',
    'Fix it\n\nSigned-off-by: D <d@x>',
    'Fix it\n\nRun-Id: run_old\n',
    'Subject\n\nA body: with a colon.\n',
  ]) {
    expect(withRunTrailer(m, 'run_1')).toBe(server.withRunTrailer(m, 'run_1'))
    expect(server.runIdOf(withRunTrailer(m, 'run_1'))).toBe('run_1')
  }
  for (const visibility of ['public', 'private'] as const)
    for (const run_trailer of ['auto', 'on', 'off'] as const)
      expect(runTrailerOn({ visibility, run_trailer })).toBe(
        server.runTrailerOn({ visibility, run_trailer }),
      )
})
