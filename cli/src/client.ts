import { SxError, exit } from './output'
import { version } from './help'
import { resolve } from './config'
import {
  clearCredentials,
  readCredentials,
  writeCredentials,
} from './credentials'

/**
 * How sx talks to source.code. Every command is a call to the HTTP API, so the
 * CLI, the MCP server and your own scripts see the same data, the same rules
 * and the same error codes.
 *
 * With `SX_API` and `SX_TOKEN` set it goes over the network. Without them it
 * runs the API in this process on sample data, which is what the preview
 * offers until the hosted service is live.
 */
export type Transport = (req: Request) => Promise<Response>

export type Reply = {
  status: number
  headers: Headers

  json: any
}

type Init = {
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
  dryRun?: boolean
}

/** An API error is already in the shape sx prints. */
function toSxError(status: number, problem: Record<string, unknown>): SxError {
  const code = typeof problem.code === 'string' ? problem.code : 'api_error'
  const detail =
    typeof problem.detail === 'string' ? problem.detail : 'The request failed.'
  const hint = typeof problem.hint === 'string' ? problem.hint : undefined
  const exitCode =
    typeof problem.exit_code === 'number' ? problem.exit_code : exit.error
  const e = new SxError(code, detail, hint, exitCode)
  Object.assign(e, { problem, httpStatus: status })
  return e
}

export class ApiClient {
  constructor(
    readonly base: string,
    private readonly token: string | null | (() => Promise<string | null>),
    private readonly transport: Transport,
    readonly mode: 'network' | 'sample',
  ) {}

  async call(method: string, path: string, init: Init = {}): Promise<Reply> {
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined) query.set(k, String(v))
    if (init.dryRun) query.set('dry_run', 'true')
    const qs = query.size ? `?${query}` : ''
    const headers: Record<string, string> = {
      accept: 'application/json',
      'sx-agent': `sx-cli/${version}`,
      ...init.headers,
    }
    const token =
      typeof this.token === 'function' ? await this.token() : this.token
    if (token) headers.authorization = `Bearer ${token}`
    let body: string | undefined
    if (init.body !== undefined) {
      body = JSON.stringify(init.body)
      headers['content-type'] = 'application/json'
    }
    let url = `${this.base}${path}${qs}`
    for (let hop = 0; hop < 3; hop++) {
      let res: Response
      try {
        res = await this.transport(
          new Request(url, { method, headers, body, redirect: 'manual' }),
        )
      } catch (e) {
        throw new SxError(
          'network',
          `Could not reach ${this.base}: ${e instanceof Error ? e.message : String(e)}`,
          'Check SX_API and your connection.',
          exit.error,
        )
      }
      // A renamed repository answers 308 with the new address. Follow it, keeping method and body.
      const to = res.status === 308 ? res.headers.get('location') : null
      if (to) {
        url = to
        continue
      }
      const text = await res.text()
      let json: unknown = null
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }
      if (res.status >= 400)
        throw toSxError(
          res.status,
          (json as Record<string, unknown> | null) ?? {
            detail: text.slice(0, 200),
          },
        )
      return { status: res.status, headers: res.headers, json }
    }
    throw new SxError(
      'too_many_redirects',
      'The address kept moving.',
      'Check the repository name.',
      exit.error,
    )
  }

  get = (path: string, init?: Init) => this.call('GET', path, init)
  post = (path: string, init?: Init) => this.call('POST', path, init)
  patch = (path: string, init?: Init) => this.call('PATCH', path, init)
  put = (path: string, init?: Init) => this.call('PUT', path, init)
  del = (path: string, init?: Init) => this.call('DELETE', path, init)

  private memo = new Map<string, Promise<Reply>>()
  /** A read repeated within one command is made once. */
  once(path: string) {
    let p = this.memo.get(path)
    if (!p) this.memo.set(path, (p = this.get(path)))
    return p
  }
}

// ---------------------------------------------------------------------------

type SampleApi = { fetch: (req: Request) => Promise<Response> }
let sample: Promise<SampleApi> | undefined

/** The preview's API, in this process. State lasts as long as the process. */
function sampleApi(): Promise<SampleApi> {
  sample ??= import('../../src/lib/api').then(
    (m) =>
      m.createSampleApi({
        mount: '/v1',
        base: 'https://api.source.code/v1',
        allowPrivateWebhooks: false,
      }) as SampleApi,
  )
  return sample
}

/** Start the sample world over. Tests use it. */
export function resetSample() {
  sample = undefined
}

export const SAMPLE_BASE = 'https://api.source.code/v1'

// The sample's tokens are in the repository, so they only exist here.
const SAMPLE_PERSON = 'sxp_dana_full_access_0001'
const SAMPLE_AGENT = 'sxb_fix_agent_scoped_03'

/** A stored access token, refreshed shortly before it expires. */
function storedToken(api: string): (() => Promise<string | null>) | null {
  if (!readCredentials(api)) return null
  return async () => {
    const c = readCredentials(api)
    if (!c) return null
    if (c.expires_at - Date.now() > 60_000) return c.access_token
    const res = await fetch(`${api}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: c.refresh_token,
        client_id: c.client_id,
      }),
    })
    if (!res.ok) {
      clearCredentials()
      throw new SxError(
        'unauthenticated',
        'Your sign-in expired.',
        'Run sx auth login.',
        exit.auth,
      )
    }
    const t = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      scope: string
    }
    // The refresh token rotates: save the new one at once.
    writeCredentials({
      ...c,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + t.expires_in * 1000,
      scope: t.scope,
    })
    return t.access_token
  }
}

export function makeClient(): ApiClient {
  const api = resolve('api').value
  const token = process.env.SX_TOKEN
  if (api) {
    const base = api.replace(/\/$/, '')
    const provider = token ? token : storedToken(base)
    if (!provider)
      throw new SxError(
        'unauthenticated',
        'You are not signed in.',
        'Run sx auth login, or set SX_TOKEN to a token from Settings, Agents and tokens.',
        exit.auth,
      )
    return new ApiClient(base, provider, (req) => fetch(req), 'network')
  }
  const asAgent = process.env.SX_ACTOR === 'agent'
  return new ApiClient(
    SAMPLE_BASE,
    asAgent ? SAMPLE_AGENT : SAMPLE_PERSON,
    async (req) => (await sampleApi()).fetch(req),
    'sample',
  )
}

/** A client for a token the caller already checked, such as an MCP request. */
export function clientFor(base: string, token: string, transport: Transport) {
  return new ApiClient(base, token, transport, 'network')
}
