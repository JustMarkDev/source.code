import { SxError, exit, print } from '../output'
import { activeAccount, whoami } from '../account'
import { resolve } from '../config'
import {
  clearCredentials,
  readCredentials,
  writeCredentials,
} from '../credentials'
import type { Ctx } from '../output'
import type { Parsed } from '../args'
import type { Command } from './types'

export const auth: Command = async ({ rest: [sub = 'status'], flags }, ctx) => {
  const apiConfig = resolve('api')
  const network = apiConfig.from !== 'default'
  const saved = network
    ? readCredentials(apiConfig.value.replace(/\/$/, ''))
    : null
  const token = process.env.SX_TOKEN ?? saved?.access_token
  if (sub === 'status') {
    // Over the network the token is checked by asking who it is. In the preview
    // there is no server to ask, so a token in the environment is enough.
    const authenticated = !!token
    let account: string | null = null
    let login: string | null = null
    let scopes: Array<string> | null = null
    if (authenticated) {
      account = (await activeAccount(ctx, flags)).handle
      if (network) {
        const who = await whoami(ctx)
        login = who.login
        scopes = who.scopes
      }
    }
    const data = {
      host: network ? apiConfig.value : resolve('host').value,
      authenticated,
      via: process.env.SX_TOKEN ? 'SX_TOKEN' : saved ? 'credentials' : null,
      // Who the token acts as, once signed in. `sx account list` shows the others.
      account,
      login,
      scopes,
    }
    print(ctx, data, () =>
      authenticated
        ? `signed in to ${data.host} with ${data.via}`
        : `not signed in to ${data.host}`,
    )
    return authenticated ? exit.ok : exit.auth
  }
  if (sub === 'login') return signIn(ctx, flags)
  if (sub === 'logout') {
    const api = resolve('api').value
    const c = api ? readCredentials(api.replace(/\/$/, '')) : null
    if (c) {
      // Tell the server first, so a stolen copy of the file stops working too.
      await fetch(`${api.replace(/\/$/, '')}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: c.refresh_token }),
      }).catch(() => undefined)
      clearCredentials()
    }
    print(ctx, { signedOut: !!c }, () =>
      c ? 'signed out' : 'you were not signed in',
    )
    return
  }
  throw new SxError(
    'unknown_command',
    `auth ${sub} is not a command.`,
    'sx auth --help lists them.',
    exit.usage,
  )
}

/** The device authorization grant: show a code, wait while the person approves it in a browser. */
export async function signIn(
  ctx: Ctx,
  flags: Parsed['flags'],
  io: { fetch: typeof fetch; sleep: (ms: number) => Promise<void> } = {
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
) {
  const api = resolve('api').value.replace(/\/$/, '')
  if (!api)
    throw new SxError(
      'not_available',
      'There is nothing to sign in to: sx is running on sample data.',
      'Set SX_API to the API address (or `sx config set api <url>`), then run sx auth login.',
      exit.usage,
    )
  const form = (data: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
  })
  const post = async (path: string, init: RequestInit) => {
    const res = await io.fetch(`${api}${path}`, init)
    return {
      status: res.status,
      json: (await res.json().catch(() => ({}))) as Record<string, any>,
    }
  }
  const registered = await post('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'sx command line',
      redirect_uris: ['http://127.0.0.1/callback'],
    }),
  })
  if (registered.status !== 201)
    throw new SxError(
      'login_failed',
      `Could not register this tool: ${registered.json.error_description ?? registered.status}`,
      'Try again later.',
      exit.error,
    )
  const clientId = String(registered.json.client_id)
  const scope =
    typeof flags.scope === 'string'
      ? flags.scope
      : 'repo:read repo:write issues:read issues:write pulls:read pulls:write pulls:comment pulls:merge secrets:schema secrets:write'
  const started = await post(
    '/oauth/device_authorization',
    form({ client_id: clientId, scope }),
  )
  if (started.status !== 200)
    throw new SxError(
      'login_failed',
      String(started.json.error_description ?? 'The server refused.'),
      'Check --scope.',
      exit.error,
    )
  const d = started.json
  // This goes to stderr: stdout stays clean for scripts.
  ctx.err(
    `Open ${d.verification_uri_complete}\nand check the code is ${d.user_code}`,
  )
  let interval = Number(d.interval) * 1000
  const deadline = Date.now() + Number(d.expires_in) * 1000
  while (Date.now() < deadline) {
    await io.sleep(interval)
    const t = await post(
      '/oauth/token',
      form({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: String(d.device_code),
        client_id: clientId,
      }),
    )
    if (t.status === 200) {
      writeCredentials({
        api,
        client_id: clientId,
        access_token: String(t.json.access_token),
        refresh_token: String(t.json.refresh_token),
        expires_at: Date.now() + Number(t.json.expires_in) * 1000,
        scope: String(t.json.scope),
      })
      print(
        ctx,
        { signedIn: true, api, scope: t.json.scope },
        () => `signed in to ${api}`,
      )
      return
    }
    if (t.json.error === 'authorization_pending') continue
    if (t.json.error === 'slow_down') {
      interval += 5000
      continue
    }
    throw new SxError(
      'login_failed',
      t.json.error === 'access_denied'
        ? 'The request was denied.'
        : t.json.error === 'expired_token'
          ? 'The code expired.'
          : String(t.json.error_description ?? t.json.error),
      'Run sx auth login again.',
      exit.error,
    )
  }
  throw new SxError(
    'login_failed',
    'The code expired before it was approved.',
    'Run sx auth login again.',
    exit.error,
  )
}
