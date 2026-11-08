import { createHash } from 'node:crypto'
import { newId } from '../ids'
import { pageSorted } from '../cursor'
import { apiError, errorCatalog } from '../problem'
import type { Pre } from '../registry'
import type { CursorPosition, Page } from '../cursor'
import type { UploadRec } from '../uploads'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import { changeNumber, changeUpdated, iso, recId } from './records'
import type {
  ActorRec,
  Assume,
  ChangeRec,
  CheckRec,
  EvidenceRec,
  OperationRec,
  PatchSetRec,
  RepoRec,
  ReviewRec,
  Viewer,
} from './records'
import { DomainIssues } from './issues'

/** Changes: patch sets, reviews, checks, policy, landing and stacks. */
export abstract class DomainChanges extends DomainIssues {
  async addEvidence(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    input: { upload: UploadRec; kind: EvidenceRec['kind']; caption: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const by = this.asActor(p!)
    const rec: EvidenceRec = {
      id: newId('evidence', this.now()),
      kind: input.kind,
      caption: input.caption,
      uploadId: input.upload.id,
      by,
      created: this.now(),
    }
    if (!dry) {
      input.upload.attachedTo = `${repo.owner}/${repo.name}`
      input.upload.attachedRepoId = repo.id
      this.touchChange(repo, c, () => (c.evidence ??= []).push(rec))
      this.changeEvent(repo, c, 'change.updated', by, ['evidence_count'])
    }
    return this.presentEvidence(c, rec, input.upload)
  }

  async listEvidence(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    find: (id: string) => UploadRec | null,
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return (c.evidence ?? []).flatMap((e) => {
      const u = find(e.uploadId)
      return u ? [this.presentEvidence(c, e, u)] : []
    })
  }

  protected getChangeRec(repo: RepoRec, ref: string): ChangeRec {
    const n = /^\d+$/.test(ref) ? Number(ref) : undefined
    let c: ChangeRec | undefined
    if (n !== undefined) c = repo.changes.get(n)
    else if (ref.startsWith('chg_'))
      for (const x of repo.changes.values()) if (x.id === ref) c = x
    if (!c)
      throw apiError(
        'not_found',
        `No change ${ref} in ${repo.owner}/${repo.name}.`,
      )
    return c
  }

  async listChanges(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      state?: string
      author?: string
      label?: string
      branch?: string
      sort: 'updated_at' | 'number'
      desc: boolean
      after: CursorPosition | null
      limit: number
      expand: ReadonlyArray<string>
    },
  ): Promise<Page<Pre>> {
    const repo = this.resolve(owner, name, p)
    const source = q.sort === 'updated_at' ? repo.byUpdated : repo.byNumber
    const keyOf = q.sort === 'updated_at' ? changeUpdated : changeNumber
    const states = q.state && q.state !== 'all' ? q.state.split(',') : null
    const everything = q.state === 'all'
    const page = pageSorted(source.items, keyOf, recId, {
      limit: q.limit,
      stored: 'asc',
      after: q.after,
      desc: q.desc,
      match: (c) =>
        (everything ||
          (states
            ? states.includes(c.state)
            : c.state === 'open' || c.state === 'draft')) &&
        (!q.author || c.author.handle === q.author) &&
        (!q.branch || c.branch === q.branch) &&
        (!q.label || c.labels.includes(q.label)),
    })
    return {
      items: page.items.map((c) => this.shownChange(repo, c, p, q.expand)),
      next: page.next,
    }
  }

  async getChange(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand: ReadonlyArray<string> = [],
  ) {
    const repo = this.resolve(owner, name, p)
    return this.shownChange(repo, this.getChangeRec(repo, ref), p, expand)
  }

  async changeVersion(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    expand: ReadonlyArray<string> = [],
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    // The change's own version covers everything in its representation.
    // The repository version covers the `repo` stub and the stack's other members.
    // The id keeps a deleted change's cached body from matching a new one.
    return this.changeKey(repo, c, expand)
  }

  protected changeKey(
    repo: RepoRec,
    c: ChangeRec,
    expand: ReadonlyArray<string> = [],
  ) {
    return `${c.id}.${c.version}.${c.stackId ? this.stackRev(repo, c) : 0}.${repo.openChangeByBranch.get(c.branch)?.id ?? ''}.${repo.version}.${this.accessRevision}${expand.includes('repo') ? `.${repo.rev}` : ''}`
  }

  async createChange(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      branch: string
      base?: string
      title?: string
      description?: string
      draft?: boolean
      sha?: string
      dry_run?: boolean
    },
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const by = this.asActor(p!)
    const sha = body.sha ?? this.fakeSha(repo, body.branch)
    const existing = repo.openChangeByBranch.get(body.branch)
    if (existing) {
      if (this.head(existing).sha === sha)
        return {
          change: this.presentChange(repo, existing, p),
          outcome: 'unchanged' as const,
        }
      if (body.dry_run) {
        const prev = this.head(existing)
        const preview = {
          ...existing,
          patchSets: [
            ...existing.patchSets,
            {
              ...prev,
              n: prev.n + 1,
              sha,
              tree: sha.slice(0, 7),
              kind: 'update' as const,
              note: 'Updated from branch',
              author: by,
              created: this.now(),
              files: Object.fromEntries(
                Object.entries(prev.files).map(([path, f]) => [
                  path,
                  { ...f, hash: `${f.hash.slice(0, 4)}${prev.n + 1}` },
                ]),
              ),
            },
          ],
          reviews: existing.reviews.map((r) => ({ ...r, carries: false })),
          latest: undefined,
          policyMemo: undefined,
          updated: Math.max(this.now(), existing.updated + 1),
          version: existing.version + 1,
        }
        return {
          change: this.presentChange(repo, preview, p),
          outcome: 'patch_set_added' as const,
        }
      }
      this.pushPatchSet(repo, existing, by, {
        sha,
        kind: 'update',
        note: 'Updated from branch',
      })
      return {
        change: this.presentChange(repo, existing, p),
        outcome: 'patch_set_added' as const,
      }
    }
    const at = this.now()
    const number = repo.nextNumber
    const c: ChangeRec = {
      id: newId('change', at),
      number,
      title: body.title ?? `Changes from ${body.branch}`,
      description: body.description ?? '',
      state: body.draft ? 'draft' : 'open',
      author: by,
      base: body.base ?? repo.defaultBranch,
      branch: body.branch,
      patchSets: [],
      reviews: [],
      findings: [],
      checks: [],
      stackId: null,
      labels: [],
      mirrors: [],
      created: at,
      updated: at,
      landed: null,
      version: 1,
    }
    c.patchSets.push({
      n: 1,
      sha,
      tree: sha.slice(0, 7),
      note: 'Initial version',
      author: by,
      created: at,
      files: {
        [`src/${body.branch.replace(/\W+/g, '_')}.rs`]: {
          hash: sha.slice(0, 6),
          add: 10,
          del: 1,
        },
      },
      kind: 'initial',
    })
    if (body.dry_run)
      return {
        change: this.presentChange(repo, c, p),
        outcome: 'created' as const,
      }
    repo.nextNumber++
    this.seedChange(repo, c)
    this.changeEvent(repo, c, 'change.opened', by, ['state'])
    return {
      change: this.presentChange(repo, c, p),
      outcome: 'created' as const,
    }
  }

  protected shaCounter = 0

  /** Stands in for the branch head the git store would report. */
  protected fakeSha(repo: RepoRec, branch: string) {
    return createHash('sha1')
      .update(`${repo.id}/${branch}/${this.now()}/${this.shaCounter++}`)
      .digest('hex')
  }

  protected pushPatchSet(
    repo: RepoRec,
    c: ChangeRec,
    by: ActorRec,
    ps: { sha: string; kind: 'update' | 'rebase'; note: string; tree?: string },
  ) {
    const prev = this.head(c)
    const tree =
      ps.tree ?? (ps.kind === 'rebase' ? prev.tree : ps.sha.slice(0, 7))
    this.touchChange(repo, c, () => {
      c.patchSets.push({
        n: prev.n + 1,
        sha: ps.sha,
        tree,
        note: ps.note,
        author: by,
        created: this.now(),
        files:
          ps.kind === 'rebase'
            ? prev.files
            : Object.fromEntries(
                Object.entries(prev.files).map(([path, f]) => [
                  path,
                  { ...f, hash: `${f.hash.slice(0, 4)}${prev.n + 1}` },
                ]),
              ),
        kind: ps.kind,
      })
      // An approval follows a rewrite only when the code did not change.
      if (ps.kind === 'update') for (const r of c.reviews) r.carries = false
    })
    this.changeEvent(repo, c, 'change.updated', by, [
      'head.patch_set',
      'policy.state',
      'checks.state',
    ])
  }

  async updateChange(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { title?: string; description?: string; labels?: Array<string> },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    this.assertMatch(ifMatch, `${c.id}.${c.version}`, () =>
      this.presentChange(repo, c, p),
    )
    const same =
      (body.title === undefined || body.title === c.title) &&
      (body.description === undefined || body.description === c.description) &&
      (body.labels === undefined ||
        JSON.stringify(body.labels) === JSON.stringify(c.labels))
    if (same) return this.presentChange(repo, c, p)
    if (!dry) {
      const by = this.asActor(p!)
      const changed = Object.keys(body)
      this.touchChange(repo, c, () => {
        if (body.title !== undefined) c.title = body.title
        if (body.description !== undefined) c.description = body.description
        if (body.labels !== undefined) c.labels = body.labels
      })
      this.changeEvent(repo, c, 'change.updated', by, changed)
    }
    const shown = dry
      ? {
          ...c,
          title: body.title ?? c.title,
          description: body.description ?? c.description,
          labels: body.labels ?? c.labels,
        }
      : c
    return this.presentChange(repo, shown, p)
  }

  async listPatchSets(owner: string, name: string, ref: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.patchSets.map((ps) => this.presentPatchSet(repo, c, ps))
  }

  protected presentPatchSet(
    repo: RepoRec,
    c: ChangeRec,
    ps: PatchSetRec,
  ): z.infer<typeof S.PatchSet> {
    return {
      object: 'patch_set',
      number: ps.n,
      change: c.number,
      sha: ps.sha,
      tree: ps.tree,
      note: ps.note,
      author: this.actor(ps.author),
      files: Object.keys(ps.files).length,
      url: `${this.repoUrl(repo)}/changes/${c.number}/patch-sets/${ps.n}`,
      created_at: iso(ps.created),
    }
  }

  async getPatchSet(
    owner: string,
    name: string,
    ref: string,
    n: number,
    p: Viewer,
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const ps = c.patchSets[n - 1] as (typeof c.patchSets)[number] | undefined
    if (!ps)
      throw apiError('not_found', `Change #${c.number} has no patch set ${n}.`)
    return this.presentPatchSet(repo, c, ps)
  }

  async addPatchSet(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { sha: string; kind: 'update' | 'rebase'; note?: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    if (c.state === 'landed' || c.state === 'abandoned')
      throw apiError('invalid_state', `Change #${c.number} is ${c.state}.`)
    if (dry) {
      const prev = this.head(c)
      const preview = {
        ...prev,
        n: prev.n + 1,
        sha: body.sha,
        tree: body.kind === 'rebase' ? prev.tree : body.sha.slice(0, 7),
        kind: body.kind,
        note: body.note ?? (body.kind === 'rebase' ? 'Rebased' : 'Updated'),
        author: this.asActor(p!),
        created: this.now(),
      }
      return this.presentPatchSet(repo, c, preview)
    }
    this.pushPatchSet(repo, c, this.asActor(p!), {
      sha: body.sha,
      kind: body.kind,
      note: body.note ?? (body.kind === 'rebase' ? 'Rebased' : 'Updated'),
    })
    return this.presentPatchSet(repo, c, this.head(c))
  }

  async comparePatchSets(
    owner: string,
    name: string,
    ref: string,
    from: number,
    to: number,
    p: Viewer,
  ): Promise<z.infer<typeof S.PatchSetComparison>> {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const a = c.patchSets[from - 1] as (typeof c.patchSets)[number] | undefined
    const b = c.patchSets[to - 1] as (typeof c.patchSets)[number] | undefined
    if (!a || !b)
      throw apiError(
        'not_found',
        `Change #${c.number} has ${c.patchSets.length} patch sets.`,
      )
    const files: z.infer<typeof S.PatchSetComparison>['files'] = []
    let unchanged = 0
    for (const path of new Set([
      ...Object.keys(a.files),
      ...Object.keys(b.files),
    ])) {
      const x = a.files[path] as (typeof a.files)[string] | undefined
      const y = b.files[path] as (typeof b.files)[string] | undefined
      if (x && y && x.hash === y.hash) unchanged++
      else
        files.push({
          path,
          status: !x ? 'added' : !y ? 'removed' : 'modified',
          additions:
            Math.max(0, (y?.add ?? 0) - (x?.add ?? 0)) || (y && !x ? y.add : 0),
          deletions:
            Math.max(0, (y?.del ?? 0) - (x?.del ?? 0)) || (x && !y ? x.del : 0),
        })
    }
    return {
      object: 'patch_set_comparison',
      change: c.number,
      from,
      to,
      files,
      unchanged_files: unchanged,
    }
  }

  async review(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { state: ReviewRec['state']; body?: string; patch_set?: number },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const by = this.asActor(p!)
    if (c.state !== 'open' && c.state !== 'draft')
      throw apiError('invalid_state', `Change #${c.number} is ${c.state}.`)
    if (body.state === 'approved' && c.author.handle === by.handle)
      throw apiError(
        by.class === 'human' ? 'forbidden' : 'human_required',
        'You cannot approve your own change.',
        { hint: 'Ask someone else to review it.' },
      )
    const patchSet = body.patch_set ?? this.head(c).n
    if (patchSet < 1 || patchSet > c.patchSets.length)
      throw apiError(
        'invalid_request',
        `Change #${c.number} has no patch set ${patchSet}.`,
        {
          errors: [
            {
              pointer: '/body/patch_set',
              code: 'out_of_range',
              message: `1 to ${c.patchSets.length}`,
            },
          ],
        },
      )
    const review: ReviewRec = {
      id: newId('review', this.now()),
      actor: by,
      state: body.state,
      patchSet,
      carries: patchSet === this.head(c).n,
      body: body.body ?? '',
      created: this.now(),
    }
    if (!dry) {
      this.touchChange(repo, c, () => c.reviews.push(review))
      this.changeEvent(repo, c, 'change.reviewed', by, [
        'reviewers',
        'policy.state',
      ])
    }
    return {
      object: 'review' as const,
      id: review.id,
      actor: this.actor(by),
      state: review.state,
      patch_set: review.patchSet,
      carries_to_head: review.carries,
      body: review.body,
      created_at: iso(review.created),
    }
  }

  async listFindings(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    state?: string,
  ) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.findings
      .filter((f) => !state || state === 'all' || f.state === state)
      .map((f) => this.presentFinding(repo, c, f))
  }

  async setFinding(
    owner: string,
    name: string,
    ref: string,
    findingId: string,
    p: Viewer,
    to: 'resolved' | 'dismissed',
    reason: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const f = c.findings.find(
      (x) => x.id === findingId || x.label === findingId,
    )
    if (!f)
      throw apiError('not_found', `No finding ${findingId} on #${c.number}.`)
    if (to === 'dismissed' && !reason)
      throw apiError('invalid_request', 'Dismissing needs a reason.', {
        errors: [
          {
            pointer: '/body/reason',
            code: 'required',
            message: 'Say why it is dismissed.',
          },
        ],
      })
    if (!dry && f.state !== to) {
      this.touchChange(repo, c, () => {
        f.state = to
        f.reason = reason
      })
      this.changeEvent(repo, c, 'finding.resolved', this.asActor(p!), [
        'findings',
        'policy.state',
      ])
    }
    if (dry && f.state !== to)
      return this.presentFinding(repo, c, { ...f, state: to, reason })
    return this.presentFinding(repo, c, f)
  }

  async reportCheck(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: {
      key: string
      state: CheckRec['state']
      tree: string
      name?: string
      details_url?: string
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    const found = c.checks.find(
      (k) => k.key === body.key && k.tree === body.tree,
    )
    let outcome: 'created' | 'updated' | 'unchanged' = 'created'
    let rec = found
    if (found) {
      const nextDetails = body.details_url ?? found.detailsUrl
      outcome =
        found.state === body.state && nextDetails === found.detailsUrl
          ? 'unchanged'
          : 'updated'
    }
    if (!dry && outcome !== 'unchanged') {
      this.touchChange(repo, c, () => {
        if (found) {
          found.state = body.state
          found.detailsUrl = body.details_url ?? found.detailsUrl
          found.updated = this.now()
        } else {
          rec = {
            id: newId('check', this.now()),
            key: body.key,
            name: body.name ?? body.key,
            state: body.state,
            tree: body.tree,
            detailsUrl: body.details_url ?? null,
            created: this.now(),
            updated: this.now(),
          }
          c.checks.push(rec)
        }
      })
      this.changeEvent(
        repo,
        c,
        body.state === 'fail' ? 'ci.failed' : 'check.reported',
        this.asActor(p!),
        ['checks', 'policy.state'],
      )
    }
    const out =
      dry && found
        ? {
            ...found,
            state: body.state,
            detailsUrl: body.details_url ?? found.detailsUrl,
            updated: this.now(),
          }
        : (rec ?? {
            id: newId('check', this.now()),
            key: body.key,
            name: body.name ?? body.key,
            state: body.state,
            tree: body.tree,
            detailsUrl: body.details_url ?? null,
            created: this.now(),
            updated: this.now(),
          })
    return { check: this.presentCheck(out), outcome }
  }

  async listChecks(owner: string, name: string, ref: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    return c.checks.map((k) => this.presentCheck(k))
  }

  async policy(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    assume?: Assume,
  ): Promise<z.infer<typeof S.PolicyEvaluation>> {
    const repo = this.resolve(owner, name, p)
    const c = this.getChangeRec(repo, ref)
    const reqs = this.evaluate(repo, c, assume)
    const assumed: Array<string> = []
    for (const h of assume?.approve ?? []) assumed.push(`approve:${h}`)
    for (const [k, v] of Object.entries(assume?.checks ?? {}))
      assumed.push(`check:${k}=${v}`)
    for (const l of assume?.resolve ?? []) assumed.push(`resolve:${l}`)
    return {
      object: 'policy_evaluation',
      change: c.number,
      tree: this.head(c).tree,
      state: this.policyState(reqs),
      requirements: reqs,
      assumed,
    }
  }

  /** Mark a draft ready, abandon, restore. */
  async transition(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    action: 'ready' | 'abandon' | 'restore',
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    if (!p!.scopes.has('pulls:write'))
      throw apiError('insufficient_scope', 'This needs pulls:write.', {
        extra: {
          required_scopes: ['pulls:write'],
          token_scopes: [...p!.scopes],
        },
      })
    const from: Record<typeof action, Array<ChangeRec['state']>> = {
      ready: ['draft'],
      abandon: ['draft', 'open'],
      restore: ['abandoned'],
    }
    if (!from[action].includes(c.state))
      throw apiError(
        'invalid_state',
        `Change #${c.number} is ${c.state}; it cannot be ${action === 'ready' ? 'marked ready' : action === 'abandon' ? 'abandoned' : 'restored'}.`,
      )
    const next = action === 'abandon' ? 'abandoned' : 'open'
    if (action === 'restore') {
      const branchOwner = repo.openChangeByBranch.get(c.branch)
      if (branchOwner && branchOwner !== c)
        throw apiError(
          'invalid_state',
          `#${branchOwner.number} already owns branch ${c.branch}.`,
          {
            hint: 'Land or abandon that change before restoring this one.',
          },
        )
    }
    if (dry) return this.presentChange(repo, { ...c, state: next }, p)
    this.touchChange(repo, c, () => {
      c.state = next
    })
    this.changeEvent(
      repo,
      c,
      action === 'abandon' ? 'change.abandoned' : 'change.updated',
      this.asActor(p!),
      ['state'],
    )
    return this.presentChange(repo, c, p)
  }

  /** Land one change. `expected_tree` must be the tree that was checked. */
  async land(
    owner: string,
    name: string,
    ref: string,
    p: Viewer,
    body: { expected_tree: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const c = this.getChangeRec(repo, ref)
    this.checkLandable(repo, c, p!, body.expected_tree)
    if (!dry) this.doLand(repo, c, this.asActor(p!))
    else
      return this.presentChange(
        repo,
        { ...c, state: 'landed', landed: this.now() },
        p,
      )
    return this.presentChange(repo, c, p)
  }

  protected checkLandable(
    repo: RepoRec,
    c: ChangeRec,
    p: Principal,
    expectedTree: string,
  ) {
    if (!p.scopes.has('pulls:merge'))
      throw apiError('insufficient_scope', 'Landing needs pulls:merge.', {
        extra: {
          required_scopes: ['pulls:merge'],
          token_scopes: [...p.scopes],
        },
      })
    if (c.state !== 'open')
      throw apiError(
        'invalid_state',
        c.state === 'draft'
          ? `#${c.number} is a draft. Mark it ready first.`
          : `#${c.number} is ${c.state}.`,
      )
    const head = this.head(c)
    if (head.tree !== expectedTree)
      throw apiError(
        'stale_head',
        `#${c.number} is now at ${head.tree}, not ${expectedTree}.`,
        {
          extra: {
            current: { patch_set: head.n, tree: head.tree, sha: head.sha },
          },
        },
      )
    const parent = this.parentOf(repo, c)
    if (parent && parent.state !== 'landed')
      throw apiError(
        'parent_not_landed',
        `#${parent.number} below #${c.number} has not landed.`,
        {
          extra: { parent: parent.number },
        },
      )
    const reqs = this.evaluate(repo, c)
    const bad = reqs.filter((r) => r.state === 'fail' || r.state === 'pending')
    if (bad.length)
      throw apiError(
        'policy_blocked',
        `#${c.number} cannot land: ${bad.map((r) => r.detail.replace(/\.$/, '')).join('; ')}.`,
        {
          extra: { requirements: reqs },
          // Only waiting is left when nothing has failed: it can clear by itself.
          retryable: !bad.some((r) => r.state === 'fail'),
          hint: bad.some((r) => r.state === 'fail')
            ? 'Stop and report the failed requirements. Do not work around the policy.'
            : 'Wait for the pending requirements, then try again.',
        },
      )
  }

  protected doLand(repo: RepoRec, c: ChangeRec, by: ActorRec) {
    this.touchChange(repo, c, () => {
      c.state = 'landed'
      c.landed = this.now()
    })
    this.changeEvent(repo, c, 'change.landed', by, ['state', 'landed_at'])
    // Changes above it are rebased onto the result. Their trees do not change,
    // so approvals and evidence stay valid.
    if (c.stackId) {
      const members = repo.stacks.get(c.stackId) ?? []
      const above = repo.changes.get(members[members.indexOf(c.number) + 1])
      if (above && (above.state === 'open' || above.state === 'draft'))
        this.pushPatchSet(repo, above, by, {
          sha: this.fakeSha(repo, `${above.branch}/rebase`),
          kind: 'rebase',
          note: `Rebased onto main after #${c.number} landed`,
        })
    }
  }

  async landStack(
    owner: string,
    name: string,
    stackId: string,
    p: Viewer,
    body: { expected_trees: Record<string, string> },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const members = repo.stacks.get(stackId)
    if (!members) throw apiError('not_found', `No stack ${stackId}.`)
    const by = this.asActor(p!)
    const open = members
      .map((n) => repo.changes.get(n)!)
      .filter((c) => c.state === 'open')
    if (open.length === 0)
      throw apiError('invalid_state', 'Nothing in this stack is open.')
    // A draft or abandoned member between two open members would make the
    // operation fail after the ones below it already landed.
    const firstAt = members.indexOf(open[0].number)
    const lastAt = members.indexOf(open[open.length - 1].number)
    for (const n of members.slice(firstAt, lastAt + 1)) {
      const c = repo.changes.get(n)!
      if (c.state !== 'open' && c.state !== 'landed')
        throw apiError(
          'invalid_state',
          `#${c.number} in this stack is ${c.state}.`,
          {
            hint: 'Every change between the open ones must be open or already landed.',
          },
        )
    }
    // Check the first now so an obvious refusal is a plain error, not an operation.
    const first = open[0]
    const trees = body.expected_trees
    const missing = open
      .filter((c) => !trees[String(c.number)])
      .map((c) => c.number)
    if (missing.length)
      throw apiError(
        'invalid_request',
        `expected_trees is missing ${missing.map((n) => `#${n}`).join(', ')}.`,
        {
          hint: 'Send the tree you checked for every open change in the stack.',
        },
      )
    // Every open member must be preflighted against the tree the caller checked,
    // so a later stale member cannot fail after earlier ones have already landed.
    for (const c of open) {
      const head = this.head(c)
      const expected = trees[String(c.number)]
      if (head.tree !== expected)
        throw apiError(
          'stale_head',
          `#${c.number} is now at ${head.tree}, not ${expected}.`,
          {
            extra: {
              current: { patch_set: head.n, tree: head.tree, sha: head.sha },
            },
          },
        )
    }
    this.checkLandable(repo, first, p!, trees[String(first.number)])
    const op: OperationRec = {
      id: newId('operation', this.now()),
      kind: 'stack.land',
      repoId: repo.id,
      state: 'queued',
      done: 0,
      total: open.length,
      result: null,
      error: null,
      created: this.now(),
      finished: null,
    }
    if (dry) return this.presentOp(op)
    this.operations.set(op.id, op)
    const step = (i: number) => {
      op.state = 'running'
      if (i >= open.length) {
        op.state = 'succeeded'
        op.finished = this.now()
        op.result = {
          object: 'stack',
          id: stackId,
          url: `${this.repoUrl(repo)}/stacks/${stackId}`,
        }
        this.emit(
          repo,
          'operation.finished',
          by,
          { object: 'operation', id: op.id, number: null },
          ['state'],
          null,
        )
        return
      }
      const c = open[i]
      try {
        this.checkLandable(repo, c, p!, trees[String(c.number)])
        this.doLand(repo, c, by)
        op.done = i + 1
        setTimeout(() => step(i + 1), this.stepDelayMs)
      } catch (e) {
        op.state = 'failed'
        op.finished = this.now()
        const failure = e as {
          code?: keyof typeof errorCatalog
          detail?: string
          hint?: string
          retryable?: boolean
          errors?: unknown
          extra?: Record<string, unknown>
        }
        const code: keyof typeof errorCatalog =
          failure.code !== undefined && failure.code in errorCatalog
            ? failure.code
            : 'internal'
        const entry = errorCatalog[code]
        op.error = {
          type: `https://source.code/docs/api/errors#${code}`,
          title: entry.title,
          status: entry.status,
          code,
          detail: failure.detail ?? 'Unexpected failure.',
          hint: failure.hint ?? entry.hint,
          retryable: failure.retryable ?? entry.retryable,
          exit_code: entry.exit,
          ...(failure.errors ? { errors: failure.errors } : {}),
          ...failure.extra,
        }
        this.emit(
          repo,
          'operation.finished',
          by,
          { object: 'operation', id: op.id, number: null },
          ['state'],
          null,
        )
      }
    }
    setTimeout(() => step(0), this.stepDelayMs)
    return this.presentOp(op)
  }

  async getOperation(id: string, p: Viewer) {
    const op = this.operations.get(id)
    if (!op || !p || !this.mayReadId(op.repoId, p))
      throw apiError('not_found', `No operation ${id}.`)
    return this.presentOp(op)
  }

  operationRepoId(id: string) {
    return this.operations.get(id)?.repoId ?? null
  }

  async operationVersion(id: string, p: Viewer) {
    const op = this.operations.get(id)
    if (!op || !p || !this.mayReadId(op.repoId, p)) return null
    return `${id}.${op.state}.${op.done}`
  }
}
