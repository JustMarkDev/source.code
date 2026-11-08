import { z } from 'zod'

/**
 * The public shape of every object. These are the contract: the OpenAPI
 * document is generated from them, and the tests check each response against
 * them with no extra members allowed, so a field cannot be added without
 * being written down here first. Clients must still ignore unknown members.
 */
const obj = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape)
const named = <T extends z.ZodType>(id: string, schema: T): T =>
  schema.meta({ id })
const ts = z.string().describe('RFC 3339 time, UTC')
const id = (prefix: string) => z.string().describe(`Starts with ${prefix}_`)

export const Actor = named('Actor', obj({
  object: z.literal('actor'),
  id: id('acc'),
  handle: z.string(),
  class: z.enum(['human', 'agent', 'bot']),
}))

export const RepoRef = named('RepoRef', obj({
  object: z.literal('repo'),
  id: id('rep'),
  full_name: z.string(),
  url: z.string(),
}))

export const Account = named('Account', obj({
  object: z.literal('account'),
  id: id('acc'),
  handle: z.string(),
  name: z.string(),
  kind: z.enum(['person', 'organization']),
  role: z.enum(['owner', 'admin', 'member']).nullable(),
  url: z.string(),
  html_url: z.string(),
  created_at: ts,
}))

export const Repo = named('Repo', obj({
  object: z.literal('repo'),
  id: id('rep'),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  description: z.string(),
  visibility: z.enum(['public', 'private']),
  default_branch: z.string(),
  stars: z.number().int(),
  open_changes: z.number().int(),
  open_issues: z.number().int(),
  url: z.string(),
  html_url: z.string(),
  created_at: ts,
  updated_at: ts,
  version: z.number().int(),
}))

const Action = obj({ allowed: z.boolean(), reasons: z.array(z.string()) })

export const Requirement = named('Requirement', obj({
  id: z.string(),
  rule: z.string(),
  state: z.enum(['pass', 'fail', 'pending', 'na']),
  detail: z.string(),
  needs: z.record(z.string(), z.unknown()).nullable(),
  blocking: z.array(z.string()),
}))

export const Finding = named('Finding', obj({
  object: z.literal('finding'),
  id: id('fnd'),
  label: z.string().describe('The short name reviewers use, such as F-2'),
  by: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  state: z.enum(['open', 'resolved', 'dismissed']),
  reason: z.string().nullable(),
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  body: z.string(),
  patch_set: z.number().int(),
  url: z.string(),
  created_at: ts,
}))

export const CheckRun = named('CheckRun', obj({
  object: z.literal('check_run'),
  id: id('chk'),
  key: z.string(),
  name: z.string(),
  state: z.enum(['pending', 'pass', 'fail']),
  tree: z.string(),
  details_url: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
}))

export const Review = named('Review', obj({
  object: z.literal('review'),
  id: id('rev'),
  actor: Actor,
  state: z.enum(['approved', 'commented', 'changes']),
  patch_set: z.number().int(),
  carries_to_head: z.boolean(),
  body: z.string(),
  created_at: ts,
}))

export const Change = named('Change', obj({
  object: z.literal('change'),
  id: id('chg'),
  number: z.number().int(),
  url: z.string(),
  html_url: z.string(),
  repo: z.union([RepoRef, Repo]),
  title: z.string(),
  description: z.string(),
  state: z.enum(['draft', 'open', 'landed', 'abandoned']),
  author: Actor,
  base: z.string(),
  branch: z.string(),
  patch_set_count: z.number().int(),
  head: obj({ patch_set: z.number().int(), sha: z.string(), tree: z.string() }),
  stack: obj({
    id: id('stk'),
    position: z.number().int(),
    size: z.number().int(),
    parent: z.number().int().nullable(),
  }).nullable(),
  stats: obj({
    files: z.number().int(),
    additions: z.number().int(),
    deletions: z.number().int(),
  }),
  checks: obj({
    state: z.enum(['none', 'pending', 'pass', 'fail']),
    passed: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int(),
  }),
  policy: obj({
    state: z.enum(['met', 'blocked', 'pending', 'computing']),
    blocking: z.number().int(),
  }),
  reviewers: z.array(
    obj({
      actor: Actor,
      state: z.enum(['approved', 'commented', 'changes', 'pending']),
      patch_set: z.number().int().nullable(),
      carries_to_head: z.boolean(),
    }),
  ),
  mirrors: z.array(
    obj({
      host: z.string(),
      number: z.number().int(),
      origin: z.enum(['here', 'there']),
    }),
  ),
  labels: z.array(z.string()),
  evidence_count: z.number().int(),
  findings: z.array(Finding).nullable().describe('Only with expand=findings'),
  check_runs: z.array(CheckRun).nullable().describe('Only with expand=check_runs'),
  actions: obj({
    land: Action,
    abandon: Action,
    restore: Action,
    mark_ready: Action,
  })
    .nullable()
    .describe('What the caller may do now. Null in events and sync, which are not tied to a viewer.'),
  landed_at: ts.nullable(),
  created_at: ts,
  updated_at: ts,
  version: z.number().int(),
}))

export const PatchSet = named('PatchSet', obj({
  object: z.literal('patch_set'),
  number: z.number().int(),
  change: z.number().int(),
  sha: z.string(),
  tree: z.string(),
  note: z.string(),
  author: Actor,
  files: z.number().int(),
  url: z.string(),
  created_at: ts,
}))

export const PatchSetComparison = named('PatchSetComparison', obj({
  object: z.literal('patch_set_comparison'),
  change: z.number().int(),
  from: z.number().int(),
  to: z.number().int(),
  files: z.array(
    obj({
      path: z.string(),
      status: z.enum(['added', 'modified', 'removed']),
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
  ),
  unchanged_files: z.number().int(),
}))

export const PolicyEvaluation = named('PolicyEvaluation', obj({
  object: z.literal('policy_evaluation'),
  change: z.number().int(),
  tree: z.string(),
  state: z.enum(['met', 'blocked', 'pending']),
  requirements: z.array(Requirement),
  assumed: z.array(z.string()),
}))

export const Issue = named('Issue', obj({
  object: z.literal('issue'),
  id: id('iss'),
  number: z.number().int(),
  url: z.string(),
  html_url: z.string(),
  repo: RepoRef,
  title: z.string(),
  body: z.string(),
  state: z.enum(['open', 'closed']),
  author: Actor,
  labels: z.array(z.string()),
  closed_at: ts.nullable(),
  created_at: ts,
  updated_at: ts,
  version: z.number().int(),
}))

export const Operation = named('Operation', obj({
  object: z.literal('operation'),
  id: id('op'),
  kind: z.string(),
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  progress: obj({ done: z.number().int(), total: z.number().int() }).nullable(),
  result: obj({ object: z.string(), id: z.string(), url: z.string() }).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  url: z.string(),
  created_at: ts,
  finished_at: ts.nullable(),
}))

export const Event = named('Event', obj({
  object: z.literal('event'),
  id: id('evt'),
  sequence: z.number().int(),
  type: z.string(),
  created_at: ts,
  repo: z.string().nullable(),
  repo_id: z.string().nullable(),
  actor: Actor,
  subject: obj({
    object: z.string(),
    id: z.string(),
    number: z.number().int().nullable(),
  }),
  changes: z.array(z.string()),
  data: z.record(z.string(), z.unknown()).nullable(),
}))

export const Sync = named('Sync', obj({
  object: z.literal('sync'),
  cursor: z.string().describe('Send as cursor to get what changed after this'),
  objects: z.array(z.record(z.string(), z.unknown())),
  deleted: z.array(obj({ object: z.string(), id: z.string() })),
  has_more: z.boolean(),
  reset: z.boolean().describe('True when the cursor was too old; objects is a fresh snapshot'),
}))

export const Context = named('Context', obj({
  object: z.literal('context'),
  repo: Repo,
  changes: z.array(
    obj({
      number: z.number().int(),
      title: z.string(),
      state: z.string(),
      author: Actor,
      checks: z.string(),
      policy: z.string(),
      blocking: z.array(z.string()),
    }),
  ),
  issues: z.array(
    obj({
      number: z.number().int(),
      title: z.string(),
      labels: z.array(z.string()),
    }),
  ),
  policy: obj({ rules: z.number().int(), mode: z.string() }),
  env: z.array(obj({ name: z.string(), kind: z.string(), set: z.array(z.string()) })),
  cursor: z.string(),
}))

export const Principal = named('Principal', obj({
  object: z.literal('principal'),
  token: id('tok'),
  login: z.string(),
  acting_as: z.string(),
  class: z.enum(['human', 'agent', 'bot']),
  scopes: z.array(z.string()),
  repos: z.array(z.string()).nullable(),
  expires_at: ts,
  pools: z.array(
    obj({ name: z.string(), limit: z.number().int(), window_seconds: z.number().int() }),
  ),
}))

export const Problem = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  hint: z.string(),
  retryable: z.boolean(),
  exit_code: z.number().int(),
  request_id: z.string(),
  errors: z
    .array(obj({ pointer: z.string(), code: z.string(), message: z.string() }))
    .optional(),
})

export const listOf = <T extends z.ZodType>(item: T) =>
  obj({
    object: z.literal('list'),
    data: z.array(item),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  })

// ---------------------------------------------------------------------------
// Teams

export const Team = named('Team', obj({
  object: z.literal('team'),
  id: id('tem'),
  org: z.string().describe('Handle of the organization'),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  members: z.array(z.string()).describe('Handles'),
  repos: z.array(obj({ full_name: z.string(), permission: z.enum(['read', 'write']) })),
  url: z.string(),
  created_at: ts,
  updated_at: ts,
  version: z.number().int(),
}))

// ---------------------------------------------------------------------------
// Runs

export const Run = named('Run', obj({
  object: z.literal('run'),
  id: id('run'),
  repo: RepoRef,
  task: z.string(),
  state: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'expired']),
  actor: Actor,
  change: z.number().int().nullable().describe('The change this run works on, if any'),
  scopes: z.array(z.string()).describe('What the run token may do'),
  token: z
    .string()
    .nullable()
    .describe('The run token. Only in the response that starts the run, never again'),
  token_id: id('tok'),
  notes: z.array(obj({ at: ts, text: z.string() })),
  summary: z.string().nullable(),
  url: z.string(),
  started_at: ts,
  expires_at: ts,
  finished_at: ts.nullable(),
  version: z.number().int(),
}))

// ---------------------------------------------------------------------------
// Git data

const Person = obj({ name: z.string(), email: z.string() })

export const GitCommit = named('GitCommit', obj({
  object: z.literal('commit'),
  sha: z.string(),
  url: z.string(),
  parents: z.array(z.string()),
  message: z.string(),
  author: Person,
  committer: Person,
  date: ts,
}))

export const GitTree = named('GitTree', obj({
  object: z.literal('tree'),
  ref: z.string().describe('The commit the ref was resolved to'),
  path: z.string().describe('The directory listed. Empty for the root'),
  entries: z.array(
    obj({
      name: z.string(),
      path: z.string(),
      type: z.enum(['tree', 'blob']),
    }),
  ),
  has_more: z.boolean().describe('True when the directory has more than 2,000 entries and the list was cut'),
}))

export const GitBlob = named('GitBlob', obj({
  object: z.literal('blob'),
  path: z.string(),
  ref: z.string(),
  size: z.number().int(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
}))

export const GitCommitDiff = named('GitCommitDiff', obj({
  object: z.literal('commit_diff'),
  sha: z.string(),
  base_sha: z.string().nullable(),
  stats: obj({ files: z.number().int(), additions: z.number().int(), deletions: z.number().int() }),
  files: z.array(
    obj({
      path: z.string(),
      state: z.enum(['added', 'modified', 'deleted']),
      additions: z.number().int(),
      deletions: z.number().int(),
      patch: z.string().describe('Unified diff hunks. Cut at 64 KB; see `truncated`'),
      truncated: z.boolean(),
    }),
  ),
}))

/** Entries of `GET /v1`, `/v1/errors` and `/v1/limits`. */
export const Root = named('Root', obj({
  object: z.literal('api'),
  name: z.string(),
  version: z.string(),
  versions: z.array(z.string()),
  links: z.record(z.string(), z.string()),
}))

export const ErrorCatalog = named('ErrorCatalog', obj({
  object: z.literal('list'),
  data: z.array(
    obj({
      code: z.string(),
      status: z.number().int(),
      title: z.string(),
      retryable: z.boolean(),
      exit_code: z.number().int(),
      hint: z.string(),
    }),
  ),
  has_more: z.literal(false),
  next_cursor: z.null(),
}))

export const Limits = named('Limits', obj({
  object: z.literal('limits'),
  pools: z.array(
    obj({ name: z.string(), limit: z.number().int(), window_seconds: z.number().int() }),
  ),
  page: obj({ default: z.number().int(), max: z.number().int() }),
  concurrency: obj({ per_token_per_node: z.number().int() }),
  body_bytes: z.number().int(),
  batch_size: z.number().int(),
  wait_seconds: z.number().int(),
  idempotency_key_hours: z.number().int(),
}))

export const NumberRef = named('NumberRef', obj({
  object: z.literal('number_ref'),
  number: z.number().int(),
  type: z.enum(['change', 'issue']),
  url: z.string(),
}))

export const BatchResult = named('BatchResult', obj({
  object: z.literal('batch'),
  results: z.array(
    obj({
      id: z.string(),
      status: z.number().int(),
      headers: z.record(z.string(), z.string()),
      body: z.unknown(),
    }),
  ),
}))

export const Token = named(
  'Token',
  obj({
    object: z.literal('token'),
    id: id('tok'),
    name: z.string(),
    kind: z.enum(['personal', 'bot', 'run']),
    class: z.enum(['human', 'agent', 'bot']),
    scopes: z.array(z.string()),
    repos: z.array(z.string()).nullable(),
    prefix: z.string().describe('The first characters, to recognise a token by'),
    secret: z
      .string()
      .nullable()
      .describe('The token itself. Only in the response that creates it, never again'),
    url: z.string(),
    expires_at: ts,
    created_at: ts,
    last_used_at: ts.nullable(),
  }),
)

export const Authorization = named(
  'Authorization',
  obj({
    object: z.literal('authorization'),
    id: id('atz'),
    client: obj({ id: z.string(), name: z.string() }),
    scopes: z.array(z.string()),
    audience: z.array(z.enum(['api', 'mcp'])),
    url: z.string(),
    created_at: ts,
    last_used_at: ts.nullable(),
  }),
)

export const Webhook = named(
  'Webhook',
  obj({
    object: z.literal('webhook'),
    id: id('whk'),
    repo: z.string(),
    endpoint: z.string().describe('Where deliveries are sent'),
    description: z.string(),
    events: z.array(z.string()),
    active: z.boolean(),
    disabled_reason: z.string().nullable(),
    secret: z
      .string()
      .nullable()
      .describe('Signing secret. Only in the response that creates it or rotates it'),
    last_delivery: obj({ id: id('dlv'), state: z.enum(['pending', 'succeeded', 'failed']), at: ts }).nullable(),
    html_url: z.string(),
    url: z.string(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

const Attempt = obj({
  number: z.number().int(),
  at: ts,
  status: z.number().int().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int(),
})

export const Delivery = named(
  'Delivery',
  obj({
    object: z.literal('delivery'),
    id: id('dlv'),
    webhook: id('whk'),
    event: obj({ id: id('evt'), type: z.string(), sequence: z.number().int() }),
    state: z.enum(['pending', 'succeeded', 'failed']),
    attempt_count: z.number().int(),
    attempts: z.array(Attempt).nullable().describe('Only when you read one delivery'),
    payload: z.record(z.string(), z.unknown()).nullable().describe('Only when you read one delivery'),
    next_attempt_at: ts.nullable(),
    redelivery_of: id('dlv').nullable(),
    url: z.string(),
    created_at: ts,
  }),
)

export const SearchResult = named(
  'SearchResult',
  obj({
    object: z.literal('search_result'),
    type: z.enum(['change', 'issue', 'repo']),
    id: z.string(),
    number: z.number().int().nullable(),
    repo: z.string(),
    title: z.string(),
    state: z.string(),
    snippet: z.string().nullable().describe('Where the words match in the body, when not in the title'),
    score: z.number().int().describe('3 title has every word, 2 some, 1 body only'),
    url: z.string(),
    updated_at: ts,
  }),
)

export const Upload = named(
  'Upload',
  obj({
    object: z.literal('upload'),
    id: id('upl'),
    filename: z.string(),
    content_type: z.string(),
    size: z.number().int(),
    purpose: z.enum(['evidence']),
    state: z.enum(['pending', 'uploaded']),
    sha256: z.string().nullable(),
    upload_url: z.string().nullable().describe('PUT the file here. Needs no token. Once, for an hour'),
    content_url: z.string().nullable().describe('Where the file can be read, once it is uploaded'),
    expires_at: ts,
    url: z.string(),
    created_at: ts,
  }),
)

export const Evidence = named(
  'Evidence',
  obj({
    object: z.literal('evidence'),
    id: id('evd'),
    change: z.number().int(),
    kind: z.enum(['image', 'recording', 'preview', 'test_results']),
    caption: z.string(),
    upload: obj({
      id: id('upl'),
      content_type: z.string(),
      size: z.number().int(),
      sha256: z.string(),
      content_url: z.string(),
    }),
    created_by: Actor,
    created_at: ts,
  }),
)

export const Mirror = named(
  'Mirror',
  obj({
    object: z.literal('mirror'),
    id: id('mir'),
    host: z.string(),
    slug: z.string().describe('The repository on that host'),
    direction: z.enum(['push', 'pull', 'two-way']),
    state: z.enum(['in-sync', 'syncing', 'behind', 'failing']),
    detail: z.string().nullable(),
    last_sync_at: ts,
    url: z.string(),
    created_at: ts,
  }),
)

export const EnvVar = named(
  'EnvVar',
  obj({
    object: z.literal('env_var'),
    name: z.string(),
    kind: z.string(),
    secret: z.boolean(),
    description: z.string(),
    environments: z.array(z.enum(['development', 'preview', 'production'])).describe('Where a value is set'),
    set: z.boolean().nullable().describe('Whether a value is set in the environment asked for. Null when none was'),
  }),
)

export const Recipient = named(
  'Recipient',
  obj({ object: z.literal('recipient'), id: z.string(), kind: z.string() }),
)

export const Grant = named(
  'Grant',
  obj({
    object: z.literal('grant'),
    id: id('grt'),
    environment: z.enum(['development', 'preview', 'production']),
    state: z.enum(['pending', 'active', 'revoked', 'expired']),
    variables: z.array(z.string()).describe('Names only'),
    reason: z.string().nullable(),
    requested_by: z.string(),
    max_runs: z.number().int(),
    uses: z.number().int(),
    expires_at: ts.nullable().describe('Null until a person approves it'),
    url: z.string(),
    created_at: ts,
  }),
)

export const EnvValues = named(
  'EnvValues',
  obj({
    object: z.literal('env_values'),
    environment: z.enum(['development', 'preview', 'production']),
    values: z.record(z.string(), z.string()),
    secrets: z.array(z.string()).describe('Which of the names are secret, so a caller can scrub them from output'),
    grant: id('grt').nullable(),
  }),
)

export const AuditEntry = named(
  'AuditEntry',
  obj({ object: z.literal('audit_entry'), at: ts, who: z.string(), action: z.string() }),
)
