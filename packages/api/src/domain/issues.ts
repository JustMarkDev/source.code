import { newId } from '../ids'
import { pageSorted } from '../cursor'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import type { UploadRec } from '../uploads'
import { issueNumber, recId } from './records'
import type {
  ActorRec,
  CommentRec,
  EvidenceRec,
  IssueRec,
  LabelColor,
  LabelRec,
  RepoRec,
  Viewer,
} from './records'
import { DomainRuns } from './runs'

/** Issues. */
export abstract class DomainIssues extends DomainRuns {
  async listIssues(
    owner: string,
    name: string,
    p: Viewer,
    q: {
      state: string
      label?: string
      author?: string
      after: CursorPosition | null
      limit: number
    },
  ) {
    const repo = this.resolve(owner, name, p)
    const page = pageSorted(repo.issuesByNumber.items, issueNumber, recId, {
      limit: q.limit,
      after: q.after,
      desc: true,
      stored: 'asc',
      match: (i) =>
        (q.state === 'all' || i.state === q.state) &&
        (!q.label || i.labels.includes(q.label)) &&
        (!q.author || i.author.handle === q.author),
    })
    return {
      items: page.items.map((i) => this.shownIssue(repo, i)),
      next: page.next,
    }
  }

  async getIssue(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const i = repo.issues.get(n)
    if (!i) throw apiError('not_found', `No issue #${n} in ${owner}/${name}.`)
    return this.presentIssue(repo, i)
  }

  async issueVersion(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const i = repo.issues.get(n)
    return i
      ? `${i.id}.${i.version}.${repo.version}.${this.accessRevision}`
      : null
  }

  async createIssue(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      title: string
      body?: string
      labels?: Array<string>
      assignees?: Array<string>
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const assignees = body.assignees && this.assignable(repo, body.assignees)
    const same = repo.openIssueByTitle.get(body.title)
    if (same)
      return {
        issue: this.presentIssue(repo, same),
        outcome: 'unchanged' as const,
      }
    const at = this.now()
    const by = this.asActor(p!)
    const issue: IssueRec = {
      id: newId('issue', at),
      number: repo.nextNumber,
      title: body.title,
      body: body.body ?? '',
      state: 'open',
      author: by,
      labels: body.labels ?? [],
      assignees: assignees ?? [],
      comments: [],
      created: at,
      updated: at,
      closed: null,
      version: 1,
    }
    // The same object goes into the event and the answer, so it is built once.
    const shown = this.presentIssue(repo, issue)
    if (!dry) {
      repo.nextNumber++
      repo.issueRev++
      this.seedIssue(repo, issue)
      this.emit(
        repo,
        'issue.created',
        by,
        { object: 'issue', id: issue.id, number: issue.number },
        ['state'],
        shown,
      )
    }
    return { issue: shown, outcome: 'created' as const }
  }

  async updateIssue(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    body: {
      title?: string
      body?: string
      labels?: Array<string>
      state?: 'open' | 'closed'
      assignees?: Array<string>
    },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const i = repo.issues.get(n)
    if (!i) throw apiError('not_found', `No issue #${n} in ${owner}/${name}.`)
    const assignees = body.assignees && this.assignable(repo, body.assignees)
    const handles = (a: Array<ActorRec> | undefined) =>
      (a ?? []).map((x) => x.handle).join(',')
    this.assertMatch(ifMatch, `${i.id}.${i.version}`, () =>
      this.presentIssue(repo, i),
    )
    const same =
      (body.title === undefined || body.title === i.title) &&
      (body.body === undefined || body.body === i.body) &&
      (body.labels === undefined ||
        JSON.stringify(body.labels) === JSON.stringify(i.labels)) &&
      (body.state === undefined || body.state === i.state) &&
      (assignees === undefined || handles(assignees) === handles(i.assignees))
    if (same) return this.presentIssue(repo, i)
    if (!dry) {
      if (repo.openIssueByTitle.get(i.title) === i)
        repo.openIssueByTitle.delete(i.title)
      if (body.title !== undefined) i.title = body.title
      if (body.body !== undefined) i.body = body.body
      if (body.labels !== undefined) i.labels = body.labels
      if (assignees !== undefined) i.assignees = assignees
      if (body.state !== undefined && body.state !== i.state) {
        i.state = body.state
        i.closed = body.state === 'closed' ? this.now() : null
      }
      if (i.state === 'open' && !repo.openIssueByTitle.has(i.title))
        repo.openIssueByTitle.set(i.title, i)
      i.updated = this.now()
      i.version++
      const shown = this.presentIssue(repo, i)
      repo.issueRev++
      this.emit(
        repo,
        i.state === 'closed' ? 'issue.closed' : 'issue.updated',
        this.asActor(p!),
        { object: 'issue', id: i.id, number: i.number },
        Object.keys(body),
        shown,
      )
      return shown
    }
    const preview = {
      ...i,
      title: body.title ?? i.title,
      body: body.body ?? i.body,
      labels: body.labels ?? i.labels,
      assignees: assignees ?? i.assignees,
      state: body.state ?? i.state,
      closed:
        body.state === 'closed'
          ? this.now()
          : body.state === 'open'
            ? null
            : i.closed,
    }
    return this.presentIssue(repo, preview)
  }

  /**
   * The actors named by handle, if each may be given the issue: someone who
   * can read the repository. Unknown and unable handles are a 400.
   */
  protected assignable(repo: RepoRec, list: Array<string>): Array<ActorRec> {
    const out: Array<ActorRec> = []
    for (const [k, h] of list.entries()) {
      const a = this.actors.get(h)
      const can =
        a &&
        (repo.visibility === 'public' ||
          this.isMember(repo.owner, h) ||
          repo.collaborators.has(h) ||
          repo.installs.has(h) ||
          this.teamLevel(repo, h) !== null)
      if (!a || !can)
        throw apiError('invalid_request', `${h} cannot be assigned here.`, {
          errors: [
            {
              pointer: `/body/assignees/${k}`,
              code: 'not_assignable',
              message: `${h} is not someone who can read this repository.`,
            },
          ],
        })
      if (!out.includes(a)) out.push(a)
    }
    return out
  }

  // ---- labels ---------------------------------------------------------------

  async listLabels(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return [...repo.labels.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((l) => this.presentLabel(repo, l))
  }

  async labelsVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    return `${repo.id}.${repo.labelRev}.${repo.issueRev}.${this.accessRevision}`
  }

  protected presentLabel(repo: RepoRec, l: LabelRec) {
    let issues = 0
    for (const i of repo.issues.values())
      if (i.state === 'open' && i.labels.includes(l.name)) issues++
    return {
      object: 'label' as const,
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description,
      issues,
      created_at: new Date(l.created).toISOString(),
    }
  }

  protected labelOf(repo: RepoRec, label: string) {
    const l = repo.labels.get(label.toLowerCase())
    if (!l)
      throw apiError(
        'not_found',
        `No label ${label} in ${repo.owner}/${repo.name}.`,
      )
    return l
  }

  async createLabel(
    owner: string,
    name: string,
    p: Viewer,
    body: { name: string; color?: LabelColor; description?: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const have = repo.labels.get(body.name.toLowerCase())
    if (have)
      return {
        label: this.presentLabel(repo, have),
        outcome: 'unchanged' as const,
      }
    const at = this.now()
    const l: LabelRec = {
      id: newId('label', at),
      name: body.name,
      color: body.color ?? 'gray',
      description: body.description ?? '',
      created: at,
    }
    if (!dry) {
      repo.labels.set(l.name.toLowerCase(), l)
      repo.labelRev++
    }
    return { label: this.presentLabel(repo, l), outcome: 'created' as const }
  }

  async updateLabel(
    owner: string,
    name: string,
    label: string,
    p: Viewer,
    body: { name?: string; color?: LabelColor; description?: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const l = this.labelOf(repo, label)
    const renamed = body.name !== undefined && body.name !== l.name
    if (
      renamed &&
      body.name!.toLowerCase() !== l.name.toLowerCase() &&
      repo.labels.has(body.name!.toLowerCase())
    )
      throw apiError('invalid_request', `${body.name} is already a label.`, {
        errors: [
          {
            pointer: '/body/name',
            code: 'taken',
            message: `There is already a label called ${body.name}.`,
          },
        ],
      })
    const next = {
      ...l,
      name: body.name ?? l.name,
      color: body.color ?? l.color,
      description: body.description ?? l.description,
    }
    if (dry) return this.presentLabel(repo, next)
    if (renamed) {
      // Issues carry the name, so a rename follows it onto every issue.
      for (const i of repo.issues.values()) {
        const k = i.labels.indexOf(l.name)
        if (k < 0) continue
        i.labels = i.labels.map((x) => (x === l.name ? next.name : x))
        i.version++
        i.updated = this.now()
      }
      repo.issueRev++
      repo.labels.delete(l.name.toLowerCase())
    }
    Object.assign(l, next)
    repo.labels.set(l.name.toLowerCase(), l)
    repo.labelRev++
    return this.presentLabel(repo, l)
  }

  async deleteLabel(
    owner: string,
    name: string,
    label: string,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const l = this.labelOf(repo, label)
    if (dry) return
    for (const i of repo.issues.values()) {
      if (!i.labels.includes(l.name)) continue
      i.labels = i.labels.filter((x) => x !== l.name)
      i.version++
      i.updated = this.now()
    }
    repo.issueRev++
    repo.labels.delete(l.name.toLowerCase())
    repo.labelRev++
  }

  // ---- comments -------------------------------------------------------------

  protected issueOf(repo: RepoRec, n: number) {
    const i = repo.issues.get(n)
    if (!i)
      throw apiError(
        'not_found',
        `No issue #${n} in ${repo.owner}/${repo.name}.`,
      )
    return i
  }

  protected presentComment(_repo: RepoRec, i: IssueRec, c: CommentRec) {
    return {
      object: 'issue_comment' as const,
      id: c.id,
      issue: i.number,
      author: this.actor(c.author),
      body: c.body,
      created_at: new Date(c.created).toISOString(),
      updated_at: new Date(c.updated).toISOString(),
      version: c.version,
    }
  }

  async listComments(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    q: { after: CursorPosition | null; limit: number },
  ) {
    const repo = this.resolve(owner, name, p)
    const i = this.issueOf(repo, n)
    const all = i.comments ?? []
    // Oldest first. The cursor is the last comment sent, by position and id,
    // so a comment deleted before it moves the page back by one, never skips.
    let start = 0
    if (q.after) {
      const k = all.findIndex((c) => c.id === q.after!.id)
      start = k >= 0 ? k + 1 : Math.min(Number(q.after.key), all.length)
    }
    const items = all.slice(start, start + q.limit)
    const last = items.at(-1)
    return {
      items: items.map((c) => this.presentComment(repo, i, c)),
      next:
        start + q.limit < all.length && last
          ? { key: start + q.limit, id: last.id }
          : null,
    }
  }

  async commentsVersion(owner: string, name: string, n: number, p: Viewer) {
    const repo = this.resolve(owner, name, p)
    const i = repo.issues.get(n)
    return i ? `${i.id}.${i.version}.c.${this.accessRevision}` : null
  }

  async createComment(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    body: { body: string },
    dry: boolean,
  ) {
    // Anyone who can read the repository may comment on its issues.
    const repo = this.resolve(owner, name, p)
    const i = this.issueOf(repo, n)
    const at = this.now()
    const by = this.asActor(p!)
    const c: CommentRec = {
      id: newId('comment', at),
      author: by,
      body: body.body,
      created: at,
      updated: at,
      version: 1,
    }
    const shown = this.presentComment(repo, i, c)
    if (!dry) {
      i.comments = [...(i.comments ?? []), c]
      i.updated = at
      i.version++
      repo.issueRev++
      this.emit(
        repo,
        'issue.commented',
        by,
        { object: 'issue', id: i.id, number: i.number },
        ['comments'],
        shown,
      )
    }
    return shown
  }

  protected commentOf(repo: RepoRec, id: string) {
    for (const i of repo.issues.values()) {
      const c = i.comments?.find((x) => x.id === id)
      if (c) return { i, c }
    }
    throw apiError(
      'not_found',
      `No comment ${id} in ${repo.owner}/${repo.name}.`,
    )
  }

  async updateComment(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    body: { body: string },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p)
    const { i, c } = this.commentOf(repo, id)
    if (c.author.handle !== p!.handle)
      throw apiError('forbidden', 'Only its author can edit a comment.')
    this.assertMatch(ifMatch, `${c.id}.${c.version}`, () =>
      this.presentComment(repo, i, c),
    )
    if (body.body === c.body) return this.presentComment(repo, i, c)
    if (dry) return this.presentComment(repo, i, { ...c, body: body.body })
    c.body = body.body
    c.updated = this.now()
    c.version++
    i.version++
    repo.issueRev++
    return this.presentComment(repo, i, c)
  }

  async deleteComment(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p)
    const { i, c } = this.commentOf(repo, id)
    if (c.author.handle !== p!.handle && !this.canWrite(repo, p))
      throw apiError(
        'forbidden',
        'Only its author or someone who can change the repository can delete a comment.',
      )
    if (dry) return
    i.comments = (i.comments ?? []).filter((x) => x !== c)
    i.version++
    repo.issueRev++
  }

  // ---- evidence -------------------------------------------------------------

  protected presentIssueEvidence(i: IssueRec, e: EvidenceRec, u: UploadRec) {
    return {
      object: 'issue_evidence' as const,
      id: e.id,
      issue: i.number,
      kind: e.kind as 'image' | 'recording',
      caption: e.caption,
      upload: {
        id: u.id,
        content_type: u.contentType,
        size: u.size,
        sha256: u.sha256 ?? '',
        content_url: `${this.urls.api}/uploads/${u.id}/content`,
      },
      created_by: this.actor(e.by),
      created_at: new Date(e.created).toISOString(),
    }
  }

  /** Anyone who can read the repository may show what they saw on an issue. */
  async addIssueEvidence(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    input: { upload: UploadRec; kind: 'image' | 'recording'; caption: string },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p)
    const i = this.issueOf(repo, n)
    const by = this.asActor(p!)
    const at = this.now()
    const rec: EvidenceRec = {
      id: newId('evidence', at),
      kind: input.kind,
      caption: input.caption,
      uploadId: input.upload.id,
      by,
      created: at,
    }
    if (!dry) {
      input.upload.attachedTo = `${repo.owner}/${repo.name}`
      input.upload.attachedRepoId = repo.id
      i.evidence = [...(i.evidence ?? []), rec]
      i.updated = at
      i.version++
      repo.issueRev++
      this.emit(
        repo,
        'issue.updated',
        by,
        { object: 'issue', id: i.id, number: i.number },
        ['evidence'],
        this.presentIssue(repo, i),
      )
    }
    return this.presentIssueEvidence(i, rec, input.upload)
  }

  async listIssueEvidence(
    owner: string,
    name: string,
    n: number,
    p: Viewer,
    find: (id: string) => UploadRec | null | Promise<UploadRec | null>,
  ) {
    const repo = this.resolve(owner, name, p)
    const i = this.issueOf(repo, n)
    const shown = []
    for (const e of i.evidence ?? []) {
      const u = await find(e.uploadId)
      if (u) shown.push(this.presentIssueEvidence(i, e, u))
    }
    return shown
  }
}
