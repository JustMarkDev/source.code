import { expect, test } from 'bun:test'
import { guarded, storeStats } from './guarded'
import type { GitRepo } from './index'

const refusal = (retryAfter?: string) =>
  Object.assign(new Error('slow down'), {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  })

test('a refused read waits as told and tries again; a refused write is not retried', async () => {
  let reads = 0
  let writes = 0
  const waited: Array<number> = []
  const repo = {
    listFiles() {
      reads++
      if (reads < 3) return Promise.reject(refusal('2'))
      return Promise.resolve({ ref: 'main', paths: ['a'] })
    },
    merge() {
      writes++
      return Promise.reject(refusal('1'))
    },
  } as unknown as GitRepo & { merge: () => Promise<unknown> }
  const g = guarded('rep_1', repo, (ms) => {
    waited.push(ms)
    return Promise.resolve()
  }) as typeof repo
  expect((await g.listFiles({})).paths).toEqual(['a'])
  expect(waited).toEqual([2000, 2000])
  await expect(g.merge()).rejects.toThrow('slow down')
  expect(writes).toBe(1)
  const s = storeStats.get('rep_1')!
  expect(s.refused).toBe(3)
  expect(s.calls).toBe(4)
  expect(s.latencies.length).toBe(4)
})
