import { newId } from '../ids'
import { apiError } from '../problem'
import type { Scope } from '../auth'
import type { EventRecord } from '../events'
import type { ActorRec, RepoRec, Viewer } from './records'
import { DomainIntegrations } from './integrations'

export type BotRec = {
  slug: string
  name: string
  description: string
  /** The account that owns it. */
  owner: string
  class: 'bot' | 'agent'
  scopes: Array<Scope>
  created: number
}

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
export type AutomationTrigger = (typeof automationTriggers)[number]

export type AutomationRec = {
  id: string
  name: string
  bot: string
  triggers: Array<AutomationTrigger>
  runtime: string
  target: string
  instructions: string
  enabled: boolean
  /** Times an event it listens for happened. */
  triggered: number
  lastTriggered: number | null
  /** The run the last trigger started, for its bot to pick up. */
  lastRun?: string | null
  /** For the `schedule` trigger: how often. Absent is weekly. */
  every?: AutomationEvery
  /** When the schedule last fired; the next is one interval after it. */
  lastScheduled?: number
  created: number
  version: number
}

export const automationEvery = ['hour', 'day', 'week'] as const
export type AutomationEvery = (typeof automationEvery)[number]
const INTERVAL: Record<AutomationEvery, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
}

/** Event types, as an automation names them. */
const triggerOf: Partial<Record<string, AutomationTrigger>> = {
  'issue.created': 'issue.created',
  'change.opened': 'change.opened',
  'change.updated': 'change.updated',
  'ci.failed': 'ci.failed',
  'finding.raised': 'finding.raised',
}

/**
 * Bots a person or organization owns, where they are installed, and the
 * automations that wake one up when something happens in a repository. An
 * installed bot can act in the repository with its token's scopes; an
 * automation is counted each time its trigger fires.
 */
export abstract class DomainAutomations extends DomainIntegrations {
  readonly bots = new Map<string, BotRec>()
  readonly automations = new Map<string, Array<AutomationRec>>()
  automationRev = 0

  protected override emit(
    repo: RepoRec,
    type: string,
    by: ActorRec,
    subject: { object: string; id: string; number: number | null },
    changes: Array<string>,
    data: Record<string, unknown> | null,
  ): EventRecord {
    const e = super.emit(repo, type, by, subject, changes, data)
    const list = this.automations.get(`${repo.owner}/${repo.name}`)
    if (!list) return e
    const body =
      type === 'issue.commented' || type === 'change.commented'
        ? String((data as { body?: string } | null)?.body ?? '').toLowerCase()
        : ''
    for (const a of list) {
      // A comment that names the bot wakes it, as `bot.mentioned`.
      const t =
        triggerOf[type] ??
        (body && new RegExp(`(^|[^\\w@/])@${a.bot}\\b`).test(body)
          ? ('bot.mentioned' as const)
          : undefined)
      if (t)
        if (a.enabled && a.triggers.includes(t) && a.bot !== by.handle) {
          const what =
            subject.number !== null
              ? `${subject.object} #${subject.number}`
              : subject.object
          this.wake(
            repo,
            a,
            `${type} on ${what} by ${by.handle}`,
            subject.object === 'change' ? subject.number : null,
          )
        }
    }
    return e
  }

  /** Count a trigger and start a run its bot picks up with its own token. */
  private wake(
    repo: RepoRec,
    a: AutomationRec,
    why: string,
    change: number | null,
  ) {
    a.triggered++
    a.lastTriggered = this.now()
    a.version++
    this.automationRev++
    const bot = this.bots.get(a.bot)
    if (!bot || !repo.installs.has(a.bot)) return null
    const run = this.startRunFor(
      repo,
      a.bot,
      bot.scopes,
      `${a.name}: ${why}.\n\n${a.instructions}`,
      change,
    )
    a.lastRun = run.id
    return run
  }

  /** When a scheduled automation fires next; null when it has no schedule. */
  private nextRun(a: AutomationRec) {
    if (!a.triggers.includes('schedule')) return null
    return (a.lastScheduled ?? a.created) + INTERVAL[a.every ?? 'week']
  }

  /**
   * Fire every scheduled automation that is due. The server calls this on a
   * timer; a schedule that was missed while it was down fires once, not once
   * for every interval it missed.
   */
  tickSchedules() {
    const now = this.now()
    let fired = 0
    for (const [full, list] of this.automations) {
      const repo = this.repos.get(full)
      if (!repo) continue
      for (const a of list) {
        const next = this.nextRun(a)
        if (!a.enabled || next === null || next > now) continue
        a.lastScheduled = now
        this.wake(repo, a, `its ${a.every ?? 'week'}ly schedule`, null)
        fired++
      }
    }
    return fired
  }

  /** Start an automation's run now, whatever its triggers. */
  async runAutomation(owner: string, name: string, id: string, p: Viewer) {
    const repo = this.resolve(owner, name, p, 'write')
    const a = this.automationOf(repo, id)
    const run = this.wake(repo, a, `started by ${p!.handle}`, null)
    if (!run)
      throw apiError(
        'invalid_state',
        `${a.bot} is not installed on ${repo.owner}/${repo.name}.`,
      )
    return this.presentRun(run)
  }

  protected override onRepoMoved(from: string, to: string) {
    super.onRepoMoved(from, to)
    const list = this.automations.get(from)
    if (list) {
      this.automations.delete(from)
      this.automations.set(to, list)
      this.automationRev++
    }
  }

  seedBot(b: BotRec, installs: Array<string>) {
    this.bots.set(b.slug, b)
    this.seedActor(b.slug, b.class, b.created)
    for (const full of installs) this.repos.get(full)?.installs.add(b.slug)
  }

  seedAutomation(full: string, a: AutomationRec) {
    this.automations.set(full, [...(this.automations.get(full) ?? []), a])
  }

  /** The account, if the viewer manages it: themself, or an org they own or administer. */
  private ownedAccount(handle: string, p: Viewer) {
    const a = this.accounts.get(handle)
    if (!a || !p) throw apiError('not_found', `No account ${handle}.`)
    const ok =
      a.kind === 'person'
        ? a.handle === p.handle
        : ['owner', 'admin'].includes(a.members.get(p.handle) ?? '')
    if (!ok)
      throw apiError(
        a.kind === 'person' ? 'not_found' : 'forbidden',
        a.kind === 'person'
          ? `No account ${handle}.`
          : 'Only owners and admins manage bots for an organization.',
      )
    return a
  }

  private presentBot(b: BotRec) {
    const installs: Array<string> = []
    for (const r of this.repos.values())
      if (r.installs.has(b.slug)) installs.push(`${r.owner}/${r.name}`)
    return {
      object: 'bot' as const,
      slug: b.slug,
      name: b.name,
      description: b.description,
      owner: b.owner,
      class: b.class,
      scopes: b.scopes,
      installs: installs.sort(),
      tokens: this.memAuth.list(b.slug, ['bot']).length,
      created_at: new Date(b.created).toISOString(),
    }
  }

  private botOf(slug: string, p: Viewer) {
    const b = this.bots.get(slug)
    if (!b) throw apiError('not_found', `No bot ${slug}.`)
    this.ownedAccount(b.owner, p)
    return b
  }

  async listBots(handle: string, p: Viewer) {
    this.ownedAccount(handle, p)
    return [...this.bots.values()]
      .filter((b) => b.owner === handle)
      .map((b) => this.presentBot(b))
  }

  async createBot(
    handle: string,
    p: Viewer,
    body: {
      slug: string
      name: string
      description?: string
      class: 'bot' | 'agent'
      scopes: Array<Scope>
    },
    dry: boolean,
  ) {
    this.ownedAccount(handle, p)
    const have = this.bots.get(body.slug)
    if (have) {
      if (have.owner !== handle)
        throw apiError('invalid_request', `${body.slug} is taken.`, {
          errors: [
            {
              pointer: '/body/slug',
              code: 'taken',
              message: `${body.slug} is taken.`,
            },
          ],
        })
      return { bot: this.presentBot(have), created: false }
    }
    if (this.accounts.has(body.slug) || this.actors.has(body.slug))
      throw apiError('invalid_request', `${body.slug} is taken.`, {
        errors: [
          {
            pointer: '/body/slug',
            code: 'taken',
            message: `${body.slug} is taken.`,
          },
        ],
      })
    const b: BotRec = {
      slug: body.slug,
      name: body.name,
      description: body.description ?? '',
      owner: handle,
      class: body.class,
      scopes: body.scopes,
      created: this.now(),
    }
    if (!dry) this.seedBot(b, [])
    return { bot: this.presentBot(b), created: true }
  }

  async installBot(
    owner: string,
    name: string,
    slug: string,
    p: Viewer,
    on: boolean,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const b = this.bots.get(slug)
    if (!b) throw apiError('not_found', `No bot ${slug}.`)
    // A bot goes where its owner's repositories are, or where its owner can write.
    if (b.owner !== repo.owner) this.ownedAccount(b.owner, p)
    if (!dry) {
      if (on) repo.installs.add(slug)
      else repo.installs.delete(slug)
      this.accessRevision++
    }
    return this.presentBot(b)
  }

  async updateBot(
    slug: string,
    p: Viewer,
    body: { name?: string; description?: string; scopes?: Array<Scope> },
    dry: boolean,
  ) {
    const b = this.botOf(slug, p)
    if (body.scopes) {
      const installed = [...this.repos.values()].some((r) =>
        r.installs.has(slug),
      )
      const added = body.scopes.filter((s) => !b.scopes.includes(s))
      if (installed && added.length)
        throw apiError(
          'invalid_state',
          `${slug} is installed, so its scopes can shrink but not grow. Remove every install to add ${added.join(', ')}.`,
        )
    }
    const next = { ...b, ...body }
    if (!dry) Object.assign(b, body)
    return this.presentBot(dry ? next : b)
  }

  async mintBotToken(slug: string, p: Viewer, days: number) {
    const b = this.botOf(slug, p)
    const repos: Array<string> = []
    for (const r of this.repos.values())
      if (r.installs.has(slug)) repos.push(`${r.owner}/${r.name}`)
    const { record, secret } = this.memAuth.create({
      name: `${b.name} token`,
      kind: 'bot',
      handle: slug,
      class: b.class,
      scopes: b.scopes,
      repos,
      ttlMs: days * 86_400_000,
    })
    return {
      object: 'bot_token' as const,
      id: record.id,
      bot: slug,
      token: secret,
      scopes: [...record.scopes],
      repos,
      expires_at: new Date(record.expiresAt).toISOString(),
    }
  }

  private presentAutomation(a: AutomationRec) {
    return {
      object: 'automation' as const,
      id: a.id,
      name: a.name,
      bot: a.bot,
      triggers: a.triggers,
      runtime: a.runtime,
      target: a.target,
      instructions: a.instructions,
      enabled: a.enabled,
      triggered: a.triggered,
      last_triggered_at:
        a.lastTriggered === null
          ? null
          : new Date(a.lastTriggered).toISOString(),
      last_run: a.lastRun ?? null,
      every: a.triggers.includes('schedule') ? (a.every ?? 'week') : null,
      next_run_at: (() => {
        const next = this.nextRun(a)
        return next === null ? null : new Date(next).toISOString()
      })(),
      created_at: new Date(a.created).toISOString(),
      version: a.version,
    }
  }

  async listAutomations(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p, 'write')
    return (this.automations.get(`${repo.owner}/${repo.name}`) ?? []).map((a) =>
      this.presentAutomation(a),
    )
  }

  async automationsVersion(owner: string, name: string, p: Viewer) {
    const repo = this.resolve(owner, name, p, 'write')
    return `${repo.id}.aut${this.automationRev}.${this.accessRevision}`
  }

  async createAutomation(
    owner: string,
    name: string,
    p: Viewer,
    body: {
      name: string
      bot: string
      triggers: Array<AutomationTrigger>
      runtime: string
      target: string
      instructions: string
      enabled?: boolean
      every?: AutomationEvery
    },
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    if (!repo.installs.has(body.bot))
      throw apiError(
        'invalid_state',
        `${body.bot} is not installed on ${repo.owner}/${repo.name}. Install it first.`,
      )
    const at = this.now()
    const a: AutomationRec = {
      id: newId('automation', at),
      name: body.name,
      bot: body.bot,
      triggers: [...new Set(body.triggers)],
      runtime: body.runtime,
      target: body.target,
      instructions: body.instructions,
      enabled: body.enabled ?? true,
      ...(body.every ? { every: body.every } : {}),
      triggered: 0,
      lastTriggered: null,
      created: at,
      version: 1,
    }
    if (!dry) {
      this.seedAutomation(`${repo.owner}/${repo.name}`, a)
      this.automationRev++
    }
    return this.presentAutomation(a)
  }

  private automationOf(repo: RepoRec, id: string) {
    const a = this.automations
      .get(`${repo.owner}/${repo.name}`)
      ?.find((x) => x.id === id)
    if (!a) throw apiError('not_found', `No automation ${id}.`)
    return a
  }

  async updateAutomation(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    body: Partial<
      Pick<
        AutomationRec,
        | 'name'
        | 'triggers'
        | 'runtime'
        | 'target'
        | 'instructions'
        | 'enabled'
        | 'every'
      >
    >,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    const a = this.automationOf(repo, id)
    const next = { ...a, ...body }
    if (dry) return this.presentAutomation(next)
    Object.assign(a, body, { version: a.version + 1 })
    this.automationRev++
    return this.presentAutomation(a)
  }

  async deleteAutomation(
    owner: string,
    name: string,
    id: string,
    p: Viewer,
    dry: boolean,
  ) {
    const repo = this.resolve(owner, name, p, 'write')
    this.automationOf(repo, id)
    if (dry) return
    const full = `${repo.owner}/${repo.name}`
    this.automations.set(
      full,
      this.automations.get(full)!.filter((x) => x.id !== id),
    )
    this.automationRev++
  }
}
