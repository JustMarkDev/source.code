import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { allOperations } from './index'
import { createApi } from './pipeline'
import { EventLog } from './events'
import { ConvexDomain, run } from './domain/convex'
import { OAuthServer } from './oauth'
import { oauthScopes } from './auth'
import { SearchIndex } from './search'
import { StoreGit } from './git'
import { HttpTransport } from './webhooks'
import { UploadSigner } from './uploads'
import { mailerFromEnv } from './mail'
import { convexHttpCall } from './stores/convex-http'
import { ConvexEventFeed } from './stores/convex-events'
import { ConvexOAuthState, ConvexTokens } from './stores/convex-tokens'
import { ConvexExtras } from './stores/convex-extras'
import { ConvexUploads } from './stores/convex-uploads'
import { ConvexHooks } from './stores/convex-hooks'
import {
  ConvexIdempotencyStore,
  ConvexLimitStore,
  convexCaller,
} from './stores/convex'
import { blobStoreFromEnv } from './stores/blobs'
import type { Attached } from './domain/records'
import type { SessionResolver } from './oauth'
import type { Scope } from './auth'
import type { JWK } from 'jose'

/**
 * The API on Convex, as the running app serves it. This server keeps no
 * data of its own: tokens, OAuth state, the forge, extras, upload records,
 * webhooks and the event feed are all in Convex; files are in the bucket.
 * What it holds in memory (the event window, the search index, caches) it
 * rebuilds from Convex at start, so any copy can be stopped at any time.
 */
export type ConvexApiOptions = {
  /** The Convex deployment (`https://<name>.convex.cloud`). */
  convexUrl: string
  /** Signs the API's own JWTs for Convex (`scripts/api-keys.ts`). */
  jwt: { issuer: string; privateJwk: JWK }
  /** Shared with every API server, for rate limits and idempotency keys. */
  storeSecret?: string
  /** Signs upload addresses. Every API server must share it. */
  uploadSecret: string
  mount: string
  base: string
  htmlBase: string
  sessions: SessionResolver
  userScopes?: (handle: string) => ReadonlyArray<Scope>
  /** Seed an empty deployment with the sample, for development. */
  seedSample?: () => string
  /** Where uploaded files go when no bucket is configured. */
  blobFolder: string
  env?: Record<string, string | undefined>
  allowPrivateWebhooks?: boolean
}

export function createConvexApi(o: ConvexApiOptions) {
  const now = Date.now
  const env = o.env ?? process.env
  const urls = { api: o.base, html: o.htmlBase }
  const call = convexHttpCall(o.convexUrl, o.jwt)
  const events = new EventLog(now)
  const svc = {
    auth: new ConvexTokens(call),
    extras: new ConvexExtras(call, now),
    uploads: new ConvexUploads(
      call,
      blobStoreFromEnv(env, o.blobFolder),
      new UploadSigner(Buffer.from(o.uploadSecret)),
      now,
    ),
    hooks: new ConvexHooks(call, {
      events,
      now,
      transport: new HttpTransport(o.allowPrivateWebhooks ?? false),
      allowPrivate: o.allowPrivateWebhooks ?? false,
    }),
    git: new StoreGit(),
    mail: mailerFromEnv(),
  } as unknown as Attached
  const d = new ConvexDomain(urls, call, events, svc, now)
  svc.search = new SearchIndex(() => d.searchDocs(), events)
  const domain = Object.assign(d, {
    oauthState: new ConvexOAuthState(call),
  })
  const feed = new ConvexEventFeed(call, events, (rev) => {
    d.accessRevision = rev
  })

  // Getting ready: seed a new development deployment, fill the event window
  // and the search index, then follow the feed with one subscription.
  const ready = (async () => {
    if (o.seedSample) {
      const seeded = await run<boolean>(
        call,
        'mutation',
        'seed:loadSample',
        { world: o.seedSample() },
        'system',
      )
      if (seeded)
        console.log('[api] seeded the Convex deployment with the sample')
    }
    await feed.start()
    await d.refreshSearch()
    svc.search.ensure()
    const client = new ConvexClient(o.convexUrl)
    client.onUpdate(
      makeFunctionReference<'query'>('forge/events:head'),
      {},
      () => {
        void feed.pull().then(() => (svc.hooks as ConvexHooks).send())
      },
    )
    // Retries come due on this server's clock; a lost one is picked up here.
    const timer = setInterval(
      () => void (svc.hooks as ConvexHooks).send().catch(() => {}),
      5_000,
    )
    timer.unref()
    // This server's request counts, for every server's status page.
    const health = setInterval(
      () =>
        void d
          .flushHealth()
          .catch((e: unknown) =>
            console.error('[api] could not share health', e),
          ),
      60_000,
    )
    health.unref()
  })()

  const oauth = new OAuthServer({
    auth: svc.auth,
    state: domain.oauthState,
    issuer: o.htmlBase,
    apiBase: o.base,
    resources: { api: o.base, mcp: `${o.htmlBase}/mcp` },
    sessions: o.sessions,
    userScopes: o.userScopes ?? (() => oauthScopes),
    now,
  })
  const shared = o.storeSecret ? convexCaller(o.convexUrl) : null
  const api = createApi({
    ops: allOperations(o.base),
    events,
    tokens: svc.auth,
    oauth,
    resourceMetadataUrl: `${o.htmlBase}/.well-known/oauth-protected-resource`,
    mount: o.mount,
    base: o.base,
    htmlBase: o.htmlBase,
    domain,
    ...(shared && o.storeSecret
      ? {
          limitStore: new ConvexLimitStore(shared, o.storeSecret),
          idempotency: new ConvexIdempotencyStore(shared, o.storeSecret),
        }
      : {}),
  })
  const fetch = async (req: Request) => {
    await ready
    return api.fetch(req)
  }
  const fetchAs: typeof api.fetchAs = async (principal, req) => {
    await ready
    return api.fetchAs(principal, req)
  }
  return { ...api, fetch, fetchAs, domain, port: domain, ready }
}
