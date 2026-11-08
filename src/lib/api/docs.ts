import { createHash } from 'node:crypto'
import { format, resolveConfig } from 'prettier'
import { randomSource } from './ids'
import { STACK_ID, T0, sampleTokens, seedStack } from './sample'
import { buildOpenApi } from './openapi'
import { errorCatalog } from './problem'
import { allOperations, createSampleApi } from './index'
import type { Op } from './registry'

/**
 * The reference pages, written from the operations themselves and from real
 * responses of the sample API. Nothing in them is typed by hand per endpoint,
 * so they cannot describe something the API does not do. `docs.test.ts` fails
 * when the committed pages differ from what this produces; regenerate with
 * `bun scripts/api-docs.ts`.
 */
type Json = Record<string, any>

const BASE = 'https://api.source.code/v1'

type Recorded = {
  method: string
  path: string
  token: string | null
  headers: Record<string, string>
  body: unknown
  status: number
  responseHeaders: Record<string, string>
  json: unknown
  text: string
  raw?: boolean
}

// ---------------------------------------------------------------------------
// Running the sample API to capture real examples.

function seededRandom() {
  let x = 0x2545f491
  return (n: number) => {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      out[i] = x & 0xff
    }
    return out
  }
}

/** Authorizes an application, so an authorization exists to list. */
async function authorizeAnApp(api: { fetch: (r: Request) => Promise<Response>; oauth?: unknown }) {
  const f = (path: string, init: RequestInit = {}) => api.fetch(new Request(`https://api.source.code/v1${path}`, { redirect: 'manual', ...init }))
  const form = (d: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(d).toString() })
  const reg = (await (await f('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'My agent', redirect_uris: ['http://127.0.0.1:8123/callback'] }) })).json()) as Json
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const cookie = (await f('/oauth/session', { ...form({ handle: 'dana', return_to: '/' }), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://source.code' } })).headers.get('set-cookie')!.split(';')[0]
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'http://127.0.0.1:8123/callback', code_challenge: challenge, code_challenge_method: 'S256', scope: 'repo:read pulls:read' })
  const html = await (await f(`/oauth/authorize?${q}`, { headers: { cookie } })).text()
  const done = await f('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ request_id: /name="request_id" value="([^"]+)"/.exec(html)![1], csrf: /name="csrf" value="([^"]+)"/.exec(html)![1], decision: 'approve' }).toString() })
  const code = new URL(done.headers.get('location')!).searchParams.get('code')!
  await f('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: 'http://127.0.0.1:8123/callback', code_verifier: verifier }))
}

export async function captureExamples(): Promise<Map<string, Recorded>> {
  const original = randomSource.bytes
  randomSource.bytes = seededRandom()
  const now = () => T0 + 3_600_000
  const api = createSampleApi({
    mount: '/v1',
    base: BASE,
    now,
    seed: (d) => {
      seedStack(d)
      d.stepDelayMs = 2
    },
    pools: undefined,
    // Deliveries "succeed" without leaving the process.
    transport: { send: () => Promise.resolve({ status: 200, error: null, ms: 38 }) },
  })
  const out = new Map<string, Recorded>()
  const t = sampleTokens
  const call = async (
    opId: string | null,
    method: string,
    path: string,
    init: {
      token?: string | null
      body?: unknown
      headers?: Record<string, string>
      /** Raw bytes, for uploads. */
      bytes?: Uint8Array
    } = {},
  ) => {
    const token = init.token === undefined ? t.dana : init.token
    const headers: Record<string, string> = { ...init.headers }
    if (token) headers.authorization = `Bearer ${token}`
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await api.fetch(
      new Request(`https://api.source.code/v1${path}`, {
        method,
        headers,
        body: init.bytes ? (init.bytes as unknown as BodyInit) : init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    )
    const binary = !(res.headers.get('content-type') ?? '').includes('json') && res.status !== 204 && res.status !== 304
    const text = binary ? `[${(await res.arrayBuffer()).byteLength} bytes]` : await res.text()
    const rec: Recorded = {
      method,
      path,
      token,
      headers: init.headers ?? {},
      body: init.body,
      status: res.status,
      responseHeaders: Object.fromEntries(res.headers),
      json: text && !binary ? (JSON.parse(text) as unknown) : null,
      text,
      raw: init.bytes !== undefined,
    }
    if (opId && !out.has(opId)) out.set(opId, rec)
    return rec
  }
  const R = '/repos/dana/gitfs'

  try {
    await call('api.root', 'GET', '/', { token: null })
    await call('api.errors', 'GET', '/errors', { token: null })
    await call('api.limits', 'GET', '/limits', { token: null })
    await call('api.openapi', 'GET', '/openapi.json', { token: null })
    await call('auth.principal', 'GET', '/auth/principal')
    await call('accounts.list', 'GET', '/accounts')
    await call('accounts.get', 'GET', '/accounts/dana')
    await call('repos.list', 'GET', '/repos?limit=2')
    await call('repos.get', 'GET', R)
    await call('repos.context', 'GET', `${R}/context`)
    await call('repos.number', 'GET', `${R}/numbers/216`)
    await call('changes.list', 'GET', `${R}/changes?limit=2&fields=number,title,state,checks,policy`)
    await call('changes.get', 'GET', `${R}/changes/216`)
    await call('patch_sets.list', 'GET', `${R}/changes/216/patch-sets`)
    await call('patch_sets.get', 'GET', `${R}/changes/216/patch-sets/3`)
    await call('patch_sets.compare', 'GET', `${R}/changes/216/compare?from=2&to=3`)
    await call('findings.list', 'GET', `${R}/changes/216/findings?state=open`)
    await call('checks.list', 'GET', `${R}/changes/216/checks`)
    await call('policy.get', 'GET', `${R}/changes/216/policy`)
    await call('policy.simulate', 'POST', `${R}/changes/216/policy/simulate`, {
      body: { checks: { 'ci/test': 'pass' }, resolve: ['F-2'] },
    })
    await call('changes.land', 'POST', '/repos/dana/stacky/changes/1/land?dry_run=true', { body: { expected_tree: '1111111' } })
    await call('findings.resolve', 'POST', `${R}/changes/216/findings/F-2/resolve`)
    await call('findings.dismiss', 'POST', `${R}/changes/216/findings/F-3/dismiss`, {
      body: { reason: 'Covered by the docs change in #209' },
    })
    await call('checks.report', 'POST', `${R}/changes/216/checks`, {
      body: { key: 'ci/test', state: 'pass', tree: '9c4d7e1', details_url: 'https://ci.example.com/runs/881' },
    })
    await call('reviews.create', 'POST', `${R}/changes/212/reviews`, {
      token: t.hollis,
      body: { state: 'commented', body: 'The regression test covers it. One question inline.' },
    })
    await call('patch_sets.create', 'POST', `${R}/changes/212/patch-sets`, {
      body: { sha: '8e41c07d2b9a', kind: 'update', note: 'Handle UNC paths' },
    })
    await call('changes.update', 'PATCH', `${R}/changes/212`, {
      body: { title: 'Normalize Windows and UNC path separators', labels: ['windows', 'bug'] },
    })
    await call('changes.create', 'POST', `${R}/changes`, {
      token: t.fixAgent,
      body: { branch: 'fix/trailing-dot-refs', title: 'Reject trailing-dot ref names', draft: true },
    })
    await call('changes.mark_ready', 'POST', `${R}/changes/218/ready`)
    await call('changes.abandon', 'POST', `${R}/changes/218/abandon`)
    await call('changes.restore', 'POST', `${R}/changes/218/restore`)
    await call('changes.land', 'POST', `${R}/changes/216/land?dry_run=true`, { body: { expected_tree: '9c4d7e1' } })
    await call('issues.list', 'GET', `${R}/issues?state=all&limit=2`)
    await call('issues.get', 'GET', `${R}/issues/4`)
    await call('issues.create', 'POST', `${R}/issues`, {
      body: { title: 'Crash on empty repo', labels: ['bug'] },
      headers: { 'idempotency-key': 'c1f0e7a2-5b1d-4f3a-9a7c-2d6e8b0f4a11' },
    })
    const etag = (await call(null, 'GET', `${R}/issues/4`)).responseHeaders.etag
    await call('issues.update', 'PATCH', `${R}/issues/4`, {
      body: { state: 'closed' },
      headers: { 'if-match': etag },
    })
    await call('events.list', 'GET', '/events?repo=dana/gitfs&type=issue.*&limit=2')
    const snap = await call('sync.get', 'GET', '/sync?repo=dana/tinyqueue')
    await call(null, 'GET', `/sync?repo=dana/tinyqueue&cursor=${(snap.json as Json).cursor}`)
    await call('api.batch', 'POST', '/batch', {
      body: {
        requests: [
          { id: 'change', method: 'GET', path: '/repos/dana/gitfs/changes/216?fields=number,title,policy' },
          { id: 'checks', method: 'GET', path: '/repos/dana/gitfs/changes/216/checks' },
          { id: 'missing', method: 'GET', path: '/repos/dana/gitfs/changes/999' },
        ],
      },
    })
    // ----- tokens and applications
    await call('tokens.create', 'POST', '/tokens', {
      body: { name: 'ci', scopes: ['repo:read', 'pulls:read'], expires_in_days: 30, repos: ['dana/gitfs'] },
    })
    await call('tokens.list', 'GET', '/tokens')
    const made = (out.get('tokens.create')!.json as Json).id as string
    await call('tokens.get', 'GET', `/tokens/${made}`)
    await call('tokens.revoke', 'DELETE', `/tokens/${made}`)
    await authorizeAnApp(api)
    await call('authorizations.list', 'GET', '/authorizations')
    const atz = ((out.get('authorizations.list')!.json as Json).data as Array<Json>)[0].id as string
    await call('authorizations.revoke', 'DELETE', `/authorizations/${atz}`)

    // ----- webhooks
    await call('webhooks.create', 'POST', `${R}/webhooks`, {
      body: { endpoint: 'https://hooks.example.com/source-code', events: ['change.*', 'issue.created'], description: 'Chat bridge' },
    })
    const hook = (out.get('webhooks.create')!.json as Json).id as string
    await call('webhooks.list', 'GET', `${R}/webhooks`)
    await call('webhooks.get', 'GET', `${R}/webhooks/${hook}`)
    await call('webhooks.update', 'PATCH', `${R}/webhooks/${hook}`, { body: { events: ['change.*', 'issue.*'] } })
    await call('webhooks.ping', 'POST', `${R}/webhooks/${hook}/ping`)
    await call(null, 'POST', `${R}/issues`, { body: { title: 'A webhook will carry this' } })
    await new Promise((r) => setTimeout(r, 20))
    await call('webhooks.deliveries.list', 'GET', `${R}/webhooks/${hook}/deliveries?limit=2`)
    const dlv = ((out.get('webhooks.deliveries.list')!.json as Json).data as Array<Json>)[0].id as string
    await call('webhooks.deliveries.get', 'GET', `${R}/webhooks/${hook}/deliveries/${dlv}`)
    await call('webhooks.deliveries.redeliver', 'POST', `${R}/webhooks/${hook}/deliveries/${dlv}/redeliver`)
    await call('webhooks.replay', 'POST', `${R}/webhooks/${hook}/replay`, { body: { after_sequence: 0, limit: 50 } })
    await call('webhooks.rotate_secret', 'POST', `${R}/webhooks/${hook}/rotate-secret`)
    await call('webhooks.delete', 'DELETE', `${R}/webhooks/${hook}`)

    // ----- search
    await call('search.query', 'GET', '/search?q=negative+cache&limit=2')

    // ----- uploads and evidence
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 40 }, (_, i) => i)])
    await call('uploads.create', 'POST', '/uploads', { body: { filename: 'after.png', content_type: 'image/png', size: png.length } })
    const up = out.get('uploads.create')!.json as Json
    await call('uploads.put', 'PUT', `/uploads/${up.id}/data?${String(up.upload_url).split('?')[1]}`, {
      token: null,
      headers: { 'content-type': 'image/png' },
      bytes: png,
    })
    await call('uploads.get', 'GET', `/uploads/${up.id}`)
    await call('evidence.create', 'POST', `${R}/changes/216/evidence`, {
      body: { upload: up.id, kind: 'image', caption: 'After: the cache stats line' },
    })
    await call('evidence.list', 'GET', `${R}/changes/216/evidence`)
    await call('uploads.content', 'GET', `/uploads/${up.id}/content`)

    // ----- repositories, mirrors, environment
    await call('repos.create', 'POST', '/repos', { body: { name: 'notes2', description: 'Scratch', visibility: 'private' } })
    // ----- runs
    await call('runs.start', 'POST', `${R}/runs`, { body: { task: 'Fix the flaky cache test', change: 216, ttl_minutes: 60 } })
    const runId = (out.get('runs.start')!.json as Json).id as string
    const runToken = (out.get('runs.start')!.json as Json).token as string
    await call('runs.note', 'POST', `${R}/runs/${runId}/notes`, { token: runToken, body: { text: 'Reproduced the failure on patch set 2' } })
    await call('runs.list', 'GET', `${R}/runs`)
    await call('runs.get', 'GET', `${R}/runs/${runId}`)
    await call('runs.finish', 'POST', `${R}/runs/${runId}/finish`, { token: runToken, body: { state: 'succeeded', summary: 'Fixed in #217' } })
    const run2 = await call(null, 'POST', `${R}/runs`, { body: { task: 'Triage new issues' } })
    await call('runs.cancel', 'POST', `${R}/runs/${(run2.json as Json).id as string}/cancel`)

    // ----- teams
    await call('teams.create', 'POST', '/accounts/northwind/teams', { body: { slug: 'support', name: 'Support', description: 'Reads private repositories to answer questions' } })
    await call('teams.list', 'GET', '/accounts/northwind/teams')
    await call('teams.get', 'GET', '/accounts/northwind/teams/support')
    await call('teams.update', 'PATCH', '/accounts/northwind/teams/support', { body: { description: 'Reads private repositories to answer customers' } })
    await call('teams.members.add', 'PUT', '/accounts/northwind/teams/support/members/stranger')
    await call('teams.repos.set', 'PUT', '/accounts/northwind/teams/support/repos/northwind/relay', { body: { permission: 'read' } })
    await call('teams.repos.remove', 'DELETE', '/accounts/northwind/teams/support/repos/northwind/relay')
    await call('teams.members.remove', 'DELETE', '/accounts/northwind/teams/support/members/stranger')
    await call('teams.delete', 'DELETE', '/accounts/northwind/teams/support')

    // ----- git data
    await call('git.tree', 'GET', `${R}/git/tree`)
    await call('git.blob', 'GET', `${R}/git/blob?path=README.md`)
    await call('git.raw', 'GET', `${R}/git/raw?path=README.md`)
    await call('git.commits', 'GET', `${R}/git/commits?limit=1`)
    const sha = (((out.get('git.commits')!.json as Json).data as Array<Json>)[0].sha as string)
    await call('git.commit', 'GET', `${R}/git/commits/${sha}`)
    await call('git.diff', 'GET', `${R}/git/commits/${sha}/diff`)
    await call('repos.update', 'PATCH', '/repos/dana/notes2', { body: { name: 'scratch2', description: 'Scratch space' } })
    await call('repos.delete', 'DELETE', '/repos/dana/scratch2?confirm=dana/scratch2')
    await call('mirrors.list', 'GET', `${R}/mirrors`)
    await call('mirrors.create', 'POST', `${R}/mirrors`, { body: { host: 'codeberg', slug: 'dana/gitfs', direction: 'push' } })
    const failing = ((out.get('mirrors.list')!.json as Json).data as Array<Json>)[1].id as string
    await call('mirrors.sync', 'POST', `${R}/mirrors/${failing}/sync`)
    await call('mirrors.delete', 'DELETE', `${R}/mirrors/${(out.get('mirrors.create')!.json as Json).id}`)
    await call('env.list', 'GET', `${R}/env?environment=development`)
    await call('env.recipients', 'GET', `${R}/env/recipients`)
    await call('env.set', 'PUT', `${R}/env/STRIPE_KEY/development`, { body: { ciphertext: 'sx1.Zm9vYmFyYmF6cXV4cXV1eA==' } })
    await call('grants.request', 'POST', `${R}/env/grants`, {
      token: t.fixAgent,
      body: { environment: 'development', reason: 'Run the test suite', max_runs: 10 },
    })
    const grant = (out.get('grants.request')!.json as Json).id as string
    await call('grants.list', 'GET', `${R}/env/grants`)
    await call('grants.approve', 'POST', `${R}/env/grants/${grant}/approve`, { body: { ttl_minutes: 30 } })
    await call('env.values', 'GET', `${R}/env/development/values`, { token: t.fixAgent })
    await call('env.audit', 'GET', `${R}/env/audit`)
    await call('grants.revoke', 'POST', `${R}/env/grants/${grant}/revoke`)

    const started = await call('stacks.land', 'POST', `/repos/dana/stacky/stacks/${STACK_ID}/land`, {
      body: { expected_trees: { '1': '1111111', '2': '2222222', '3': '3333333' } },
    })
    const op = started.json as Json
    await new Promise((r) => setTimeout(r, 60))
    await call('operations.get', 'GET', `/operations/${op.id}`)
  } finally {
    randomSource.bytes = original
    await api.dispose()
  }
  return out
}

// ---------------------------------------------------------------------------
// Rendering.

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

function typeOf(schema: Json | undefined): string {
  if (!schema) return 'any'
  if (schema.$ref) return `\`${String(schema.$ref).split('/').pop()}\``
  if (schema.enum) return schema.enum.map((e: unknown) => `\`${String(e)}\``).join(' or ')
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(' or ')
  if (schema.type === 'array') return `array of ${typeOf(schema.items)}`
  if (schema.type === 'object')
    return schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? `object of ${typeOf(schema.additionalProperties)}`
      : 'object'
  const bits: Array<string> = []
  if (schema.minimum !== undefined) bits.push(`min ${schema.minimum}`)
  if (schema.maximum !== undefined) bits.push(`max ${schema.maximum}`)
  if (schema.maxLength !== undefined) bits.push(`up to ${schema.maxLength} characters`)
  if (schema.minLength !== undefined && schema.minLength > 0) bits.push(`at least ${schema.minLength}`)
  if (schema.format) bits.push(schema.format)
  if (schema.pattern) bits.push('pattern')
  const base = Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'any')
  return bits.length ? `${base} (${bits.join(', ')})` : base
}

function resolve(doc: Json, schema: Json | undefined): Json | undefined {
  let s = schema
  for (let i = 0; s?.$ref && i < 5; i++) s = doc.components.schemas[String(s.$ref).split('/').pop()!]
  return s
}

function responseName(doc: Json, item: Json, op: Op): string {
  if (op.status === 204) return 'no body'
  const content = item.responses[String(op.status ?? 200)]?.content ?? {}
  if (op.responseContentType && op.responseContentType !== 'application/json') {
    if (op.responseContentType === 'text/event-stream') return 'a `text/event-stream`'
    if (op.responseContentType === '*/*' || op.responseContentType === 'application/octet-stream') return 'binary data'
    return `a \`${op.responseContentType}\``
  }
  if (content['text/event-stream']) return 'a `text/event-stream`'
  const schema = resolve(doc, content['application/json']?.schema)
  const kind = schema?.properties?.object?.const
  if (kind === 'list') {
    const inner = resolve(doc, schema?.properties.data?.items)
    const itemKind = inner?.properties?.object?.const
    return itemKind ? `a list of \`${itemKind}\`` : 'a list'
  }
  return kind ? `a \`${kind}\`` : 'a JSON document'
}

function table(rows: Array<Array<string>>, header: Array<string>) {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
}

function trim(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const keep = depth === 0 ? 3 : 2
    const head = value.slice(0, keep).map((v) => trim(v, depth + 1))
    return value.length > keep ? [...head, `…and ${value.length - keep} more`] : head
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, trim(v, depth + 1)]))
  if (typeof value === 'string') {
    const redacted = value
      .replace(/\b((?:sxp|sxb|sxr|sxo|sxf)_)[A-Za-z0-9_-]{6,}/g, '$1…')
      .replace(/\b(whsec_)[A-Za-z0-9_+/=-]{6,}/g, '$1…')
      .replace(/([?&]sig=)[^&]+/g, '$1…')
    return redacted.length > 160 ? `${redacted.slice(0, 157)}…` : redacted
  }
  return value
}

function curl(rec: Recorded) {
  const path = rec.path.replace(/([?&]sig=)[^&]+/g, '$1…')
  const lines = [`curl ${rec.method === 'GET' ? '' : `-X ${rec.method} `}"${BASE}${path}"`.replace('curl "', 'curl "')]
  if (rec.token) lines.push('  -H "Authorization: Bearer $SX_TOKEN"')
  for (const [k, v] of Object.entries(rec.headers)) lines.push(`  -H "${k}: ${v}"`)
  if (rec.raw) lines.push('  --data-binary @after.png')
  else if (rec.body !== undefined) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${JSON.stringify(rec.body)}'`)
  }
  return lines.join(' \\\n')
}

function example(rec: Recorded, opId: string) {
  const shown = ['etag', 'location', 'sx-outcome', 'sx-replayed', 'sx-dry-run', 'retry-after', 'ratelimit']
    .filter((h) => rec.responseHeaders[h])
    .map((h) => `${h}: ${rec.responseHeaders[h]}`)
  let body = ''
  if (opId === 'api.openapi')
    body = JSON.stringify(
      { openapi: '3.1.0', info: { title: 'source.code API', version: '2026-11-07' }, paths: { '…': '…' }, components: { '…': '…' } },
      null,
      2,
    )
  else if (opId === 'events.stream')
    body = ''
  else body = rec.json === null ? '' : JSON.stringify(trim(rec.json), null, 2)
  return [
    '```bash',
    curl(rec),
    '```',
    '',
    '```http',
    `HTTP/1.1 ${rec.status}`,
    ...shown,
    '```',
    '',
    ...(body ? ['```json', body, '```'] : []),
  ].join('\n')
}

const pages: Array<{ file: string; title: string; description: string; icon: string; match: (id: string) => boolean }> = [
  {
    file: 'meta',
    title: 'Discovery, identity and batch',
    description: 'The root, the OpenAPI document, every error and limit, who a token is, and several requests in one.',
    icon: 'ServerIcon',
    match: (id) => id.startsWith('api.') || id.startsWith('auth.'),
  },
  {
    file: 'accounts-and-repositories',
    title: 'Accounts and repositories',
    description: 'Who you can act as, the repositories you can see, creating one, and the one-call context for starting work.',
    icon: 'UsersIcon',
    match: (id) => id.startsWith('accounts.') || id.startsWith('repos.') || id.startsWith('teams.') || id.startsWith('runs.'),
  },
  {
    file: 'git-data',
    title: 'Git data',
    description: 'Directories, files, history and diffs, read from the repository itself.',
    icon: 'CodeBracketIcon',
    match: (id) => id.startsWith('git.'),
  },
  {
    file: 'changes',
    title: 'Changes',
    description: 'Changes, patch sets, reviews, findings, checks, policy, landing and stacks.',
    icon: 'GitMergeIcon',
    match: (id) => /^(changes|patch_sets|reviews|findings|checks|policy|stacks)\./.test(id),
  },
  {
    file: 'issues',
    title: 'Issues',
    description: 'List, open, edit and close issues.',
    icon: 'ListBulletIcon',
    match: (id) => id.startsWith('issues.'),
  },
  {
    file: 'events',
    title: 'Events, sync and operations',
    description: 'The event log, the stream, keeping a local copy in sync, and long-running operations.',
    icon: 'ArrowPathIcon',
    match: (id) => id.startsWith('events.') || id.startsWith('sync.') || id.startsWith('operations.'),
  },
  {
    file: 'tokens',
    title: 'Tokens and authorizations',
    description: 'Create, list and revoke tokens, and see the applications you have authorized.',
    icon: 'KeyIcon',
    match: (id) => id.startsWith('tokens.') || id.startsWith('authorizations.'),
  },
  {
    file: 'webhooks',
    title: 'Webhooks',
    description: 'Create an endpoint, watch deliveries, send one again, replay what was missed.',
    icon: 'ArrowPathIcon',
    match: (id) => id.startsWith('webhooks.'),
  },
  {
    file: 'search',
    title: 'Search',
    description: 'One query across repositories, changes and issues.',
    icon: 'ListBulletIcon',
    match: (id) => id.startsWith('search.'),
  },
  {
    file: 'uploads',
    title: 'Uploads and evidence',
    description: 'Announce a file, send it to a signed address, attach it to a change.',
    icon: 'ArrowDownTrayIcon',
    match: (id) => id.startsWith('uploads.') || id.startsWith('evidence.'),
  },
  {
    file: 'secrets-and-mirrors',
    title: 'Secrets and mirrors',
    description: 'Environment variables without values, grants that let an agent use them, and copies on other hosts.',
    icon: 'LockClosedIcon',
    match: (id) => id.startsWith('env.') || id.startsWith('grants.') || id.startsWith('mirrors.'),
  },
]

function section(op: Op, doc: Json, examples: Map<string, Recorded>) {
  const item = doc.paths[op.path][op.method.toLowerCase()] as Json
  const out: Array<string> = []
  out.push(`### \`${op.id}\``, '', `\`${op.method} ${op.path}\``, '', `**${op.summary}**`, '')
  if (op.description) out.push(op.description, '')

  const meta: Array<Array<string>> = [
    ['Safety', `\`${op.safety}\`${op.idempotent ? ', safe to repeat' : ', not safe to repeat blindly'}`],
    ['Needs', op.auth === 'required' ? 'a token' : op.auth === 'optional' ? 'nothing for public data, a token otherwise' : 'nothing'],
    ['Scopes', op.scopes?.length ? op.scopes.map((s) => `\`${s}\``).join(', ') : 'none'],
    ['Rate limit', op.pool === 'none' ? 'not limited' : `\`${op.pool}\` pool, ${op.cost ?? 1} unit${(op.cost ?? 1) === 1 ? '' : 's'}`],
  ]
  if (op.dryRun) meta.push(['Dry run', '`?dry_run=true`'])
  if (op.waitOn) meta.push(['Wait', '`?wait=20` with `If-None-Match`'])
  if (op.shapeable) meta.push(['Fields', '`?fields=a,b.c`'])
  if (op.mayBeAsync) meta.push(['Async', 'answers `202` and an operation'])
  meta.push(['Success', `\`${op.status ?? 200}\`, ${responseName(doc, item, op)}`])
  out.push(table(meta, ['About', '']), '')

  const params = (item.parameters ?? []) as Array<Json>
  const path = params.filter((p) => p.in === 'path')
  const query = params.filter((p) => p.in === 'query')
  if (path.length)
    out.push('**Path parameters**', '', table(path.map((p) => [`\`${p.name}\``, typeOf(p.schema), p.description ?? ''] ), ['Name', 'Type', 'Notes']), '')
  if (query.length)
    out.push(
      '**Query parameters**',
      '',
      table(
        query.map((p) => [
          `\`${p.name}\``,
          typeOf(p.schema),
          [p.required ? 'Required.' : '', p.schema?.default !== undefined ? `Default \`${JSON.stringify(p.schema.default)}\`.` : '', p.description ?? p.schema?.description ?? ''].filter(Boolean).join(' '),
        ]),
        ['Name', 'Type', 'Notes'],
      ),
      '',
    )
  const body = resolve(doc, item.requestBody?.content?.['application/json']?.schema)
  if (body?.properties) {
    const req = new Set<string>(body.required ?? [])
    out.push(
      '**Request body**',
      '',
      table(
        Object.entries<Json>(body.properties).map(([k, v]) => [
          `\`${k}\``,
          typeOf(v),
          [req.has(k) ? 'Required.' : '', v.default !== undefined ? `Default \`${JSON.stringify(v.default)}\`.` : '', v.description ?? ''].filter(Boolean).join(' '),
        ]),
        ['Member', 'Type', 'Notes'],
      ),
      '',
    )
  }

  const errors = (item['x-sx-errors'] as Array<string>).filter((c) => !['rate_limited', 'internal'].includes(c))
  out.push('**Errors**', '', errors.map((c) => `[\`${c}\`](/docs/api/errors#${c})`).join(', '), '')

  const rec = examples.get(op.id)
  if (rec) out.push('**Example**', '', example(rec, op.id), '')
  return out.join('\n')
}

const ERRORS_HEAD = "---\nicon: ShieldCheckIcon\ntitle: Errors\ndescription: One error shape with a stable code, a hint for what to do next, and whether a retry can help.\n---\n\nEvery error is `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) with a few members of ours. The CLI prints the same object on stderr and the MCP server returns it as an `isError` result, so one parser handles all three.\n\n```json\n{\n  \"type\": \"https://source.code/docs/api/errors#policy_blocked\",\n  \"title\": \"Policy blocked this\",\n  \"status\": 409,\n  \"code\": \"policy_blocked\",\n  \"detail\": \"#216 cannot land: ci/test is running on tree 9c4d7e1; 1 open: F-2 from greptile.\",\n  \"hint\": \"Stop and report the failed requirements. Do not work around the policy.\",\n  \"retryable\": false,\n  \"exit_code\": 5,\n  \"request_id\": \"req_01m6v2nqt5fs5m8zb0\",\n  \"requirements\": [\n    { \"id\": \"ci-evidence\", \"state\": \"pending\", \"needs\": { \"check\": \"ci/test\", \"bound_to\": \"tree\" } },\n    { \"id\": \"findings\", \"state\": \"fail\", \"needs\": { \"resolve\": [\"F-2\"] } }\n  ]\n}\n```\n\n| Member       | Use it to                                                                                       |\n| ------------ | ----------------------------------------------------------------------------------------------- |\n| `code`       | Branch on it. It is stable and documented below. `detail` and `hint` wording can change, `code` will not.    |\n| `detail`     | Show a person what happened, in this case.                                                      |\n| `hint`       | Know the next thing to try. It is the same string `sx` prints.                                  |\n| `retryable`  | Decide whether to send the same request again. See below.                                       |\n| `exit_code`  | Map to the CLI's exit codes: 2 usage, 3 not found, 4 not signed in, 5 blocked by policy or permission, 6 needs a person. |\n| `request_id` | Quote it when you ask us about a failure. It matches the `Sx-Request-Id` header.                |\n| `errors`     | On a `400`: one entry per field with a JSON Pointer such as `/body/title`, a `code` and a `message`. Never the value you sent, since it might be a secret. |\n\nSome codes add members: `required_scopes`, `requirements`, `current`, `retry_after_seconds`. Each is described under its code.\n\n## Retrying\n\n`retryable: true` means the same request, unchanged, may succeed later. It is the only thing a generic retry loop needs to read.\n\n- **`429` and `503`** are retryable. Wait `Retry-After` seconds, then back off if it fails again.\n- **`request_in_progress`** is retryable with the same `Idempotency-Key`.\n- **`policy_blocked`** is retryable only when nothing has failed and every unmet requirement is `pending`, meaning something automatic, like CI, will clear it. If any requirement has `fail`, it is a stop. Report it. Do not look for a way round.\n- Everything else is not. Fix the request, or ask a person.\n\nReads and writes sent with an `Idempotency-Key` are safe to repeat. See [Writes](/docs/api/writes).\n\n## Every code\n\n`GET /v1/errors` returns this table as JSON, so a client or an agent can read it once.\n\n"

const ERROR_GROUPS: Array<[string, Array<string>]> = [
  ['The request', ['invalid_request', 'cursor_mismatch', 'unsupported_version', 'method_not_allowed', 'payload_too_large', 'unsupported_media_type']],
  ['Who you are', ['unauthenticated', 'token_invalid', 'token_expired', 'token_revoked', 'signature_invalid', 'insufficient_scope', 'forbidden', 'human_required', 'grant_required']],
  ['Where it is', ['not_found', 'moved']],
  ['State and policy', ['invalid_state', 'stale_head', 'parent_not_landed', 'policy_blocked', 'version_mismatch', 'limit_reached', 'upload_incomplete']],
  ['Retries', ['idempotency_key_reused', 'request_in_progress']],
  ['Limits', ['rate_limited', 'concurrency_limited']],
  ['Our side', ['backend_unavailable', 'internal']],
]

/** Hints are plain text; make anything MDX would read as markup into code. */
function mdxSafe(text: string) {
  let out = text.replace(/\b(?:GET|POST|PATCH|PUT|DELETE) \/\S+/g, (m) => {
    const trail = /[.,;]+$/.exec(m)?.[0] ?? ''
    return `\`${m.slice(0, m.length - trail.length)}\`${trail}`
  })
  for (const tok of ['Authorization: Bearer <token>', 'Content-Type: application/json', 'errors[]', 'Sx-Version', 'Retry-After', 'Idempotency-Key', 'If-Match', 'Location', 'Allow', 'request_id', 'upload_url', 'required_scopes', 'current'])
    out = out.replace(new RegExp(`(?<![\\w\`])${tok.replace(/[[\]]/g, '\\$&')}(?![\\w\`])`, 'g'), `\`${tok}\``)
  return out.replace('`sxp_, sxb_, sxr_ or sxo_`', '`sxp_`, `sxb_`, `sxr_` or `sxo_`').replace('sxp_, sxb_, sxr_ or sxo_', '`sxp_`, `sxb_`, `sxr_` or `sxo_`')
}

function errorsPage() {
  const seen = new Set<string>()
  const body: Array<string> = []
  for (const [name, codes] of ERROR_GROUPS) {
    body.push(`## ${name}`, '')
    for (const c of codes) {
      seen.add(c)
      const e = (errorCatalog as Record<string, { status: number; title: string; retryable: boolean; exit: number; hint: string }>)[c]
      body.push(`### \`${c}\``, '', `**${e.status}.** ${e.title}. ${e.retryable ? 'Retryable.' : 'Not retryable.'} CLI exit code ${e.exit}.`, '', mdxSafe(e.hint), '')
    }
  }
  const missing = Object.keys(errorCatalog).filter((c) => !seen.has(c))
  if (missing.length) throw new Error(`error codes with no group on the errors page: ${missing.join(', ')}`)
  return ERRORS_HEAD + body.join('\n')
}

export async function generateReference(): Promise<Map<string, string>> {
  const ops = allOperations(BASE)
  const doc = buildOpenApi(ops, BASE)
  const examples = await captureExamples()
  const files = new Map<string, string>()
  const config = (await resolveConfig(new URL('../../../.prettierrc', import.meta.url).pathname)) ?? {}
  const covered = new Set<string>()
  for (const page of pages) {
    const mine = ops.filter((o) => page.match(o.id)).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    for (const o of mine) covered.add(o.id)
    const text = [
      '---',
      `icon: ${page.icon}`,
      `title: ${page.title}`,
      `description: ${page.description}`,
      '---',
      '',
      '{/* Generated from the API definitions by scripts/api-docs.ts. Do not edit by hand. */}',
      '',
      '<Callout type="warn" title="Preview">',
      '  Examples are real responses from the sample data the preview serves.',
      '</Callout>',
      '',
      ...mine.map((o) => section(o, doc, examples)),
    ].join('\n')
    files.set(`reference/${page.file}.mdx`, await format(text, { ...config, parser: 'mdx' }))
  }
  files.set('errors.mdx', await format(errorsPage(), { ...config, parser: 'mdx' }))
  const missing = ops.filter((o) => !covered.has(o.id)).map((o) => o.id)
  if (missing.length) throw new Error(`operations with no reference page: ${missing.join(', ')}`)
  return files
}

export const exampleless = async () => {
  const examples = await captureExamples()
  return allOperations(BASE).filter((o) => !examples.has(o.id)).map((o) => o.id)
}
