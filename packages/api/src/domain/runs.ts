import { newId } from '../ids'
import { pageSorted } from '../cursor'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type { Principal } from '../auth'
import type { z } from 'zod'
import type * as S from '../schemas'
import { iso } from './records'
import type { RepoRec, RunRec, Viewer } from './records'
import { DomainTeams } from './teams'

/** Agent runs and the long operations they start. */
export abstract class DomainRuns extends DomainTeams {
  static readonly RUN_NOTES = 50

  static readonly RUNS_RUNNING = 20

  static readonly RUN_SCOPES = [
    'repo:read',
    'issues:read',
    'issues:comment',
    'pulls:read',
    'pulls:comment',
    'secrets:schema',
  ] as const

  /** A run that outlived its token is over, whether or not anyone said so. */
  protected runState(r: RunRec): z.infer<typeof S.Run>['state'] {
    return r.state === 'running' && r.expires <= this.now()
      ? 'expired'
      : r.state
  }

  presentRun(r: RunRec, secret: string | null = null): z.infer<typeof S.Run> {
    const repo = this.repos.get(r.repo)
    return {
      object: 'run',
      id: r.id,
      repo: repo
        ? this.repoRef(repo)
        : {
            object: 'repo',
            id: 'rep_deleted',
            full_name: r.repo,
            url: `${this.urls.api}/repos/${r.repo}`,
          },
      task: r.task,
      state: this.runState(r),
      actor: this.actor(this.actorFor(r.handle, 'agent')),
      change: r.change,
      scopes: r.scopes,
      token: secret,
      token_id: r.tokenId,
      notes: r.notes.map((n) => ({ at: iso(n.at), text: n.text })),
      summary: r.summary,
      url: `${this.urls.api}/repos/${r.repo}/runs/${r.id}`,
      started_at: iso(r.started),
      expires_at: iso(r.expires),
      finished_at: r.finished ? iso(r.finished) : null,
      version: r.version,
    }
  }

  protected runRec(repo: RepoRec, id: string): RunRec {
    const r = this.runs.get(id)
    if (!r || r.repo !== `${repo.owner}/${repo.name}`)
      throw apiError('not_found', `No run ${id} in ${repo.owner}/${repo.name}.`)
    return r
  }

  async startRun(
    owner: string,
    name: string,
    p: Principal,
    input: {
      task: string
      change?: number
      scopes?: Array<string>
      ttl_minutes: number
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const full = `${repo.owner}/${repo.name}`
    if (input.change !== undefined && !repo.changes.has(input.change))
      throw apiError('not_found', `No change #${input.change} in ${full}.`)
    // A run token can never do more than the one that started it.
    if (!p.scopes.has('repo:read'))
      throw apiError(
        'insufficient_scope',
        'A run token needs repo:read to report on itself.',
        {
          extra: {
            required_scopes: ['repo:read'],
            token_scopes: [...p.scopes],
          },
        },
      )
    const wanted = [
      ...new Set([
        ...(input.scopes ??
          DomainRuns.RUN_SCOPES.filter((s) => p.scopes.has(s))),
        'repo:read',
      ]),
    ]
    const missing = wanted.filter((s) => !p.scopes.has(s as never))
    if (missing.length)
      throw apiError(
        'insufficient_scope',
        `A run cannot have scopes you do not have: ${missing.join(', ')}.`,
        {
          extra: { required_scopes: missing, token_scopes: [...p.scopes] },
        },
      )
    if (wanted.includes('tokens:manage'))
      throw apiError('forbidden', 'A run cannot be given tokens:manage.', {
        hint: 'A run token that could mint tokens would outlive its run.',
      })
    if (wanted.includes('secrets:write'))
      throw apiError('forbidden', 'A run cannot be given secrets:write.', {
        hint: 'Setting secrets is a person-only action.',
      })
    let running = 0
    for (const r of this.runs.values())
      if (r.handle === p.handle && this.runState(r) === 'running') running++
    if (running >= DomainRuns.RUNS_RUNNING)
      throw apiError(
        'limit_reached',
        `You can have ${DomainRuns.RUNS_RUNNING} runs going at once.`,
        { hint: 'Finish or cancel one first.' },
      )
    const at = this.now()
    const id = newId('run', at)
    const rec: RunRec = {
      id,
      repo: full,
      task: input.task,
      state: 'running',
      handle: p.handle,
      change: input.change ?? null,
      scopes: wanted,
      tokenId: 'tok_dryrun',
      notes: [],
      summary: null,
      started: at,
      expires: at + input.ttl_minutes * 60_000,
      finished: null,
      version: 1,
    }
    if (dry) return { run: this.presentRun(rec, null) }
    const { record, secret } = this.memAuth.create({
      name: `run ${id}`,
      kind: 'run',
      handle: p.handle,
      class: 'agent',
      scopes: wanted as never,
      repos: [full],
      ttlMs: input.ttl_minutes * 60_000,
    })
    rec.tokenId = record.id
    this.runs.set(id, rec)
    let list = this.runsByRepo.get(full)
    if (!list) this.runsByRepo.set(full, (list = []))
    list.push(rec)
    this.emit(
      repo,
      'run.started',
      this.asActor(p),
      { object: 'run', id, number: null },
      ['state'],
      this.presentRun(rec),
    )
    return { run: this.presentRun(rec, secret) }
  }

  async listRuns(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      state?: string
      actor?: string
      after: CursorPosition | null
      limit: number
    },
  ) {
    const repo = this.resolve(owner, name, p)
    const all = [
      ...(this.runsByRepo.get(`${repo.owner}/${repo.name}`) ?? []),
    ].sort((a, b) => a.started - b.started || (a.id < b.id ? -1 : 1))
    const page = pageSorted(
      all,
      (r) => r.started,
      (r) => r.id,
      {
        limit: q.limit,
        after: q.after,
        desc: true,
        stored: 'asc',
        match: (r) =>
          (!q.state || this.runState(r) === q.state) &&
          (!q.actor || r.handle === q.actor),
      },
    )
    return { items: page.items.map((r) => this.presentRun(r)), next: page.next }
  }

  async getRun(owner: string, name: string, id: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return this.presentRun(this.runRec(repo, id))
  }

  /**
   * Start a run for a bot or agent that something else woke up (an
   * automation). Its token is minted and thrown away: the bot picks the run up
   * with `claimRun`, which gives it a fresh one.
   */
  protected startRunFor(
    repo: RepoRec,
    handle: string,
    scopes: ReadonlyArray<string>,
    task: string,
    change: number | null,
    ttlMinutes = 60,
  ): RunRec {
    const full = `${repo.owner}/${repo.name}`
    const at = this.now()
    const id = newId('run', at)
    const wanted = [
      ...new Set([
        ...DomainRuns.RUN_SCOPES.filter((s) => scopes.includes(s)),
        'repo:read',
      ]),
    ]
    const { record } = this.memAuth.create({
      name: `run ${id}`,
      kind: 'run',
      handle,
      class: 'agent',
      scopes: wanted as never,
      repos: [full],
      ttlMs: ttlMinutes * 60_000,
    })
    const rec: RunRec = {
      id,
      repo: full,
      task,
      state: 'running',
      handle,
      change,
      scopes: wanted,
      tokenId: record.id,
      notes: [],
      summary: null,
      started: at,
      expires: at + ttlMinutes * 60_000,
      finished: null,
      version: 1,
    }
    this.runs.set(id, rec)
    let list = this.runsByRepo.get(full)
    if (!list) this.runsByRepo.set(full, (list = []))
    list.push(rec)
    this.emit(
      repo,
      'run.started',
      this.actorFor(handle, 'agent'),
      { object: 'run', id, number: null },
      ['state'],
      this.presentRun(rec),
    )
    return rec
  }

  /**
   * The bot or agent a run belongs to picks it up: it gets the run's token,
   * and any token handed out before stops working.
   */
  async claimRun(owner: string, name: string, id: string, p: Principal) {
    const repo = this.resolve(owner, name, p)
    const r = this.runRec(repo, id)
    if (p.handle !== r.handle)
      throw apiError('forbidden', `Only ${r.handle} can pick up this run.`, {
        hint: `Call this with a token of ${r.handle}.`,
      })
    if (this.runState(r) !== 'running')
      throw apiError('invalid_state', `This run is ${this.runState(r)}.`)
    this.memAuth.revoke(r.tokenId)
    const { record, secret } = this.memAuth.create({
      name: `run ${id}`,
      kind: 'run',
      handle: r.handle,
      class: 'agent',
      scopes: r.scopes as never,
      repos: [r.repo],
      ttlMs: r.expires - this.now(),
    })
    r.tokenId = record.id
    r.notes = [
      ...r.notes,
      { at: this.now(), text: `Picked up by ${p.handle}.` },
    ].slice(-DomainRuns.RUN_NOTES)
    r.version++
    return this.presentRun(r, secret)
  }

  /** The run's own token, the person who started it, or an admin of the account may act on it. */
  protected assertRunOwner(repo: RepoRec, r: RunRec, p: Principal) {
    if (
      p.repos &&
      !p.repos.includes(`${repo.owner}/${repo.name}`.toLowerCase())
    )
      throw apiError(
        'forbidden',
        'This token is not granted for this repository.',
      )
    if (p.tokenId === r.tokenId) return
    if (p.class === 'human' && r.handle === p.handle) return
    if (p.class === 'human') return this.assertAdmin(repo, p)
    throw apiError('forbidden', 'A run token can only control its own run.')
  }

  async noteRun(
    owner: string,
    name: string,
    id: string,
    p: Principal,
    text: string,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'read')
    const r = this.runRec(repo, id)
    this.assertRunOwner(repo, r, p)
    if (this.runState(r) !== 'running')
      throw apiError('invalid_state', `Run ${id} is ${this.runState(r)}.`, {
        hint: 'Start another run.',
      })
    if (dry)
      return this.presentRun({
        ...r,
        notes: [...r.notes, { at: this.now(), text }],
      })
    {
      r.notes.push({ at: this.now(), text })
      if (r.notes.length > DomainRuns.RUN_NOTES)
        r.notes.splice(0, r.notes.length - DomainRuns.RUN_NOTES)
      r.version++
    }
    return this.presentRun(r)
  }

  async endRun(
    owner: string,
    name: string,
    id: string,
    p: Principal,
    state: 'succeeded' | 'failed' | 'cancelled',
    summary: string | undefined,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'read')
    const r = this.runRec(repo, id)
    this.assertRunOwner(repo, r, p)
    const now = this.runState(r)
    // Finishing twice with the same outcome is a no-op, so a retry is safe.
    if (now === state) return this.presentRun(r)
    if (now !== 'running')
      throw apiError('invalid_state', `Run ${id} is already ${now}.`)
    if (dry)
      return this.presentRun({
        ...r,
        state,
        finished: this.now(),
        summary: summary ?? r.summary,
      })
    {
      r.state = state
      r.finished = this.now()
      if (summary !== undefined) r.summary = summary
      r.version++
      this.memAuth.revoke(r.tokenId)
      this.emit(
        repo,
        'run.finished',
        this.asActor(p),
        { object: 'run', id, number: null },
        ['state'],
        this.presentRun(r),
      )
    }
    return this.presentRun(r)
  }

  /** Drop finished runs and operations after a week. */
  sweepRunsOperations() {
    const cutoff = this.now() - 7 * 86_400_000
    for (const [id, r] of this.runs) {
      if (this.runState(r) === 'running') continue
      if ((r.finished ?? r.expires) >= cutoff) continue
      this.runs.delete(id)
      const list = this.runsByRepo.get(r.repo)
      if (list) {
        const at = list.indexOf(r)
        if (at >= 0) list.splice(at, 1)
        if (list.length === 0) this.runsByRepo.delete(r.repo)
      }
    }
    for (const [id, op] of this.operations)
      if (op.finished !== null && op.finished < cutoff)
        this.operations.delete(id)
  }
}
