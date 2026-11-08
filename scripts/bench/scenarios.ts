import { HUGE, manyToken, sampleTokens } from './world'

/**
 * Every scenario is a function of a counter that makes one logical operation
 * and says whether it worked. Closed loop: a connection sends the next one when
 * the last has answered.
 */
export type Ctx = { base: string; setup: Record<string, string> }
export type Scenario = {
  id: string
  title: string
  group: 'read' | 'list' | 'agent' | 'write' | 'auth'
  /** Runs once, in the parent, before the clients start. Returns values for `setup`. */
  prepare?: (base: string) => Promise<Record<string, string>>
  exec: (i: number, c: Ctx) => Promise<number>
  /** Connections per client process, where the API's own limits would otherwise be what is measured. */
  connections?: number
}

const dana = { authorization: `Bearer ${sampleTokens.dana}` }
const json = { ...dana, 'content-type': 'application/json' }
const get = async (url: string, headers: Record<string, string> = dana) => {
  const r = await fetch(url, { headers })
  await r.arrayBuffer()
  return r.status
}
const post = async (
  url: string,
  body: unknown,
  headers: Record<string, string> = json,
) => {
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  await r.arrayBuffer()
  return r.status
}
// A small deterministic generator, so runs repeat.
const rnd = (i: number) => {
  let x = (i + 1) * 2654435761
  x ^= x >>> 15
  x = Math.imul(x, 2246822519)
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}
const change = (i: number) => 1 + Math.floor(rnd(i) * 10_000)
const R = (base: string) => `${base}/repos/${HUGE}`

export const scenarios: Array<Scenario> = [
  {
    id: 'root',
    title: 'GET /v1, anonymous',
    group: 'read',
    exec: (_i, c) => get(`${c.base}/`, {}),
  },
  {
    id: 'change-hot',
    title: 'One change, the same one (body cache)',
    group: 'read',
    exec: (_i, c) => get(`${c.base}/repos/dana/gitfs/changes/216`),
  },
  {
    id: 'change-304',
    title: 'One change, If-None-Match (304)',
    group: 'read',
    prepare: async (base) => ({
      etag: (
        await fetch(`${base}/repos/dana/gitfs/changes/216`, { headers: dana })
      ).headers.get('etag')!,
    }),
    exec: (_i, c) =>
      get(`${c.base}/repos/dana/gitfs/changes/216`, {
        ...dana,
        'if-none-match': c.setup.etag,
      }),
  },
  {
    id: 'change-spread',
    title: 'One of 10,000 changes, spread (cache misses)',
    group: 'read',
    exec: (i, c) => get(`${R(c.base)}/changes/${change(i)}`),
  },
  {
    id: 'change-tokens',
    title: 'The same change, 1,000 different tokens',
    group: 'read',
    exec: (i, c) =>
      get(`${c.base}/repos/dana/gitfs/changes/216`, {
        authorization: `Bearer ${manyToken(i)}`,
      }),
  },
  {
    id: 'policy',
    title: 'Policy of a change',
    group: 'read',
    exec: (_i, c) => get(`${c.base}/repos/dana/gitfs/changes/216/policy`),
  },
  {
    id: 'context',
    title: 'context (the agent start-up bundle)',
    group: 'agent',
    exec: (_i, c) => get(`${c.base}/repos/dana/gitfs/context`),
  },
  {
    id: 'sync-idle',
    title: 'sync with nothing new',
    group: 'agent',
    prepare: async (base) => ({
      cursor: (
        await (
          await fetch(`${base}/sync?repo=dana/gitfs`, { headers: dana })
        ).json()
      ).cursor,
    }),
    exec: (_i, c) =>
      get(`${c.base}/sync?repo=dana/gitfs&cursor=${c.setup.cursor}`),
  },
  {
    id: 'list-50',
    title: '50 changes of 10,000',
    group: 'list',
    exec: (_i, c) => get(`${R(c.base)}/changes?state=all&limit=50`),
  },
  {
    id: 'list-50-fields',
    title: '50 changes, fields=number,title,policy',
    group: 'list',
    exec: (_i, c) =>
      get(`${R(c.base)}/changes?state=all&limit=50&fields=number,title,policy`),
  },
  {
    id: 'list-filter',
    title: '50 changes, author filter',
    group: 'list',
    exec: (_i, c) => get(`${R(c.base)}/changes?author=ines&limit=50`),
  },
  {
    id: 'issues-50',
    title: '50 issues of 2,000',
    group: 'list',
    exec: (_i, c) => get(`${R(c.base)}/issues?state=all&limit=50`),
  },
  {
    id: 'events',
    title: 'Event log, 50 newest page',
    group: 'list',
    exec: (_i, c) => get(`${c.base}/events?repo=dana/gitfs&limit=50`),
  },
  {
    id: 'search-hot',
    title: 'Search, one query (10,000 matches)',
    group: 'list',
    exec: (_i, c) => get(`${c.base}/search?q=change&limit=50`),
  },
  {
    id: 'search-varied',
    title: 'Search, 500 different queries',
    group: 'list',
    exec: (i, c) =>
      get(
        `${c.base}/search?q=${encodeURIComponent(`issue ${i % 500}`)}&limit=20`,
      ),
  },
  {
    id: 'openapi-304',
    title: 'openapi.json, conditional',
    group: 'read',
    prepare: async (base) => ({
      etag: (await fetch(`${base}/openapi.json`)).headers.get('etag')!,
    }),
    exec: (_i, c) =>
      get(`${c.base}/openapi.json`, { 'if-none-match': c.setup.etag }),
  },
  {
    id: 'batch-3',
    title: 'batch of 3 reads',
    group: 'agent',
    exec: (_i, c) =>
      post(`${c.base}/batch`, {
        requests: [
          { id: 'a', method: 'GET', path: '/repos/dana/gitfs/changes/216' },
          {
            id: 'b',
            method: 'GET',
            path: '/repos/dana/gitfs/changes/216/policy',
          },
          { id: 'c', method: 'GET', path: '/repos/dana/gitfs/issues' },
        ],
      }),
  },
  {
    id: 'mixed',
    title: 'Mixed: 80% change reads, 15% lists, 5% writes',
    group: 'agent',
    exec: (i, c) => {
      const k = i % 20
      if (k < 16) return get(`${R(c.base)}/changes/${change(i)}`)
      if (k < 19) return get(`${R(c.base)}/changes?limit=50`)
      return post(`${R(c.base)}/issues`, {
        title: `Mixed ${i}-${Math.random()}`,
      })
    },
  },
  {
    id: 'issue-create',
    title: 'POST an issue',
    group: 'write',
    exec: (i, c) =>
      post(`${R(c.base)}/issues`, { title: `Bench ${i} ${Math.random()}` }),
  },
  {
    id: 'issue-keyed',
    title: 'POST an issue, Idempotency-Key (every 2nd is a replay)',
    group: 'write',
    exec: (i, c) =>
      post(
        `${R(c.base)}/issues`,
        { title: `Keyed ${Math.floor(i / 2)} ${c.setup.run}` },
        { ...json, 'idempotency-key': `k${c.setup.run}-${Math.floor(i / 2)}` },
      ),
    prepare: () => Promise.resolve({ run: String(Date.now()) }),
  },
  {
    id: 'review',
    title: 'POST a review',
    group: 'write',
    exec: (i, c) => {
      // Bot-authored (number ≡ 1 mod 4) and not landed (every 10th is): j is never a multiple of 5.
      let j = 1 + Math.floor(rnd(i) * 2000)
      if (j % 5 === 0) j++
      return post(`${R(c.base)}/changes/${1 + 4 * j}/reviews`, {
        state: 'commented',
        body: 'ok',
      })
    },
  },
  {
    id: 'check',
    title: 'POST a check run (create or update)',
    group: 'write',
    exec: (i, c) => {
      const n = 1 + Math.floor(rnd(i) * 9000)
      return post(`${R(c.base)}/changes/${n}/checks`, {
        key: `ci/k${i % 3}`,
        state: i % 2 ? 'pass' : 'fail',
        tree: (0x1000000 + n - 1).toString(16),
      })
    },
  },
  {
    id: 'upload-100k',
    title: 'Upload 100 KB (announce + PUT)',
    group: 'write',
    connections: 12,
    exec: async (i, c) => {
      const png = new Uint8Array(100_000)
      png.set([0x89, 0x50, 0x4e, 0x47])
      const made = await fetch(`${c.base}/uploads`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          filename: `a${i}.png`,
          content_type: 'image/png',
          size: png.length,
        }),
      })
      const u = (await made.json()) as { upload_url: string }
      const r = await fetch(
        u.upload_url.replace(/^https?:\/\/[^/]+/, c.base.replace(/\/v1$/, '')),
        { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png },
      )
      await r.arrayBuffer()
      return r.status
    },
  },
  {
    id: 'token-create',
    title: 'POST a token, then revoke it',
    group: 'auth',
    connections: 12,
    exec: async (i, c) => {
      const r = await fetch(`${c.base}/tokens`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: `t${i}`, scopes: ['repo:read'] }),
      })
      const t = (await r.json()) as { id: string }
      const d = await fetch(`${c.base}/tokens/${t.id}`, {
        method: 'DELETE',
        headers: dana,
      })
      await d.arrayBuffer()
      return r.status === 201 ? d.status : r.status
    },
  },
]

export const byId = new Map(scenarios.map((s) => [s.id, s]))
