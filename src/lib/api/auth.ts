import { createHash } from 'node:crypto'
import { newId, randomSource } from './ids'

/**
 * Who a request is. A token maps to a principal: the account it acts as, what
 * kind of actor it is (policies read that), the scopes it holds and, for a bot
 * or run token, the repositories it is limited to.
 */
export type ActorClass = 'human' | 'agent' | 'bot'

export const allScopes = [
  'repo:read',
  'repo:write',
  'issues:read',
  'issues:comment',
  'issues:write',
  'pulls:read',
  'pulls:comment',
  'pulls:write',
  'pulls:merge',
  'secrets:schema',
  'secrets:write',
  'secrets:decrypt',
  'webhooks:read',
  'webhooks:write',
  'tokens:manage',
] as const
export type Scope = (typeof allScopes)[number]

/** Scopes an OAuth client can be granted. A token never mints tokens. */
export const oauthScopes: ReadonlyArray<Scope> = allScopes.filter(
  (s) => s !== 'tokens:manage' && s !== 'secrets:decrypt',
)

export type Audience = 'api' | 'mcp'
export type TokenKind = 'personal' | 'bot' | 'run' | 'oauth'

export type TokenRecord = {
  id: string
  name: string
  kind: TokenKind
  /** The login. */
  handle: string
  /** The account the request acts as. Usually the same as `handle`. */
  actingAs: string
  class: ActorClass
  scopes: ReadonlyArray<Scope>
  /** `owner/name` list when the token is limited to repositories. */
  repos: ReadonlyArray<string> | null
  audience: ReadonlyArray<Audience>
  prefix: string
  createdAt: number
  expiresAt: number
  lastUsedAt: number | null
  revokedAt: number | null
  /** OAuth only: the authorization this token belongs to. */
  authorizationId?: string
}

export type Principal = {
  tokenId: string
  handle: string
  actingAs: string
  class: ActorClass
  scopes: ReadonlySet<Scope>
  repos: ReadonlyArray<string> | null
  expiresAt: number
  /** Everything that decides what this principal may do, as a cache key. */
  capabilityKey: string
  /** The same, as a short stand-in, for keys that are built on every request. */
  capId: string
}

export type FindResult =
  | { ok: true; record: TokenRecord }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'audience' }

export interface TokenStore {
  /**
   * Looks a token up as it arrived. A store may remember recent ones, so a busy
   * token is not hashed on every request. Revocation and expiry are still
   * checked on the record each time.
   */
  findToken?: (
    token: string,
    audience: Audience,
    now: number,
  ) => FindResult | Promise<FindResult>
  /** Looks a secret up by its hash. */
  find: (
    tokenHash: string,
    audience: Audience,
    now: number,
  ) => FindResult | Promise<FindResult>
  /** Note that the token was used. Never a write on every request. */
  touch?: (record: TokenRecord, now: number) => void
  /** Drop expired and long-revoked records. Called on a schedule when present. */
  sweep?: (now: number) => void
}

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export const tokenShape = /^sx[pbrof]_[A-Za-z0-9_-]{8,}$/

const prefixes: Record<TokenKind, string> = {
  personal: 'sxp',
  bot: 'sxb',
  run: 'sxr',
  oauth: 'sxo',
}

export function secretFor(kind: TokenKind | 'refresh'): string {
  const p = kind === 'refresh' ? 'sxf' : prefixes[kind]
  return `${p}_${Buffer.from(randomSource.bytes(24)).toString('base64url')}`
}

/** A short, stable name for a long capability key, with no unbounded map to grow. */
export function internCapability(key: string): string {
  return createHash('sha1').update(key).digest('base64url').slice(0, 16)
}

const principals = new WeakMap<TokenRecord, Principal>()

/** One principal per record, built once, so a request does no allocation for it. */
export function principalOf(record: TokenRecord): Principal {
  let p = principals.get(record)
  if (!p || p.repos !== record.repos) {
    const scopes = new Set(record.scopes)
    p = {
      tokenId: record.id,
      handle: record.handle,
      actingAs: record.actingAs,
      class: record.class,
      scopes,
      repos: record.repos,
      expiresAt: record.expiresAt,
      // Everything that can change what this caller sees or may do.
      capabilityKey: `${record.class}:${record.handle}:${record.actingAs}:${[...scopes].sort().join(',')}:${record.repos?.join(',') ?? '*'}`,
      capId: '',
    }
    p.capId = internCapability(p.capabilityKey)
    principals.set(record, p)
  }
  return p
}

export type Authorization = {
  id: string
  clientId: string
  clientName: string
  handle: string
  scopes: ReadonlyArray<Scope>
  audience: ReadonlyArray<Audience>
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export type CreateToken = {
  name: string
  kind: TokenKind
  handle: string
  actingAs?: string
  class: ActorClass
  scopes: ReadonlyArray<Scope>
  repos?: ReadonlyArray<string> | null
  audience?: ReadonlyArray<Audience>
  ttlMs: number
  authorizationId?: string
}

/**
 * Tokens and OAuth authorizations, in memory. The hosted version keeps the same
 * surface in the database. Secrets are never stored, only their hashes.
 */
export class AuthStore implements TokenStore {
  private readonly byHash = new Map<string, TokenRecord>()
  private readonly byId = new Map<string, TokenRecord>()
  /** Each person's tokens, so listing and counting them does not read everyone's. */
  private readonly byHandle = new Map<string, Set<TokenRecord>>()
  readonly authorizations = new Map<string, Authorization>()
  /** Tokens that stop working when their authorization is revoked. */
  private readonly byAuthorization = new Map<string, Set<TokenRecord>>()

  constructor(private readonly clock: () => number = Date.now) {}

  create(
    input: CreateToken & { id?: string },
    fixedSecret?: string,
  ): { record: TokenRecord; secret: string } {
    const secret = fixedSecret ?? secretFor(input.kind)
    const at = this.clock()
    const record: TokenRecord = {
      id: input.id ?? newId('token', at),
      name: input.name,
      kind: input.kind,
      handle: input.handle,
      actingAs: input.actingAs ?? input.handle,
      class: input.class,
      scopes: [...input.scopes],
      repos: input.repos ? input.repos.map((r) => r.toLowerCase()) : null,
      audience: input.audience ?? ['api', 'mcp'],
      prefix: secret.slice(0, 8),
      createdAt: at,
      expiresAt: at + input.ttlMs,
      lastUsedAt: null,
      revokedAt: null,
      authorizationId: input.authorizationId,
    }
    const hash = hashToken(secret)
    this.byHash.set(hash, record)
    this.hashOf.set(record, hash)
    this.byId.set(record.id, record)
    let own = this.byHandle.get(record.handle)
    if (!own) this.byHandle.set(record.handle, (own = new Set()))
    own.add(record)
    if (record.authorizationId) {
      const set = this.byAuthorization.get(record.authorizationId) ?? new Set()
      set.add(record)
      this.byAuthorization.set(record.authorizationId, set)
    }
    return { record, secret }
  }

  /** Register a token whose secret already exists. Sample data uses it. */
  add(secret: string, input: CreateToken & { id?: string }) {
    return this.create(input, secret).record
  }

  private readonly recent = new Map<string, TokenRecord>()

  findToken(token: string, audience: Audience, now: number): FindResult {
    let record = this.recent.get(token)
    if (!record) {
      record = this.byHash.get(hashToken(token))
      if (!record) return { ok: false, reason: 'unknown' }
      if (this.recent.size >= 4096) this.recent.delete(this.recent.keys().next().value as string)
      this.recent.set(token, record)
      this.rawOf.set(record, token)
    }
    return this.check(record, audience, now)
  }

  find(tokenHash: string, audience: Audience, now: number): FindResult {
    const record = this.byHash.get(tokenHash)
    if (!record) return { ok: false, reason: 'unknown' }
    return this.check(record, audience, now)
  }

  private check(record: TokenRecord, audience: Audience, now: number): FindResult {
    if (record.revokedAt !== null) return { ok: false, reason: 'revoked' }
    if (record.expiresAt <= now) return { ok: false, reason: 'expired' }
    if (!record.audience.includes(audience))
      return { ok: false, reason: 'audience' }
    return { ok: true, record }
  }

  touch(record: TokenRecord, now: number) {
    // At most once a minute: reading a token must not become a write per request.
    if (record.lastUsedAt === null || now - record.lastUsedAt > 60_000)
      record.lastUsedAt = now
  }

  get(id: string) {
    return this.byId.get(id) ?? null
  }

  list(handle: string, kinds: ReadonlyArray<TokenKind>) {
    return [...(this.byHandle.get(handle) ?? [])]
      .filter(
        (t) =>
          t.handle === handle && kinds.includes(t.kind) && t.revokedAt === null,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Revoked tokens, oldest first. They are kept so the answer to one is `token_revoked`, but not without limit. */
  private readonly revoked: Array<TokenRecord> = []
  private revokedFrom = 0
  static readonly REVOKED_KEPT = 50_000

  private readonly hashOf = new WeakMap<TokenRecord, string>()
  /** The secret a record was last found by, so forgetting the record can forget that shortcut too. */
  private readonly rawOf = new WeakMap<TokenRecord, string>()

  private forgetByRecord(t: TokenRecord) {
    const hash = this.hashOf.get(t)
    if (hash) this.byHash.delete(hash)
    this.byId.delete(t.id)
    const own = this.byHandle.get(t.handle)
    own?.delete(t)
    if (own?.size === 0) this.byHandle.delete(t.handle)
    const raw = this.rawOf.get(t)
    if (raw !== undefined) this.recent.delete(raw)
  }

  revoke(id: string): boolean {
    const t = this.byId.get(id)
    if (!t || t.revokedAt !== null) return false
    t.revokedAt = this.clock()
    this.revoked.push(t)
    // Past the cap the oldest revocations are forgotten: such a token then answers
    // `token_invalid` instead of `token_revoked`, and it still does not work.
    while (this.revoked.length - this.revokedFrom > AuthStore.REVOKED_KEPT) this.forgetOldest()
    if (this.revokedFrom > 4096 && this.revokedFrom * 2 > this.revoked.length) {
      this.revoked.splice(0, this.revokedFrom)
      this.revokedFrom = 0
    }
    return true
  }

  private forgetOldest() {
    this.forgetByRecord(this.revoked[this.revokedFrom++])
  }

  // ----- OAuth authorizations ---------------------------------------------

  createAuthorization(
    input: Omit<Authorization, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>,
  ): Authorization {
    const a: Authorization = {
      ...input,
      id: newId('authorization', this.clock()),
      createdAt: this.clock(),
      lastUsedAt: null,
      revokedAt: null,
    }
    this.authorizations.set(a.id, a)
    return a
  }

  revokeAuthorization(id: string): boolean {
    const a = this.authorizations.get(id)
    if (!a || a.revokedAt !== null) return false
    a.revokedAt = this.clock()
    for (const t of this.byAuthorization.get(id) ?? []) t.revokedAt ??= a.revokedAt
    return true
  }

  listAuthorizations(handle: string) {
    return [...this.authorizations.values()]
      .filter((a) => a.handle === handle && a.revokedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  countActive(handle: string, now = this.clock()) {
    let n = 0
    for (const t of this.byHandle.get(handle) ?? [])
      if (t.revokedAt === null && t.kind !== 'oauth' && t.expiresAt > now) n++
    return n
  }

  /** A renamed repository keeps its name in every limited token. */
  renameRepo(from: string, to: string) {
    const oldName = from.toLowerCase()
    const newName = to.toLowerCase()
    for (const t of this.byId.values()) {
      if (!t.repos) continue
      if (t.repos.includes(oldName)) t.repos = t.repos.map((r) => (r === oldName ? newName : r))
      // A different repository moving into a name this token holds is not the
      // repository the token was granted, so remove the name it collides with.
      else if (t.repos.includes(newName)) t.repos = t.repos.filter((r) => r !== newName)
    }
  }

  /** A deleted repository stops being reachable through any limited token. */
  dropRepo(full: string) {
    const name = full.toLowerCase()
    for (const t of this.byId.values())
      if (t.repos?.includes(name)) t.repos = t.repos.filter((r) => r !== name)
  }

  /** Drop expired and long-revoked tokens, and authorizations revoked long ago. */
  sweep(now: number) {
    for (const t of [...this.byId.values()])
      if (t.expiresAt + 86_400_000 < now || (t.revokedAt && t.revokedAt + 86_400_000 < now)) this.forgetByRecord(t)
    for (const [id, a] of this.authorizations)
      if (a.revokedAt !== null && a.revokedAt + 86_400_000 < now) {
        this.authorizations.delete(id)
        this.byAuthorization.delete(id)
      }
  }
}

/** Kept for code and tests that build a store of fixed tokens. */
export { AuthStore as MemoryTokenStore }
