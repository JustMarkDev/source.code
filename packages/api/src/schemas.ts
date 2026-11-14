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

export const Actor = named(
  'Actor',
  obj({
    object: z.literal('actor'),
    id: id('acc'),
    handle: z.string(),
    class: z.enum(['human', 'agent', 'bot']),
  }),
)

export const RepoRef = named(
  'RepoRef',
  obj({
    object: z.literal('repo'),
    id: id('rep'),
    full_name: z.string(),
    url: z.string(),
  }),
)

export const Account = named(
  'Account',
  obj({
    object: z.literal('account'),
    id: id('acc'),
    handle: z.string(),
    name: z.string(),
    kind: z.enum(['person', 'organization']),
    bio: z.string().describe('A short description, shown on the profile'),
    role: z
      .enum(['owner', 'admin', 'member'])
      .nullable()
      .describe('What you are in this account. `owner` on your own.'),
    url: z.string(),
    html_url: z.string(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const Member = named(
  'Member',
  obj({
    object: z.literal('member'),
    account: z.string().describe('Handle of the organization'),
    handle: z.string().describe('Handle of the person'),
    name: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    url: z.string(),
  }),
)

/** Where Discover lists a repository. */
export const repoCategories = [
  'Developer tools',
  'Apps',
  'Infrastructure',
  'Databases',
] as const

export const Repo = named(
  'Repo',
  obj({
    object: z.literal('repo'),
    id: id('rep'),
    owner: z.string(),
    name: z.string(),
    full_name: z.string(),
    description: z.string(),
    visibility: z.enum(['public', 'private']),
    default_branch: z.string(),
    stars: z.number().int(),
    stars_today: z.number().int().describe('Stars in the last 24 hours'),
    forks: z.number().int(),
    upstream: obj({
      host: z.enum(['github', 'gitlab', 'codeberg', 'gitea']),
      slug: z.string().describe('`owner/name` there'),
    })
      .nullable()
      .describe(
        'Where the code is developed when this repository mirrors it. Null when it lives here',
      ),
    install: z
      .string()
      .nullable()
      .describe('One command that installs the project, set by its owners'),
    category: z
      .enum(repoCategories)
      .nullable()
      .describe('Where Discover lists it. Set by its owners'),
    language: z
      .string()
      .nullable()
      .describe('The language most of the code is in'),
    languages: z
      .array(obj({ name: z.string(), percent: z.number() }))
      .describe(
        'Share of the code by language, largest first. Read from the default branch',
      ),
    license: z
      .string()
      .nullable()
      .describe('SPDX id of the licence file, when it is a known licence'),
    website: z.string().nullable().describe("The project's own site"),
    docs_url: z.string().nullable().describe("The project's documentation"),
    maintainers: z
      .array(z.string())
      .describe(
        'People who can approve core-path changes. A maintainer also has repository write access: adding one grants it, and removing one revokes the write access that maintainer list granted unless the person has another grant.',
      ),
    transcripts: z
      .enum(['off', 'on'])
      .describe(
        'Whether agent runs may attach their transcripts. Off unless an owner turns it on',
      ),
    run_trailer: z
      .enum(['auto', 'on', 'off'])
      .describe(
        'Whether commits keep a `Run-Id:` trailer naming the run that made them. `auto` keeps it in private repositories and removes it in public ones',
      ),
    open_changes: z.number().int(),
    open_issues: z.number().int(),
    url: z.string(),
    html_url: z.string(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const Invitation = named(
  'Invitation',
  obj({
    object: z.literal('invitation'),
    id: id('inv'),
    account: z.string().describe('Handle of the organization'),
    email: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    invited_by: z.string().describe('Handle of who sent it'),
    created_at: ts,
    expires_at: ts,
    url: z.string(),
  }),
)

export const Star = named(
  'Star',
  obj({
    object: z.literal('star'),
    repo: z.string().describe('`owner/name`'),
    starred: z.boolean().describe('Whether you starred it'),
    stars: z.number().int().describe('How many people did'),
  }),
)

export const Contributor = named(
  'Contributor',
  obj({
    object: z.literal('contributor'),
    name: z.string(),
    email: z.string(),
    commits: z.number().int(),
    last_commit_at: ts,
  }),
)

const Action = obj({ allowed: z.boolean(), reasons: z.array(z.string()) })

export const Requirement = named(
  'Requirement',
  obj({
    id: z.string(),
    rule: z.string(),
    state: z.enum(['pass', 'fail', 'pending', 'na']),
    detail: z.string(),
    needs: z.record(z.string(), z.unknown()).nullable(),
    blocking: z.array(z.string()),
  }),
)

export const Suggestion = named(
  'Suggestion',
  obj({
    summary: z.string(),
    file: z.string(),
    replace: z
      .array(z.string())
      .describe(
        'The lines to replace, exactly as they are. Found by their text, not a line number, so a suggestion still applies after the lines above it move. Empty for an insertion',
      ),
    after: z
      .string()
      .nullable()
      .describe('The line an insertion follows, when `replace` is empty'),
    lines: z.array(z.string()).describe('The new lines. Empty to delete'),
  }),
)

const testResult = z.enum(['pass', 'fail', 'skip'])
export const TestCase = named(
  'TestCase',
  obj({
    suite: z.string(),
    name: z.string(),
    ms: z.number().int(),
    base: z
      .union([testResult, z.literal('missing')])
      .describe(
        'The same test on the base. `fail` there and `pass` here is a fix shown working',
      ),
    head: testResult,
  }),
)

export const Finding = named(
  'Finding',
  obj({
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
    suggestion: Suggestion.nullable().describe(
      'A change the reviewer proposes, to apply in one step',
    ),
    prompt: z
      .string()
      .nullable()
      .describe('The same fix as instructions for an agent'),
    run: id('run')
      .nullable()
      .describe('The agent run that made it; null when no run did'),
    created_at: ts,
  }),
)

export const CheckRun = named(
  'CheckRun',
  obj({
    object: z.literal('check_run'),
    id: id('chk'),
    key: z.string(),
    name: z.string(),
    state: z.enum(['pending', 'pass', 'fail']),
    tree: z.string(),
    details_url: z.string().nullable(),
    cases: z
      .array(TestCase)
      .nullable()
      .describe('Test results case by case, when the check sent them'),
    created_at: ts,
    updated_at: ts,
  }),
)

export const Review = named(
  'Review',
  obj({
    object: z.literal('review'),
    id: id('rev'),
    actor: Actor,
    state: z.enum(['approved', 'commented', 'changes']),
    patch_set: z.number().int(),
    carries_to_head: z.boolean(),
    body: z.string(),
    run: id('run')
      .nullable()
      .describe('The agent run that made it; null when no run did'),
    created_at: ts,
  }),
)

export const Change = named(
  'Change',
  obj({
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
    head: obj({
      patch_set: z.number().int(),
      sha: z.string(),
      tree: z.string(),
    }),
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
    check_runs: z
      .array(CheckRun)
      .nullable()
      .describe('Only with expand=check_runs'),
    actions: obj({
      land: Action,
      abandon: Action,
      restore: Action,
      mark_ready: Action,
    })
      .nullable()
      .describe(
        'What the caller may do now. Null in events and sync, which are not tied to a viewer.',
      ),
    landed_at: ts.nullable(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const PatchSet = named(
  'PatchSet',
  obj({
    object: z.literal('patch_set'),
    number: z.number().int(),
    change: z.number().int(),
    sha: z.string(),
    tree: z.string(),
    note: z.string(),
    author: Actor,
    files: z.number().int(),
    url: z.string(),
    run: id('run')
      .nullable()
      .describe('The agent run that made it; null when no run did'),
    created_at: ts,
  }),
)

export const PatchSetFiles = named(
  'PatchSetFiles',
  obj({
    object: z.literal('patch_set_files'),
    change: z.number().int(),
    patch_set: z.number().int(),
    available: z
      .boolean()
      .describe(
        'False when the change came without its files; `files` is then empty',
      ),
    files: z.array(
      obj({
        path: z.string(),
        base: z
          .string()
          .nullable()
          .describe('On the base. Null when the file is new'),
        content: z
          .string()
          .nullable()
          .describe('At this patch set. Null when it is deleted'),
      }),
    ),
  }),
)

export const PatchSetComparison = named(
  'PatchSetComparison',
  obj({
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
  }),
)

export const PolicyEvaluation = named(
  'PolicyEvaluation',
  obj({
    object: z.literal('policy_evaluation'),
    change: z.number().int(),
    tree: z.string(),
    state: z.enum(['met', 'blocked', 'pending']),
    requirements: z.array(Requirement),
    assumed: z.array(z.string()),
  }),
)

export const Issue = named(
  'Issue',
  obj({
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
    assignees: z
      .array(Actor)
      .describe('Who is working on it. Set with `assignees` on update'),
    comments: z.number().int().describe('How many comments it has'),
    closed_at: ts.nullable(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const labelColors = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
] as const

export const Label = named(
  'Label',
  obj({
    object: z.literal('label'),
    id: id('lbl'),
    name: z.string(),
    color: z.enum(labelColors),
    description: z.string(),
    issues: z.number().int().describe('Open issues that carry it'),
    created_at: ts,
  }),
)

export const IssueComment = named(
  'IssueComment',
  obj({
    object: z.literal('issue_comment'),
    id: id('cmt'),
    issue: z.number().int(),
    author: Actor,
    body: z.string(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const ChangeComment = named(
  'ChangeComment',
  obj({
    object: z.literal('change_comment'),
    id: id('cmt'),
    change: z.number().int(),
    author: Actor,
    body: z.string(),
    file: z
      .string()
      .nullable()
      .describe('The file it is on; null for the whole change'),
    line: z
      .number()
      .int()
      .nullable()
      .describe(
        'The line in that file at `patch_set`; null for the whole file',
      ),
    patch_set: z.number().int().describe('The patch set it was written on'),
    reply_to: z
      .string()
      .nullable()
      .describe('The comment that starts its thread; null when it starts one'),
    resolved: z
      .boolean()
      .describe('For the comment that starts a thread: whether it is settled'),
    anchor: obj({
      quote: z.string().describe('The text the comment is about'),
      before: z.array(z.string()).describe('Up to three lines above it'),
      after: z.array(z.string()).describe('Up to three lines below it'),
      side: z.enum(['head', 'base']),
    })
      .nullable()
      .describe(
        "What a comment on a line is about, so it follows the code into newer patch sets. A reply has its thread's",
      ),
    current_line: z
      .number()
      .int()
      .nullable()
      .describe(
        'Where its thread is in the newest patch set; null when it is not on a line or its code is gone',
      ),
    outdated: z
      .boolean()
      .describe(
        'Its code is gone from the newest patch set. `line` and `patch_set` still say where it was written',
      ),
    addressed: obj({
      patch_set: z.number().int().describe('The patch set that answers it'),
      by: Actor,
      note: z.string(),
      at: ts,
    })
      .nullable()
      .describe(
        'On the comment that starts a thread: the fix that answers it. Addressed is not resolved; someone still settles the thread',
      ),
    run: id('run')
      .nullable()
      .describe('The agent run that made it; null when no run did'),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

export const ReleaseAsset = named(
  'ReleaseAsset',
  obj({
    name: z.string(),
    platform: z.enum(['macos', 'windows', 'linux']),
    arch: z.string().describe('Such as arm64 or x64'),
    size: z.number().int().describe('Bytes'),
    downloads: z.number().int(),
    sha256: z.string(),
    content_url: z
      .string()
      .nullable()
      .describe('Where the file is served, when it was uploaded here'),
  }),
)

export const Release = named(
  'Release',
  obj({
    object: z.literal('release'),
    id: id('rel'),
    tag: z.string().describe('Its version, such as v2.4.1'),
    url: z.string(),
    html_url: z.string(),
    channel: z
      .enum(['stable', 'beta', 'nightly'])
      .describe('Who it is for. People are offered stable unless they opt in'),
    title: z.string(),
    notes: obj({
      added: z.array(z.string()),
      changed: z.array(z.string()),
      fixed: z.array(z.string()),
    }),
    signed: z.boolean().describe('Every asset is signed'),
    commit: z
      .string()
      .nullable()
      .describe('The commit a beta or nightly was built from'),
    withdrawn: obj({ reason: z.string(), at: ts })
      .nullable()
      .describe('Pulled, and why. It stays listed so its page can say so'),
    assets: z.array(ReleaseAsset),
    downloads: z.number().int().describe('Every asset, added up'),
    author: Actor,
    published_at: ts,
    version: z.number().int(),
  }),
)

export const PipelineJob = named(
  'PipelineJob',
  obj({
    object: z.literal('pipeline_job'),
    run: z.number().int().describe('The run number'),
    job: z.number().int().describe('The job, counted from 1'),
    name: z.string(),
    workflow: z.string(),
    file: z.string().describe('The workflow file to read at `sha`'),
    branch: z.string(),
    sha: z.string(),
    steps: z.array(obj({ number: z.number().int(), name: z.string() })),
    url: z.string(),
  }),
)

export const Download = named(
  'Download',
  obj({
    object: z.literal('download'),
    release: z.string(),
    asset: z.string(),
    sha256: z.string().describe('Check the file against this'),
    url: z.string().describe('Where the file is'),
    downloads: z.number().int().describe('This asset, counting this one'),
    content_url: z
      .string()
      .nullable()
      .describe(
        'The file itself, when it was uploaded here; null when it is kept elsewhere',
      ),
  }),
)

const pipelineStatus = z.enum([
  'queued',
  'running',
  'success',
  'failure',
  'canceled',
])
const stepStatus = z.enum([
  'queued',
  'running',
  'success',
  'failure',
  'canceled',
  'skipped',
])

export const PipelineRun = named(
  'PipelineRun',
  obj({
    object: z.literal('pipeline_run'),
    id: id('pip'),
    number: z.number().int(),
    url: z.string(),
    html_url: z.string(),
    workflow: z.string(),
    file: z.string().describe('The workflow file it ran'),
    title: z.string(),
    branch: z.string(),
    sha: z.string(),
    status: pipelineStatus,
    trigger: z.enum(['push', 'change', 'tag', 'schedule', 'manual']),
    actor: z.string().describe('Handle of who or what started it'),
    started_at: ts,
    finished_at: ts.nullable(),
    duration_ms: z.number().int().nullable(),
    jobs: z
      .array(
        obj({
          name: z.string(),
          runner: z.string(),
          status: stepStatus,
          duration_ms: z.number().int(),
          steps: z.array(
            obj({
              name: z.string(),
              status: stepStatus,
              duration_ms: z.number().int(),
              lines: z.number().int().describe('Lines in its log'),
              log_url: z.string(),
            }),
          ),
        }),
      )
      .nullable()
      .describe('Only on one run, not in a list'),
    annotations: z
      .array(
        obj({
          level: z.enum(['error', 'warn']),
          text: z.string(),
          job: z.string(),
          step: z.string(),
        }),
      )
      .describe('What to look at first'),
    version: z.number().int(),
  }),
)

export const PipelineLog = named(
  'PipelineLog',
  obj({
    object: z.literal('pipeline_log'),
    run: z.number().int(),
    job: z.string(),
    step: z.string(),
    status: stepStatus,
    lines: z.array(
      obj({
        text: z.string(),
        level: z.enum(['cmd', 'info', 'dim', 'ok', 'warn', 'error']).nullable(),
      }),
    ),
  }),
)

export const PolicyException = named(
  'PolicyException',
  obj({
    object: z.literal('policy_exception'),
    id: id('pex'),
    rule: z.string(),
    who: z.string().describe('The person the rule bends for'),
    reason: z.string(),
    created_by: z.string(),
    created_at: ts,
    expires_at: ts,
  }),
)

export const Landing = named(
  'Landing',
  obj({
    strategy: z.enum(['squash', 'rebase', 'merge']),
    fresh_approvals: z
      .boolean()
      .describe(
        'Approvals count only on the newest patch set, not carried over a rebase',
      ),
    resolve: z
      .enum(['author', 'any_reviewer'])
      .describe('Who may settle a review thread'),
    steps: z
      .array(z.record(z.string(), z.unknown()))
      .describe(
        '`{wait_checks: [...]}`, `{run_pipeline: name}` or `{webhook: url}`, in order',
      ),
  }),
)

export const PolicySet = named(
  'PolicySet',
  obj({
    object: z.literal('policy_set'),
    repo: z.string(),
    file: z.string(),
    yaml: z.string().describe('The rules as the policy file says them'),
    rules: z.array(
      obj({
        id: z.string(),
        name: z.string(),
        mode: z
          .enum(['enforce', 'dry-run', 'off'])
          .describe('`dry-run` reports what it would block and blocks nothing'),
        when: z.string(),
        requires: z.array(z.string()),
        evaluated: z.number().int().describe('Changes it applied to'),
        blocked: z
          .number()
          .int()
          .describe('Of those, how many it held back, or would have'),
        custom: z
          .boolean()
          .describe(
            'Written by the repository, not built in; it can be deleted',
          ),
        would_block: z
          .array(
            obj({
              change: z.number().int(),
              title: z.string(),
              why: z.string(),
            }),
          )
          .describe('For a rule in dry run: the changes it would block now'),
      }),
    ),
    exceptions: z.array(PolicyException).describe('Live ones only'),
    large_change_lines: z.number().int(),
    version: z.number().int(),
    source: obj({
      state: z
        .enum(['settings', 'file', 'errors'])
        .describe(
          '`settings` until the rules move into the file; `file` once they live there; `errors` when the file that landed last does not read, and the last valid rules stay in force',
        ),
      sha: z
        .string()
        .nullable()
        .describe('The commit the rules were read from'),
      errors: z.array(
        obj({
          path: z.string().describe('Where in the file, like `rules[2].mode`'),
          line: z.number().int().nullable(),
          message: z.string(),
        }),
      ),
      pending: z
        .array(
          obj({
            change: z.number().int(),
            title: z.string(),
            author: z.string(),
            url: z.string(),
          }),
        )
        .describe('Open changes that edit the policy file'),
    }).describe('Where the rules come from'),
    landing: Landing,
  }),
)

export const PolicyProposal = named(
  'PolicyProposal',
  obj({
    object: z.literal('policy_proposal'),
    change: z
      .number()
      .int()
      .nullable()
      .describe('The change that carries the edit; null for a dry run'),
    url: z.string().nullable(),
    patch_set: z.number().int().nullable(),
    created: z
      .boolean()
      .describe(
        'True when a new change was opened; false when the edit went on your open policy change as a patch set',
      ),
    edits: z.array(z.record(z.string(), z.unknown())),
    diff: z
      .string()
      .describe('What this edit does to the file, as a unified diff'),
  }),
)

export const Landability = named(
  'Landability',
  obj({
    object: z.literal('landability'),
    change: z.number().int(),
    patch_set: z.number().int(),
    tree: z.string().describe('Send it as `expected_tree` to land'),
    landable: z.boolean(),
    blockers: z
      .array(Requirement)
      .describe(
        'What stops it now: failed or pending requirements, and landing steps it waits on',
      ),
    requirements: z.array(Requirement),
    landing: Landing,
  }),
)

export const IntegrationConnection = named(
  'IntegrationConnection',
  obj({
    object: z.literal('integration_connection'),
    integration: z.string().describe('Such as coderabbit or t3code'),
    account: z.string(),
    key_hint: z
      .string()
      .nullable()
      .describe('The last four characters of its key, when it uses one'),
    connected_by: z.string(),
    connected_at: ts,
  }),
)

export const RepoIntegration = named(
  'RepoIntegration',
  obj({
    object: z.literal('repo_integration'),
    integration: z.string(),
    enabled: z.boolean(),
  }),
)

export const Bot = named(
  'Bot',
  obj({
    object: z.literal('bot'),
    slug: z.string().describe('Its handle, what it acts as'),
    name: z.string(),
    description: z.string(),
    owner: z.string().describe('The account that owns it'),
    class: z.enum(['bot', 'agent']),
    scopes: z.array(z.string()).describe('What its tokens may do'),
    installs: z
      .array(z.string())
      .describe('Repositories it is installed on, and so may act in'),
    tokens: z.number().int().describe('Live tokens'),
    created_at: ts,
  }),
)

export const BotToken = named(
  'BotToken',
  obj({
    object: z.literal('bot_token'),
    id: id('tok'),
    bot: z.string(),
    token: z.string().describe('Shown once, never again'),
    scopes: z.array(z.string()),
    repos: z.array(z.string()).describe('Limited to where it is installed now'),
    expires_at: ts,
  }),
)

export const automationTriggers = [
  'issue.created',
  'change.opened',
  'change.updated',
  'finding.raised',
  'ci.failed',
  'bot.mentioned',
  'repository.pushed',
  'schedule',
] as const

export const Automation = named(
  'Automation',
  obj({
    object: z.literal('automation'),
    id: id('aut'),
    name: z.string(),
    bot: z.string().describe('The bot it wakes'),
    triggers: z.array(z.enum(automationTriggers)),
    runtime: z.string().describe('Such as Claude Code or Codex'),
    target: z.string().describe('Where it runs, such as T3 Code or E2B'),
    instructions: z.string(),
    enabled: z.boolean(),
    triggered: z
      .number()
      .int()
      .describe('Times an event it listens for happened'),
    last_triggered_at: ts.nullable(),
    created_at: ts,
    version: z.number().int(),
    last_run: z
      .string()
      .nullable()
      .describe(
        'The run the last trigger started; its bot picks it up with runs.claim',
      ),
    every: z
      .enum(['hour', 'day', 'week'])
      .nullable()
      .describe('How often the `schedule` trigger fires; null without it'),
    next_run_at: ts
      .nullable()
      .describe('When the schedule fires next; null without one'),
  }),
)

const hostEnum = z.enum(['github', 'gitlab', 'codeberg', 'gitea'])

export const LinkedAccount = named(
  'LinkedAccount',
  obj({
    object: z.literal('linked_account'),
    account: z.string(),
    host: hostEnum,
    login: z.string().describe('Who they are on that host'),
    instance: z.string().nullable().describe('For a self-hosted Gitea'),
    verified: z
      .boolean()
      .describe(
        'Whether the host confirmed it. Always false until signing in with each host is built',
      ),
    linked_at: ts,
  }),
)

export const Import = named(
  'Import',
  obj({
    object: z.literal('import'),
    repo: z.string().describe('The repository here'),
    host: hostEnum,
    slug: z.string().describe('Where it came from on that host'),
    state: z.enum(['in-sync', 'syncing', 'behind', 'failing']),
    created_at: ts,
  }),
)

const downloadsShape = obj({
  total: z.number().int().describe('Every download, ever'),
  daily: z
    .array(z.number().int())
    .describe(
      'The last 30 days, oldest first. Counted from when counting began',
    ),
  change: z
    .number()
    .int()
    .nullable()
    .describe('Percent against the 30 days before, when there were any'),
})

export const RepoInsights = named(
  'RepoInsights',
  obj({
    object: z.literal('repo_insights'),
    repo: z.string(),
    commits: obj({
      total: z.number().int().describe('In the newest 1,000'),
      by_week: z
        .array(z.number().int())
        .describe('The last 26 weeks, oldest first'),
      by_class: obj({
        human: z.number().int(),
        agent: z.number().int(),
        bot: z.number().int(),
      }),
    }),
    contributors: z.number().int(),
    downloads: downloadsShape,
    stars: obj({ total: z.number().int(), today: z.number().int() }),
    issues: obj({ open: z.number().int(), closed: z.number().int() }),
    changes: obj({
      open: z.number().int(),
      landed: z.number().int(),
      abandoned: z.number().int(),
    }),
  }),
)

export const Dashboard = named(
  'Dashboard',
  obj({
    object: z.literal('dashboard'),
    account: z
      .string()
      .describe('The account it is for: you, or the one you act as'),
    empty: z.boolean().describe('No repositories yet'),
    needs_you: z.array(
      obj({
        severity: z.enum(['stopped', 'failing', 'review', 'assigned']),
        title: z.string(),
        repo: z.string(),
        note: z.string(),
        at: ts,
        action: z.string(),
        path: z.string().describe('Where it is in the web app'),
      }),
    ),
    in_progress: z.array(
      obj({
        kind: z.enum(['agent', 'change']),
        title: z.string(),
        repo: z.string(),
        status: z.string(),
        detail: z.string(),
        path: z.string(),
      }),
    ),
    activity: z.array(
      obj({
        who: z.string(),
        class: z.enum(['human', 'agent', 'bot']),
        type: z.string().describe('The event type'),
        repo: z.string().nullable(),
        subject: z.number().int().nullable(),
        at: ts,
      }),
    ),
    repos: z.array(
      obj({
        repo: z.string(),
        checks: z.enum(['passing', 'failing']),
        open_changes: z.number().int(),
        open_issues: z.number().int(),
        updated_at: ts,
      }),
    ),
    mirrors: z.array(
      obj({
        host: z.string(),
        state: z.enum(['synced', 'stopped']),
        repos: z.number().int(),
      }),
    ),
    storage: obj({
      used_bytes: z.number().int().describe('Release files'),
      limit_bytes: z.number().int(),
    }),
    imported: z
      .number()
      .int()
      .describe('Repositories brought from another host'),
    downloads: downloadsShape,
    contributions: obj({
      daily: z.array(z.number().int()).describe('The last 28 days'),
      total: z.number().int(),
      change: z.number().int().nullable(),
      commits: z.number().int(),
      reviews: z.number().int(),
      changes: z.number().int(),
    }),
    stars: obj({ total: z.number().int(), today: z.number().int() }),
  }),
)

export const notificationKinds = [
  'review',
  'mention',
  'release',
  'ci',
  'issue',
  'import',
] as const

export const Notification = named(
  'Notification',
  obj({
    object: z.literal('notification'),
    id: id('ntf'),
    kind: z
      .enum(notificationKinds)
      .describe(
        '`review`: your change was reviewed or landed. `mention`: someone wrote @you. `release`: a project you starred released. `ci`: checks failed on your change. `issue`: you were assigned. `import`: an import finished',
      ),
    title: z.string(),
    repo: z
      .string()
      .nullable()
      .describe(
        '`owner/name`, or a place in your account such as "Linked accounts"',
      ),
    html_url: z.string(),
    unread: z.boolean(),
    created_at: ts,
  }),
)

export const NotificationCount = named(
  'NotificationCount',
  obj({
    object: z.literal('notification_count'),
    unread: z.number().int(),
  }),
)

export const AccountPreferences = named(
  'AccountPreferences',
  obj({
    object: z.literal('account_preferences'),
    combined_total: z
      .boolean()
      .describe('Show one contribution total that includes linked accounts'),
    private_totals: z
      .boolean()
      .describe(
        'Count work in private repositories in the totals; a number only, never what or where',
      ),
    show_activity: z
      .boolean()
      .describe('Show recent activity and the daily graph on the profile'),
    show_agents: z
      .boolean()
      .describe('Show the share of reviewed work an agent wrote'),
    searchable: z
      .boolean()
      .describe('Listed in the people directory and found by name in search'),
    download_target: obj({
      os: z.enum(['macos', 'windows', 'linux']),
      arch: z.enum(['arm64', 'x64']),
    })
      .nullable()
      .describe(
        'The machine download buttons pick a file for; null to detect it',
      ),
  }),
)

export const AccountRef = named(
  'AccountRef',
  obj({
    object: z.literal('account_ref'),
    handle: z.string(),
    name: z.string(),
    kind: z.enum(['person', 'organization']),
    html_url: z.string(),
  }),
)

export const PersonEntry = named(
  'Person',
  obj({
    object: z.literal('person'),
    handle: z.string(),
    name: z.string(),
    bio: z.string(),
    followers: z.number().int(),
    repositories: z.number().int().describe('Public repositories they own'),
    stars: z.number().int().describe('Stars on those repositories'),
    languages: z
      .array(z.string())
      .describe('Their main languages, up to three'),
    html_url: z.string(),
    viewer_follows: z
      .boolean()
      .nullable()
      .describe('Whether you follow them; null when signed out or yourself'),
  }),
)

const contributionKinds = [
  'push',
  'review',
  'change',
  'issue',
  'release',
] as const

export const Profile = named(
  'Profile',
  obj({
    object: z.literal('profile'),
    handle: z.string(),
    name: z.string(),
    kind: z.enum(['person', 'organization']),
    bio: z.string(),
    followers: z.number().int(),
    following: z.number().int(),
    viewer_follows: z
      .boolean()
      .nullable()
      .describe('Whether you follow them; null when signed out or your own'),
    contributions: obj({
      total: z
        .number()
        .int()
        .describe(
          'Commits, reviews, changes, issues and releases in the past year',
        ),
      private: z
        .number()
        .int()
        .describe('Of the total, how many are in repositories you cannot see'),
      by_month: z.array(obj({ month: z.string(), count: z.number().int() })),
      by_day: z
        .array(z.number().int())
        .describe(
          'The past 26 weeks, oldest first; empty if they hide activity',
        ),
      by_weekday: z.array(
        obj({
          day: z.string(),
          commits: z.number().int(),
          reviews: z.number().int(),
        }),
      ),
    }),
    work: z
      .array(obj({ axis: z.string(), value: z.number().int() }))
      .describe('Share of their work by kind, in percent'),
    languages: z.array(obj({ name: z.string(), percent: z.number().int() })),
    repositories: z.number().int(),
    releases: z.number().int(),
    downloads: z.number().int(),
    agent_share: z
      .number()
      .int()
      .nullable()
      .describe(
        'Of the changes they reviewed, the share an agent wrote; null if they hide it or reviewed none',
      ),
    activity: z.array(
      obj({
        kind: z.enum(contributionKinds),
        title: z.string(),
        repo: z.string(),
        at: ts,
      }),
    ),
    activity_hidden: z.boolean(),
  }),
)

export const NotificationPreferences = named(
  'NotificationPreferences',
  obj({
    object: z.literal('notification_preferences'),
    review: z.boolean(),
    mention: z.boolean(),
    release: z.boolean(),
    ci: z.boolean(),
    issue: z.boolean(),
    import: z.boolean(),
    digest: z
      .boolean()
      .describe('One email a week with what changed. Kept; not sent yet'),
  }),
)

export const Operation = named(
  'Operation',
  obj({
    object: z.literal('operation'),
    id: id('op'),
    kind: z.string(),
    state: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
    progress: obj({
      done: z.number().int(),
      total: z.number().int(),
    }).nullable(),
    result: obj({
      object: z.string(),
      id: z.string(),
      url: z.string(),
    }).nullable(),
    error: z.record(z.string(), z.unknown()).nullable(),
    url: z.string(),
    created_at: ts,
    finished_at: ts.nullable(),
    steps: z
      .array(
        obj({
          name: z.string(),
          kind: z.enum(['land', 'run_pipeline', 'webhook']),
          target: z
            .string()
            .describe("The change number, the pipeline's workflow, or the URL"),
          state: z.enum([
            'pending',
            'running',
            'succeeded',
            'failed',
            'skipped',
          ]),
          detail: z.string(),
          finished_at: ts.nullable(),
        }),
      )
      .describe(
        "For a landing: each change it lands, then the policy file's landing steps, with how each went. Empty for other operations",
      ),
  }),
)

export const Event = named(
  'Event',
  obj({
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
  }),
)

export const Sync = named(
  'Sync',
  obj({
    object: z.literal('sync'),
    cursor: z
      .string()
      .describe('Send as cursor to get what changed after this'),
    objects: z.array(z.record(z.string(), z.unknown())),
    deleted: z.array(obj({ object: z.string(), id: z.string() })),
    has_more: z.boolean(),
    reset: z
      .boolean()
      .describe(
        'True when the cursor was too old or ahead of this log; objects is a fresh snapshot',
      ),
  }),
)

export const Context = named(
  'Context',
  obj({
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
    env: z.array(
      obj({ name: z.string(), kind: z.string(), set: z.array(z.string()) }),
    ),
    cursor: z.string(),
  }),
)

export const Principal = named(
  'Principal',
  obj({
    object: z.literal('principal'),
    token: id('tok'),
    login: z.string(),
    acting_as: z.string(),
    class: z.enum(['human', 'agent', 'bot']),
    scopes: z.array(z.string()),
    repos: z.array(z.string()).nullable(),
    expires_at: ts,
    pools: z.array(
      obj({
        name: z.string(),
        limit: z.number().int(),
        window_seconds: z.number().int(),
      }),
    ),
  }),
)

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

export const Team = named(
  'Team',
  obj({
    object: z.literal('team'),
    id: id('tem'),
    org: z.string().describe('Handle of the organization'),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    members: z.array(z.string()).describe('Handles'),
    repos: z.array(
      obj({ full_name: z.string(), permission: z.enum(['read', 'write']) }),
    ),
    url: z.string(),
    created_at: ts,
    updated_at: ts,
    version: z.number().int(),
  }),
)

// ---------------------------------------------------------------------------
// Runs

export const Run = named(
  'Run',
  obj({
    object: z.literal('run'),
    id: id('run'),
    repo: RepoRef,
    task: z.string(),
    state: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'expired']),
    actor: Actor,
    change: z
      .number()
      .int()
      .nullable()
      .describe('The change this run works on, if any'),
    scopes: z.array(z.string()).describe('What the run token may do'),
    token: z
      .string()
      .nullable()
      .describe(
        'The run token. Only in the response that starts the run, never again',
      ),
    token_id: id('tok'),
    notes: z.array(obj({ at: ts, text: z.string() })),
    summary: z.string().nullable(),
    issue: z
      .number()
      .int()
      .nullable()
      .describe('The issue this run works on, if any'),
    harness: z
      .string()
      .nullable()
      .describe('What drove the agent, such as claude-code, delta or sx'),
    links: z
      .array(z.string())
      .describe(
        'Conversations about this run elsewhere, such as a Delta thread',
      ),
    transcript: obj({
      size: z.number().int().describe('Bytes, after masking'),
      sha256: z.string(),
      redactions: z
        .number()
        .int()
        .describe('How many secrets were masked when it was attached'),
      url: z.string().describe('Read it here, with the runs:transcripts scope'),
    })
      .nullable()
      .describe('What the agent saw and said, when the repository keeps it'),
    patch_sets: z
      .array(obj({ change: z.number().int(), patch_set: z.number().int() }))
      .describe('The patch sets this run pushed, oldest first'),
    url: z.string(),
    started_at: ts,
    expires_at: ts,
    finished_at: ts.nullable(),
    version: z.number().int(),
  }),
)

export const RunTranscript = named(
  'RunTranscript',
  obj({
    object: z.literal('run_transcript'),
    run: id('run'),
    content_type: z.enum(['text/plain', 'application/json']),
    size: z.number().int().describe('Bytes'),
    sha256: z.string(),
    redactions: z
      .number()
      .int()
      .describe('How many secrets were masked when it was attached'),
    content: z.string().describe('The transcript, secrets masked'),
  }),
)

// ---------------------------------------------------------------------------
// Git data

const Person = obj({ name: z.string(), email: z.string() })

export const GitCommit = named(
  'GitCommit',
  obj({
    object: z.literal('commit'),
    sha: z.string(),
    url: z.string(),
    parents: z.array(z.string()),
    message: z.string(),
    author: Person,
    committer: Person,
    date: ts,
    actor: Actor.nullable().describe(
      "The account behind the author, when the author's email is one of ours (`<handle>@users.source.code`)",
    ),
    change: z
      .number()
      .int()
      .nullable()
      .describe('The change this commit landed through, when it did'),
    checks: z
      .enum(['pass', 'fail'])
      .nullable()
      .describe('Whether the checks on it passed, when any ran'),
  }),
)

export const Provenance = named(
  'Provenance',
  obj({
    object: z.literal('provenance'),
    path: z.string(),
    line: z.number().int(),
    ref: z
      .string()
      .describe('The commit the line was read at, or the change it is in'),
    commit: obj({
      sha: z.string(),
      message: z.string(),
      author: Person,
      date: ts,
    })
      .nullable()
      .describe('The commit that last wrote the line; null inside a change'),
    change: obj({
      number: z.number().int(),
      title: z.string(),
      state: z.enum(['draft', 'open', 'landed', 'abandoned']),
      url: z.string(),
      html_url: z.string(),
    })
      .nullable()
      .describe('The change it came through; null when none of ours did'),
    patch_set: z
      .number()
      .int()
      .nullable()
      .describe('The patch set of that change that wrote the line'),
    run: Run.nullable().describe(
      'The agent run that pushed that patch set, with its task, summary, links and transcript',
    ),
  }),
)

export const GitTree = named(
  'GitTree',
  obj({
    object: z.literal('tree'),
    ref: z.string().describe('The commit the ref was resolved to'),
    path: z.string().describe('The directory listed. Empty for the root'),
    entries: z.array(
      obj({
        name: z.string(),
        path: z.string(),
        type: z.enum(['tree', 'blob']),
        last_commit: obj({ sha: z.string(), message: z.string(), date: ts })
          .nullable()
          .describe(
            'The newest commit that touched it. Null unless asked for with `last_commit=true`, or when it is older than the newest 200 commits',
          ),
      }),
    ),
    has_more: z
      .boolean()
      .describe(
        'True when the directory has more than 2,000 entries and the list was cut',
      ),
  }),
)

export const GitBlob = named(
  'GitBlob',
  obj({
    object: z.literal('blob'),
    path: z.string(),
    ref: z.string(),
    size: z.number().int(),
    encoding: z.enum(['utf-8', 'base64']),
    content: z.string(),
  }),
)

export const GitCommitDiff = named(
  'GitCommitDiff',
  obj({
    object: z.literal('commit_diff'),
    sha: z.string(),
    base_sha: z.string().nullable(),
    stats: obj({
      files: z.number().int(),
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
    files: z.array(
      obj({
        path: z.string(),
        state: z.enum(['added', 'modified', 'deleted']),
        additions: z.number().int(),
        deletions: z.number().int(),
        patch: z
          .string()
          .describe('Unified diff hunks. Cut at 64 KB; see `truncated`'),
        truncated: z.boolean(),
      }),
    ),
  }),
)

/** Entries of `GET /v1`, `/v1/errors` and `/v1/limits`. */
export const Root = named(
  'Root',
  obj({
    object: z.literal('api'),
    name: z.string(),
    version: z.string(),
    versions: z.array(z.string()),
    links: z.record(z.string(), z.string()),
  }),
)

export const ErrorCatalog = named(
  'ErrorCatalog',
  obj({
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
  }),
)

export const Limits = named(
  'Limits',
  obj({
    object: z.literal('limits'),
    pools: z.array(
      obj({
        name: z.string(),
        limit: z.number().int(),
        window_seconds: z.number().int(),
      }),
    ),
    page: obj({ default: z.number().int(), max: z.number().int() }),
    concurrency: obj({ per_token_per_node: z.number().int() }),
    body_bytes: z.number().int(),
    batch_size: z.number().int(),
    wait_seconds: z.number().int(),
    idempotency_key_hours: z.number().int(),
  }),
)

export const NumberRef = named(
  'NumberRef',
  obj({
    object: z.literal('number_ref'),
    number: z.number().int(),
    type: z.enum(['change', 'issue']),
    url: z.string(),
  }),
)

export const BatchResult = named(
  'BatchResult',
  obj({
    object: z.literal('batch'),
    results: z.array(
      obj({
        id: z.string(),
        status: z.number().int(),
        headers: z.record(z.string(), z.string()),
        body: z.unknown(),
      }),
    ),
  }),
)

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
    prefix: z
      .string()
      .describe('The first characters, to recognise a token by'),
    secret: z
      .string()
      .nullable()
      .describe(
        'The token itself. Only in the response that creates it, never again',
      ),
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
      .describe(
        'Signing secret. Only in the response that creates it or rotates it',
      ),
    last_delivery: obj({
      id: id('dlv'),
      state: z.enum(['pending', 'succeeded', 'failed']),
      at: ts,
    }).nullable(),
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
    attempts: z
      .array(Attempt)
      .nullable()
      .describe('Only when you read one delivery'),
    payload: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Only when you read one delivery'),
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
    snippet: z
      .string()
      .nullable()
      .describe('Where the words match in the body, when not in the title'),
    score: z
      .number()
      .int()
      .describe('3 title has every word, 2 some, 1 body only'),
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
    purpose: z.enum(['evidence', 'release', 'transcript']),
    state: z.enum(['pending', 'uploaded']),
    sha256: z.string().nullable(),
    upload_url: z
      .string()
      .nullable()
      .describe('PUT the file here. Needs no token. Once, for an hour'),
    content_url: z
      .string()
      .nullable()
      .describe('Where the file can be read, once it is uploaded'),
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

export const IssueEvidence = named(
  'IssueEvidence',
  obj({
    object: z.literal('issue_evidence'),
    id: id('evd'),
    issue: z.number().int(),
    kind: z.enum(['image', 'recording']),
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

const statusState = z.enum(['up', 'degraded', 'down'])
export const Status = named(
  'Status',
  obj({
    object: z.literal('status'),
    state: statusState.describe('The worst of the services'),
    since: ts.describe('When this server started measuring'),
    services: z.array(
      obj({
        id: z.string(),
        name: z.string(),
        note: z.string(),
        state: statusState,
        detail: z
          .string()
          .nullable()
          .describe('What is wrong, when something is'),
        uptime: z
          .number()
          .nullable()
          .describe(
            'Percent of requests answered without a server error, over 90 days',
          ),
        requests: z.number().int(),
        errors: z.number().int().describe('Requests that failed on our side'),
        p50_ms: z
          .number()
          .int()
          .nullable()
          .describe('Median time to answer, last hour'),
        p95_ms: z
          .number()
          .int()
          .nullable()
          .describe('95th percentile, last hour'),
        days: z.array(
          obj({
            date: z.string(),
            requests: z.number().int(),
            errors: z.number().int(),
          }),
        ),
      }),
    ),
    incidents: z.array(
      obj({
        service: z.string(),
        date: z.string(),
        title: z.string(),
        state: z.enum(['open', 'resolved']),
        detail: z.string(),
      }),
    ),
    counts: obj({
      accounts: z.number().int(),
      repositories: z.number().int(),
      changes: z.number().int(),
      issues: z.number().int(),
    }),
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
    paused: z
      .boolean()
      .describe('Paused: nothing is sent or fetched until it is resumed'),
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
    environments: z
      .array(z.enum(['development', 'preview', 'production']))
      .describe('Where a value is set'),
    set: z
      .boolean()
      .nullable()
      .describe(
        'Whether a value is set in the environment asked for. Null when none was',
      ),
    required: z
      .array(z.enum(['development', 'preview', 'production']))
      .describe('Environments that must have a value'),
    rotated_at: ts.nullable().describe('When a value was last set'),
    rotated_by: z.string().nullable(),
  }),
)

export const Recipient = named(
  'Recipient',
  obj({
    object: z.literal('recipient'),
    id: z.string(),
    kind: z.string(),
    name: z.string().nullable(),
    fingerprint: z.string().nullable().describe("The public key's short form"),
    environments: z.array(z.enum(['development', 'preview', 'production'])),
    added_at: ts.nullable(),
    last_used_at: ts.nullable(),
  }),
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
    secrets: z
      .array(z.string())
      .describe(
        'Which of the names are secret, so a caller can scrub them from output',
      ),
    grant: id('grt').nullable(),
  }),
)

export const AuditEntry = named(
  'AuditEntry',
  obj({
    object: z.literal('audit_entry'),
    at: ts,
    who: z.string(),
    action: z.string(),
    target: z.string().nullable(),
    kind: z.enum(['rotate', 'grant', 'revoke', 'read', 'reject']).nullable(),
  }),
)

// ---------------------------------------------------------------------------
// Timelines

export const timelineKinds = [
  'patch_set',
  'comment',
  'review',
  'finding',
  'check',
  'guide',
  'evidence',
  'run_note',
  'state_change',
  'reference',
] as const

export const RunNote = named(
  'RunNote',
  obj({
    object: z.literal('run_note'),
    run: id('run'),
    task: z.string(),
    text: z.string(),
    final: z
      .boolean()
      .describe("The run's summary, said when it ended, rather than a note"),
  }),
)

export const StateChange = named(
  'StateChange',
  obj({
    object: z.literal('state_change'),
    from: z.string().nullable().describe('Null when it was opened'),
    to: z.string(),
  }),
)

export const Reference = named(
  'Reference',
  obj({
    object: z.literal('reference'),
    change: z.number().int(),
    title: z.string(),
    state: z.enum(['draft', 'open', 'landed', 'abandoned']),
    closes: z
      .boolean()
      .describe('It says it fixes the issue (Fixes, Closes or Resolves #n)'),
    url: z.string(),
  }),
)

export const ChangeGuide = named(
  'ChangeGuide',
  obj({
    object: z.literal('change_guide'),
    change: z.number().int(),
    patch_set: z.number().int().describe('The patch set it was written for'),
    current: z.boolean().describe('It was written for the newest patch set'),
    summary: z.string().describe('What the change does, for a reviewer'),
    order: z
      .array(
        obj({
          path: z.string(),
          why: z.string().describe('Why to read it, and what to look for'),
          risk: z.enum(['low', 'medium', 'high']),
        }),
      )
      .describe('The files in the order to read them'),
    by: Actor,
    run: id('run').nullable().describe('The agent run that wrote it, if any'),
    created_at: ts,
  }),
)

export const TimelineEntry = named(
  'TimelineEntry',
  obj({
    object: z.literal('timeline_entry'),
    id: z.string().describe('Stable: the kind and the id of what it shows'),
    kind: z.enum(timelineKinds),
    created_at: ts,
    actor: Actor.nullable(),
    run: id('run')
      .nullable()
      .describe('The agent run that made it; null when no run did'),
    summary: z.string().describe('One line, for reading the story at a glance'),
    item: z
      .union([
        PatchSet,
        ChangeComment,
        Review,
        Finding,
        CheckRun,
        IssueComment,
        Evidence,
        IssueEvidence,
        ChangeGuide,
        RunNote,
        StateChange,
        Reference,
      ])
      .describe('What happened, as its own object'),
  }),
)

export const ChangeSeen = named(
  'ChangeSeen',
  obj({
    object: z.literal('change_seen'),
    change: z.number().int(),
    patch_set: z.number().int().describe('The newest patch set'),
    seen: z.number().int().describe('Files you have seen as they are now'),
    total: z.number().int().describe('Files the change touches'),
    files: z.array(
      obj({
        path: z.string(),
        seen: z
          .boolean()
          .describe('You marked it seen and it has not changed since'),
        patch_set: z
          .number()
          .int()
          .nullable()
          .describe('The patch set you marked it seen on; null if never'),
        changed_since: z
          .boolean()
          .describe('You saw it, then a newer patch set changed it'),
      }),
    ),
  }),
)

export const Presence = named(
  'Presence',
  obj({
    object: z.literal('presence'),
    kind: z.enum(['change', 'issue']),
    number: z.number().int(),
    interval: z
      .number()
      .int()
      .describe(
        'Seconds between heartbeats. A viewer who sends none for two and a half intervals is gone',
      ),
    viewers: z
      .array(
        obj({
          actor: Actor,
          path: z
            .string()
            .nullable()
            .describe('The file they have open; null on the overview'),
          seen_at: z.string().describe('Their last heartbeat'),
        }),
      )
      .describe('People and agents looking at it now, agents marked by class'),
  }),
)
