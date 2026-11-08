import { seededId } from '../ids'
import type { EventRecord } from '../events'
import type { Principal } from '../auth'
import type { ActorClass, ActorRec, ChangeRec, RepoRec } from './records'
import { DomainPresent } from './present'

/** Every mutation writes one event; these build and emit it. */
export abstract class DomainEvents extends DomainPresent {
  protected emit(
    repo: RepoRec,
    type: string,
    by: ActorRec,
    subject: { object: string; id: string; number: number | null },
    changes: Array<string>,
    data: Record<string, unknown> | null,
  ): EventRecord {
    repo.updated = this.now()
    repo.rev++
    return this.events.append({
      type,
      repo: `${repo.owner}/${repo.name}`,
      repo_id: repo.id,
      actor: this.actor(by),
      subject,
      changes,
      data,
    })
  }

  protected asActor(p: Principal): ActorRec {
    return this.actorFor(p.handle, p.class)
  }

  /**
   * Who an action is recorded as. A person and an agent acting for them share a
   * handle but are not the same actor: policy counts approvals from people, and
   * a run token must never be mistaken for the person who started the run.
   */
  protected actorFor(handle: string, cls: ActorClass): ActorRec {
    const found = this.actors.get(handle)
    if (found?.class === cls) return found
    if (!found) return this.seedActor(handle, cls, this.now())
    const key = `${handle}~${cls}`
    let rec = this.actors.get(key)
    if (!rec)
      this.actors.set(
        key,
        (rec = {
          id: seededId('account', this.now(), key),
          handle,
          class: cls,
        }),
      )
    return rec
  }

  protected touchChange(repo: RepoRec, c: ChangeRec, mutate: () => void) {
    repo.byUpdated.remove(c)
    mutate()
    c.updated = Math.max(this.now(), c.updated + 1)
    c.version++
    repo.byUpdated.add(c)
    if (c.state === 'open' || c.state === 'draft') {
      if (!repo.openChangeByBranch.has(c.branch))
        repo.openChangeByBranch.set(c.branch, c)
    } else if (repo.openChangeByBranch.get(c.branch) === c)
      repo.openChangeByBranch.delete(c.branch)
  }

  protected changeEvent(
    repo: RepoRec,
    c: ChangeRec,
    type: string,
    by: ActorRec,
    changes: Array<string>,
  ) {
    repo.changeRev++
    this.emit(
      repo,
      type,
      by,
      { object: 'change', id: c.id, number: c.number },
      changes,
      this.presentChange(repo, c, 'event'),
    )
  }
}
