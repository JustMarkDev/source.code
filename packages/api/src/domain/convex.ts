import { ConvexError } from 'convex/values'
import { apiError } from '../problem'
import { Pre } from '../registry'
import { pageSorted } from '../cursor'
import { heldKey } from '../idempotency'
import { healthAreas, reportFrom } from '../health'
import type { HealthReader } from '../health'
import { parseEvent } from '../events'
import type { StoredEvent } from '../events'
import type { SearchDoc } from '../search'
import type { MirrorRec } from '../extras'
import { seqId } from './records'
import { statusReport } from './status-report'
import type { ErrorCode } from '../problem'
import type { Principal } from '../auth'
import { Moved } from './records'
import type { Attached, Urls, Viewer } from './records'
import type { EventLog } from '../events'
import type { DomainPort } from './port'

/**
 * How the API reaches the forge's Convex functions. `who` is the caller the
 * API already authenticated; the caller turns it into the identity Convex
 * reads (a short JWT in production, `withIdentity` in tests). Functions are
 * named the Convex way, `forge/issues:list`.
 */
export type ConvexCall = (
  kind: 'query' | 'mutation' | 'action',
  name: string,
  args: Record<string, unknown>,
  who: Viewer | 'system',
) => Promise<unknown>

/** The identity claims for a principal. The Convex side reads them in `convex/lib/actor.ts`. */
export function claimsOf(who: Principal | 'system') {
  if (who === 'system')
    return { subject: '~system', sx_cls: 'bot', sx_sys: 'true', sx_scp: '' }
  const claims: Record<string, string> = {
    subject: who.handle,
    sx_tok: who.tokenId,
    sx_cls: who.class,
    sx_act: who.actingAs,
    sx_scp: [...who.scopes].join(' '),
  }
  if (who.repos) claims.sx_rep = who.repos.join(',')
  // A write under an Idempotency-Key marks the key in its own transaction.
  const held = heldKey.getStore()
  if (held) claims.sx_idem = JSON.stringify([held.scope, held.key])
  return claims
}

type Refusal = { code: string; detail: string; more?: string }

function refusal(e: unknown): (Refusal & Record<string, unknown>) | null {
  const data =
    e instanceof ConvexError
      ? (e.data as unknown)
      : e && typeof e === 'object' && 'data' in e
        ? e.data
        : null
  if (data && typeof data === 'object' && 'code' in data && 'detail' in data)
    return data as Refusal & Record<string, unknown>
  return null
}

/**
 * Runs one forge function and gives back its answer as the API shows it.
 * Answers come as JSON text (key order kept); refusals come back as the same
 * `ApiError` the in-memory domain throws; a dry run's answer comes back from
 * the rollback that carried it.
 */
export async function run<T>(
  call: ConvexCall,
  kind: 'query' | 'mutation' | 'action',
  name: string,
  args: Record<string, unknown>,
  who: Viewer | 'system',
): Promise<T> {
  try {
    const text = await call(kind, name, args, who)
    return (typeof text === 'string' ? JSON.parse(text) : text) as T
  } catch (e) {
    const r = refusal(e)
    if (!r) throw e
    if (r.code === 'dry_run') return JSON.parse(r.value as string) as T
    if (r.code === 'moved') throw new Moved(r.from as string, r.to as string)
    const more = r.more ? (JSON.parse(r.more) as Record<string, never>) : {}
    throw apiError(r.code as ErrorCode, r.detail, more)
  }
}

type Port = DomainPort

/**
 * `DomainPort` on Convex: every method is one call to a forge function in
 * `convex/forge/`. The rules live there, once; this class only names the
 * function and passes the arguments.

 */
export class ConvexDomain implements DomainPort {
  accessRevision = 0
  constructor(
    readonly urls: Urls,
    readonly call: ConvexCall,
    readonly events: EventLog,
    readonly svc: Attached,
    protected readonly now: () => number = Date.now,
  ) {}

  protected q<T>(
    name: string,
    args: Record<string, unknown>,
    p: Viewer | 'system',
  ) {
    return run<T>(this.call, 'query', `forge/${name}`, args, p)
  }

  protected m<T>(
    name: string,
    args: Record<string, unknown>,
    p: Viewer | 'system',
  ) {
    return run<T>(this.call, 'mutation', `forge/${name}`, args, p)
  }

  // ---- search -------------------------------------------------------------------
  // The index is this server's cache. It is built from Convex, follows the
  // event feed, and is built again after writes that move many documents at
  // once (a rename, a visibility change, a deletion).

  private searchSource: Array<SearchDoc> = []

  searchDocs: Port['searchDocs'] = () => this.searchSource

  async refreshSearch(call: ConvexCall = this.call) {
    const docs: Array<SearchDoc> = []
    let after: string | null = null
    do {
      const page: { docs: Array<SearchDoc>; next: string | null } = await run(
        call,
        'query',
        'forge/search:docs',
        { after, repos: 20 },
        'system',
      )
      docs.push(...page.docs)
      after = page.next
    } while (after)
    this.searchSource = docs
    this.svc.search.reset()
  }

  /** After a write that changes what search shows across many documents. */
  private async reindex<T>(done: Promise<T>, dry?: boolean) {
    const r = await done
    if (!dry) await this.refreshSearch()
    return r
  }

  async sweepRunsOperations() {
    await this.m('runs:sweepNow', {}, 'system')
  }

  // ---- accounts --------------------------------------------------------------

  listAccounts: Port['listAccounts'] = (p) => this.q('accounts:list', {}, p)
  getAccount: Port['getAccount'] = (handle, p) =>
    this.q('accounts:get', { handle }, p)
  accountVersion: Port['accountVersion'] = (handle) =>
    this.q('accounts:version', { handle }, null)
  knowPerson: Port['knowPerson'] = (handle, name) =>
    this.m('accounts:knowPerson', { handle, name }, 'system')
  updateAccount: Port['updateAccount'] = (handle, p, body, ifMatch, dry) =>
    this.reindex(
      this.m('accounts:update', { handle, ...body, ifMatch, dry }, p),
      dry,
    )
  createOrganization: Port['createOrganization'] = (p, input, dry) =>
    this.reindex(
      this.m('accounts:createOrganization', { ...input, dry }, p),
      dry,
    )
  listMembers: Port['listMembers'] = (handle, p) =>
    this.q('accounts:listMembers', { handle }, p)
  membersVersion: Port['membersVersion'] = (handle, p) =>
    this.q('accounts:membersVersion', { handle }, p)
  setMember: Port['setMember'] = (handle, login, role, p, dry) =>
    this.reindex(
      this.m('accounts:setMember', { handle, login, role, dry }, p),
      dry,
    )
  removeMember: Port['removeMember'] = (handle, login, p, dry) =>
    this.reindex(
      this.m('accounts:removeMember', { handle, login, dry }, p),
      dry,
    )
  listInvitations: Port['listInvitations'] = (handle, p) =>
    this.q('accounts:listInvitations', { handle, at: this.now() }, p)
  invite: Port['invite'] = (handle, p, input, dry) =>
    this.m('accounts:invite', { handle, ...input, dry }, p)
  revokeInvitation: Port['revokeInvitation'] = (handle, id, p, dry) =>
    this.m('accounts:revokeInvitation', { handle, id, dry }, p)
  acceptInvitation: Port['acceptInvitation'] = (secret, p, dry) =>
    this.reindex(this.m('accounts:acceptInvitation', { secret, dry }, p), dry)

  // ---- access ----------------------------------------------------------------

  canActAs: Port['canActAs'] = (login, account) =>
    this.q('repos:canActAs', { login, account }, 'system')
  mayReadId: Port['mayReadId'] = (id, p) => this.q('repos:mayReadId', { id }, p)
  repoAccess: Port['repoAccess'] = (owner, name, p, need) =>
    this.q('repos:access', { owner, name, need, strict: false }, p)
  repoAccessStrict: Port['repoAccessStrict'] = (
    owner,
    name,
    p,
    need = 'read',
  ) => this.q('repos:access', { owner, name, need, strict: true }, p)
  replayKey: Port['replayKey'] = (opId, params, p) =>
    this.q(
      'repos:replayKey',
      { opId, owner: params.owner, name: params.repo },
      p,
    )
  repoIdForHistory: Port['repoIdForHistory'] = (full) =>
    this.q('repos:idForHistory', { full }, 'system')
  canonicalRepoName: Port['canonicalRepoName'] = (full) =>
    this.q('repos:canonicalName', { full }, 'system')

  /** `If-Match` against a version the caller already worked out: no data needed. */
  assertVersion: Port['assertVersion'] = (ifMatch, version, current) => {
    if (ifMatch === null) return
    const tags = ifMatch
      .split(',')
      .map((t) => t.trim().replace(/^W\//, '').replace(/"/g, ''))
    if (
      tags.includes('*') ||
      tags.some(
        (t) =>
          t === version ||
          t.startsWith(`${version}-`) ||
          t.startsWith(`${version}.`),
      )
    )
      return
    throw apiError(
      'version_mismatch',
      'The object changed since you read it.',
      {
        extra: { current: current() },
      },
    )
  }

  // ---- repositories ------------------------------------------------------------

  listRepos: Port['listRepos'] = (p, q) =>
    this.q('repos:list', { ...q, at: this.now() }, p)
  getRepo: Port['getRepo'] = (owner, name, p) =>
    this.q('repos:get', { owner, name, at: this.now() }, p)
  repoVersion: Port['repoVersion'] = (owner, name, p) =>
    this.q('repos:version', { owner, name }, p)
  changeListVersion: Port['changeListVersion'] = (owner, name, p) =>
    this.q('repos:listVersion', { owner, name, of: 'changes' }, p)
  issueListVersion: Port['issueListVersion'] = (owner, name, p) =>
    this.q('repos:listVersion', { owner, name, of: 'issues' }, p)
  repoIdOf: Port['repoIdOf'] = (owner, name, p) =>
    this.q('repos:idOf', { owner, name }, p)
  getStar: Port['getStar'] = (owner, name, p) =>
    this.q('repos:getStar', { owner, name }, p)
  setStar: Port['setStar'] = (owner, name, p, on, dry) =>
    this.m('repos:setStar', { owner, name, on, dry }, p)
  bumpRepo: Port['bumpRepo'] = (owner, name, p) =>
    this.m('repos:bump', { owner, name }, p)
  createRepo: Port['createRepo'] = async (p, input, dry) => {
    const r = await this.m<Awaited<ReturnType<Port['createRepo']>>>(
      'repos:create',
      { ...input, dry },
      p,
    )
    if (r.created && !dry) {
      this.svc.git.setRepo?.(r.repo.full_name, r.repo.id)
      await this.refreshSearch()
    }
    return r
  }
  updateRepo: Port['updateRepo'] = async (
    owner,
    name,
    p,
    body,
    ifMatch,
    dry,
  ) => {
    const before = await this.repoAccess(owner, name, p, 'read')
    const r = await this.m<Awaited<ReturnType<Port['updateRepo']>>>(
      'repos:update',
      { owner, name, body, ifMatch, dry },
      p,
    )
    if (!dry) this.moved(before, r.full_name)
    if (!dry) await this.refreshSearch()
    return r
  }
  transferRepo: Port['transferRepo'] = async (owner, name, p, body, dry) => {
    const before = await this.repoAccess(owner, name, p, 'read')
    const r = await this.m<Awaited<ReturnType<Port['transferRepo']>>>(
      'repos:transfer',
      {
        owner,
        name,
        to: body.owner,
        toName: body.name,
        confirm: body.confirm,
        dry,
      },
      p,
    )
    if (!dry) this.moved(before, r.full_name)
    if (!dry) await this.refreshSearch()
    return r
  }
  deleteRepo: Port['deleteRepo'] = async (owner, name, p, confirm, dry) => {
    const r = await this.m<Awaited<ReturnType<Port['deleteRepo']>>>(
      'repos:remove',
      { owner, name, confirm, dry },
      p,
    )
    if (r.deleted) {
      const id = (r as { id?: string }).id
      if (id) await this.svc.uploads.dropRepo(id)
      void this.svc.auth.dropRepo(r.full)
      this.svc.git.dropRepo?.(r.full)
      this.svc.hooks.dropRepo(r.full)
      this.svc.extras.drop(r.full)
      await this.refreshSearch()
    }
    return r
  }

  numberRef: Port['numberRef'] = (owner, name, n, p) =>
    this.q('repos:numberRef', { owner, name, number: n }, p)
  commitFacts: Port['commitFacts'] = (full, commits) =>
    this.q(
      'repos:commitFacts',
      {
        full,
        commits: commits.map((c) => ({ sha: c.sha, email: c.author.email })),
      },
      'system',
    )
  context: Port['context'] = async (owner, name, p) => {
    const r = await this.q<{
      repo: Awaited<ReturnType<Port['context']>>['repo']
      changes: Awaited<ReturnType<Port['context']>>['changes']
      issues: Awaited<ReturnType<Port['context']>>['issues']
      envAllowed: boolean
      full: string
      id: string
    }>('repos:context', { owner, name, at: this.now() }, p)
    return {
      object: 'context',
      repo: r.repo,
      changes: r.changes,
      issues: r.issues,
      policy: { rules: 4, mode: 'enforce' },
      env: r.envAllowed
        ? (await this.svc.extras.open(r.full)).env.map((x) => ({
            name: x.name,
            kind: x.kind,
            set: [...x.set],
          }))
        : [],
      cursor: `e_${r.id}_${this.events.head}`,
    }
  }

  /** Stores not on Convex yet still key by address; tell them it moved. */
  private moved(from: string, to: string) {
    if (from === to) return
    void this.svc.auth.renameRepo(from, to)
    const storeId = this.svc.git.storeOf?.(from)
    if (storeId) this.svc.git.setRepo?.(to, storeId)
    if (from.toLowerCase() !== to.toLowerCase()) this.svc.git.dropRepo?.(from)
    this.svc.hooks.rename(from, to)
    this.svc.extras.rename(from, to)
  }

  // ---- issues ------------------------------------------------------------------

  listIssues: Port['listIssues'] = async (owner, name, p, q) => {
    const page = await this.q<{
      items: Array<{ id: string; version: number }>
      next: never
    }>('issues:list', { owner, name, ...q }, p)
    return {
      items: page.items.map(
        (x) => new Pre(JSON.stringify(x), x, `${x.id}|${x.version}`),
      ),
      next: page.next,
    }
  }
  getIssue: Port['getIssue'] = (owner, name, n, p) =>
    this.q('issues:get', { owner, name, number: n }, p)
  issueVersion: Port['issueVersion'] = (owner, name, n, p) =>
    this.q('issues:version', { owner, name, number: n }, p)
  createIssue: Port['createIssue'] = (owner, name, p, body, dry) =>
    this.m('issues:create', { owner, name, ...body, dry }, p)
  updateIssue: Port['updateIssue'] = (owner, name, n, p, body, ifMatch, dry) =>
    this.m(
      'issues:update',
      { owner, name, number: n, body, fields: Object.keys(body), ifMatch, dry },
      p,
    )
  listLabels: Port['listLabels'] = (owner, name, p) =>
    this.q('issues:listLabels', { owner, name }, p)
  labelsVersion: Port['labelsVersion'] = (owner, name, p) =>
    this.q('issues:labelsVersion', { owner, name }, p)
  createLabel: Port['createLabel'] = (owner, name, p, body, dry) =>
    this.m(
      'issues:createLabel',
      {
        owner,
        name,
        label: body.name,
        color: body.color,
        description: body.description,
        dry,
      },
      p,
    )
  updateLabel: Port['updateLabel'] = (owner, name, label, p, body, dry) =>
    this.m('issues:updateLabel', { owner, name, label, body, dry }, p)
  deleteLabel: Port['deleteLabel'] = (owner, name, label, p, dry) =>
    this.m('issues:deleteLabel', { owner, name, label, dry }, p)
  listComments: Port['listComments'] = (owner, name, n, p, q) =>
    this.q('issues:listComments', { owner, name, number: n, ...q }, p)
  commentsVersion: Port['commentsVersion'] = (owner, name, n, p) =>
    this.q('issues:commentsVersion', { owner, name, number: n }, p)
  createComment: Port['createComment'] = (owner, name, n, p, body, dry) =>
    this.m(
      'issues:createComment',
      { owner, name, number: n, body: body.body, dry },
      p,
    )
  updateComment: Port['updateComment'] = (
    owner,
    name,
    id,
    p,
    body,
    ifMatch,
    dry,
  ) =>
    this.m(
      'issues:updateComment',
      { owner, name, id, body: body.body, ifMatch, dry },
      p,
    )
  deleteComment: Port['deleteComment'] = (owner, name, id, p, dry) =>
    this.m('issues:deleteComment', { owner, name, id, dry }, p)
  addIssueEvidence: Port['addIssueEvidence'] = async (
    owner,
    name,
    n,
    p,
    input,
    dry,
  ) => {
    const u = input.upload
    const r = await this.m<{
      evidence: Awaited<ReturnType<Port['addIssueEvidence']>>
      repo: string
      repoId: string
    }>(
      'issues:addEvidence',
      {
        owner,
        name,
        number: n,
        kind: input.kind,
        caption: input.caption,
        upload: {
          id: u.id,
          contentType: u.contentType,
          size: u.size,
          sha256: u.sha256 ?? '',
        },
        dry,
      },
      p,
    )
    if (!dry) {
      u.attachedTo = r.repo
      u.attachedRepoId = r.repoId
    }
    return r.evidence
  }
  listIssueEvidence: Port['listIssueEvidence'] = async (
    owner,
    name,
    n,
    p,
    find,
  ) => {
    const all = await this.q<
      Array<{
        uploadId: string
        shown: Awaited<ReturnType<Port['listIssueEvidence']>>[number]
      }>
    >('issues:listEvidence', { owner, name, number: n }, p)
    const shown = []
    for (const e of all) if (await find(e.uploadId)) shown.push(e.shown)
    return shown
  }

  // ---- changes ------------------------------------------------------------------

  private pre<T extends { id: string; version?: number }>(x: T) {
    return new Pre(JSON.stringify(x), x, `${x.id}|${x.version ?? 0}`)
  }

  listChanges: Port['listChanges'] = async (owner, name, p, q) => {
    const page = await this.q<{
      items: Array<{ id: string; version: number }>
      next: never
    }>(
      'changes:list',
      { owner, name, ...q, expand: [...q.expand], at: this.now() },
      p,
    )
    return { items: page.items.map((x) => this.pre(x)), next: page.next }
  }
  getChange: Port['getChange'] = async (owner, name, ref, p, expand = []) =>
    this.pre(
      await this.q<{ id: string; version: number }>(
        'changes:get',
        { owner, name, ref, expand: [...expand], at: this.now() },
        p,
      ),
    )
  changeVersion: Port['changeVersion'] = (owner, name, ref, p, expand = []) =>
    this.q('changes:version', { owner, name, ref, expand: [...expand] }, p)
  createChange: Port['createChange'] = (owner, name, p, body) => {
    const { dry_run, ...rest } = body
    return this.m('changes:create', { owner, name, ...rest, dry: dry_run }, p)
  }
  updateChange: Port['updateChange'] = (
    owner,
    name,
    ref,
    p,
    body,
    ifMatch,
    dry,
  ) =>
    this.m(
      'changes:update',
      { owner, name, ref, body, fields: Object.keys(body), ifMatch, dry },
      p,
    )
  transition: Port['transition'] = (owner, name, ref, p, action, dry) =>
    this.m('changes:transition', { owner, name, ref, action, dry }, p)
  land: Port['land'] = (owner, name, ref, p, body, dry) =>
    this.m(
      'changes:land',
      { owner, name, ref, expectedTree: body.expected_tree, dry },
      p,
    )
  landStack: Port['landStack'] = (owner, name, stackId, p, body, dry) =>
    this.m(
      'changes:landStack',
      { owner, name, stackId, trees: Object.entries(body.expected_trees), dry },
      p,
    )
  listPatchSets: Port['listPatchSets'] = (owner, name, ref, p) =>
    this.q('changes:listPatchSets', { owner, name, ref, at: this.now() }, p)
  getPatchSet: Port['getPatchSet'] = (owner, name, ref, n, p) =>
    this.q('changes:getPatchSet', { owner, name, ref, n, at: this.now() }, p)
  addPatchSet: Port['addPatchSet'] = (owner, name, ref, p, body, dry) =>
    this.m(
      'changes:addPatchSet',
      {
        owner,
        name,
        ref,
        sha: body.sha,
        kind: body.kind,
        note: body.note,
        files: body.files ? Object.entries(body.files) : undefined,
        dry,
      },
      p,
    )
  getPatchSetFiles: Port['getPatchSetFiles'] = (owner, name, ref, n, p) =>
    this.q('changes:getPatchSetFiles', { owner, name, ref, n }, p)
  comparePatchSets: Port['comparePatchSets'] = (
    owner,
    name,
    ref,
    from,
    to,
    p,
  ) => this.q('changes:comparePatchSets', { owner, name, ref, from, to }, p)
  review: Port['review'] = (owner, name, ref, p, body, dry) =>
    this.m('changes:review', { owner, name, ref, ...body, dry }, p)
  listReviewComments: Port['listReviewComments'] = (owner, name, ref, p, q) =>
    this.q(
      'changes:listReviewComments',
      { owner, name, ref, ...q, at: this.now() },
      p,
    )
  reviewCommentsVersion: Port['reviewCommentsVersion'] = (
    owner,
    name,
    ref,
    p,
  ) => this.q('changes:reviewCommentsVersion', { owner, name, ref }, p)
  createReviewComment: Port['createReviewComment'] = (
    owner,
    name,
    ref,
    p,
    body,
    dry,
  ) =>
    this.m('changes:createReviewComment', { owner, name, ref, ...body, dry }, p)
  updateReviewComment: Port['updateReviewComment'] = (
    owner,
    name,
    ref,
    id,
    p,
    body,
    dry,
  ) =>
    this.m(
      'changes:updateReviewComment',
      { owner, name, ref, id, ...body, dry },
      p,
    )
  deleteReviewComment: Port['deleteReviewComment'] = (
    owner,
    name,
    ref,
    id,
    p,
    dry,
  ) => this.m('changes:deleteReviewComment', { owner, name, ref, id, dry }, p)
  listFindings: Port['listFindings'] = (owner, name, ref, p, state) =>
    this.q(
      'changes:listFindings',
      { owner, name, ref, state, at: this.now() },
      p,
    )
  raiseFinding: Port['raiseFinding'] = (owner, name, ref, p, body, dry) =>
    this.m('changes:raiseFinding', { owner, name, ref, ...body, dry }, p)
  setFinding: Port['setFinding'] = (
    owner,
    name,
    ref,
    finding,
    p,
    to,
    reason,
    dry,
  ) =>
    this.m(
      'changes:setFinding',
      { owner, name, ref, finding, to, reason, dry },
      p,
    )
  listChecks: Port['listChecks'] = (owner, name, ref, p) =>
    this.q('changes:listChecks', { owner, name, ref, at: this.now() }, p)
  reportCheck: Port['reportCheck'] = (owner, name, ref, p, body, dry) => {
    const { name: checkName, ...rest } = body
    return this.m(
      'changes:reportCheck',
      { owner, name, ref, ...rest, checkName, dry },
      p,
    )
  }
  policy: Port['policy'] = (owner, name, ref, p, assume) =>
    this.q(
      'changes:policy',
      {
        owner,
        name,
        ref,
        assume: assume && {
          approve: assume.approve,
          checks: assume.checks ? Object.entries(assume.checks) : undefined,
          resolve: assume.resolve,
        },
        at: this.now(),
      },
      p,
    )
  addEvidence: Port['addEvidence'] = async (
    owner,
    name,
    ref,
    p,
    input,
    dry,
  ) => {
    const u = input.upload
    const r = await this.m<{
      evidence: Awaited<ReturnType<Port['addEvidence']>>
      repo: string
      repoId: string
    }>(
      'changes:addEvidence',
      {
        owner,
        name,
        ref,
        kind: input.kind,
        caption: input.caption,
        upload: {
          id: u.id,
          contentType: u.contentType,
          size: u.size,
          sha256: u.sha256 ?? '',
        },
        dry,
      },
      p,
    )
    if (!dry) {
      u.attachedTo = r.repo
      u.attachedRepoId = r.repoId
    }
    return r.evidence
  }
  listEvidence: Port['listEvidence'] = async (owner, name, ref, p, find) => {
    const all = await this.q<
      Array<{
        uploadId: string
        shown: Awaited<ReturnType<Port['listEvidence']>>[number]
      }>
    >('changes:listEvidence', { owner, name, ref, at: this.now() }, p)
    const shown = []
    for (const e of all) if (await find(e.uploadId)) shown.push(e.shown)
    return shown
  }
  getOperation: Port['getOperation'] = (id, p) =>
    this.q('changes:getOperation', { id }, p)
  operationVersion: Port['operationVersion'] = (id, p) =>
    this.q('changes:operationVersion', { id }, p)
  operationRepoId: Port['operationRepoId'] = (id) =>
    this.q('changes:operationRepoId', { id }, 'system')

  // ---- events and sync ------------------------------------------------------------
  // The feed is in Convex; this server reads it into `events`, its own
  // window (`stores/convex-events.ts`). What happened comes from the window;
  // who may see it comes from Convex.

  /** Who may see events of a repository by id, asked once per id per answer. */
  canSeeId: Port['canSeeId'] = (p) => {
    const cache = new Map<string, Promise<boolean>>()
    return (id) => {
      if (!id) return !!p
      let ok = cache.get(id)
      if (!ok)
        cache.set(id, (ok = this.q<boolean>('repos:mayReadId', { id }, p)))
      return ok
    }
  }

  /** Who may see a repository by name, asked once per name per answer. */
  canSee: Port['canSee'] = (p) => {
    const cache = new Map<string, Promise<boolean>>()
    return (full) => {
      if (!full) return !!p
      let ok = cache.get(full)
      if (!ok)
        cache.set(
          full,
          (ok = this.q<boolean>('repos:mayReadName', { full }, p)),
        )
      return ok
    }
  }

  eventVersion: Port['eventVersion'] = async () =>
    `${this.events.head}.${this.events.oldest}`

  syncVersion: Port['syncVersion'] = async (owner, name, p) => {
    const full = owner.startsWith('rep_') ? owner : `${owner}/${name}`
    return `${await this.q<string>('sync:version', { full }, p)}.${this.events.oldest}`
  }

  repoHistoryVersion: Port['repoHistoryVersion'] = async (full, p) => {
    const id = await this.repoIdForHistory(full)
    if (!id) throw apiError('not_found', `No repository ${full}.`)
    if (!(await this.canSeeId(p)(id)))
      throw apiError('not_found', `No repository ${full}.`, {
        hint: 'Check the path. Private things answer 404 to everyone who cannot see them.',
      })
    const list = this.events.repoEvents(id)
    return `${id}.${list.at(-1)?.sequence ?? 0}.${this.events.oldest}`
  }

  listEvents: Port['listEvents'] = async (p, q) => {
    const can = this.canSeeId(p)
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const types = q.type ? q.type.split(',') : null
    const typeOk = (t: string) =>
      !types ||
      types.some((x) =>
        x.endsWith('.*') ? t.startsWith(x.slice(0, -1)) : x === t,
      )
    const scopeOk = (t: string) =>
      t.startsWith('issue.')
        ? canIssue
        : /^(change|finding|check|ci|operation)\./.test(t)
          ? canPull
          : true
    const repoId = q.repo ? await this.repoIdForHistory(q.repo) : null
    const source = q.repo
      ? repoId
        ? this.events.repoEvents(repoId)
        : []
      : this.events.all()
    // Access is asked of Convex, so it is worked out for the repositories in
    // the window first, then the page is read as the memory domain reads it.
    const allowed = new Map<string | null, boolean>()
    for (const e of source)
      if (!allowed.has(e.repoId)) allowed.set(e.repoId, await can(e.repoId))
    const page = pageSorted(source, (e) => e.sequence, seqId, {
      limit: q.limit,
      after: q.after,
      desc: false,
      stored: 'asc',
      match: (e) =>
        typeOk(e.type) && scopeOk(e.type) && !!allowed.get(e.repoId),
    })
    return {
      items: page.items.map(
        (e: StoredEvent) =>
          new Pre(e.json, () => parseEvent(e), `ev${e.sequence}`),
      ),
      next: page.next,
    }
  }

  sync: Port['sync'] = async (p, q) => {
    const [owner = '', name = ''] = q.repo.split('/')
    const full = owner.startsWith('rep_') ? owner : `${owner}/${name}`
    const canPull = !p || p.scopes.has('pulls:read')
    const canIssue = !p || p.scopes.has('issues:read')
    const scopeOk = (t: string) =>
      t.startsWith('issue.')
        ? canIssue
        : /^(change|finding|check|ci|operation)\./.test(t)
          ? canPull
          : true
    const snap = await this.q<{
      id: string
      objects: Array<Record<string, unknown>>
    }>('sync:snapshot', { full, at: this.now() }, p)
    const repoId = snap.id
    const head = this.events.head
    const snapshot = (from: number, at: number, reset: boolean) => {
      const slice = snap.objects.slice(from, from + q.limit)
      const more = from + q.limit < snap.objects.length
      return {
        object: 'sync' as const,
        cursor: more
          ? `s_${repoId}_${at}_${from + q.limit}`
          : `e_${repoId}_${at}`,
        objects: slice,
        deleted: [],
        has_more: more,
        reset,
      }
    }
    const mismatch = () =>
      apiError(
        'cursor_mismatch',
        'This cursor belongs to another repository.',
        {
          errors: [
            {
              pointer: '/query/cursor',
              code: 'cursor_mismatch',
              message: 'Use a cursor returned for this repository.',
            },
          ],
        },
      )
    const c = q.cursor
    if (!c) return snapshot(0, head, true)
    const s = /^s_(.+)_(\d+)_(\d+)$/.exec(c)
    if (s) {
      if (s[1] !== repoId) throw mismatch()
      if (Number(s[2]) > head) return snapshot(0, head, true)
      return snapshot(Number(s[3]), Math.min(Number(s[2]), head), false)
    }
    const ev = /^e_(.+)_(\d+)$/.exec(c)
    if (!ev)
      throw apiError('invalid_request', 'The cursor is not valid.', {
        errors: [
          {
            pointer: '/query/cursor',
            code: 'invalid_cursor',
            message: 'Use cursor exactly as returned.',
          },
        ],
      })
    if (ev[1] !== repoId) throw mismatch()
    const after = Number(ev[2])
    if (after > head) return snapshot(0, head, true)
    if (after + 1 < this.events.oldest) return snapshot(0, head, true)
    const {
      events: stored,
      exhausted,
      scannedTo,
    } = this.events.since(
      after,
      q.limit,
      (e) =>
        e.repoId === repoId &&
        scopeOk(e.type) &&
        /^(repo|change|issue|finding|check|ci)\./.test(e.type),
    )
    const latest = new Map<string, Record<string, unknown>>()
    const deleted = new Map<string, { object: string; id: string }>()
    for (const st of stored) {
      const e = parseEvent(st)
      if (e.data) {
        latest.set(e.subject.id, e.data)
        deleted.delete(e.subject.id)
      } else if (e.type.endsWith('.deleted')) {
        latest.delete(e.subject.id)
        deleted.set(e.subject.id, {
          object: e.subject.object,
          id: e.subject.id,
        })
      }
    }
    return {
      object: 'sync',
      cursor: `e_${repoId}_${exhausted ? Math.max(scannedTo, head) : scannedTo}`,
      objects: [...latest.values()],
      deleted: [...deleted.values()],
      has_more: !exhausted,
      reset: false,
    }
  }

  // ---- notifications --------------------------------------------------------------

  listNotifications: Port['listNotifications'] = (p, q) =>
    this.q('notifications:list', { ...q }, p)
  notificationsVersion: Port['notificationsVersion'] = (p) =>
    this.q('notifications:version', { access: this.accessRevision }, p)
  unreadCount: Port['unreadCount'] = (p) =>
    this.q('notifications:unreadCount', {}, p)
  markRead: Port['markRead'] = (p, id) =>
    this.m('notifications:markRead', { id }, p)
  getNotificationPrefs: Port['getNotificationPrefs'] = (p) =>
    this.q('notifications:getPrefs', {}, p)
  updateNotificationPrefs: Port['updateNotificationPrefs'] = (p, body) =>
    this.m('notifications:updatePrefs', { prefs: body }, p)

  // ---- runs -------------------------------------------------------------------

  startRun: Port['startRun'] = (owner, name, p, input, dry) =>
    this.m('runs:start', { owner, name, ...input, dry }, p)
  listRuns: Port['listRuns'] = (owner, name, p, q) =>
    this.q('runs:list', { owner, name, ...q, at: this.now() }, p)
  getRun: Port['getRun'] = (owner, name, id, p) =>
    this.q('runs:get', { owner, name, id, at: this.now() }, p)
  claimRun: Port['claimRun'] = (owner, name, id, p) =>
    this.m('runs:claim', { owner, name, id }, p)
  noteRun: Port['noteRun'] = (owner, name, id, p, text, dry) =>
    this.m('runs:note', { owner, name, id, text, dry }, p)
  endRun: Port['endRun'] = (owner, name, id, p, state, summary, dry) =>
    this.m('runs:end', { owner, name, id, state, summary, dry }, p)

  // ---- pipelines ------------------------------------------------------------------

  listPipelineRuns: Port['listPipelineRuns'] = (owner, name, p, q) =>
    this.q('pipelines:list', { owner, name, ...q }, p)
  pipelinesVersion: Port['pipelinesVersion'] = (owner, name, p) =>
    this.q('pipelines:version', { owner, name }, p)
  getPipelineRun: Port['getPipelineRun'] = (owner, name, n, p) =>
    this.q('pipelines:get', { owner, name, n }, p)
  getPipelineLog: Port['getPipelineLog'] = (owner, name, n, job, step, p) =>
    this.q('pipelines:log', { owner, name, n, job, step }, p)
  rerunPipeline: Port['rerunPipeline'] = (owner, name, n, p, dry) =>
    this.m('pipelines:rerun', { owner, name, n, dry }, p)
  startPipeline: Port['startPipeline'] = async (owner, name, p, body, dry) => {
    const full = await this.repoAccess(owner, name, p, 'write')
    let sha: string | undefined
    try {
      sha = (await this.svc.git.commits(full, 1))[0]?.sha
    } catch {
      // No history in the store: it starts on the commit it last ran on.
    }
    return this.m('pipelines:start', { owner, name, ...body, sha, dry }, p)
  }
  claimPipelineJob: Port['claimPipelineJob'] = (owner, name, p, body) =>
    this.m('pipelines:claim', { owner, name, runner: body.runner }, p)
  reportPipelineStep: Port['reportPipelineStep'] = (
    owner,
    name,
    n,
    job,
    step,
    p,
    body,
  ) => this.m('pipelines:report', { owner, name, n, job, step, ...body }, p)
  cancelPipeline: Port['cancelPipeline'] = (owner, name, n, p, dry) =>
    this.m('pipelines:cancel', { owner, name, n, dry }, p)

  // ---- bots and automations --------------------------------------------------------

  listBots: Port['listBots'] = (handle, p) =>
    this.q('automations:listBots', { handle }, p)
  createBot: Port['createBot'] = (handle, p, body, dry) =>
    this.m('automations:createBot', { handle, ...body, dry }, p)
  installBot: Port['installBot'] = (owner, name, slug, p, on, dry) =>
    this.m('automations:install', { owner, name, slug, on, dry }, p)
  updateBot: Port['updateBot'] = (slug, p, body, dry) =>
    this.m('automations:updateBot', { slug, ...body, dry }, p)
  mintBotToken: Port['mintBotToken'] = (slug, p, days) =>
    this.m('automations:mintBotToken', { slug, days }, p)
  listAutomations: Port['listAutomations'] = (owner, name, p) =>
    this.q('automations:list', { owner, name }, p)
  automationsVersion: Port['automationsVersion'] = (owner, name, p) =>
    this.q(
      'automations:version',
      { owner, name, access: this.accessRevision },
      p,
    )
  createAutomation: Port['createAutomation'] = (owner, name, p, body, dry) =>
    this.m('automations:create', { owner, name, body, dry }, p)
  updateAutomation: Port['updateAutomation'] = (
    owner,
    name,
    id,
    p,
    body,
    dry,
  ) => this.m('automations:update', { owner, name, id, body, dry }, p)
  deleteAutomation: Port['deleteAutomation'] = (owner, name, id, p, dry) =>
    this.m('automations:remove', { owner, name, id, dry }, p)
  runAutomation: Port['runAutomation'] = (owner, name, id, p) =>
    this.m('automations:run', { owner, name, id }, p)
  tickSchedules: Port['tickSchedules'] = () =>
    this.m('automations:tickNow', {}, 'system')

  // ---- policy rules -------------------------------------------------------------

  getPolicySet: Port['getPolicySet'] = (owner, name, p) =>
    this.q('policy:get', { owner, name, at: this.now() }, p)
  policySetVersion: Port['policySetVersion'] = (owner, name, p) =>
    this.q('policy:version', { owner, name }, p)
  createRule: Port['createRule'] = (owner, name, p, body, dry) => {
    const { name: ruleName, ...rest } = body
    return this.m(
      'policy:createRule',
      { owner, name, ruleName, ...rest, dry },
      p,
    )
  }
  deleteRule: Port['deleteRule'] = (owner, name, rule, p, dry) =>
    this.m('policy:deleteRule', { owner, name, rule, dry }, p)
  setRuleMode: Port['setRuleMode'] = (owner, name, rule, p, mode, dry) =>
    this.m('policy:setRuleMode', { owner, name, rule, mode, dry }, p)
  addPolicyException: Port['addPolicyException'] = (
    owner,
    name,
    p,
    body,
    dry,
  ) => this.m('policy:addException', { owner, name, ...body, dry }, p)
  removePolicyException: Port['removePolicyException'] = (
    owner,
    name,
    id,
    p,
    dry,
  ) => this.m('policy:removeException', { owner, name, id, dry }, p)

  // ---- releases -------------------------------------------------------------------

  listReleases: Port['listReleases'] = (owner, name, p, q) =>
    this.q('releases:list', { owner, name, ...q }, p)
  releasesVersion: Port['releasesVersion'] = (owner, name, p) =>
    this.q('releases:version', { owner, name }, p)
  getRelease: Port['getRelease'] = (owner, name, tag, p) =>
    this.q('releases:get', { owner, name, tag }, p)
  createRelease: Port['createRelease'] = async (owner, name, p, body, dry) => {
    // Uploads are still this server's; their checks stay with them until they move.
    const bad = (i: number, field: string, message: string) =>
      apiError('invalid_request', message, {
        errors: [
          { pointer: `/body/assets/${i}/${field}`, code: 'invalid', message },
        ],
      })
    await this.repoAccess(owner, name, p, 'write')
    const assets: Array<
      NonNullable<typeof body.assets>[number] & { uploadId?: string }
    > = []
    for (const [i, a] of (body.assets ?? []).entries()) {
      const { upload, ...rest } = a
      if (!upload) {
        if (a.size === undefined || a.sha256 === undefined)
          throw bad(i, 'upload', `${a.name}: give upload, or size and sha256.`)
        assets.push({ ...rest, size: a.size, sha256: a.sha256 })
        continue
      }
      const u = await this.svc.uploads.get(upload)
      if (!u || u.owner !== p!.handle)
        throw apiError('not_found', `No upload ${upload}.`)
      if (u.state !== 'uploaded' || !u.sha256)
        throw apiError('upload_incomplete', `Upload ${a.name} first.`)
      if (u.purpose !== 'release')
        throw bad(i, 'upload', `${upload} was not uploaded for a release.`)
      if (u.attachedTo) throw bad(i, 'upload', `${upload} is already attached.`)
      if (a.sha256 && a.sha256 !== u.sha256)
        throw bad(i, 'sha256', `${a.name} does not match what was uploaded.`)
      assets.push({ ...rest, size: u.size, sha256: u.sha256, uploadId: u.id })
    }
    const r = await this.m<
      Awaited<ReturnType<Port['createRelease']>> & {
        repo?: string
        repoId?: string
      }
    >('releases:create', { owner, name, ...body, assets, dry }, p)
    if (!dry && r.repo)
      for (const a of assets)
        if (a.uploadId) {
          const u = await this.svc.uploads.get(a.uploadId)
          if (u) {
            u.attachedTo = r.repo
            u.attachedRepoId = r.repoId ?? null
          }
        }
    return { release: r.release, outcome: r.outcome }
  }
  updateRelease: Port['updateRelease'] = (owner, name, tag, p, body, dry) =>
    this.m(
      'releases:update',
      { owner, name, tag, ...body, fields: Object.keys(body), dry },
      p,
    )
  downloadAsset: Port['downloadAsset'] = (owner, name, tag, asset, p) =>
    this.m('releases:download', { owner, name, tag, asset }, p)

  // ---- integrations, linked accounts, imports ----------------------------------------

  listConnections: Port['listConnections'] = (handle, p) =>
    this.q('integrations:listConnections', { handle }, p)
  connectionsVersion: Port['connectionsVersion'] = (handle, p) =>
    this.q('integrations:connectionsVersion', { handle }, p)
  connect: Port['connect'] = (handle, id, p, body, dry) =>
    this.m('integrations:connect', { handle, id, key: body.key, dry }, p)
  disconnect: Port['disconnect'] = (handle, id, p, dry) =>
    this.m('integrations:disconnect', { handle, id, dry }, p)
  listRepoIntegrations: Port['listRepoIntegrations'] = (owner, name, p) =>
    this.q('integrations:listRepoIntegrations', { owner, name }, p)
  repoIntegrationsVersion: Port['repoIntegrationsVersion'] = (owner, name, p) =>
    this.q('integrations:repoIntegrationsVersion', { owner, name }, p)
  setRepoIntegration: Port['setRepoIntegration'] = (
    owner,
    name,
    id,
    p,
    on,
    dry,
  ) =>
    this.m('integrations:setRepoIntegration', { owner, name, id, on, dry }, p)
  listLinks: Port['listLinks'] = (handle, p) =>
    this.q('integrations:listLinks', { handle }, p)
  linkAccount: Port['linkAccount'] = (handle, host, p, body) =>
    this.m('integrations:link', { handle, host, ...body }, p)
  unlinkAccount: Port['unlinkAccount'] = (handle, host, p) =>
    this.m('integrations:unlink', { handle, host }, p)
  importRepo: Port['importRepo'] = async (p, body, dry) => {
    const name = body.name ?? body.slug.split('/').pop()!
    const made = await this.createRepo(
      p,
      {
        owner: body.owner,
        name,
        visibility: body.visibility,
        description: `Imported from ${body.host}:${body.slug}`,
      },
      dry,
    )
    if (dry) return made
    if (!made.created && made.repo.upstream) return made
    const full = made.repo.full_name
    const repo = await this.m<Awaited<ReturnType<Port['getRepo']>>>(
      'integrations:markImported',
      {
        owner: made.repo.owner,
        name: made.repo.name,
        host: body.host,
        slug: body.slug,
        at: this.now(),
      },
      p,
    )
    const x = await this.svc.extras.open(full)
    if (!x.mirrors.some((m) => m.host === body.host && m.slug === body.slug))
      x.mirrors.push({
        id: `mir_${this.now().toString(36)}${x.mirrors.length}`
          .padEnd(22, '0')
          .slice(0, 22),
        host: body.host,
        slug: body.slug,
        direction: 'pull',
        state: 'syncing',
        lastSync: this.now(),
        detail: 'Waiting for the first fetch.',
        created: this.now(),
      })
    await this.svc.extras.flush?.()
    return { repo, created: made.created }
  }
  listImports: Port['listImports'] = async (p) => {
    const found = await this.q<
      Array<{ repo: string; host: string; slug: string; created: number }>
    >('integrations:listImports', {}, p)
    const shown = []
    for (const r of found) {
      const m = (await this.svc.extras.open(r.repo)).mirrors.find(
        (x) => x.host === r.host && x.slug === r.slug,
      )
      shown.push({ r, m })
    }
    return shown
      .map(({ r, m }) => {
        return {
          object: 'import' as const,
          repo: r.repo,
          host: r.host as 'github',
          slug: r.slug,
          state: m?.state ?? ('in-sync' as const),
          created_at: new Date(r.created).toISOString(),
        }
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }

  // ---- people -----------------------------------------------------------------------

  getAccountPrefs: Port['getAccountPrefs'] = (p) =>
    this.q('people:getPrefs', {}, p)
  updateAccountPrefs: Port['updateAccountPrefs'] = (p, body) =>
    this.reindex(
      this.m('people:updatePrefs', { body: JSON.stringify(body) }, p),
      false,
    )
  follow: Port['follow'] = (p, handle, on) =>
    this.m('people:follow', { handle, on }, p)
  listFollows: Port['listFollows'] = (handle, which, q) =>
    this.q('people:listFollows', { handle, which, ...q }, null)
  peopleVersion: Port['peopleVersion'] = (p) =>
    this.q('people:peopleVersion', { access: this.accessRevision }, p)
  listPeople: Port['listPeople'] = (p, q) =>
    this.q('people:listPeople', { ...q }, p)
  profileVersion: Port['profileVersion'] = (handle, p) =>
    this.q(
      'people:profileVersion',
      { handle, at: this.now(), access: this.accessRevision },
      p,
    )
  profile: Port['profile'] = async (handle, p) => {
    const since = this.now() - 365 * 86_400_000
    // Commits come from the git store, which this server reads.
    const repos = await this.q<Array<string>>(
      'people:profileRepos',
      { handle, since },
      p,
    )
    const email = `${handle}@users.source.code`
    const pushes: Array<{ repo: string; at: number; title: string }> = []
    for (const full of repos) {
      let commits: Awaited<ReturnType<Attached['git']['commits']>> = []
      try {
        commits = await this.svc.git.commits(full, 1000)
      } catch {
        commits = []
      }
      for (const c of commits) {
        const at = Date.parse(c.date)
        if (at >= since && c.author.email.toLowerCase() === email)
          pushes.push({ repo: full, at, title: c.message.split('\n')[0] })
      }
    }
    return this.q('people:profile', { handle, at: this.now(), pushes }, p)
  }

  // ---- insights, dashboard, status ------------------------------------------------
  // Convex says what the caller may see and hands the facts; this server adds
  // what it holds (git history, mirrors, its own health, the event window).

  private async history(full: string, limit: number) {
    try {
      return await this.svc.git.commits(full, limit)
    } catch {
      return []
    }
  }

  private downloadsOf(
    d: { total: number; days: Array<{ day: number; n: number }> },
    now: number,
  ) {
    const days = Array.from({ length: 60 }, () => 0)
    const end = Math.floor(now / 86_400_000)
    for (const x of d.days) {
      const k = 59 - (end - x.day)
      if (k >= 0 && k < 60) days[k] += x.n
    }
    const sum = (xs: Array<number>) => xs.reduce((a, b) => a + b, 0)
    const last = sum(days.slice(30))
    const before = sum(days.slice(0, 30))
    return {
      total: d.total,
      daily: days.slice(30),
      change: before ? Math.round(((last - before) / before) * 100) : null,
    }
  }

  repoInsights: Port['repoInsights'] = async (owner, name, p) => {
    const full = await this.repoAccess(owner, name, p, 'read')
    const now = this.now()
    const commits = await this.history(full, 1000)
    const logins = [
      ...new Set(
        commits
          .map((c) =>
            /^([^@]+)@users\.source\.code$/i
              .exec(c.author.email)?.[1]
              ?.toLowerCase(),
          )
          .filter((x): x is string => !!x),
      ),
    ]
    const f = await this.q<{
      repo: string
      classes: Record<string, 'human' | 'agent' | 'bot'>
      downloads: { total: number; days: Array<{ day: number; n: number }> }
      stars: { total: number; today: number }
      issues: Partial<Record<string, number>>
      changes: Partial<Record<string, number>>
    }>('insights:repoFacts', { owner, name, at: now, logins }, p)
    const WEEKS = 26
    const weeks = Array.from({ length: WEEKS }, () => 0)
    const by = { human: 0, agent: 0, bot: 0 }
    const people = new Set<string>()
    for (const c of commits) {
      const w = Math.floor((now - Date.parse(c.date)) / (7 * 86_400_000))
      if (w >= 0 && w < WEEKS) weeks[WEEKS - 1 - w]++
      const login = /^([^@]+)@users\.source\.code$/i
        .exec(c.author.email)?.[1]
        ?.toLowerCase()
      by[(login && f.classes[login]) || 'human']++
      people.add(c.author.email.toLowerCase())
    }
    return {
      object: 'repo_insights' as const,
      repo: f.repo,
      commits: { total: commits.length, by_week: weeks, by_class: by },
      contributors: people.size,
      downloads: this.downloadsOf(f.downloads, now),
      stars: f.stars,
      issues: { open: f.issues.open ?? 0, closed: f.issues.closed ?? 0 },
      changes: {
        open: (f.changes.open ?? 0) + (f.changes.draft ?? 0),
        landed: f.changes.landed ?? 0,
        abandoned: f.changes.abandoned ?? 0,
      },
    }
  }
  insightsVersion: Port['insightsVersion'] = (owner, name, p) =>
    this.q(
      'insights:repoVersion',
      { owner, name, at: this.now(), access: this.accessRevision },
      p,
    )

  dashboard: Port['dashboard'] = async (p, as) => {
    if (!p) throw apiError('unauthenticated', 'Sign in to see your dashboard.')
    const now = this.now()
    const me = p.handle
    type Run = {
      number: number
      workflow: string
      title: string
      branch: string
      status: string
      actor: string
      started: number
    }
    const f = await this.q<{
      account: string
      owned: Array<{
        repo: string
        id: string
        updated: number
        upstream: boolean
        stars: number
        starsToday: number
        openChanges: number
        openIssues: number
        size: number
        runs: Array<Run>
        agentChanges: Array<{
          number: number
          title: string
          state: string
          author: string
          patchSets: number
        }>
      }>
      toReview: Array<{
        repo: string
        number: number
        title: string
        author: string
        updated: number
      }>
      assigned: Array<{
        repo: string
        number: number
        title: string
        updated: number
      }>
      reviewTimes: Array<number>
      openedTimes: Array<number>
      downloads: { total: number; days: Array<{ day: number; n: number }> }
    }>('insights:dashboardFacts', { account: as, at: now }, p)
    const ago = (t: number) => new Date(t).toISOString()
    const path = (full: string, tail = '') => `/${full}${tail}`
    const mainOf = (runs: Array<Run>) =>
      runs.find(
        (x) =>
          x.branch === 'main' &&
          x.status !== 'queued' &&
          x.status !== 'running',
      )
    const needs: Awaited<ReturnType<Port['dashboard']>>['needs_you'] = []
    const mirrorsOf = new Map<string, Array<MirrorRec>>()
    for (const r of f.owned)
      mirrorsOf.set(r.repo, (await this.svc.extras.open(r.repo)).mirrors)
    for (const r of f.owned)
      for (const m of mirrorsOf.get(r.repo) ?? [])
        if (m.state === 'failing')
          needs.push({
            severity: 'stopped',
            title: `Mirror to ${m.host} stopped`,
            repo: r.repo,
            note: m.detail ?? 'It stopped syncing.',
            at: ago(m.lastSync),
            action: 'Reconnect',
            path: path(r.repo, '/settings?section=mirrors'),
          })
    for (const r of f.owned) {
      const main = mainOf(r.runs)
      if (main?.status === 'failure')
        needs.push({
          severity: 'failing',
          title: `${main.workflow} is failing on main`,
          repo: r.repo,
          note: main.title,
          at: ago(main.started),
          action: 'See the run',
          path: path(r.repo, `/pipelines?n=${main.number}`),
        })
    }
    for (const c of f.toReview)
      needs.push({
        severity: 'review',
        title: `Review #${c.number} ${c.title}`,
        repo: c.repo,
        note: `${c.author} opened it.`,
        at: ago(c.updated),
        action: 'Review',
        path: path(c.repo, `/changes?n=${c.number}`),
      })
    for (const i of f.assigned)
      needs.push({
        severity: 'assigned',
        title: `#${i.number} ${i.title}`,
        repo: i.repo,
        note: 'Assigned to you.',
        at: ago(i.updated),
        action: 'Open',
        path: path(i.repo, `/issues?n=${i.number}`),
      })
    const rank = { stopped: 0, failing: 1, review: 2, assigned: 3 }
    needs.sort((a, b) => rank[a.severity] - rank[b.severity])
    const progress: Awaited<ReturnType<Port['dashboard']>>['in_progress'] = []
    for (const r of f.owned) {
      for (const c of r.agentChanges)
        progress.push({
          kind: 'agent',
          title: c.title,
          repo: `${r.repo} · #${c.number}`,
          status: c.state === 'draft' ? 'Agent working' : 'Waiting on review',
          detail: `${c.author}, patch set ${c.patchSets}`,
          path: path(r.repo, `/changes?n=${c.number}`),
        })
      for (const x of r.runs)
        if (x.status === 'running' || x.status === 'queued')
          progress.push({
            kind: 'change',
            title: x.title,
            repo: `${r.repo} · ${x.workflow} #${x.number}`,
            status: x.status === 'running' ? 'Running' : 'Queued',
            detail: `${x.branch} by ${x.actor}`,
            path: path(r.repo, `/pipelines?n=${x.number}`),
          })
    }
    const activity = f.owned
      .flatMap((r) => this.events.repoEvents(r.id).slice(-30))
      .map((x) => parseEvent(x))
      .filter((e) => e.actor.handle !== me)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, 30)
      .map((e) => ({
        who: e.actor.handle,
        class: e.actor.class,
        type: e.type,
        repo: e.repo,
        subject: e.subject.number,
        at: e.created_at,
      }))
    const mirrors = new Map<
      string,
      { host: string; state: 'synced' | 'stopped'; repos: number }
    >()
    for (const r of f.owned)
      for (const m of mirrorsOf.get(r.repo) ?? []) {
        const have = mirrors.get(m.host) ?? {
          host: m.host,
          state: 'synced' as const,
          repos: 0,
        }
        mirrors.set(m.host, {
          host: m.host,
          state: m.state === 'failing' ? 'stopped' : have.state,
          repos: have.repos + 1,
        })
      }
    const commitTimes: Array<number> = []
    for (const r of f.owned)
      for (const c of await this.history(r.repo, 300))
        if (c.author.email.toLowerCase() === `${me}@users.source.code`)
          commitTimes.push(Date.parse(c.date))
    const bucket = (times: Array<number>) => {
      const days = Array.from({ length: 56 }, () => 0)
      const end = Math.floor(now / 86_400_000)
      for (const t of times) {
        const k = 55 - (end - Math.floor(t / 86_400_000))
        if (k >= 0 && k < 56) days[k]++
      }
      return days
    }
    const daily = [commitTimes, f.reviewTimes, f.openedTimes].map(bucket)
    const sum = (xs: Array<number>) => xs.reduce((a, b) => a + b, 0)
    const total = (k: number) => sum(daily[k].slice(28))
    const before = sum(daily.flatMap((d) => d.slice(0, 28)))
    const all = total(0) + total(1) + total(2)
    return {
      object: 'dashboard' as const,
      account: f.account,
      empty: f.owned.length === 0,
      needs_you: needs.slice(0, 20),
      in_progress: progress.slice(0, 20),
      activity,
      repos: [...f.owned]
        .sort((a, b) => b.updated - a.updated)
        .map((r) => ({
          repo: r.repo,
          checks:
            mainOf(r.runs)?.status === 'failure'
              ? ('failing' as const)
              : ('passing' as const),
          open_changes: r.openChanges,
          open_issues: r.openIssues,
          updated_at: ago(r.updated),
        })),
      mirrors: [...mirrors.values()],
      storage: {
        used_bytes: f.owned.reduce((n, r) => n + r.size, 0),
        limit_bytes: 5 * 1024 ** 3,
      },
      imported: f.owned.filter((r) => r.upstream).length,
      downloads: this.downloadsOf(f.downloads, now),
      contributions: {
        daily: daily[0]
          .slice(28)
          .map((n, i) => n + daily[1][28 + i] + daily[2][28 + i]),
        total: all,
        change: before ? Math.round(((all - before) / before) * 100) : null,
        commits: total(0),
        reviews: total(1),
        changes: total(2),
      },
      stars: {
        total: f.owned.reduce((n, r) => n + r.stars, 0),
        today: f.owned.reduce((n, r) => n + r.starsToday, 0),
      },
    }
  }

  /**
   * Hands this server's request counts to the shared store, so every server's
   * status page adds up all of them. Called each minute and before a status
   * read; buckets the store did not take go with the next call.
   */
  flushHealth = async () => {
    const h = this.svc.health
    if (!h) return
    const buckets = h.drain()
    if (!buckets.length) return
    try {
      await this.m('health:record', { buckets }, 'system')
    } catch (e) {
      h.restore(buckets)
      throw e
    }
  }

  private async sharedHealth(): Promise<HealthReader> {
    await this.flushHealth().catch((e: unknown) =>
      console.error('[api] could not share health', e),
    )
    const r = await this.q<{
      areas: Partial<
        Record<
          string,
          {
            days: Array<{ day: number; requests: number; errors: number }>
            minutes: Array<{
              minute: number
              requests: number
              errors: number
              hist: Array<number>
            }>
          }
        >
      >
    }>('health:report', { areas: [...healthAreas] }, 'system')
    const at = this.now()
    const first = Math.min(
      ...Object.values(r.areas).flatMap((a) => a?.days.map((d) => d.day) ?? []),
    )
    return {
      since: Number.isFinite(first)
        ? first * 86_400_000
        : (this.svc.health?.since ?? at),
      report: (area) =>
        reportFrom(at, r.areas[area]?.days ?? [], r.areas[area]?.minutes ?? []),
    }
  }

  status: Port['status'] = async () => {
    const health = await this.sharedHealth()
    const f = await this.q<{
      waiting: number
      oldest: number | null
      counts: {
        accounts: number
        repositories: number
        changes: number
        issues: number
      }
    }>('insights:statusFacts', {}, 'system')
    // Health and counts are every server's; the arithmetic is the shared status code's.
    const mirrors: Array<{
      repo: string
      host: string
      state: string
      paused?: boolean
    }> = []
    for (const { repo, mirror: m } of await this.svc.extras.allMirrors())
      mirrors.push({ repo, host: m.host, state: m.state, paused: m.paused })
    return statusReport({
      now: this.now(),
      health,
      mirrors,
      waiting: f.waiting,
      oldest: f.oldest,
      counts: f.counts,
    })
  }

  // ---- teams -----------------------------------------------------------------

  listTeams: Port['listTeams'] = (org, p) => this.q('teams:list', { org }, p)
  getTeam: Port['getTeam'] = (org, slug, p) =>
    this.q('teams:get', { org, slug }, p)
  teamVersion: Port['teamVersion'] = (org, slug, p) =>
    this.q('teams:version', { org, slug }, p)
  createTeam: Port['createTeam'] = (org, p, input, dry) =>
    this.m('teams:create', { org, ...input, dry }, p)
  updateTeam: Port['updateTeam'] = (org, slug, p, body, ifMatch, dry) =>
    this.m('teams:update', { org, slug, ...body, ifMatch, dry }, p)
  deleteTeam: Port['deleteTeam'] = (org, slug, p, dry) =>
    this.reindex(this.m('teams:remove', { org, slug, dry }, p), dry)
  setTeamMember: Port['setTeamMember'] = (org, slug, login, p, dry) =>
    this.reindex(this.m('teams:setMember', { org, slug, login, dry }, p), dry)
  removeTeamMember: Port['removeTeamMember'] = (org, slug, login, p, dry) =>
    this.reindex(
      this.m('teams:removeMember', { org, slug, login, dry }, p),
      dry,
    )
  setTeamRepo: Port['setTeamRepo'] = (
    org,
    slug,
    owner,
    name,
    permission,
    p,
    dry,
  ) =>
    this.reindex(
      this.m('teams:setRepo', { org, slug, owner, name, permission, dry }, p),
      dry,
    )
  removeTeamRepo: Port['removeTeamRepo'] = (org, slug, owner, name, p, dry) =>
    this.reindex(
      this.m('teams:removeRepo', { org, slug, owner, name, dry }, p),
      dry,
    )
}
