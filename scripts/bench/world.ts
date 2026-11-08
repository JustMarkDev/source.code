import { createSampleApi } from '../../src/lib/api'
import { AuthStore } from '../../src/lib/api/auth'
import {
  sampleTokenStore,
  sampleTokens,
  seedBulk,
} from '../../src/lib/api/sample'

/** The server under test: sample data, a 10,000-change repository, 1,000 tokens. */
export const HUGE = 'dana/huge'
export const TOKENS = 1000
export const manyToken = (i: number) =>
  `sxp_bench_token_${String(i % TOKENS).padStart(6, '0')}`

/** Counts bytes and keeps none, so an upload benchmark measures the API and not the size of RAM. */
class DiscardingBlobs {
  bytes = 0
  readonly capacity = Number.MAX_SAFE_INTEGER
  put() {}
  get() {
    return null
  }
}

export function buildWorld(
  port: number,
  opts: { allowPrivateWebhooks: boolean },
) {
  const auth = sampleTokenStore(Date.now(), new AuthStore())
  for (let i = 0; i < TOKENS; i++)
    auth.add(manyToken(i), {
      name: `bench ${i}`,
      kind: 'personal',
      // Not dana: dana is limited to 100 active tokens, and the token benchmark needs room.
      handle: 'hollis',
      class: 'human',
      scopes: ['repo:read', 'issues:read', 'pulls:read'],
      ttlMs: 365 * 86_400_000,
    })
  const huge = { limit: 1e12, windowMs: 60_000 }
  const api = createSampleApi({
    mount: '/v1',
    base: `http://127.0.0.1:${port}/v1`,
    htmlBase: `http://127.0.0.1:${port}`,
    issuer: `http://127.0.0.1:${port}`,
    tokens: auth,
    pools: {
      read: huge,
      write: huge,
      heavy: huge,
      search: huge,
      anonymous: huge,
    },
    concurrencyPerToken: 1_000_000,
    allowPrivateWebhooks: opts.allowPrivateWebhooks,
    seed: (d) => seedBulk(d, 'dana', 'huge', 10_000, 2_000),
  })
  ;(api.domain.svc.uploads as unknown as { blobs: unknown }).blobs =
    new DiscardingBlobs()
  return api
}

export { sampleTokens }
