import { buildOpenApi } from './openapi'
import { createApi } from './pipeline'
import { EventLog } from './events'
import { MemoryDomain } from './domain'
import { changeOps } from './ops/changes'
import { tokenOps } from './ops/tokens'
import { webhookOps } from './ops/webhooks'
import { searchOps } from './ops/search'
import { uploadOps } from './ops/uploads'
import { extrasOps } from './ops/extras'
import { gitOps } from './ops/git'
import { teamOps } from './ops/teams'
import { runOps } from './ops/runs'
import { StoreGit } from './git'
import { ExtrasStore } from './extras'
import { SearchIndex } from './search'
import { HttpTransport, WebhookService } from './webhooks'
import { MemoryBlobStore, UploadService } from './uploads'
import { MemorySessions, OAuthServer } from './oauth'
import { oauthScopes } from './auth'
import { eventOps } from './ops/events'
import { issueOps } from './ops/issues'
import { metaOps, openapiOp } from './ops/meta'
import { repoOps } from './ops/repos'
import { T0, sampleTokenStore, seedSample } from './sample'
import type { AuthStore } from './auth'
import type { GitData } from './git'
import type { Scheduler, Transport } from './webhooks'
import type { Environment } from './extras'
import type { Op } from './registry'
import type { ApiOptions } from './pipeline'

/** Every operation. Adding an endpoint is adding one to a list in `ops/`. */
export const operations: ReadonlyArray<Op> = [
  ...metaOps,
  ...repoOps,
  ...changeOps,
  ...issueOps,
  ...eventOps,
  ...tokenOps,
  ...webhookOps,
  ...searchOps,
  ...uploadOps,
  ...extrasOps,
  ...gitOps,
  ...teamOps,
  ...runOps,
]

export function allOperations(base?: string): Array<Op> {
  const list: Array<Op> = [...operations]
  list.push(openapiOp(() => buildOpenApi(list, base)))
  return list
}

export type { Api } from './pipeline'
export { createApi } from './pipeline'

/** The API as the preview serves it: sample data, memory stores. */
export function createSampleApi(
  overrides: Partial<ApiOptions> & {
    seed?: (d: MemoryDomain) => void
    /** Offer sample accounts on the OAuth sign-in page. Default: true. */
    sampleLogins?: boolean
    /** The address people reach the app at, for OAuth. Default: the html base. */
    issuer?: string
    /** How webhooks are sent. Tests pass a fake; the default refuses private addresses. */
    transport?: Transport
    scheduler?: Scheduler
    allowPrivateWebhooks?: boolean
    /** Where git data comes from. Default: the git store in `src/git`. */
    git?: GitData
  } = {},
) {
  const now = overrides.now ?? Date.now
  const urls = {
    api: overrides.base ?? 'https://api.source.code/v1',
    html: overrides.htmlBase ?? 'https://source.code',
  }
  const events = overrides.events ?? new EventLog(now)
  const domain = new MemoryDomain(urls, now, events)
  seedSample(domain)
  overrides.seed?.(domain)
  const auth = (overrides.tokens as AuthStore | undefined) ?? sampleTokenStore(now())
  domain.svc.auth = auth
  domain.svc.hooks = new WebhookService({
    events,
    now,
    scheduler: overrides.scheduler,
    transport: overrides.transport ?? new HttpTransport(overrides.allowPrivateWebhooks ?? false),
    allowPrivate: overrides.allowPrivateWebhooks ?? false,
  })
  domain.svc.search = new SearchIndex(() => domain.searchDocs(), events)
  domain.svc.uploads = new UploadService(new MemoryBlobStore(), now)
  domain.svc.extras = new ExtrasStore(now)
  domain.svc.git = overrides.git ?? new StoreGit()
  seedExtras(domain)
  const issuer = overrides.issuer ?? urls.html
  const oauth = new OAuthServer({
    auth,
    issuer,
    apiBase: urls.api,
    resources: { api: urls.api, mcp: `${urls.html}/mcp` },
    sessions: new MemorySessions(
      overrides.sampleLogins === false
        ? []
        : [
            { handle: 'dana', name: 'Dana Okafor' },
            { handle: 'hollis', name: 'Hollis Reyes' },
          ],
      issuer.startsWith('https:'),
    ),
    userScopes: (handle) =>
      handle === 'dana' ? oauthScopes : oauthScopes.filter((s) => s !== 'repo:write' && s !== 'issues:write'),
    now,
  })
  return createApi({
    ops: allOperations(urls.api),
    domain,
    events,
    tokens: auth,
    oauth,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    ...overrides,
  })
}

/** Mirrors and environment schema for the sample repositories. */
function seedExtras(d: MemoryDomain) {
  for (const r of d.repos.values()) {
    const full = `${r.owner}/${r.name}`
    const x = d.svc.extras.for(full)
    for (const v of r.env)
      x.env.push({ name: v.name, kind: v.kind, secret: v.kind !== 'port', set: v.set as Array<Environment>, description: '' })
  }
  const x = d.svc.extras.for('dana/gitfs')
  const at = T0 - 2 * 86_400_000
  x.mirrors.push(
    { id: 'mir_gitfsgithub0000000', host: 'github', slug: 'dana/gitfs', direction: 'two-way', state: 'in-sync', lastSync: at, detail: null, created: at - 86_400_000 },
    { id: 'mir_gitfsgitlab0000000', host: 'gitlab', slug: 'dana-labs/gitfs', direction: 'push', state: 'failing', lastSync: at - 86_400_000, detail: 'Authentication failed. Reconnect GitLab.', created: at - 86_400_000 },
  )
}
