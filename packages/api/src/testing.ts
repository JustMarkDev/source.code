import { T0, sampleTokens } from './sample'
import { createSampleApi } from './index'

/** A fixed clock the tests can move. */
export function clock(start = T0 + 3_600_000) {
  let t = start
  const now = () => t
  return Object.assign(now, {
    advance(ms: number) {
      t += ms
    },
  })
}

export type Reply = {
  status: number
  headers: Headers
  json: any
  text: string
  res: Response
}

/**
 * Which domain the suite runs on: memory by default, Convex when
 * `SX_DOMAIN=convex` (`bun run test:convex`).
 */
export const onConvex = process.env.SX_DOMAIN === 'convex'

export function harness(overrides: Parameters<typeof createSampleApi>[0] = {}) {
  const now = overrides.now ?? clock()
  const api = createSampleApi({
    mount: '/v1',
    now,
    ...(onConvex
      ? { domainFactory: require('./convex-testing').convexFactory }
      : {}),
    ...overrides,
  })
  const call = async (
    method: string,
    path: string,
    init: {
      token?: string | null
      body?: unknown
      headers?: Record<string, string>
      raw?: string
    } = {},
  ): Promise<Reply> => {
    const token = init.token === undefined ? sampleTokens.dana : init.token
    const headers: Record<string, string> = { ...init.headers }
    if (token) headers.authorization = `Bearer ${token}`
    let body: string | undefined
    if (init.raw !== undefined) body = init.raw
    else if (init.body !== undefined) body = JSON.stringify(init.body)
    if (body !== undefined && !('content-type' in headers))
      headers['content-type'] = 'application/json'
    const res = await api.fetch(
      new Request(`https://api.test/v1${path}`, { method, headers, body }),
    )
    const text = await res.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { status: res.status, headers: res.headers, json, text, res }
  }
  return { api, call, now, tokens: sampleTokens }
}
