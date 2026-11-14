import { newId } from './ids'

/**
 * Per-repository things beyond code and review: mirrors on other hosts, the
 * environment schema with its encrypted values, and the grants that let an
 * agent use them.
 *
 * Values are the point of care here. Names and kinds are ordinary data. A value
 * leaves only through `values()`, which needs a person, or an agent holding an
 * unexpired grant for a development environment, writes an audit entry, and is
 * never cached. The values in the sample are stand-ins.
 */
export const ENVIRONMENTS = ['development', 'preview', 'production'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export type MirrorRec = {
  id: string
  host: string
  slug: string
  direction: 'push' | 'pull' | 'two-way'
  state: 'in-sync' | 'syncing' | 'behind' | 'failing'
  lastSync: number
  detail: string | null
  created: number
  /** Paused: nothing is sent or fetched until it is resumed. */
  paused?: boolean
}

export type EnvVarRec = {
  name: string
  kind: string
  secret: boolean
  set: Array<Environment>
  description: string
  /** Environments that must have a value. */
  required?: Array<Environment>
  rotated?: { at: number; by: string }
}

export type RecipientRec = {
  id: string
  kind: string
  name?: string
  /** The public key's short form, to tell keys apart. */
  fingerprint?: string
  environments?: Array<Environment>
  added?: number
  lastUsed?: number
}

export type GrantRec = {
  id: string
  environment: Environment
  state: 'pending' | 'active' | 'revoked'
  variables: Array<string>
  reason: string | null
  requestedBy: string
  maxRuns: number
  uses: number
  expires: number | null
  created: number
}

export type AuditKind = 'rotate' | 'grant' | 'revoke' | 'read' | 'reject'
export type AuditRec = {
  at: number
  who: string
  action: string
  target?: string
  kind?: AuditKind
}

/** Stand-ins for decrypted values. */
const SAMPLE_VALUES: Record<string, string> = {
  DATABASE_URL: 'postgres://dev:hunter2-dev-only@localhost:5432/gitfs',
  STRIPE_KEY: 'sk_test_51MockMockMockMock9x',
  API_PORT: '8080',
}

export class RepoExtras {
  readonly mirrors: Array<MirrorRec> = []
  readonly env: Array<EnvVarRec> = []
  readonly recipients: Array<RecipientRec> = [
    { id: 'owner', kind: 'person' },
    { id: 'recovery', kind: 'recovery' },
  ]
  readonly grants: Array<GrantRec> = []
  readonly audit: Array<AuditRec> = []

  constructor(private readonly now: () => number) {}

  /** The plain data, for keeping elsewhere. */
  toJSON() {
    return {
      mirrors: this.mirrors,
      env: this.env,
      recipients: this.recipients,
      grants: this.grants,
      audit: this.audit,
    }
  }

  static from(now: () => number, data: ReturnType<RepoExtras['toJSON']>) {
    const x = new RepoExtras(now)
    for (const k of [
      'mirrors',
      'env',
      'recipients',
      'grants',
      'audit',
    ] as const) {
      const list = x[k] as Array<unknown>
      list.splice(0, list.length, ...data[k])
    }
    return x
  }

  note(
    who: string,
    action: string,
    more?: { target?: string; kind?: AuditKind },
  ) {
    this.audit.unshift({ at: this.now(), who, action, ...more })
    if (this.audit.length > 1000) this.audit.length = 1000
  }

  activeGrant(environment: Environment): GrantRec | undefined {
    const t = this.now()
    return this.grants.find(
      (g) =>
        g.state === 'active' &&
        g.environment === environment &&
        g.expires !== null &&
        g.expires > t &&
        g.uses < g.maxRuns,
    )
  }

  /** Reads values. The caller has already been checked; this applies the grant. */
  values(opts: {
    environment: Environment
    names?: Array<string>
    who: string
    agent: boolean
  }) {
    const grant = opts.agent ? this.activeGrant(opts.environment) : undefined
    const vars = this.env.filter(
      (v) =>
        v.set.includes(opts.environment) &&
        (!opts.names || opts.names.includes(v.name)) &&
        (!grant || grant.variables.includes(v.name)),
    )
    const values: Record<string, string> = {}
    for (const v of vars)
      if (v.name in SAMPLE_VALUES) values[v.name] = SAMPLE_VALUES[v.name]
    if (grant) grant.uses++
    this.note(
      opts.who,
      `read ${vars.length} variable${vars.length === 1 ? '' : 's'} (${opts.environment})${grant ? ` under ${grant.id}` : ''}`,
    )
    return {
      values,
      secrets: vars.filter((v) => v.secret).map((v) => v.name),
      grant: grant?.id ?? null,
      grantRec: grant,
    }
  }

  requestGrant(opts: {
    environment: Environment
    reason: string | null
    maxRuns: number
    who: string
  }) {
    const existing = this.grants.find(
      (g) => g.state === 'pending' && g.environment === opts.environment,
    )
    if (existing) return { grant: existing, created: false }
    const g: GrantRec = {
      id: newId('grant', this.now()),
      environment: opts.environment,
      state: 'pending',
      variables: this.env
        .filter((v) => v.set.includes(opts.environment))
        .map((v) => v.name),
      reason: opts.reason,
      requestedBy: opts.who,
      maxRuns: opts.maxRuns,
      uses: 0,
      expires: null,
      created: this.now(),
    }
    this.grants.unshift(g)
    this.note(
      opts.who,
      `requested ${opts.environment} access: ${opts.reason ?? 'no reason given'}`,
    )
    return { grant: g, created: true }
  }
}

/**
 * Where extras are kept. `open` gives a copy to read and change; a store
 * that keeps them elsewhere (`stores/convex-extras.ts`) saves what changed
 * when the request ends. The memory store hands out the object itself.
 */
export interface ExtrasPort {
  open: (repo: string) => Promise<RepoExtras>
  /** Every repository's mirrors, for the status page. */
  allMirrors: () => Promise<Array<{ repo: string; mirror: MirrorRec }>>
  rename: (from: string, to: string) => void
  drop: (repo: string) => void
  /** Saves what this request changed. Called once a request's domain work is done. */
  flush?: () => Promise<void>
}

export class ExtrasStore implements ExtrasPort {
  private readonly repos = new Map<string, RepoExtras>()
  constructor(private readonly now: () => number) {}
  /** A renamed repository keeps its mirrors, variables and grants. */
  rename(from: string, to: string) {
    const x = this.repos.get(from)
    if (!x) return
    this.repos.delete(from)
    this.repos.set(to, x)
  }

  drop(repo: string) {
    this.repos.delete(repo)
  }

  /** Every repository's extras, by address. */
  entries() {
    return this.repos.entries()
  }

  open(repo: string) {
    return Promise.resolve(this.for(repo))
  }

  allMirrors() {
    return Promise.resolve(
      [...this.repos].flatMap(([repo, x]) =>
        x.mirrors.map((mirror) => ({ repo, mirror })),
      ),
    )
  }

  for(repo: string): RepoExtras {
    let x = this.repos.get(repo)
    if (!x) this.repos.set(repo, (x = new RepoExtras(this.now)))
    return x
  }
}
