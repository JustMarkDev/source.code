import { describe, expect, test } from 'bun:test'
import {
  afterParentLands,
  branchFor,
  compatibility,
  fromRemote,
  patchSetsFromPushes,
  readMarker,
  remoteVerdict,
  stacksFromRemotes,
  toRemote,
} from './change-sync'
import type { LocalChange } from './change-sync'

const change: LocalChange = {
  number: 216,
  branch: 'sx/216-cache-negative-ref-lookups',
  title: 'Cache negative ref lookups',
  body: 'Remembers lookups for refs that do not exist.',
  state: 'open',
  headSha: '9c4d7e1',
  baseBranch: 'main',
}

describe('change to request', () => {
  test('carries the change id in a hidden footer', () => {
    const out = toRemote(change, 'github', 3)
    expect(readMarker(out.body)).toEqual({ number: 216, patchSet: 3 })
    expect(out.headRef).toBe('sx/216-cache-negative-ref-lookups')
  })

  test('a draft is a flag on GitHub and a prefix elsewhere', () => {
    const draft = { ...change, state: 'draft' as const }
    expect(toRemote(draft, 'github', 1).title).toBe(change.title)
    expect(toRemote(draft, 'gitlab', 1).title).toBe(`Draft: ${change.title}`)
    expect(toRemote(draft, 'gitea', 1).title).toBe(`WIP: ${change.title}`)
  })

  test('a stacked change targets its parent branch', () => {
    const child = {
      ...change,
      number: 217,
      branch: 'sx/217-bound-the-cache',
      parent: { number: 216, branch: change.branch },
    }
    expect(toRemote(child, 'github', 1).baseRef).toBe(change.branch)
    expect(toRemote(change, 'github', 1).baseRef).toBe('main')
  })
})

describe('request to change', () => {
  test('round-trips what was sent', () => {
    const sent = toRemote(change, 'gitlab', 2)
    const back = fromRemote({ ...sent, number: 58 }, 999)
    expect(back.number).toBe(216)
    expect(back.title).toBe(change.title)
    expect(back.body).toBe(change.body)
    expect(back.openedThere).toBe(false)
  })

  test('a draft title on the host is a draft here, without the prefix', () => {
    const back = fromRemote(
      {
        host: 'gitlab',
        number: 12,
        title: 'Draft: Add retries',
        body: '',
        state: 'open',
        headRef: 'retries',
        baseRef: 'main',
        headSha: 'abc1234',
      },
      300,
    )
    expect(back.state).toBe('draft')
    expect(back.number).toBe(300)
    expect(back.title).toBe('Add retries')
    expect(back.openedThere).toBe(true)
  })

  test('merged and closed become landed and abandoned', () => {
    const base = {
      host: 'github',
      number: 9,
      title: 'x',
      body: '',
      headRef: 'x',
      baseRef: 'main',
      headSha: 'a',
    } as const
    expect(fromRemote({ ...base, state: 'merged' }, 1).state).toBe('landed')
    expect(fromRemote({ ...base, state: 'closed' }, 1).state).toBe('abandoned')
  })

  test('a request opened there takes the next number, not the host number', () => {
    const back = fromRemote(
      {
        host: 'github',
        number: 226,
        title: 'x',
        body: '',
        state: 'open',
        headRef: 'x',
        baseRef: 'main',
        headSha: 'a',
      },
      219,
    )
    expect(back.number).toBe(219)
  })
})

describe('branch names', () => {
  test('the number first, then the title as it was', () => {
    expect(branchFor(216, 'Cache negative ref lookups')).toBe(
      'sx/216-cache-negative-ref-lookups',
    )
    expect(branchFor(7, 'Show cache stats in `gitfs doctor`!')).toBe(
      'sx/7-show-cache-stats-in-gitfs-doctor',
    )
    expect(branchFor(9, '???')).toBe('sx/9')
  })
})

describe('stacks', () => {
  const r = (
    number: number,
    headRef: string,
    baseRef: string,
    state: 'open' | 'draft' | 'merged' | 'closed' = 'open',
  ) => ({ number, headRef, baseRef, state })

  test('a chain of requests is a stack, bottom first', () => {
    const places = stacksFromRemotes([
      r(233, 'c', 'b', 'draft'),
      r(231, 'a', 'main'),
      r(232, 'b', 'a', 'draft'),
    ])
    expect([...places.values()].map((p) => [p.number, p.index, p.of])).toEqual([
      [231, 1, 3],
      [232, 2, 3],
      [233, 3, 3],
    ])
    expect(places.get(232)?.parent).toBe(231)
    expect(places.get(231)?.parent).toBeUndefined()
  })

  test('a request on its own is not a stack', () => {
    expect(stacksFromRemotes([r(1, 'a', 'main'), r(2, 'b', 'main')]).size).toBe(
      0,
    )
  })

  test('a merged parent leaves its children as the new bottom', () => {
    const places = stacksFromRemotes([
      r(231, 'a', 'main', 'merged'),
      r(232, 'b', 'main'),
      r(233, 'c', 'b'),
    ])
    expect(places.get(232)).toMatchObject({ index: 1, of: 2 })
    expect(places.get(233)).toMatchObject({ index: 2, of: 2, parent: 232 })
  })

  test('two children cut the chain: each starts its own', () => {
    const places = stacksFromRemotes([
      r(1, 'a', 'main'),
      r(2, 'b', 'a'),
      r(3, 'c', 'a'),
    ])
    expect(places.get(2)).toMatchObject({ index: 1, of: 1, parent: 1 })
    expect(places.get(3)).toMatchObject({ index: 1, of: 1, parent: 1 })
  })

  test('merging a parent re-aims and rebases its children', () => {
    expect(
      afterParentLands(
        { headRef: 'a' },
        [r(232, 'b', 'a'), r(240, 'z', 'main')],
        'main',
      ),
    ).toEqual([{ number: 232, baseRef: 'main', rebase: true }])
  })
})

describe('patch sets', () => {
  test('a new head is a new patch set, the same head twice is not', () => {
    expect(patchSetsFromPushes(['a', 'a', 'b', 'c', 'c'])).toEqual([
      { n: 1, tree: 'a' },
      { n: 2, tree: 'b' },
      { n: 3, tree: 'c' },
    ])
  })
})

describe('what travels', () => {
  test('GitLab cannot block with a review, so it uses a thread', () => {
    expect(remoteVerdict('github', 'changes').kind).toBe('request-changes')
    expect(remoteVerdict('gitlab', 'changes').kind).toBe('unresolved-thread')
  })

  test('comparing patch sets never leaves source.code', () => {
    for (const host of ['github', 'gitlab', 'codeberg', 'gitea'] as const) {
      const ids = compatibility(host).native.map((f) => f.id)
      expect(ids).toContain('interdiff')
      expect(ids).toContain('carry')
    }
  })

  test('reviews are partial on GitLab only', () => {
    const partial = (h: 'github' | 'gitlab') =>
      compatibility(h).partial.map((f) => f.id)
    expect(partial('gitlab')).toContain('reviews')
    expect(partial('github')).not.toContain('reviews')
  })
})
