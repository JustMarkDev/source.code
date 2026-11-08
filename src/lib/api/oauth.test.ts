import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { clock, harness } from './testing'

const REDIRECT = 'https://app.example.com/callback'
const API = 'https://api.test/v1'

function setup(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts)
  const fetchRaw = (path: string, init: RequestInit = {}) =>
    h.api.fetch(new Request(`${API}${path}`, { redirect: 'manual', ...init }))
  const form = (data: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
  })

  const register = async (name = 'Test App', redirect = REDIRECT) => {
    const res = await fetchRaw('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }),
    })
    return { status: res.status, json: (await res.json()) }
  }

  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
  }

  const signIn = async (handle = 'dana', returnTo = '/') => {
    const res = await fetchRaw('/oauth/session', {
      ...form({ handle, return_to: returnTo }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://source.code' },
    })
    return res.headers.get('set-cookie')!.split(';')[0]
  }

  const authorizeUrl = (client: string, challenge: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: client,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'repo:read pulls:read issues:read',
      ...extra,
    })
    return `/oauth/authorize?${p}`
  }

  /** Runs the whole browser leg and returns the code. */
  const approve = async (client: string, challenge: string, extra: Record<string, string> = {}, handle = 'dana') => {
    const cookie = await signIn(handle)
    const page = await fetchRaw(authorizeUrl(client, challenge, extra), { headers: { cookie } })
    const html = await page.text()
    const requestId = /name="request_id" value="([^"]+)"/.exec(html)?.[1]
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
    expect(requestId, html.slice(0, 300)).toBeTruthy()
    const done = await fetchRaw('/oauth/authorize', {
      ...form({ request_id: requestId!, csrf: csrf!, decision: 'approve' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    })
    return { done, location: new URL(done.headers.get('location')!), html, cookie, requestId: requestId!, csrf: csrf! }
  }

  const exchange = async (data: Record<string, string>) => {
    const res = await fetchRaw('/oauth/token', form(data))
    return { status: res.status, json: (await res.json()), headers: res.headers }
  }

  const getCode = async (extra: Record<string, string> = {}) => {
    const client = (await register()).json.client_id as string
    const { verifier, challenge } = pkce()
    const r = await approve(client, challenge, extra)
    return { client, verifier, code: r.location.searchParams.get('code')!, r }
  }

  const tokenRequest = (client: string, code: string, verifier: string) => ({
    grant_type: 'authorization_code',
    code,
    client_id: client,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  })

  return { ...h, fetchRaw, form, register, pkce, signIn, authorizeUrl, approve, exchange, getCode, tokenRequest }
}

describe('discovery', () => {
  test('the authorization server describes itself', () => {
    const h = setup()
    const m = h.api.oauth!.metadata()
    expect(m.code_challenge_methods_supported).toEqual(['S256'])
    expect(m.response_types_supported).toEqual(['code'])
    expect(m.grant_types_supported).not.toContain('implicit')
    expect(m.grant_types_supported).not.toContain('password')
    expect(m.token_endpoint).toBe('https://api.source.code/v1/oauth/token')
    expect(m.authorization_response_iss_parameter_supported).toBe(true)
    expect(m.scopes_supported).not.toContain('tokens:manage')
    expect(m.scopes_supported).not.toContain('secrets:decrypt')
    const r = h.api.oauth!.protectedResource()
    expect(r.authorization_servers).toEqual(['https://source.code'])
    expect(r.bearer_methods_supported).toEqual(['header'])
  })

  test('a 401 points the client at the resource metadata', async () => {
    const h = setup()
    const res = await h.call('GET', '/auth/principal', { token: null })
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="https://source.code/.well-known/oauth-protected-resource"')
  })
})

describe('registration', () => {
  test('registers a public client', async () => {
    const h = setup()
    const r = await h.register('My CLI')
    expect(r.status).toBe(201)
    expect(r.json.client_id).toMatch(/^cl_/)
    expect(r.json.token_endpoint_auth_method).toBe('none')
  })

  test.each([
    ['plain http to a real host', 'http://app.example.com/cb'],
    ['a wildcard', 'https://*.example.com/cb'],
    ['a fragment', 'https://app.example.com/cb#x'],
    ['javascript', 'javascript:alert(1)'],
    ['credentials in the URL', 'https://u:p@app.example.com/cb'],
    ['not a URL', 'nope'],
  ])('refuses a redirect URI with %s', async (_n, uri) => {
    const h = setup()
    const r = await h.register('Bad', uri)
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('invalid_redirect_uri')
  })

  test('accepts loopback http and a native reverse-DNS scheme', async () => {
    const h = setup()
    expect((await h.register('a', 'http://127.0.0.1:8123/cb')).status).toBe(201)
    expect((await h.register('b', 'http://localhost:3000/cb')).status).toBe(201)
    expect((await h.register('c', 'com.example.app:/callback')).status).toBe(201)
  })

  test('refuses a confidential client and a nameless one', async () => {
    const h = setup()
    const res = await h.fetchRaw('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }) })
    expect((await res.json()).error).toBe('invalid_client_metadata')
    expect((await h.register('')).status).toBe(400)
  })

  test('registration is rate limited per address', async () => {
    const h = setup()
    let last = 0
    for (let i = 0; i < 25; i++) last = (await h.register(`c${i}`)).status
    expect(last).toBe(429)
  })
})

describe('authorization code with PKCE', () => {
  test('the whole flow gives a token that works on the API', async () => {
    const h = setup()
    const { client, verifier, code, r } = await h.getCode()
    expect(r.done.status).toBe(302)
    expect(r.location.origin + r.location.pathname).toBe(REDIRECT)
    expect(r.location.searchParams.get('state')).toBe('xyz')
    expect(r.location.searchParams.get('iss')).toBe('https://source.code')
    expect(r.html).toContain('Test App')
    expect(r.html).toContain('repo:read')
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    expect(t.status).toBe(200)
    expect(t.headers.get('cache-control')).toBe('no-store')
    expect(t.json).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'repo:read pulls:read issues:read' })
    expect(t.json.access_token).toMatch(/^sxo_/)
    expect(t.json.refresh_token).toMatch(/^sxf_/)

    const who = await h.call('GET', '/auth/principal', { token: t.json.access_token })
    expect(who.status).toBe(200)
    expect(who.json.login).toBe('dana')
    expect(who.json.scopes).toEqual(['issues:read', 'pulls:read', 'repo:read'])
    // The scopes it was given are all it has: no writes.
    const write = await h.call('POST', '/repos/dana/gitfs/issues', { token: t.json.access_token, body: { title: 'x' } })
    expect(write.status).toBe(403)
    expect(write.json.code).toBe('insufficient_scope')
  })

  test('no PKCE, or plain PKCE, is refused through the redirect', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    const cookie = await h.signIn()
    for (const extra of [{ code_challenge: '' }, { code_challenge_method: 'plain' }] as Array<Record<string, string>>) {
      const res = await h.fetchRaw(h.authorizeUrl(client, h.pkce().challenge, extra), { headers: { cookie } })
      expect(res.status).toBe(302)
      expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('invalid_request')
    }
  })

  test('a wrong verifier gets nothing, and the code is then dead', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const bad = await h.exchange(h.tokenRequest(client, code, randomBytes(32).toString('base64url')))
    expect(bad.json.error).toBe('invalid_grant')
    // The right verifier still works: a wrong guess does not burn the code.
    expect((await h.exchange(h.tokenRequest(client, code, verifier))).status).toBe(200)
  })

  test('a code used twice revokes what the first use produced', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const first = await h.exchange(h.tokenRequest(client, code, verifier))
    expect((await h.call('GET', '/auth/principal', { token: first.json.access_token })).status).toBe(200)
    const second = await h.exchange(h.tokenRequest(client, code, verifier))
    expect(second.json.error).toBe('invalid_grant')
    const after = await h.call('GET', '/auth/principal', { token: first.json.access_token })
    expect(after.status).toBe(401)
    expect(after.json.code).toBe('token_revoked')
  })

  test('a code expires after a minute', async () => {
    const now = clock()
    const h = setup({ now })
    const { client, code, verifier } = await h.getCode()
    now.advance(61_000)
    expect((await h.exchange(h.tokenRequest(client, code, verifier))).json.error).toBe('invalid_grant')
  })

  test('redirect URIs must match exactly, and an unknown client never redirects', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    const c = h.pkce().challenge
    for (const uri of [`${REDIRECT}/evil`, `${REDIRECT}?x=1`, 'https://evil.example.com/callback']) {
      const res = await h.fetchRaw(h.authorizeUrl(client, c, { redirect_uri: uri }))
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
    }
    const unknown = await h.fetchRaw(h.authorizeUrl('cl_doesnotexist', c))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('location')).toBeNull()
    // And the code cannot be redeemed at a different redirect.
    const { client: c2, code, verifier } = await h.getCode()
    const wrong = await h.exchange({ ...h.tokenRequest(c2, code, verifier), redirect_uri: 'https://evil.example.com/callback' })
    expect(wrong.json.error).toBe('invalid_grant')
  })

  test('sign-in only returns to a local path', async () => {
    const h = setup()
    for (const to of ['//evil.example', '/\\evil.example', '/\tevil', 'https://evil.example']) {
      const res = await h.fetchRaw('/oauth/session', {
        ...h.form({ handle: 'dana', return_to: to }),
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://source.code' },
      })
      expect(res.status, to).toBe(400)
      expect(res.headers.get('set-cookie'), to).toBeNull()
    }
    const ok = await h.fetchRaw('/oauth/session', {
      ...h.form({ handle: 'dana', return_to: '/' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://source.code' },
    })
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('/')
    const noOrigin = await h.fetchRaw('/oauth/session', h.form({ handle: 'dana', return_to: '/' }))
    expect(noOrigin.status).toBe(403)
  })

  test('the consent page needs a session, a CSRF token and the same origin', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    const { challenge } = h.pkce()
    // Signed out: a sign-in page, not consent.
    const out = await h.fetchRaw(h.authorizeUrl(client, challenge))
    expect(await out.text()).toContain('Continue as dana')
    const cookie = await h.signIn()
    const html = await (await h.fetchRaw(h.authorizeUrl(client, challenge), { headers: { cookie } })).text()
    const r = {
      cookie,
      requestId: /name="request_id" value="([^"]+)"/.exec(html)![1],
      csrf: /name="csrf" value="([^"]+)"/.exec(html)![1],
    }
    // The same decision without the token is refused.
    const noCsrf = await h.fetchRaw('/oauth/authorize', { ...h.form({ request_id: r.requestId, decision: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: r.cookie } })
    expect(noCsrf.status).toBe(403)
    const crossOrigin = await h.fetchRaw('/oauth/authorize', { ...h.form({ request_id: r.requestId, csrf: r.csrf, decision: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: r.cookie, origin: 'https://evil.example.com' } })
    expect(crossOrigin.status).toBe(403)
    const noSession = await h.fetchRaw('/oauth/authorize', h.form({ request_id: r.requestId, csrf: r.csrf, decision: 'approve' }))
    expect(noSession.status).toBe(400)
  })

  test('denying sends access_denied and no code', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    const { challenge } = h.pkce()
    const cookie = await h.signIn()
    const html = await (await h.fetchRaw(h.authorizeUrl(client, challenge), { headers: { cookie } })).text()
    const requestId = /name="request_id" value="([^"]+)"/.exec(html)![1]
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]
    const res = await h.fetchRaw('/oauth/authorize', { ...h.form({ request_id: requestId, csrf, decision: 'deny' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('error')).toBe('access_denied')
    expect(loc.searchParams.get('code')).toBeNull()
  })

  test('what the page shows is escaped', async () => {
    const h = setup()
    const client = (await h.register('<script>alert(1)</script>')).json.client_id
    const cookie = await h.signIn()
    const page = await h.fetchRaw(h.authorizeUrl(client, h.pkce().challenge), { headers: { cookie } })
    const html = await page.text()
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(page.headers.get('x-frame-options')).toBe('DENY')
  })

  test('you cannot delegate more than you hold, and unknown scopes are refused', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    // hollis is a member, not an owner: no repo:write to hand out.
    const cookie = await h.signIn('hollis')
    const res = await h.fetchRaw(h.authorizeUrl(client, h.pkce().challenge, { scope: 'repo:write' }), { headers: { cookie } })
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope')
    for (const scope of ['tokens:manage', 'secrets:decrypt', 'made:up']) {
      const r = await h.fetchRaw(h.authorizeUrl(client, h.pkce().challenge, { scope }), { headers: { cookie: await h.signIn() } })
      expect(new URL(r.headers.get('location')!).searchParams.get('error'), scope).toBe('invalid_scope')
    }
  })

  test('with no scope you get read-only', async () => {
    const h = setup()
    const client = (await h.register()).json.client_id
    const { verifier, challenge } = h.pkce()
    const params = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' })
    const cookie = await h.signIn()
    const html = await (await h.fetchRaw(`/oauth/authorize?${params}`, { headers: { cookie } })).text()
    const requestId = /name="request_id" value="([^"]+)"/.exec(html)![1]
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]
    const done = await h.fetchRaw('/oauth/authorize', { ...h.form({ request_id: requestId, csrf, decision: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })
    const code = new URL(done.headers.get('location')!).searchParams.get('code')!
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    expect(t.json.scope).toBe('repo:read issues:read pulls:read')
  })

  test('resource indicators narrow the audience: an MCP token is not an API token', async () => {
    const h = setup()
    const apiOnly = await h.getCode({ resource: 'https://api.source.code/v1' })
    const t = await h.exchange(h.tokenRequest(apiOnly.client, apiOnly.code, apiOnly.verifier))
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).status).toBe(200)
    expect((await h.api.verifyToken(t.json.access_token, 'mcp')).ok).toBe(false)

    const mcpOnly = await h.getCode({ resource: 'https://source.code/mcp' })
    const m = await h.exchange(h.tokenRequest(mcpOnly.client, mcpOnly.code, mcpOnly.verifier))
    const refused = await h.call('GET', '/auth/principal', { token: m.json.access_token })
    expect(refused.status).toBe(401)
    expect(refused.json.detail).toContain('not valid for the API')
    expect((await h.api.verifyToken(m.json.access_token, 'mcp')).ok).toBe(true)

    // With no resource, one token serves both.
    const both = await h.getCode()
    const b = await h.exchange(h.tokenRequest(both.client, both.code, both.verifier))
    expect((await h.api.verifyToken(b.json.access_token, 'api')).ok).toBe(true)
    expect((await h.api.verifyToken(b.json.access_token, 'mcp')).ok).toBe(true)

    // A token exchange may narrow the audience even when the grant was wider.
    const narrow = await h.getCode()
    const n = await h.exchange({ ...h.tokenRequest(narrow.client, narrow.code, narrow.verifier), resource: 'https://source.code/mcp' })
    expect((await h.api.verifyToken(n.json.access_token, 'api')).ok).toBe(false)
    expect((await h.api.verifyToken(n.json.access_token, 'mcp')).ok).toBe(true)

    const client = (await h.register()).json.client_id
    const bad = await h.fetchRaw(h.authorizeUrl(client, h.pkce().challenge, { resource: 'https://evil.example.com' }), { headers: { cookie: await h.signIn() } })
    expect(new URL(bad.headers.get('location')!).searchParams.get('error')).toBe('invalid_target')
  })
})

describe('tokens expire, refresh rotates, and a replay takes everything back', () => {
  test('the access token expires after an hour', async () => {
    const now = clock()
    const h = setup({ now })
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    now.advance(3_599_000)
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).status).toBe(200)
    now.advance(2000)
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).json.code).toBe('token_expired')
  })

  test('refreshing gives new tokens and retires the old refresh token', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const r = await h.exchange({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client })
    expect(r.status).toBe(200)
    expect(r.json.refresh_token).not.toBe(t.json.refresh_token)
    expect((await h.call('GET', '/auth/principal', { token: r.json.access_token })).status).toBe(200)
  })

  test('replaying an old refresh token revokes the whole grant', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const r = await h.exchange({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client })
    const replay = await h.exchange({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client })
    expect(replay.json.error).toBe('invalid_grant')
    // The thief and the owner both lose: the newest tokens are dead too.
    expect((await h.call('GET', '/auth/principal', { token: r.json.access_token })).json.code).toBe('token_revoked')
    expect((await h.exchange({ grant_type: 'refresh_token', refresh_token: r.json.refresh_token, client_id: client })).json.error).toBe('invalid_grant')
  })

  test('a refresh can narrow the scope and never widen it', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const wide = await h.exchange({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client, scope: 'repo:read repo:write' })
    expect(wide.json.error).toBe('invalid_scope')
    // That attempt used the token; take a fresh one.
    const again = await h.getCode()
    const t2 = await h.exchange(h.tokenRequest(again.client, again.code, again.verifier))
    const narrow = await h.exchange({ grant_type: 'refresh_token', refresh_token: t2.json.refresh_token, client_id: again.client, scope: 'repo:read' })
    expect(narrow.json.scope).toBe('repo:read')
  })

  test('another client cannot use the refresh token', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const other = (await h.register('Other')).json.client_id
    expect((await h.exchange({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: other })).json.error).toBe('invalid_grant')
  })

  test('revocation kills the grant and says nothing about what exists', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const res = await h.fetchRaw('/oauth/revoke', h.form({ token: t.json.refresh_token }))
    expect(res.status).toBe(200)
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).json.code).toBe('token_revoked')
    expect((await h.fetchRaw('/oauth/revoke', h.form({ token: 'sxo_unknown_garbage_value' }))).status).toBe(200)
  })

  test('token endpoint errors follow RFC 6749', async () => {
    const h = setup()
    expect((await h.exchange({ grant_type: 'password', username: 'a', password: 'b' })).json.error).toBe('unsupported_grant_type')
    const json = await h.fetchRaw('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect((await json.json()).error).toBe('invalid_request')
  })
})

describe('device authorization', () => {
  async function start(h: ReturnType<typeof setup>, scope = 'repo:read pulls:read') {
    const client = (await h.register('Device CLI')).json.client_id
    const res = await h.fetchRaw('/oauth/device_authorization', h.form({ client_id: client, scope }))
    return { client, json: (await res.json()) }
  }

  async function approveDevice(h: ReturnType<typeof setup>, userCode: string, decision = 'approve') {
    const cookie = await h.signIn()
    const entry = await (await h.fetchRaw('/oauth/device', { headers: { cookie } })).text()
    const csrf = /name="csrf" value="([^"]+)"/.exec(entry)![1]
    const post = (data: Record<string, string>) => h.fetchRaw('/oauth/device', { ...h.form(data), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })
    const consent = await (await post({ csrf, user_code: userCode })).text()
    expect(consent).toContain('Device CLI')
    return post({ csrf, user_code: userCode, decision })
  }

  test('the CLI flow: code, approval in a browser, polling, token', async () => {
    const now = clock()
    const h = setup({ now })
    const { client, json } = await start(h)
    expect(json.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(json.verification_uri).toBe('https://api.source.code/v1/oauth/device')
    expect(json.interval).toBe(5)
    const poll = () => h.exchange({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: json.device_code, client_id: client })
    expect((await poll()).json.error).toBe('authorization_pending')
    await approveDevice(h, json.user_code.toLowerCase())
    now.advance(6000)
    const t = await poll()
    expect(t.status).toBe(200)
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).json.scopes).toEqual(['pulls:read', 'repo:read'])
    // The code works once.
    now.advance(6000)
    expect((await poll()).json.error).toBe('invalid_grant')
  })

  test('polling too fast is told to slow down', async () => {
    const now = clock()
    const h = setup({ now })
    const { client, json } = await start(h)
    const poll = () => h.exchange({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: json.device_code, client_id: client })
    now.advance(6000)
    expect((await poll()).json.error).toBe('authorization_pending')
    now.advance(1000)
    const fast = await poll()
    expect(fast.json.error).toBe('slow_down')
    now.advance(6000)
    expect((await poll()).json.error).toBe('slow_down')
  })

  test('denied and expired codes', async () => {
    const now = clock()
    const h = setup({ now })
    const a = await start(h)
    await approveDevice(h, a.json.user_code, 'deny')
    now.advance(6000)
    const denied = await h.exchange({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: a.json.device_code, client_id: a.client })
    expect(denied.json.error).toBe('access_denied')
    const b = await start(h)
    now.advance(15 * 60_000 + 1000)
    const expired = await h.exchange({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: b.json.device_code, client_id: b.client })
    expect(expired.json.error).toBe('expired_token')
  })

  test('guessing user codes is limited, and the page needs a session', async () => {
    const h = setup()
    expect(await (await h.fetchRaw('/oauth/device')).text()).toContain('Continue as dana')
    const cookie = await h.signIn()
    const entry = await (await h.fetchRaw('/oauth/device', { headers: { cookie } })).text()
    const csrf = /name="csrf" value="([^"]+)"/.exec(entry)![1]
    let status = 0
    for (let i = 0; i < 12; i++)
      status = (await h.fetchRaw('/oauth/device', { ...h.form({ csrf, user_code: 'BBBB-BBBB' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })).status
    expect(status).toBe(429)
  })

  test('an unknown client or scope is refused', async () => {
    const h = setup()
    expect((await h.fetchRaw('/oauth/device_authorization', h.form({ client_id: 'cl_nope' }))).status).toBe(401)
    const client = (await h.register()).json.client_id
    const res = await h.fetchRaw('/oauth/device_authorization', h.form({ client_id: client, scope: 'tokens:manage' }))
    expect((await res.json()).error).toBe('invalid_scope')
  })
})

describe('tokens API', () => {
  test('create shows the secret once, list never does, and revoking is immediate', async () => {
    const h = setup()
    const made = await h.call('POST', '/tokens', { body: { name: 'ci', scopes: ['repo:read', 'pulls:read'], expires_in_days: 30 } })
    expect(made.status).toBe(201)
    expect(made.headers.get('cache-control')).toBe('no-store')
    expect(made.json.secret).toMatch(/^sxp_/)
    expect(made.json.prefix).toBe(made.json.secret.slice(0, 8))
    const secret = made.json.secret as string
    expect((await h.call('GET', '/auth/principal', { token: secret })).json.scopes).toEqual(['pulls:read', 'repo:read'])
    const list = await h.call('GET', '/tokens')
    expect(list.text).not.toContain(secret)
    expect(list.json.data.some((t: { id: string }) => t.id === made.json.id)).toBe(true)
    expect((await h.call('GET', `/tokens/${made.json.id}`)).json.secret).toBeNull()
    expect((await h.call('DELETE', `/tokens/${made.json.id}`)).status).toBe(204)
    const dead = await h.call('GET', '/auth/principal', { token: secret })
    expect(dead.status).toBe(401)
    expect(dead.json.code).toBe('token_revoked')
    expect((await h.call('DELETE', `/tokens/${made.json.id}`)).status).toBe(404)
  })

  test('a token can never have more than its creator', async () => {
    const h = setup()
    // hollis has no tokens:manage.
    expect((await h.call('POST', '/tokens', { token: h.tokens.hollis, body: { name: 'x', scopes: ['repo:read'] } })).json.code).toBe('insufficient_scope')
    // A limited token can only make limited tokens.
    const limited = (await h.call('POST', '/tokens', { body: { name: 'one repo', scopes: ['repo:read', 'tokens:manage'], repos: ['dana/gitfs'] } })).json.secret
    expect((await h.call('POST', '/tokens', { token: limited, body: { name: 'wide', scopes: ['repo:read'] } })).json.code).toBe('forbidden')
    expect((await h.call('POST', '/tokens', { token: limited, body: { name: 'wide', scopes: ['repo:write'], repos: ['dana/gitfs'] } })).json.code).toBe('insufficient_scope')
    expect((await h.call('POST', '/tokens', { token: limited, body: { name: 'ok', scopes: ['repo:read'], repos: ['dana/gitfs'] } })).status).toBe(201)
    expect((await h.call('POST', '/tokens', { token: limited, body: { name: 'other', scopes: ['repo:read'], repos: ['dana/tinyqueue'] } })).json.code).toBe('forbidden')
  })

  test('validation, dry run and the limit on how many', async () => {
    const h = setup()
    expect((await h.call('POST', '/tokens', { body: { name: 'x', scopes: ['nope'] } })).status).toBe(400)
    expect((await h.call('POST', '/tokens', { body: { name: 'x', scopes: ['repo:read'], expires_in_days: 1000 } })).status).toBe(400)
    const before = (await h.call('GET', '/tokens')).json.data.length
    const dry = await h.call('POST', '/tokens?dry_run=true', { body: { name: 'x', scopes: ['repo:read'] } })
    expect(dry.status).toBe(200)
    expect((await h.call('GET', '/tokens')).json.data.length).toBe(before)
    let limited = false
    for (let i = 0; i < 105 && !limited; i++) {
      const r = await h.call('POST', '/tokens', { body: { name: `t${i}`, scopes: ['repo:read'] } })
      limited = r.json.code === 'limit_reached'
    }
    expect(limited).toBe(true)
  })

  test('expired tokens do not use up the quota', async () => {
    const now = clock()
    const h = setup({ now })
    let limited = false
    for (let i = 0; i < 103 && !limited; i++) {
      const r = await h.call('POST', '/tokens', { body: { name: `t${i}`, scopes: ['repo:read'] } })
      limited = r.json.code === 'limit_reached'
    }
    expect(limited).toBe(true)
    now.advance(91 * 86_400_000)
    expect((await h.call('POST', '/tokens', { body: { name: 'fresh', scopes: ['repo:read'] } })).status).toBe(201)
  })

  test('someone else’s token looks like no token', async () => {
    const h = setup()
    const made = await h.call('POST', '/tokens', { body: { name: 'mine', scopes: ['repo:read'] } })
    expect((await h.call('GET', `/tokens/${made.json.id}`, { token: h.tokens.stranger })).status).toBe(404)
  })

  test('last use is recorded, at most once a minute', async () => {
    const now = clock()
    const h = setup({ now })
    const made = await h.call('POST', '/tokens', { body: { name: 'used', scopes: ['repo:read'] } })
    expect(made.json.last_used_at).toBeNull()
    await h.call('GET', '/auth/principal', { token: made.json.secret })
    const first = (await h.call('GET', `/tokens/${made.json.id}`)).json.last_used_at
    expect(first).not.toBeNull()
    now.advance(10_000)
    await h.call('GET', '/auth/principal', { token: made.json.secret })
    expect((await h.call('GET', `/tokens/${made.json.id}`)).json.last_used_at).toBe(first)
    now.advance(61_000)
    await h.call('GET', '/auth/principal', { token: made.json.secret })
    expect((await h.call('GET', `/tokens/${made.json.id}`)).json.last_used_at).not.toBe(first)
  })

  test('authorizations list the apps you approved and revoking one ends its tokens', async () => {
    const h = setup()
    const { client, code, verifier } = await h.getCode()
    const t = await h.exchange(h.tokenRequest(client, code, verifier))
    const list = (await h.call('GET', '/authorizations')).json.data
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({ client: { id: client, name: 'Test App' }, scopes: ['repo:read', 'pulls:read', 'issues:read'] })
    expect((await h.call('DELETE', `/authorizations/${list[0].id}`)).status).toBe(204)
    expect((await h.call('GET', '/auth/principal', { token: t.json.access_token })).json.code).toBe('token_revoked')
    expect((await h.call('GET', '/authorizations')).json.data).toEqual([])
  })
})
