import { seededId } from '../ids'
import { EventLog } from '../events'
import type { AuthStore } from '../auth'
import type { ExtrasStore } from '../extras'
import type { UploadService } from '../uploads'
import {
  Sorted,
  changeNumber,
  changeUpdated,
  issueNumber,
  recId,
} from './records'
import type {
  AccountRec,
  ActorClass,
  ActorRec,
  Attached,
  ChangeRec,
  IssueRec,
  LabelColor,
  LabelRec,
  OperationRec,
  RepoRec,
  Role,
  RunRec,
  TeamRec,
  Urls,
} from './records'

/** Records, indexes and seeding: the data every other layer reads and writes. */
export abstract class DomainState {
  readonly events: EventLog

  readonly accounts = new Map<string, AccountRec>()

  readonly actors = new Map<string, ActorRec>()

  readonly repos = new Map<string, RepoRec>()

  protected readonly reposById = new Map<string, RepoRec>()

  readonly aliases = new Map<string, string>()

  /** Teams by `org/slug`, and the teams each person is in. */
  readonly teams = new Map<string, TeamRec>()

  /** Runs by id, and each repository's runs oldest first. */
  readonly runs = new Map<string, RunRec>()

  protected readonly runsByRepo = new Map<string, Array<RunRec>>()

  readonly teamsOf = new Map<string, Set<string>>()

  readonly operations = new Map<string, OperationRec>()

  /** Bumped by every ACL change, so cached bodies and ETags cannot outlive access. */
  accessRevision = 0

  /** Delay between steps of a long operation. Tests set it to 0. */
  stepDelayMs = 5

  /** Attached by whoever assembles the API: tokens, webhooks, search, blobs. */
  svc = {} as Attached

  /** The memory domain always runs on the memory token store, which answers at once. */
  /** The memory domain keeps extras in memory too, and reads them at once. */
  protected get memExtras(): ExtrasStore {
    return this.svc.extras as ExtrasStore
  }

  protected get memUploads(): UploadService {
    return this.svc.uploads as UploadService
  }

  protected get memAuth(): AuthStore {
    return this.svc.auth as AuthStore
  }

  constructor(
    readonly urls: Urls,
    protected readonly now: () => number = Date.now,
    events?: EventLog,
  ) {
    this.events = events ?? new EventLog(now)
  }

  seedActor(handle: string, cls: ActorClass, at = this.now()): ActorRec {
    const found = this.actors.get(handle)
    if (found) return found
    const rec = { id: seededId('account', at, handle), handle, class: cls }
    this.actors.set(handle, rec)
    return rec
  }

  seedAccount(
    handle: string,
    name: string,
    kind: AccountRec['kind'],
    members: Array<[string, Role]> = [],
    at = this.now(),
  ) {
    const actor = this.seedActor(handle, 'human', at)
    const rec: AccountRec = {
      id: actor.id,
      handle,
      name,
      kind,
      bio: '',
      created: at,
      updated: at,
      version: 1,
      members: new Map(members),
      invites: new Map(),
    }
    this.accounts.set(handle, rec)
    return rec
  }

  seedRepo(
    owner: string,
    name: string,
    init: Partial<
      Pick<
        RepoRec,
        | 'id'
        | 'storeId'
        | 'description'
        | 'visibility'
        | 'stars'
        | 'created'
        | 'env'
        | 'forks'
        | 'category'
        | 'languages'
        | 'license'
        | 'website'
        | 'docsUrl'
        | 'upstream'
        | 'install'
        | 'starsTodayBase'
        | 'sampleCommitFacts'
      >
    > & {
      collaborators?: Array<string>
      installs?: Array<string>
      maintainers?: Array<string>
      maintainerGrants?: Array<string>
    } = {},
  ): RepoRec {
    const rec = this.makeRepo(owner, name, init)
    this.repos.set(`${owner}/${name}`, rec)
    this.reposById.set(rec.id, rec)
    this.svc.git.setRepo?.(`${owner}/${name}`, rec.storeId)
    return rec
  }

  protected makeRepo(
    owner: string,
    name: string,
    init: Partial<
      Pick<
        RepoRec,
        | 'id'
        | 'storeId'
        | 'description'
        | 'visibility'
        | 'stars'
        | 'created'
        | 'env'
        | 'forks'
        | 'category'
        | 'languages'
        | 'license'
        | 'website'
        | 'docsUrl'
        | 'upstream'
        | 'install'
        | 'starsTodayBase'
        | 'sampleCommitFacts'
      >
    > & {
      collaborators?: Array<string>
      installs?: Array<string>
      maintainers?: Array<string>
      maintainerGrants?: Array<string>
    } = {},
  ): RepoRec {
    const at = init.created ?? this.now()
    const id = init.id ?? seededId('repo', at, `${owner}/${name}`)
    const rec: RepoRec = {
      id,
      storeId: init.storeId ?? id,
      owner,
      name,
      description: init.description ?? '',
      visibility: init.visibility ?? 'public',
      defaultBranch: 'main',
      stars: init.stars ?? 0,
      starredBy: new Set(),
      starTimes: [],
      starsTodayBase: init.starsTodayBase ?? 0,
      upstream: init.upstream ?? null,
      install: init.install ?? null,
      sampleCommitFacts: init.sampleCommitFacts,
      forks: init.forks ?? 0,
      category: init.category ?? null,
      languages: init.languages ?? [],
      license: init.license ?? null,
      website: init.website ?? null,
      docsUrl: init.docsUrl ?? null,
      created: at,
      updated: at,
      version: 1,
      rev: 0,
      changeRev: 0,
      issueRev: 0,
      nextNumber: 1,
      collaborators: new Set(init.collaborators ?? []),
      installs: new Set(init.installs ?? []),
      maintainers: new Set(init.maintainers ?? [owner]),
      maintainerGrants: new Set(init.maintainerGrants ?? []),
      changes: new Map(),
      issues: new Map(),
      labels: defaultLabels(id, at),
      labelRev: 0,
      stacks: new Map(),
      byUpdated: new Sorted(changeUpdated, recId),
      byNumber: new Sorted(changeNumber, recId),
      issuesByNumber: new Sorted(issueNumber, recId),
      openIssueByTitle: new Map(),
      openChangeByBranch: new Map(),
      counts: { key: '', openChanges: 0, openIssues: 0 },
      env: init.env ?? [],
    }
    return rec
  }

  seedAlias(from: string, to: string) {
    this.aliases.set(from, to)
  }

  seedChange(repo: RepoRec, c: ChangeRec) {
    repo.changes.set(c.number, c)
    repo.byUpdated.add(c)
    repo.byNumber.add(c)
    repo.nextNumber = Math.max(repo.nextNumber, c.number + 1)
    if (
      (c.state === 'open' || c.state === 'draft') &&
      !repo.openChangeByBranch.has(c.branch)
    )
      repo.openChangeByBranch.set(c.branch, c)
    if (c.stackId) {
      const members = repo.stacks.get(c.stackId) ?? []
      members.push(c.number)
      members.sort((a, b) => a - b)
      repo.stacks.set(c.stackId, members)
    }
  }

  seedIssue(repo: RepoRec, i: IssueRec) {
    repo.issues.set(i.number, i)
    repo.issuesByNumber.add(i)
    repo.nextNumber = Math.max(repo.nextNumber, i.number + 1)
    if (i.state === 'open' && !repo.openIssueByTitle.has(i.title))
      repo.openIssueByTitle.set(i.title, i)
  }

  protected byLower(key: string) {
    for (const [k, v] of this.repos) if (k.toLowerCase() === key) return v
    return undefined
  }

  protected repoUrl(r: RepoRec) {
    return `${this.urls.api}/repos/${r.owner}/${r.name}`
  }

  /** Names of deleted repositories, with the account that owned each. */
  protected readonly deleted = new Map<string, string>()

  protected readonly deletedRepos = new Map<
    string,
    { full: string; owner: string }
  >()

  protected readonly deletedIds = new Map<string, string>()
}

/** The labels every repository starts with. */
const DEFAULT_LABELS: Array<[string, LabelColor, string]> = [
  ['bug', 'red', 'Something does not work'],
  ['enhancement', 'blue', 'A new feature or a better one'],
  ['docs', 'purple', 'Documentation'],
  ['perf', 'yellow', 'Speed or memory'],
  ['good first issue', 'green', 'A good place to start'],
  ['help wanted', 'orange', 'The maintainers would welcome a hand'],
]

function defaultLabels(repoId: string, at: number): Map<string, LabelRec> {
  return new Map(
    DEFAULT_LABELS.map(([name, color, description]) => [
      name,
      {
        id: seededId('label', at, `${repoId}/${name}`),
        name,
        color,
        description,
        created: at,
      },
    ]),
  )
}
