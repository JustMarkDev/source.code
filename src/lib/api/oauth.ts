import { createHash } from 'node:crypto'
import { randomSource } from './ids'
import { oauthScopes, secretFor } from './auth'
import type { Audience, AuthStore, Scope } from './auth'

const randomBytes = (n: number) => Buffer.from(randomSource.bytes(n))

/**
 * The OAuth server. It speaks the OAuth 2.1 profile, which is OAuth 2.0
 * (RFC 6749, 6750) with the practices that have since become mandatory:
 *
 *  - the authorization code flow only, and PKCE with S256 on every request
 *  - exact redirect URI matching, https or loopback only
 *  - no implicit flow, no password grant
 *  - refresh tokens that rotate, and revoke the whole grant if one is replayed
 *  - an authorization code that is used twice revokes what it produced
 *
 * Also built: the device authorization grant for the CLI (RFC 8628), dynamic
 * client registration (RFC 7591), revocation (RFC 7009), authorization server
 * metadata (RFC 8414), protected resource metadata (RFC 9728), resource
 * indicators (RFC 8707) and the `iss` response parameter (RFC 9207).
 *
 * One token works for the REST API and for MCP, because its audience names
 * both unless the client asked for one with `resource`.
 */
export type SessionUser = { handle: string; name: string }

export interface SessionResolver {
  current: (req: Request) => SessionUser | null | Promise<SessionUser | null>
  /** Accounts a visitor may pick on the sign-in page. Empty: sign-in is not available. */
  logins: () => ReadonlyArray<SessionUser>
  start: (handle: string) => { cookie: string; csrf: string } | null
  csrf: (req: Request) => string | null
}

const SESSION_TTL = 28_800_000
const MAX_SESSIONS = 10_000

export class MemorySessions implements SessionResolver {
  private readonly sessions = new Map<string, { user: SessionUser; csrf: string; expires: number }>()
  constructor(
    private readonly users: ReadonlyArray<SessionUser>,
    private readonly secure: boolean,
  ) {}

  private sid(req: Request) {
    return /(?:^|;\s*)sx_session=([A-Za-z0-9_-]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
  }

  private live(sid: string | undefined) {
    if (!sid) return null
    const session = this.sessions.get(sid)
    if (!session) return null
    if (session.expires <= Date.now()) {
      this.sessions.delete(sid)
      return null
    }
    return session
  }

  current(req: Request) {
    return this.live(this.sid(req))?.user ?? null
  }

  csrf(req: Request) {
    return this.live(this.sid(req))?.csrf ?? null
  }

  logins() {
    return this.users
  }

  start(handle: string) {
    const user = this.users.find((u) => u.handle === handle)
    if (!user) return null
    if (this.sessions.size >= MAX_SESSIONS) {
      // Drop expired sessions first; if none are, drop the oldest.
      for (const [sid, session] of this.sessions)
        if (session.expires <= Date.now()) this.sessions.delete(sid)
      while (this.sessions.size >= MAX_SESSIONS)
        this.sessions.delete(this.sessions.keys().next().value as string)
    }
    const sid = randomBytes(24).toString('base64url')
    const csrf = randomBytes(18).toString('base64url')
    this.sessions.set(sid, { user, csrf, expires: Date.now() + SESSION_TTL })
    return {
      cookie: `sx_session=${sid}; Path=/; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}; Max-Age=${SESSION_TTL / 1000}`,
      csrf,
    }
  }
}

type Client = {
  id: string
  name: string
  redirectUris: ReadonlyArray<string>
  createdAt: number
}

type Pending = {
  id: string
  client: Client
  redirectUri: string
  challenge: string
  scopes: ReadonlyArray<Scope>
  audience: ReadonlyArray<Audience>
  state: string | null
  expires: number
}

type Code = Pending & { handle: string; used: boolean; authorizationId: string | null }

type Refresh = { authorizationId: string; used: boolean; expires: number; clientId: string }

type Device = {
  userCode: string
  client: Client
  scopes: ReadonlyArray<Scope>
  audience: ReadonlyArray<Audience>
  expires: number
  interval: number
  lastPoll: number
  status: 'pending' | 'approved' | 'denied'
  handle: string | null
}

export type Guard = (
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
) => Promise<Response | null>

export type OAuthOptions = {
  auth: AuthStore
  /** `https://source.code`: scheme and host, no path. */
  issuer: string
  /** The API's full base URL, such as `https://source.code/api/v1`. Endpoints live under it. */
  apiBase: string
  resources: { api: string; mcp: string }
  sessions: SessionResolver
  /** The most a person may delegate. */
  userScopes?: (handle: string) => ReadonlyArray<Scope>
  now?: () => number
  guard?: Guard
}

const ACCESS_TTL = 3600
const REFRESH_TTL = 30 * 86_400_000
const REFRESH_MAX = 180 * 86_400_000
const CODE_TTL = 60_000
const PENDING_TTL = 10 * 60_000
const DEVICE_TTL = 15 * 60_000
const USER_CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ'
const DEFAULT_SCOPES: ReadonlyArray<Scope> = ['repo:read', 'issues:read', 'pulls:read']

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' }

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...noStore, ...headers },
  })

/** OAuth requests are small. Read no more than this, with or without a Content-Length. */
const MAX_FORM_BYTES = 64 * 1024
async function readText(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return null
  const text = await req.text()
  return Buffer.byteLength(text, 'utf8') > MAX_FORM_BYTES ? null : text
}

async function formOf(req: Request): Promise<URLSearchParams | null> {
  const text = await readText(req)
  return text === null ? null : new URLSearchParams(text)
}

/** A `return_to` must stay on this origin. Backslashes and control bytes are not paths. */
function localReturn(to: string): boolean {
  if (!to.startsWith('/') || to.startsWith('//') || to.includes('\\')) return false
  for (const ch of to) {
    const code = ch.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return false
  }
  try {
    return new URL(to, 'https://example.invalid').origin === 'https://example.invalid'
  } catch {
    return false
  }
}

const oauthError = (error: string, description: string, status = 400, headers: Record<string, string> = {}) =>
  json({ error, error_description: description }, status, headers)

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

function validRedirect(uri: string): boolean {
  if (uri.length > 2000 || /[\s*]/.test(uri)) return false
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === 'https:') return !u.username && !u.password
  if (u.protocol === 'http:')
    return ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) && !u.username
  // A native app's reverse-DNS scheme, such as com.example.app:/callback.
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(u.protocol) && !uri.startsWith('javascript:')
}

const page = (title: string, body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem}h1{font-size:1.25rem}code{background:#8882;padding:.1em .3em;border-radius:3px}ul{padding-left:1.2rem}button{font:inherit;padding:.5rem 1rem;margin:.25rem .25rem .25rem 0;cursor:pointer}.muted{opacity:.7}input[type=text]{font:inherit;padding:.4rem;letter-spacing:.15em;text-transform:uppercase}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...noStore,
        ...extra,
      },
    },
  )

export class OAuthServer {
  private readonly clients = new Map<string, Client>()
  private readonly pending = new Map<string, Pending>()
  private readonly codes = new Map<string, Code>()
  private readonly refresh = new Map<string, Refresh>()
  private readonly devices = new Map<string, Device>()
  private readonly userCodes = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly o: OAuthOptions) {
    this.now = o.now ?? Date.now
  }

  private url(path: string) {
    return `${this.o.apiBase}/oauth${path}`
  }

  metadataUrl() {
    return `${this.o.issuer}/.well-known/oauth-protected-resource`
  }

  // ----- discovery --------------------------------------------------------

  metadata() {
    return {
      issuer: this.o.issuer,
      authorization_endpoint: this.url('/authorize'),
      token_endpoint: this.url('/token'),
      registration_endpoint: this.url('/register'),
      revocation_endpoint: this.url('/revoke'),
      device_authorization_endpoint: this.url('/device_authorization'),
      scopes_supported: oauthScopes,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${this.o.issuer}/docs/api/oauth`,
    }
  }

  protectedResource() {
    return {
      resource: this.o.resources.api,
      authorization_servers: [this.o.issuer],
      scopes_supported: oauthScopes,
      bearer_methods_supported: ['header'],
      resource_documentation: `${this.o.issuer}/docs/api`,
    }
  }

  mcpResource() {
    return { ...this.protectedResource(), resource: this.o.resources.mcp }
  }

  // ----- entry ------------------------------------------------------------

  async handle(req: Request, rest: string): Promise<Response | null> {
    const m = req.method
    this.sweep()
    if (rest === '/register' && m === 'POST') return this.register(req)
    if (rest === '/authorize' && (m === 'GET' || m === 'POST')) return this.authorize(req)
    if (rest === '/token' && m === 'POST') return this.token(req)
    if (rest === '/revoke' && m === 'POST') return this.revoke(req)
    if (rest === '/device_authorization' && m === 'POST') return this.deviceAuthorization(req)
    if (rest === '/device' && (m === 'GET' || m === 'POST')) return this.devicePage(req)
    if (rest === '/session' && m === 'POST') return this.signIn(req)
    return null
  }

  /** Set by the API that mounts this server, so limits share its limiter. */
  guardWith: Guard | undefined

  private async guard(req: Request, bucket: string, limit: number, windowMs: number) {
    const g = this.guardWith ?? this.o.guard
    return g ? g(req, bucket, limit, windowMs) : null
  }

  private sweep() {
    const t = this.now()
    if (this.pending.size + this.codes.size + this.devices.size < 200) return
    for (const [k, v] of this.pending) if (v.expires < t) this.pending.delete(k)
    for (const [k, v] of this.codes) if (v.expires < t) this.codes.delete(k)
    for (const [k, v] of this.devices) if (v.expires < t) {
      this.devices.delete(k)
      this.userCodes.delete(v.userCode)
    }
    for (const [k, v] of this.refresh) if (v.expires < t) this.refresh.delete(k)
  }

  // ----- registration (RFC 7591) -------------------------------------------

  private async register(req: Request) {
    const limited = await this.guard(req, 'oauth-register', 20, 3_600_000)
    if (limited) return limited
    let body: Record<string, unknown>
    try {
      const text = await readText(req)
      if (text === null) return oauthError('invalid_client_metadata', 'The body is too large.', 413)
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      return oauthError('invalid_client_metadata', 'The body is not JSON.')
    }
    const name = typeof body.client_name === 'string' ? body.client_name.trim() : ''
    const uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as Array<unknown>) : []
    if (!name || name.length > 100)
      return oauthError('invalid_client_metadata', 'client_name is required, up to 100 characters.')
    if (uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === 'string' && validRedirect(u)))
      return oauthError(
        'invalid_redirect_uri',
        'Give 1 to 5 redirect_uris. Each must be https, or http on a loopback address, with no fragment or wildcard.',
      )
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none')
      return oauthError('invalid_client_metadata', 'Only public clients are supported: token_endpoint_auth_method must be none.')
    if (this.clients.size >= 20_000)
      return oauthError('temporarily_unavailable', 'Too many registered clients. Try again later.', 503, { 'retry-after': '60' })
    const client: Client = {
      id: `cl_${randomBytes(15).toString('base64url')}`,
      name,
      redirectUris: uris as Array<string>,
      createdAt: this.now(),
    }
    this.clients.set(client.id, client)
    return json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    )
  }

  // ----- helpers -----------------------------------------------------------

  private parseScopes(
    raw: string | null | undefined,
    max: ReadonlyArray<Scope>,
  ): { error: string } | { scopes: Array<Scope> } {
    const asked = raw ? raw.split(/\s+/).filter(Boolean) : DEFAULT_SCOPES
    const bad = asked.filter((s) => !oauthScopes.includes(s as Scope))
    if (bad.length) return { error: `Unknown or ungrantable scope: ${bad.join(' ')}.` }
    const scopes = asked as Array<Scope>
    const over = scopes.filter((s) => !max.includes(s))
    if (over.length) return { error: `You may not delegate: ${over.join(' ')}.` }
    return { scopes: [...new Set(scopes)] }
  }

  private audienceOf(resources: Array<string>): ReadonlyArray<Audience> | null {
    if (resources.length === 0) return ['api', 'mcp']
    const out = new Set<Audience>()
    for (const r of resources) {
      if (r === this.o.resources.api) out.add('api')
      else if (r === this.o.resources.mcp) out.add('mcp')
      else return null
    }
    return [...out]
  }

  private maxScopes(handle: string) {
    return this.o.userScopes ? this.o.userScopes(handle) : oauthScopes
  }

  private describeScope(s: Scope) {
    return (
      {
        'repo:read': 'Read your repositories',
        'repo:write': 'Change repository data',
        'issues:read': 'Read issues',
        'issues:comment': 'Comment on issues',
        'issues:write': 'Open, edit and close issues',
        'pulls:read': 'Read changes',
        'pulls:comment': 'Review and comment on changes',
        'pulls:write': 'Create and edit changes',
        'pulls:merge': 'Land changes',
        'secrets:schema': 'See the names of environment variables, never their values',
        'secrets:write': 'Set environment variables',
        'webhooks:read': 'Read webhooks',
        'webhooks:write': 'Create and change webhooks',
      } as Record<string, string>
    )[s] ?? s
  }

  private signInPage(_req: Request, returnTo: string) {
    const logins = this.o.sessions.logins()
    if (logins.length === 0)
      return page(
        'Sign in',
        '<h1>Sign in is not available yet</h1><p>This preview has no accounts. Tokens and sign-in arrive with the hosted service.</p>',
        401,
      )
    return page(
      'Sign in',
      `<h1>Sign in to source.code</h1><p class="muted">Preview: pick a sample account. No password is asked.</p>${logins
        .map(
          (u) =>
            `<form method="post" action="${esc(this.url('/session'))}" style="display:inline"><input type="hidden" name="handle" value="${esc(u.handle)}"><input type="hidden" name="return_to" value="${esc(returnTo)}"><button>Continue as ${esc(u.handle)}</button></form>`,
        )
        .join('')}`,
    )
  }

  private async signIn(req: Request) {
    if (!this.sameOrigin(req)) return page('Error', '<h1>Request refused</h1>', 403)
    const form = await formOf(req)
    const handle = String(form?.get('handle') ?? '')
    const returnTo = String(form?.get('return_to') ?? '/')
    const started = this.o.sessions.start(handle)
    if (!started || !localReturn(returnTo))
      return page('Sign in', '<h1>That did not work</h1>', 400)
    return new Response(null, {
      status: 303,
      headers: { location: returnTo, 'set-cookie': started.cookie, ...noStore },
    })
  }

  private sameOrigin(req: Request) {
    const origin = req.headers.get('origin')
    return !origin || origin === this.o.issuer
  }

  // ----- authorization code (RFC 6749, 7636, 8707, 9207) ----------------------

  private async authorize(req: Request): Promise<Response> {
    const limited = await this.guard(req, 'oauth-authorize', 120, 60_000)
    if (limited) return limited
    const url = new URL(req.url)
    if (req.method === 'POST') return this.decide(req)
    const p = url.searchParams
    const client = this.clients.get(p.get('client_id') ?? '')
    const redirectUri = p.get('redirect_uri') ?? ''
    // Until the client and redirect are known to be good, never redirect.
    if (!client || !client.redirectUris.includes(redirectUri))
      return page('Error', '<h1>This link is not valid</h1><p>The application is not registered, or its redirect address does not match.</p>', 400)
    const fail = (error: string, description: string) => {
      const to = new URL(redirectUri)
      to.searchParams.set('error', error)
      to.searchParams.set('error_description', description)
      if (p.get('state')) to.searchParams.set('state', p.get('state')!)
      to.searchParams.set('iss', this.o.issuer)
      return new Response(null, { status: 302, headers: { location: to.toString(), ...noStore } })
    }
    if (p.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.')
    const challenge = p.get('code_challenge') ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || p.get('code_challenge_method') !== 'S256')
      return fail('invalid_request', 'PKCE is required: send code_challenge and code_challenge_method=S256.')
    const audience = this.audienceOf(p.getAll('resource'))
    if (!audience) return fail('invalid_target', 'resource must be one of the resources this server protects.')

    const user = await this.o.sessions.current(req)
    const scopeParse = this.parseScopes(p.get('scope'), user ? this.maxScopes(user.handle) : oauthScopes)
    if ('error' in scopeParse) return fail('invalid_scope', scopeParse.error)

    if (this.pending.size >= 10_000) {
      this.sweep()
      if (this.pending.size >= 10_000)
        return page('Error', '<h1>Too many sign-in attempts</h1><p>Try again later.</p>', 503, { 'retry-after': '60' })
    }
    const pending: Pending = {
      id: `oar_${randomBytes(18).toString('base64url')}`,
      client,
      redirectUri,
      challenge,
      scopes: scopeParse.scopes,
      audience,
      state: p.get('state'),
      expires: this.now() + PENDING_TTL,
    }
    this.pending.set(pending.id, pending)
    if (!user) return this.signInPage(req, `${url.pathname}${url.search}`)
    return this.consentPage(req, pending, user)
  }

  private consentPage(req: Request, pending: Pending, user: SessionUser) {
    const csrf = this.o.sessions.csrf(req) ?? ''
    return page(
      'Authorize',
      `<h1>Authorize ${esc(pending.client.name)}</h1>
<p>Signed in as <strong>${esc(user.handle)}</strong>. This application will be able to:</p>
<ul>${pending.scopes.map((s) => `<li>${esc(this.describeScope(s))} <code>${esc(s)}</code></li>`).join('')}</ul>
<p class="muted">It will send you back to <code>${esc(new URL(pending.redirectUri).origin === 'null' ? pending.redirectUri : new URL(pending.redirectUri).origin)}</code>. You can revoke it any time in Settings.</p>
<form method="post" action="${esc(this.url('/authorize'))}"><input type="hidden" name="request_id" value="${esc(pending.id)}"><input type="hidden" name="csrf" value="${esc(csrf)}"><button name="decision" value="approve">Approve</button><button name="decision" value="deny">Deny</button></form>`,
    )
  }

  private async decide(req: Request): Promise<Response> {
    if (!this.sameOrigin(req)) return page('Error', '<h1>Request refused</h1>', 403)
    const user = await this.o.sessions.current(req)
    const form = await formOf(req)
    const pending = this.pending.get(String(form?.get('request_id') ?? ''))
    if (!user || !form || !pending || pending.expires < this.now())
      return page('Error', '<h1>This request expired</h1><p>Go back to the application and start again.</p>', 400)
    if (form.get('csrf') !== this.o.sessions.csrf(req) || !form.get('csrf'))
      return page('Error', '<h1>Request refused</h1>', 403)
    this.pending.delete(pending.id)
    const to = new URL(pending.redirectUri)
    if (pending.state) to.searchParams.set('state', pending.state)
    to.searchParams.set('iss', this.o.issuer)
    if (form.get('decision') !== 'approve') {
      to.searchParams.set('error', 'access_denied')
      return new Response(null, { status: 302, headers: { location: to.toString(), ...noStore } })
    }
    const scopes = pending.scopes.filter((s) => this.maxScopes(user.handle).includes(s))
    const code = `oac_${randomBytes(24).toString('base64url')}`
    this.codes.set(code, { ...pending, scopes, handle: user.handle, used: false, authorizationId: null, expires: this.now() + CODE_TTL })
    to.searchParams.set('code', code)
    return new Response(null, { status: 302, headers: { location: to.toString(), ...noStore } })
  }

  // ----- tokens ---------------------------------------------------------------

  private issue(authorizationId: string, handle: string, clientName: string, scopes: ReadonlyArray<Scope>, audience: ReadonlyArray<Audience>, clientId: string) {
    const { secret } = this.o.auth.create({
      name: clientName,
      kind: 'oauth',
      handle,
      class: 'human',
      scopes,
      audience,
      ttlMs: ACCESS_TTL * 1000,
      authorizationId,
    })
    const refreshSecret = secretFor('refresh')
    const auth = this.o.auth.authorizations.get(authorizationId)!
    this.refresh.set(createHash('sha256').update(refreshSecret).digest('hex'), {
      authorizationId,
      used: false,
      expires: Math.min(this.now() + REFRESH_TTL, auth.createdAt + REFRESH_MAX),
      clientId,
    })
    return json({
      access_token: secret,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      refresh_token: refreshSecret,
      scope: scopes.join(' '),
    })
  }

  private async token(req: Request): Promise<Response> {
    const limited = await this.guard(req, 'oauth-token', 120, 60_000)
    if (limited) return limited
    const type = req.headers.get('content-type') ?? ''
    if (!type.includes('application/x-www-form-urlencoded'))
      return oauthError('invalid_request', 'Send application/x-www-form-urlencoded.')
    const f = await formOf(req)
    if (!f) return oauthError('invalid_request', 'The body is too large.', 413)
    const grant = f.get('grant_type')
    if (grant === 'authorization_code') return this.codeGrant(f)
    if (grant === 'refresh_token') return this.refreshGrant(f)
    if (grant === 'urn:ietf:params:oauth:grant-type:device_code') return this.deviceGrant(f)
    return oauthError('unsupported_grant_type', 'Use authorization_code, refresh_token or the device code grant.')
  }

  private codeGrant(f: URLSearchParams): Response {
    const code = this.codes.get(f.get('code') ?? '')
    const bad = () => oauthError('invalid_grant', 'The code is not valid, has expired, or was already used.')
    if (!code || code.expires < this.now()) return bad()
    if (code.used) {
      // A code used twice means it leaked: take back what it produced.
      if (code.authorizationId) this.o.auth.revokeAuthorization(code.authorizationId)
      return bad()
    }
    if (f.get('client_id') !== code.client.id || f.get('redirect_uri') !== code.redirectUri) return bad()
    const verifier = f.get('code_verifier') ?? ''
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || s256(verifier) !== code.challenge)
      return oauthError('invalid_grant', 'The code_verifier does not match the code_challenge.')
    const asked = f.getAll('resource')
    if (asked.length) {
      const aud = this.audienceOf(asked)
      if (!aud || !aud.every((a) => code.audience.includes(a)))
        return oauthError('invalid_target', 'resource was not part of the authorization.')
    }
    code.used = true
    const a = this.o.auth.createAuthorization({
      clientId: code.client.id,
      clientName: code.client.name,
      handle: code.handle,
      scopes: code.scopes,
      audience: code.audience,
    })
    code.authorizationId = a.id
    return this.issue(a.id, code.handle, code.client.name, code.scopes, code.audience, code.client.id)
  }

  private refreshGrant(f: URLSearchParams): Response {
    const hash = createHash('sha256').update(f.get('refresh_token') ?? '').digest('hex')
    const r = this.refresh.get(hash)
    const bad = () => oauthError('invalid_grant', 'The refresh token is not valid.')
    if (!r || r.expires < this.now() || (f.get('client_id') && f.get('client_id') !== r.clientId)) return bad()
    const a = this.o.auth.authorizations.get(r.authorizationId)
    if (!a || a.revokedAt !== null) return bad()
    if (r.used) {
      // A refresh token used twice was copied. Revoke the whole grant.
      this.o.auth.revokeAuthorization(a.id)
      return bad()
    }
    let scopes = a.scopes
    if (f.get('scope')) {
      const asked = f.get('scope')!.split(/\s+/).filter(Boolean) as Array<Scope>
      if (!asked.every((s) => a.scopes.includes(s))) return oauthError('invalid_scope', 'A refresh cannot widen the scope.')
      scopes = asked
    }
    r.used = true
    a.lastUsedAt = this.now()
    return this.issue(a.id, a.handle, a.clientName, scopes, a.audience, r.clientId)
  }

  // ----- revocation (RFC 7009) ----------------------------------------------------

  private async revoke(req: Request): Promise<Response> {
    const limited = await this.guard(req, 'oauth-revoke', 120, 60_000)
    if (limited) return limited
    const f = await formOf(req)
    if (!f) return oauthError('invalid_request', 'The body is too large.', 413)
    const token = f.get('token') ?? ''
    const hash = createHash('sha256').update(token).digest('hex')
    const r = this.refresh.get(hash)
    if (r) this.o.auth.revokeAuthorization(r.authorizationId)
    else {
      const found = this.o.auth.find(hash, 'api', this.now())
      if (found.ok && found.record.kind === 'oauth' && found.record.authorizationId)
        this.o.auth.revokeAuthorization(found.record.authorizationId)
    }
    // Always 200: the caller learns nothing about which tokens exist.
    return new Response(null, { status: 200, headers: noStore })
  }

  // ----- device authorization (RFC 8628) -----------------------------------------------

  private async deviceAuthorization(req: Request): Promise<Response> {
    const limited = await this.guard(req, 'oauth-device', 30, 60_000)
    if (limited) return limited
    const f = await formOf(req)
    if (!f) return oauthError('invalid_request', 'The body is too large.', 413)
    const client = this.clients.get(f.get('client_id') ?? '')
    if (!client) return oauthError('invalid_client', 'Unknown client_id. Register one at the registration endpoint.', 401)
    const audience = this.audienceOf(f.getAll('resource'))
    if (!audience) return oauthError('invalid_target', 'resource must be one this server protects.')
    const parsed = this.parseScopes(f.get('scope'), oauthScopes)
    if ('error' in parsed) return oauthError('invalid_scope', parsed.error)
    let userCode = ''
    for (let i = 0; i < 8; i++) userCode += USER_CODE_CHARS[randomBytes(1)[0] % USER_CODE_CHARS.length]
    const deviceCode = `sxd_${randomBytes(32).toString('base64url')}`
    const device: Device = {
      userCode,
      client,
      scopes: parsed.scopes,
      audience,
      expires: this.now() + DEVICE_TTL,
      interval: 5,
      lastPoll: 0,
      status: 'pending',
      handle: null,
    }
    this.devices.set(createHash('sha256').update(deviceCode).digest('hex'), device)
    this.userCodes.set(userCode, createHash('sha256').update(deviceCode).digest('hex'))
    const shown = `${userCode.slice(0, 4)}-${userCode.slice(4)}`
    const uri = this.url('/device')
    return json({
      device_code: deviceCode,
      user_code: shown,
      verification_uri: uri,
      verification_uri_complete: `${uri}?user_code=${shown}`,
      expires_in: DEVICE_TTL / 1000,
      interval: device.interval,
    })
  }

  private deviceGrant(f: URLSearchParams): Response {
    const hash = createHash('sha256').update(f.get('device_code') ?? '').digest('hex')
    const d = this.devices.get(hash)
    if (!d || (f.get('client_id') && f.get('client_id') !== d.client.id))
      return oauthError('invalid_grant', 'The device code is not valid.')
    const t = this.now()
    if (d.expires < t) return oauthError('expired_token', 'The device code expired. Start again.')
    if (t - d.lastPoll < d.interval * 1000 - 200) {
      d.interval += 5
      d.lastPoll = t
      return oauthError('slow_down', `Poll no faster than every ${d.interval} seconds.`)
    }
    d.lastPoll = t
    if (d.status === 'denied') {
      this.devices.delete(hash)
      return oauthError('access_denied', 'The person said no.')
    }
    if (d.status === 'pending') return oauthError('authorization_pending', 'Waiting for the person to approve.')
    this.devices.delete(hash)
    this.userCodes.delete(d.userCode)
    const a = this.o.auth.createAuthorization({
      clientId: d.client.id,
      clientName: d.client.name,
      handle: d.handle!,
      scopes: d.scopes,
      audience: d.audience,
    })
    return this.issue(a.id, d.handle!, d.client.name, d.scopes, d.audience, d.client.id)
  }

  private async devicePage(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const user = await this.o.sessions.current(req)
    const entry = (message = '') =>
      page(
        'Connect a device',
        `<h1>Connect a device</h1>${message ? `<p>${esc(message)}</p>` : '<p>Enter the code shown by the application.</p>'}<form method="post" action="${esc(this.url('/device'))}"><input type="hidden" name="csrf" value="${esc(this.o.sessions.csrf(req) ?? '')}"><input type="text" name="user_code" autocomplete="off" maxlength="9" value="${esc(url.searchParams.get('user_code') ?? '')}"><button>Continue</button></form>`,
      )
    if (req.method === 'GET') {
      if (!user) return this.signInPage(req, `${url.pathname}${url.search}`)
      return entry()
    }
    if (!this.sameOrigin(req)) return page('Error', '<h1>Request refused</h1>', 403)
    if (!user) return this.signInPage(req, url.pathname)
    const form = await formOf(req)
    if (!form || !form.get('csrf') || form.get('csrf') !== this.o.sessions.csrf(req))
      return page('Error', '<h1>Request refused</h1>', 403)
    // Guessing codes is the attack here: slow it down per address.
    const limited = await this.guard(req, 'oauth-user-code', 10, 15 * 60_000)
    if (limited) return page('Too many tries', '<h1>Too many tries</h1><p>Wait a few minutes.</p>', 429)
    const code = String(form.get('user_code') ?? '').toUpperCase().replace(/[^A-Z]/g, '')
    const hash = this.userCodes.get(code)
    const d = hash ? this.devices.get(hash) : undefined
    if (!d || d.expires < this.now() || d.status !== 'pending') return entry('That code was not found or has expired.')
    const decision = form.get('decision')
    if (decision === 'approve' || decision === 'deny') {
      d.status = decision === 'approve' ? 'approved' : 'denied'
      d.handle = user.handle
      d.scopes = d.scopes.filter((s) => this.maxScopes(user.handle).includes(s))
      return page('Done', `<h1>${decision === 'approve' ? 'Device connected' : 'Request denied'}</h1><p>You can close this window.</p>`)
    }
    return page(
      'Connect a device',
      `<h1>Connect ${esc(d.client.name)}</h1><p>Signed in as <strong>${esc(user.handle)}</strong>. Only approve if you started this on your own device. It will be able to:</p><ul>${d.scopes.map((s) => `<li>${esc(this.describeScope(s))} <code>${esc(s)}</code></li>`).join('')}</ul><form method="post" action="${esc(this.url('/device'))}"><input type="hidden" name="csrf" value="${esc(String(form.get('csrf')))}"><input type="hidden" name="user_code" value="${esc(code)}"><button name="decision" value="approve">Approve</button><button name="decision" value="deny">Deny</button></form>`,
    )
  }
}

