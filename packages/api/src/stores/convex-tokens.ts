import { run } from '../domain/convex'
import type { ConvexCall } from '../domain/convex'
import type {
  Audience,
  Authorization,
  CreateToken,
  FindResult,
  TokenKind,
  TokenRecord,
  TokenService,
} from '../auth'
import type { OAuthKind, OAuthState } from '../oauth-state'

/**
 * Tokens in Convex (`convex/forge/tokens.ts`). Every lookup asks the
 * database, so a revoked token stops working on the very next request.
 */
export class ConvexTokens implements TokenService {
  constructor(private readonly call: ConvexCall) {}

  private q<T>(name: string, args: Record<string, unknown>) {
    return run<T>(this.call, 'query', `forge/tokens:${name}`, args, 'system')
  }

  private m<T>(name: string, args: Record<string, unknown>) {
    return run<T>(this.call, 'mutation', `forge/tokens:${name}`, args, 'system')
  }

  find(hash: string, audience: Audience, now: number) {
    return this.q<FindResult>('find', { hash, audience, at: now })
  }

  touch(record: TokenRecord, now: number) {
    if (record.lastUsedAt === null || now - record.lastUsedAt > 60_000)
      void this.m('touch', { id: record.id }).catch(() => {})
  }

  create(input: CreateToken & { id?: string }) {
    const { repos, ...rest } = input
    return this.m<{ record: TokenRecord; secret: string }>('create', {
      ...rest,
      scopes: [...input.scopes],
      repos: repos ? [...repos] : null,
      ...(input.audience ? { audience: [...input.audience] } : {}),
    })
  }

  /** A token whose secret already exists, as sample data has. */
  add(secret: string, input: CreateToken & { id?: string }) {
    return this.m<{ record: TokenRecord }>('create', {
      ...input,
      scopes: [...input.scopes],
      repos: input.repos ? [...input.repos] : null,
      secret,
    })
  }

  get(id: string) {
    return this.q<TokenRecord | null>('get', { id })
  }

  list(handle: string, kinds: ReadonlyArray<TokenKind>) {
    return this.q<Array<TokenRecord>>('list', { handle, kinds: [...kinds] })
  }

  revoke(id: string) {
    return this.m<boolean>('revoke', { id })
  }

  countActive(handle: string, now = Date.now()) {
    return this.q<number>('countActive', { handle, at: now })
  }

  getAuthorization(id: string) {
    return this.q<Authorization | null>('getAuthorization', { id })
  }

  createAuthorization(
    input: Omit<Authorization, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>,
  ) {
    return this.m<Authorization>('createAuthorization', {
      ...input,
      scopes: [...input.scopes],
      audience: [...input.audience],
    })
  }

  revokeAuthorization(id: string) {
    return this.m<boolean>('revokeAuthorization', { id })
  }

  listAuthorizations(handle: string) {
    return this.q<Array<Authorization>>('listAuthorizations', { handle })
  }

  /** Tokens keep repository ids, so a rename needs nothing. */
  renameRepo() {}

  /** A deleted repository's id no longer resolves, so it drops out by itself. */
  dropRepo() {}
}

/** The OAuth server's memory in Convex (`convex/forge/oauth.ts`). */
export class ConvexOAuthState implements OAuthState {
  constructor(private readonly call: ConvexCall) {}

  private q<T>(name: string, args: Record<string, unknown>) {
    return run<T>(this.call, 'query', `forge/oauth:${name}`, args, 'system')
  }

  private m<T>(name: string, args: Record<string, unknown>) {
    return run<T>(this.call, 'mutation', `forge/oauth:${name}`, args, 'system')
  }

  async get<T>(kind: OAuthKind, key: string) {
    return (await this.q<T | null>('get', { kind, key })) ?? undefined
  }

  async set(
    kind: OAuthKind,
    key: string,
    value: unknown,
    expires: number | null,
  ) {
    await this.m('set', { kind, key, value: JSON.stringify(value), expires })
  }

  async delete(kind: OAuthKind, key: string) {
    await this.m('remove', { kind, key })
  }

  async use<T>(kind: OAuthKind, key: string) {
    return (await this.m<T | null>('use', { kind, key })) ?? undefined
  }

  count(kind: OAuthKind, upTo: number) {
    return this.q<number>('count', { kind, upTo })
  }

  /** The deployment sweeps on a schedule (`crons.ts`). */
  async sweep() {}
}
