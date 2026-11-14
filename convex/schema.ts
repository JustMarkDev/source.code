import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Repositories belong to an account. An account is a person or an
 * organization, and both live in one namespace (`source.code/<handle>`), so a
 * name can never mean two things. A login is a person; a person can be a
 * member of any number of organizations and acts as one account at a time.
 */
export const role = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
)

export const actorClass = v.union(
  v.literal('human'),
  v.literal('agent'),
  v.literal('bot'),
)

/** Who did something, as events and records show it. */
export const actorRef = v.object({
  id: v.string(),
  handle: v.string(),
  class: actorClass,
})

export default defineSchema({
  accounts: defineTable({
    kind: v.union(v.literal('person'), v.literal('organization')),
    // The address in every URL. Generated for new accounts, changeable.
    handle: v.string(),
    // A person's full name, or an organization's name.
    name: v.string(),
    bio: v.string(),
    now: v.optional(v.string()),
    // How a person works with agents. Organizations have none.
    setup: v.optional(
      v.object({
        agents: v.array(v.string()),
        models: v.array(v.string()),
        tools: v.array(v.string()),
      }),
    ),
    // The sign-in user this person is (`auth.ts`). Organizations and the
    // seeded sample accounts have none.
    authId: v.optional(v.string()),
    // The public id (`acc_...`). Ours, never the database's own.
    publicId: v.string(),
    created: v.number(),
    updated: v.number(),
    // Rises when the name, the bio or the members change.
    version: v.number(),
    // Rises when who may see what changes in this account: members, teams,
    // a repository's visibility or collaborators. Versions of what the
    // account owns include it, so a cached answer cannot outlive access.
    aclRev: v.number(),
  })
    .index('by_handle', ['handle'])
    .index('by_authId', ['authId'])
    .index('by_publicId', ['publicId']),

  // Agents and bots, and a person acting as another class (a run token).
  // People and organizations are accounts; their actor id is the account's.
  actors: defineTable({
    // `handle`, or `handle~class` when the same handle acts as another class.
    key: v.string(),
    publicId: v.string(),
    handle: v.string(),
    class: actorClass,
  }).index('by_key', ['key']),

  // Who belongs to which organization, and what they may do there. An
  // organization always has at least one owner.
  memberships: defineTable({
    organizationId: v.id('accounts'),
    personId: v.id('accounts'),
    role,
  })
    .index('by_organizationId_and_personId', ['organizationId', 'personId'])
    .index('by_personId', ['personId']),

  // Invitations by email that were not accepted yet.
  invitations: defineTable({
    publicId: v.string(),
    organizationId: v.id('accounts'),
    email: v.string(),
    role,
    // Hash of the secret in the emailed link. The secret is never kept.
    secretHash: v.string(),
    invitedBy: v.string(),
    created: v.number(),
    expires: v.number(),
  })
    .index('by_organizationId_and_email', ['organizationId', 'email'])
    .index('by_organizationId_and_created', ['organizationId', 'created'])
    .index('by_secretHash', ['secretHash'])
    .index('by_publicId', ['publicId']),

  // Old addresses. A renamed account keeps answering at its old address by
  // redirecting, and nobody else can take the name.
  handleAliases: defineTable({
    handle: v.string(),
    accountId: v.id('accounts'),
  }).index('by_handle', ['handle']),

  repos: defineTable({
    publicId: v.string(),
    // The immutable git store key. A rename keeps it.
    storeId: v.string(),
    ownerId: v.id('accounts'),
    owner: v.string(),
    name: v.string(),
    // `owner/name` in lowercase, for lookups that ignore case.
    key: v.string(),
    description: v.string(),
    visibility: v.union(v.literal('public'), v.literal('private')),
    defaultBranch: v.string(),
    stars: v.number(),
    starsTodayBase: v.number(),
    forks: v.number(),
    upstream: v.union(
      v.null(),
      v.object({
        host: v.union(
          v.literal('github'),
          v.literal('gitlab'),
          v.literal('codeberg'),
          v.literal('gitea'),
        ),
        slug: v.string(),
      }),
    ),
    install: v.union(v.null(), v.string()),
    category: v.union(v.null(), v.string()),
    languages: v.array(v.array(v.union(v.string(), v.number()))),
    license: v.union(v.null(), v.string()),
    website: v.union(v.null(), v.string()),
    docsUrl: v.union(v.null(), v.string()),
    collaborators: v.array(v.string()),
    installs: v.array(v.string()),
    maintainers: v.array(v.string()),
    maintainerGrants: v.array(v.string()),
    env: v.array(
      v.object({
        name: v.string(),
        kind: v.string(),
        set: v.array(v.string()),
      }),
    ),
    // Sample data only: invent believable facts for commits no change landed.
    sampleFacts: v.optional(v.boolean()),
    // Whether agent runs may attach transcripts. Off when absent.
    transcripts: v.optional(v.union(v.literal('off'), v.literal('on'))),
    // The `Run-Id:` commit trailer: `auto` (private only) when absent.
    runTrailer: v.optional(
      v.union(v.literal('auto'), v.literal('on'), v.literal('off')),
    ),
    created: v.number(),
    updated: v.number(),
    version: v.number(),
    aclRev: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_ownerId_and_name', ['ownerId', 'name'])
    .index('by_publicId', ['publicId'])
    .index('by_storeId', ['storeId'])
    .index('by_owner_and_created_and_publicId', [
      'owner',
      'created',
      'publicId',
    ])
    .index('by_created_and_publicId', ['created', 'publicId'])
    .index('by_updated', ['updated']),

  // The busy numbers of a repository, apart from the repository itself, so
  // a new issue does not wake every page that only read the repository.
  // One small document per repository: every new change and issue writes it.
  repoCounters: defineTable({
    repoId: v.id('repos'),
    nextNumber: v.number(),
    // The repository's own event sequence: gapless, 1, 2, 3...
    seq: v.number(),
    // Bumped by every event, and per collection.
    rev: v.number(),
    changeRev: v.number(),
    issueRev: v.number(),
    labelRev: v.number(),
    policyRev: v.number(),
    openChanges: v.number(),
    openIssues: v.number(),
    // Pipeline runs: how many, the highest number, and a revision for lists.
    pipelines: v.optional(v.number()),
    pipelineNumber: v.optional(v.number()),
    pipelineRev: v.optional(v.number()),
    automationRev: v.optional(v.number()),
  }).index('by_repoId', ['repoId']),

  // A renamed or transferred repository keeps answering at its old address.
  repoAliases: defineTable({
    // Lowercase `owner/name`.
    from: v.string(),
    to: v.string(),
  })
    .index('by_from', ['from'])
    .index('by_to', ['to']),

  // A deleted repository's history stays readable by who administered it.
  deletedRepos: defineTable({
    publicId: v.string(),
    full: v.string(),
    // `full` in lowercase.
    key: v.string(),
    owner: v.string(),
    deleted: v.number(),
  })
    .index('by_publicId', ['publicId'])
    .index('by_full', ['full'])
    .index('by_key', ['key']),

  stars: defineTable({
    repoId: v.id('repos'),
    handle: v.string(),
    at: v.number(),
  })
    .index('by_repoId_and_handle', ['repoId', 'handle'])
    .index('by_repoId_and_at', ['repoId', 'at'])
    .index('by_handle', ['handle']),

  teams: defineTable({
    publicId: v.string(),
    organizationId: v.id('accounts'),
    org: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    created: v.number(),
    updated: v.number(),
    version: v.number(),
  })
    .index('by_org_and_slug', ['org', 'slug'])
    .index('by_organizationId', ['organizationId']),

  teamMembers: defineTable({
    teamId: v.id('teams'),
    handle: v.string(),
  })
    .index('by_teamId_and_handle', ['teamId', 'handle'])
    .index('by_handle', ['handle']),

  teamRepos: defineTable({
    teamId: v.id('teams'),
    repoId: v.id('repos'),
    level: v.union(v.literal('read'), v.literal('write')),
  })
    .index('by_teamId_and_repoId', ['teamId', 'repoId'])
    .index('by_repoId', ['repoId']),

  // Every write's one event. `seq` is the repository's own sequence;
  // account-level events have no repository and use their account's.
  forgeEvents: defineTable({
    // The repository's public id, or `~handle` for an account's own events.
    stream: v.string(),
    // Gapless within the stream: 1, 2, 3...
    seq: v.number(),
    type: v.string(),
    repo: v.union(v.null(), v.string()),
    repoId: v.union(v.null(), v.string()),
    created: v.number(),
    // The event as the API shows it, as JSON text (`EventRecord`).
    json: v.string(),
    // Its place in the whole feed, gapless. A write leaves it null and the
    // sequencer (`forge/events:sequence`) numbers events in the order it finds
    // them, so no two writes ever wait on one counter. Readers only see
    // events that have a number.
    sequence: v.union(v.null(), v.number()),
  })
    .index('by_stream_and_seq', ['stream', 'seq'])
    .index('by_sequence', ['sequence'])
    .index('by_created', ['created']),

  // State changes of changes and issues (opened, landed, closed...), by what
  // they happened to, so a timeline reads them without reading the feed.
  stateChanges: defineTable({
    repoId: v.id('repos'),
    // `change:216` or `issue:4`.
    subject: v.string(),
    to: v.string(),
    at: v.number(),
    eventId: v.string(),
    actor: actorRef,
  }).index('by_repoId_and_subject_and_at', ['repoId', 'subject', 'at']),

  // The issues a change names (`Fixes #4`, `Refs #4`), kept on every write
  // of the change, so an issue's timeline finds the changes that link it.
  issueRefs: defineTable({
    repoId: v.id('repos'),
    issue: v.number(),
    changeId: v.id('changes'),
    closes: v.boolean(),
  })
    .index('by_repoId_and_issue', ['repoId', 'issue'])
    .index('by_changeId', ['changeId']),

  // The feed's head: the last sequence handed out. Only the sequencer writes it.
  eventHead: defineTable({ head: v.number() }),

  // Rises whenever who may see what changes anywhere: rare writes (members,
  // teams, visibility), read by API servers so a cached answer never
  // outlives the access it was made under.
  accessRevision: defineTable({ rev: v.number() }),

  // ---- Issues ----------------------------------------------------------------

  labels: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    name: v.string(),
    // `name` in lowercase: a repository has one label per name, any case.
    key: v.string(),
    color: v.string(),
    description: v.string(),
    created: v.number(),
    // Open issues with this label, kept up to date on every issue write.
    openIssues: v.number(),
  }).index('by_repoId_and_key', ['repoId', 'key']),

  issues: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    number: v.number(),
    title: v.string(),
    body: v.string(),
    // Title and body, for the full-text search index.
    text: v.string(),
    state: v.union(v.literal('open'), v.literal('closed')),
    author: actorRef,
    labels: v.array(v.string()),
    assignees: v.array(actorRef),
    commentCount: v.number(),
    created: v.number(),
    updated: v.number(),
    closed: v.union(v.null(), v.number()),
    version: v.number(),
  })
    .index('by_repoId_and_number', ['repoId', 'number'])
    .index('by_repoId_and_state_and_number', ['repoId', 'state', 'number'])
    .index('by_repoId_and_title', ['repoId', 'title'])
    .index('by_publicId', ['publicId'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['repoId', 'state'],
    }),

  issueComments: defineTable({
    issueId: v.id('issues'),
    repoId: v.id('repos'),
    publicId: v.string(),
    author: actorRef,
    body: v.string(),
    created: v.number(),
    updated: v.number(),
    version: v.number(),
  })
    .index('by_issueId', ['issueId'])
    .index('by_repoId_and_publicId', ['repoId', 'publicId']),

  // Images and recordings shown on an issue. The bytes are an upload's.
  issueEvidence: defineTable({
    issueId: v.id('issues'),
    publicId: v.string(),
    kind: v.union(v.literal('image'), v.literal('recording')),
    caption: v.string(),
    upload: v.object({
      id: v.string(),
      contentType: v.string(),
      size: v.number(),
      sha256: v.string(),
    }),
    by: actorRef,
    created: v.number(),
  }).index('by_issueId', ['issueId']),

  // ---- Changes ---------------------------------------------------------------
  // A change is one aggregate: the change itself, and its parts (patch sets,
  // reviews, findings, checks, line comments, evidence) in `changeParts`. A
  // write loads the change and its parts, changes them, and writes back only
  // the parts that changed. A change has tens of parts, not thousands.

  changes: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    number: v.number(),
    title: v.string(),
    description: v.string(),
    // Title and description, for the full-text search index.
    text: v.string(),
    state: v.union(
      v.literal('draft'),
      v.literal('open'),
      v.literal('landed'),
      v.literal('abandoned'),
    ),
    author: actorRef,
    base: v.string(),
    branch: v.string(),
    stackId: v.union(v.null(), v.string()),
    labels: v.array(v.string()),
    mirrors: v.array(
      v.object({
        host: v.string(),
        number: v.number(),
        origin: v.union(v.literal('here'), v.literal('there')),
      }),
    ),
    // The touched files as they are on the base, as JSON text.
    baseFiles: v.optional(v.string()),
    commentRev: v.number(),
    // The newest patch set's commit, to find the change a commit landed through.
    headSha: v.string(),
    created: v.number(),
    updated: v.number(),
    landed: v.union(v.null(), v.number()),
    version: v.number(),
  })
    .index('by_repoId_and_number', ['repoId', 'number'])
    .index('by_repoId_and_headSha', ['repoId', 'headSha'])
    .index('by_repoId_and_updated_and_publicId', [
      'repoId',
      'updated',
      'publicId',
    ])
    .index('by_repoId_and_branch', ['repoId', 'branch'])
    .index('by_repoId_and_stackId', ['repoId', 'stackId'])
    .index('by_publicId', ['publicId'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['repoId', 'state'],
    }),

  changeParts: defineTable({
    changeId: v.id('changes'),
    kind: v.union(
      v.literal('patchSet'),
      v.literal('review'),
      v.literal('finding'),
      v.literal('check'),
      v.literal('comment'),
      v.literal('evidence'),
      v.literal('guide'),
    ),
    // The part's own id (a patch set's number), unique within its kind.
    key: v.string(),
    // Order within the kind: patch sets by number, the rest as they came.
    seq: v.number(),
    // The part as JSON text.
    json: v.string(),
  }).index('by_changeId_and_kind_and_seq', ['changeId', 'kind', 'seq']),

  // Which files of a change each reviewer has seen. A file counts as seen
  // only while its hash matches the file at the head patch set, so a new
  // patch set that touches it clears the mark. Personal state, no event.
  reviewSeen: defineTable({
    changeId: v.id('changes'),
    handle: v.string(),
    path: v.string(),
    patchSet: v.number(),
    contentHash: v.string(),
  }).index('by_changeId_and_handle_and_path', ['changeId', 'handle', 'path']),

  // The presence component's token for listing a room, kept so a reader
  // who has not sent a heartbeat yet can still see who is there. A room is
  // `change:<id>` or `issue:<id>`.
  presenceRooms: defineTable({
    room: v.string(),
    token: v.string(),
  }).index('by_room', ['room']),

  // A repository's policy settings: rule modes, its own rules, exceptions.
  repoPolicy: defineTable({
    repoId: v.id('repos'),
    ruleModes: v.array(v.object({ id: v.string(), mode: v.string() })),
    // JSON text of `CustomRuleRec[]` and `PolicyExceptionRec[]`.
    customRules: v.string(),
    exceptions: v.string(),
    // JSON text of the `landing:` section, when the file gave one.
    landing: v.optional(v.string()),
    // Once the rules live in .source/policy/main.yml: the file as last
    // landed, the commit it came from, and (JSON) why it did not read, if it
    // did not. The fields above are then the file's last valid rules.
    sourceSha: v.optional(v.string()),
    sourceText: v.optional(v.string()),
    errors: v.optional(v.string()),
  }).index('by_repoId', ['repoId']),

  // Long operations (landing a stack), watched with GET /operations/{id}.
  operations: defineTable({
    publicId: v.string(),
    kind: v.string(),
    repoId: v.string(),
    state: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('canceled'),
    ),
    done: v.number(),
    total: v.number(),
    result: v.union(
      v.null(),
      v.object({ object: v.string(), id: v.string(), url: v.string() }),
    ),
    // JSON text of the problem, when it failed.
    error: v.union(v.null(), v.string()),
    created: v.number(),
    finished: v.union(v.null(), v.number()),
    // A landing: JSON text of its plan (`LandingStepRec[]`), each step with
    // how it went, and the result it gives once every step succeeded.
    steps: v.optional(v.string()),
    pending: v.optional(
      v.object({ object: v.string(), id: v.string(), url: v.string() }),
    ),
  })
    .index('by_publicId', ['publicId'])
    .index('by_finished', ['finished']),

  // ---- Runs --------------------------------------------------------------------

  // An agent's run: a task, a short token limited to one repository, notes.
  runs: defineTable({
    publicId: v.string(),
    repoId: v.id('repos'),
    // `owner/name` when it started, shown if the repository is gone.
    repo: v.string(),
    task: v.string(),
    state: v.union(
      v.literal('running'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    handle: v.string(),
    change: v.union(v.null(), v.number()),
    scopes: v.array(v.string()),
    tokenId: v.string(),
    notes: v.array(v.object({ at: v.number(), text: v.string() })),
    summary: v.union(v.null(), v.string()),
    // Absent on runs from before these were kept; read as null and [].
    issue: v.optional(v.union(v.null(), v.number())),
    harness: v.optional(v.union(v.null(), v.string())),
    links: v.optional(v.array(v.string())),
    transcript: v.optional(
      v.union(
        v.null(),
        v.object({
          uploadId: v.string(),
          size: v.number(),
          sha256: v.string(),
          redactions: v.number(),
        }),
      ),
    ),
    started: v.number(),
    expires: v.number(),
    finished: v.union(v.null(), v.number()),
    version: v.number(),
  })
    .index('by_repoId_and_started_and_publicId', [
      'repoId',
      'started',
      'publicId',
    ])
    .index('by_publicId', ['publicId'])
    .index('by_tokenId', ['tokenId'])
    .index('by_handle_and_state', ['handle', 'state'])
    .index('by_state_and_expires', ['state', 'expires'])
    .index('by_finished', ['finished']),

  // The patch sets a run pushed, so a line of code leads back to the run
  // that wrote it, and a run lists what it produced.
  runPatchSets: defineTable({
    runId: v.id('runs'),
    changeId: v.id('changes'),
    patchSet: v.number(),
  })
    .index('by_runId', ['runId'])
    .index('by_changeId_and_patchSet', ['changeId', 'patchSet']),

  // ---- Pipelines ---------------------------------------------------------------
  // A pipeline run, its jobs and steps, as JSON text without the logs. Each
  // step's log is its own document, written once per report, never per line.

  pipelineRuns: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    number: v.number(),
    workflow: v.string(),
    status: v.string(),
    started: v.number(),
    // `PipelineRunRec` without step lines.
    json: v.string(),
  })
    .index('by_repoId_and_started', ['repoId', 'started'])
    .index('by_repoId_and_number', ['repoId', 'number'])
    .index('by_repoId_and_status_and_started', ['repoId', 'status', 'started'])
    .index('by_status_and_started', ['status', 'started']),

  pipelineLogs: defineTable({
    runId: v.id('pipelineRuns'),
    job: v.number(),
    step: v.number(),
    // `Array<{ t, level }>` as JSON text, the newest 5,000 lines.
    lines: v.string(),
    count: v.number(),
  }).index('by_runId_and_job_and_step', ['runId', 'job', 'step']),

  // ---- Bots and automations ------------------------------------------------------

  bots: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    // The account that owns it.
    owner: v.string(),
    class: v.union(v.literal('bot'), v.literal('agent')),
    scopes: v.array(v.string()),
    // Where it is installed, by repository id. A repository's own `installs`
    // is what access reads; this is what showing the bot reads.
    installs: v.array(v.id('repos')),
    created: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_owner', ['owner']),

  automations: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    name: v.string(),
    bot: v.string(),
    triggers: v.array(v.string()),
    runtime: v.string(),
    target: v.string(),
    instructions: v.string(),
    enabled: v.boolean(),
    triggered: v.number(),
    lastTriggered: v.union(v.null(), v.number()),
    lastRun: v.union(v.null(), v.string()),
    every: v.optional(v.string()),
    lastScheduled: v.optional(v.number()),
    // When its schedule fires next; null without one. The tick reads this.
    nextRun: v.union(v.null(), v.number()),
    created: v.number(),
    version: v.number(),
  })
    .index('by_repoId', ['repoId'])
    .index('by_publicId', ['publicId'])
    .index('by_nextRun', ['nextRun']),

  // ---- Releases ----------------------------------------------------------------

  releases: defineTable({
    repoId: v.id('repos'),
    publicId: v.string(),
    tag: v.string(),
    channel: v.string(),
    published: v.number(),
    // `ReleaseRec` as JSON text, with each asset's downloads as they were seeded.
    json: v.string(),
    version: v.number(),
  })
    .index('by_repoId_and_published', ['repoId', 'published'])
    .index('by_repoId_and_tag', ['repoId', 'tag']),

  // Downloads, counted on a few shards per file so a popular one is never
  // a document every download waits on.
  downloads: defineTable({
    releaseId: v.id('releases'),
    asset: v.string(),
    shard: v.number(),
    n: v.number(),
  }).index('by_releaseId_and_asset_and_shard', ['releaseId', 'asset', 'shard']),

  // ---- Integrations, linked accounts --------------------------------------------

  // A service connected to an account. A key is kept as a hash and a hint.
  connections: defineTable({
    account: v.string(),
    integration: v.string(),
    hint: v.union(v.null(), v.string()),
    keyHash: v.union(v.null(), v.string()),
    by: v.string(),
    connected: v.number(),
  }).index('by_account_and_integration', ['account', 'integration']),

  // Which connected services a repository uses.
  repoIntegrations: defineTable({
    repoId: v.id('repos'),
    integration: v.string(),
  }).index('by_repoId_and_integration', ['repoId', 'integration']),

  // Who someone says they are on another host. Unverified until sign-in with it is built.
  links: defineTable({
    handle: v.string(),
    host: v.string(),
    login: v.string(),
    instance: v.union(v.null(), v.string()),
    linked: v.number(),
  }).index('by_handle_and_host', ['handle', 'host']),

  // Rises with every connection and link write, for versions.
  integrationRev: defineTable({ account: v.string(), rev: v.number() }).index(
    'by_account',
    ['account'],
  ),

  // ---- People ------------------------------------------------------------------

  // What a person chose their profile shows. JSON text of `AccountPrefs`.
  accountPrefs: defineTable({ handle: v.string(), prefs: v.string() }).index(
    'by_handle',
    ['handle'],
  ),

  follows: defineTable({ who: v.string(), whom: v.string() })
    .index('by_who_and_whom', ['who', 'whom'])
    .index('by_whom_and_who', ['whom', 'who']),

  // Counts shown on profiles, kept on write rather than counted on read.
  peopleStats: defineTable({
    handle: v.string(),
    followers: v.number(),
    following: v.number(),
    // Rises with every contribution, for the profile's version.
    rev: v.number(),
  }).index('by_handle', ['handle']),

  // What a person did, recorded as it happens (from events), so a profile
  // reads one person's work instead of every repository.
  contributions: defineTable({
    handle: v.string(),
    kind: v.union(
      v.literal('review'),
      v.literal('change'),
      v.literal('issue'),
      v.literal('release'),
    ),
    at: v.number(),
    title: v.string(),
    repoId: v.id('repos'),
    // The work was an agent's, and this person approved it.
    agent: v.boolean(),
  }).index('by_handle_and_at', ['handle', 'at']),

  // Rises when the directory of people changes (preferences, follows).
  peopleRev: defineTable({ rev: v.number() }),

  // Downloads per repository per day, for the insights charts.
  downloadDays: defineTable({
    repoId: v.id('repos'),
    day: v.number(),
    n: v.number(),
  }).index('by_repoId_and_day', ['repoId', 'day']),

  // Who is assigned which open issue, so "assigned to you" is one lookup.
  issueAssignees: defineTable({
    handle: v.string(),
    issueId: v.id('issues'),
    repoId: v.id('repos'),
  })
    .index('by_handle', ['handle'])
    .index('by_issueId', ['issueId']),

  // Repositories a person or bot was given directly (collaborators, installs),
  // so finding them does not read every repository.
  repoGrants: defineTable({ handle: v.string(), repoId: v.id('repos') })
    .index('by_handle', ['handle'])
    .index('by_repoId_and_handle', ['repoId', 'handle']),

  // A repository's extras (mirrors, environment schema, sealed values,
  // recipients, grants, audit), as JSON text, with a version for saves.
  repoExtras: defineTable({
    repoId: v.id('repos'),
    json: v.string(),
    version: v.number(),
  }).index('by_repoId', ['repoId']),

  // An upload's record. Its bytes are in the bucket, under its id; never here.
  uploads: defineTable({
    publicId: v.string(),
    owner: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    purpose: v.union(
      v.literal('evidence'),
      v.literal('release'),
      v.literal('transcript'),
    ),
    state: v.union(v.literal('pending'), v.literal('uploaded')),
    sha256: v.union(v.null(), v.string()),
    expires: v.number(),
    created: v.number(),
    attachedTo: v.union(v.null(), v.string()),
    attachedRepoId: v.union(v.null(), v.string()),
  })
    .index('by_publicId', ['publicId'])
    .index('by_owner_and_state', ['owner', 'state'])
    .index('by_attachedRepoId', ['attachedRepoId'])
    .index('by_state_and_expires', ['state', 'expires']),

  // ---- Webhooks -----------------------------------------------------------------

  webhooks: defineTable({
    publicId: v.string(),
    repoId: v.id('repos'),
    url: v.string(),
    description: v.string(),
    events: v.array(v.string()),
    active: v.boolean(),
    disabledReason: v.union(v.null(), v.string()),
    // Signing secrets: the newest, and an older one for a day after a rotation.
    secrets: v.array(
      v.object({
        value: v.string(),
        createdAt: v.number(),
        expiresAt: v.union(v.null(), v.number()),
      }),
    ),
    failures: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.number(),
    lastDelivery: v.union(v.null(), v.string()),
    // The next delivery's place in this webhook's list.
    nextSequence: v.number(),
  })
    .index('by_publicId', ['publicId'])
    .index('by_repoId', ['repoId']),

  // One event to send to one webhook, and every attempt at it. An API server
  // claims due ones (`claimedUntil`), sends them, and reports how it went.
  webhookDeliveries: defineTable({
    publicId: v.string(),
    hookId: v.id('webhooks'),
    sequence: v.number(),
    // The event as JSON text.
    event: v.string(),
    state: v.union(
      v.literal('pending'),
      v.literal('succeeded'),
      v.literal('failed'),
    ),
    attempts: v.array(
      v.object({
        number: v.number(),
        at: v.number(),
        status: v.union(v.null(), v.number()),
        error: v.union(v.null(), v.string()),
        ms: v.number(),
      }),
    ),
    nextAt: v.union(v.null(), v.number()),
    claimedUntil: v.number(),
    redeliveryOf: v.union(v.null(), v.string()),
    createdAt: v.number(),
  })
    .index('by_publicId', ['publicId'])
    .index('by_hookId_and_sequence', ['hookId', 'sequence'])
    .index('by_state_and_nextAt', ['state', 'nextAt']),

  // Pushes code.storage told us about. The same webhook can arrive twice; a
  // push is recorded once, by repository, ref and the commit it moved to.
  pushes: defineTable({
    storeId: v.string(),
    ref: v.string(),
    before: v.string(),
    after: v.string(),
    pushedAt: v.number(),
  }).index('by_storeId_and_ref_and_after', ['storeId', 'ref', 'after']),

  // ---- Notifications -----------------------------------------------------------

  notifications: defineTable({
    handle: v.string(),
    publicId: v.string(),
    kind: v.string(),
    title: v.string(),
    // The repository it is about, by id, so a rename moves it along; or null.
    repoId: v.union(v.null(), v.string()),
    // `owner/name` when it was made, an account-level place, or null.
    repo: v.union(v.null(), v.string()),
    // Where it leads: after `/<owner>/<name>` when it is about a repository.
    path: v.string(),
    unread: v.boolean(),
    created: v.number(),
  })
    .index('by_handle_and_created', ['handle', 'created'])
    .index('by_handle_and_unread', ['handle', 'unread'])
    .index('by_publicId', ['publicId']),

  // One per person: their inbox's revision and size, and what they want to hear about.
  inboxes: defineTable({
    handle: v.string(),
    rev: v.number(),
    count: v.number(),
    prefs: v.union(v.null(), v.record(v.string(), v.boolean())),
  }).index('by_handle', ['handle']),

  // ---- Tokens ---------------------------------------------------------------
  // Only the hash of a secret is kept. The API checks a bearer token here,
  // then calls the forge functions with a short JWT of its own.

  tokens: defineTable({
    publicId: v.string(),
    hash: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal('personal'),
      v.literal('bot'),
      v.literal('run'),
      v.literal('oauth'),
    ),
    handle: v.string(),
    actingAs: v.string(),
    class: actorClass,
    scopes: v.array(v.string()),
    repos: v.union(v.null(), v.array(v.string())),
    audience: v.array(v.union(v.literal('api'), v.literal('mcp'))),
    prefix: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.union(v.null(), v.number()),
    revokedAt: v.union(v.null(), v.number()),
    authorizationId: v.optional(v.string()),
    limitKey: v.optional(v.string()),
  })
    .index('by_hash', ['hash'])
    .index('by_publicId', ['publicId'])
    .index('by_handle_and_createdAt', ['handle', 'createdAt'])
    .index('by_authorizationId', ['authorizationId'])
    .index('by_expiresAt', ['expiresAt']),

  authorizations: defineTable({
    publicId: v.string(),
    clientId: v.string(),
    clientName: v.string(),
    handle: v.string(),
    scopes: v.array(v.string()),
    audience: v.array(v.union(v.literal('api'), v.literal('mcp'))),
    createdAt: v.number(),
    lastUsedAt: v.union(v.null(), v.number()),
    revokedAt: v.union(v.null(), v.number()),
  })
    .index('by_publicId', ['publicId'])
    .index('by_handle_and_createdAt', ['handle', 'createdAt']),

  // What the OAuth server remembers between requests: clients, sign-ins
  // waiting for consent, codes, refresh tokens and device codes.
  oauthState: defineTable({
    kind: v.string(),
    key: v.string(),
    // JSON text.
    value: v.string(),
    expires: v.union(v.null(), v.number()),
  })
    .index('by_kind_and_key', ['kind', 'key'])
    .index('by_expires', ['expires']),

  // Mail waiting to be sent. A write that sends mail adds it here in the same
  // transaction, and `mail.send` delivers it, so mail goes out only for
  // writes that committed.
  outbox: defineTable({
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    created: v.number(),
  }),

  // ---- Shared state of the HTTP API (packages/api) --------------------------
  // Everything below is read and written by the API servers through
  // `apiStores.ts`, never by a browser. It is what lets many API nodes agree.

  // One row per rate-limit key: the window it is in and the units already
  // handed out. A node leases a block of units at a time, so this row is written
  // once per block and not once per request.
  apiLimits: defineTable({
    key: v.string(),
    start: v.number(),
    used: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_start', ['start']),

  // A POST with an Idempotency-Key runs once. The row holds the key, a hash of
  // the request, and (when it finishes) the response to replay.
  // What the status page adds up (`forge/health.ts`).
  healthMinutes: defineTable({
    area: v.string(),
    minute: v.number(),
    requests: v.number(),
    errors: v.number(),
    hist: v.array(v.number()),
  })
    .index('by_area_and_minute', ['area', 'minute'])
    .index('by_minute', ['minute']),
  healthDays: defineTable({
    area: v.string(),
    day: v.number(),
    requests: v.number(),
    errors: v.number(),
  })
    .index('by_area_and_day', ['area', 'day'])
    .index('by_day', ['day']),
  statusCounts: defineTable({
    accounts: v.number(),
    repositories: v.number(),
    changes: v.number(),
    issues: v.number(),
    /** When the last pass finished; 0 before the first. */
    at: v.number(),
    /** A pass under way. */
    pass: v.optional(
      v.object({
        table: v.number(),
        cursor: v.union(v.string(), v.null()),
        counts: v.object({
          accounts: v.number(),
          repositories: v.number(),
          changes: v.number(),
          issues: v.number(),
        }),
        moved: v.number(),
      }),
    ),
  }),

  apiIdempotency: defineTable({
    scope: v.string(),
    key: v.string(),
    fingerprint: v.string(),
    expires: v.number(),
    /** When the request that holds the key began. */
    started: v.optional(v.number()),
    /**
     * When a write made under the key committed, set in that write's own
     * transaction. A key with an effect never runs again.
     */
    effect: v.optional(v.number()),
    response: v.optional(
      v.object({ status: v.number(), headers: v.string(), body: v.string() }),
    ),
  })
    .index('by_scope_and_key', ['scope', 'key'])
    .index('by_expires', ['expires']),
})
