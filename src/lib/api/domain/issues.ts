import { newId } from '../ids'
import { pageSorted } from '../cursor'
import { apiError } from '../problem'
import type { CursorPosition } from '../cursor'
import { issueNumber, recId } from './records'
import type { IssueRec, Viewer } from './records'
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
    body: { title: string; body?: string; labels?: Array<string> },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
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
    },
    ifMatch: string | null,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const i = repo.issues.get(n)
    if (!i) throw apiError('not_found', `No issue #${n} in ${owner}/${name}.`)
    this.assertMatch(ifMatch, `${i.id}.${i.version}`, () =>
      this.presentIssue(repo, i),
    )
    const same =
      (body.title === undefined || body.title === i.title) &&
      (body.body === undefined || body.body === i.body) &&
      (body.labels === undefined ||
        JSON.stringify(body.labels) === JSON.stringify(i.labels)) &&
      (body.state === undefined || body.state === i.state)
    if (same) return this.presentIssue(repo, i)
    if (!dry) {
      if (repo.openIssueByTitle.get(i.title) === i)
        repo.openIssueByTitle.delete(i.title)
      if (body.title !== undefined) i.title = body.title
      if (body.body !== undefined) i.body = body.body
      if (body.labels !== undefined) i.labels = body.labels
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
}
