import { api } from '../../../convex/_generated/api'
import type { FunctionReference } from 'convex/server'
import type { OperationId, Operations } from '@source-code/sdk'

/**
 * What a screen calls in Convex for an API operation. A page reads and
 * writes the forge's data straight from Convex, live, and gets back what the
 * operation would have answered: the same function, the same arguments the
 * API passes it (`ConvexDomain`), and the same list envelope. `screens.test.ts`
 * runs each one both ways and checks the answers are equal.
 *
 * What is not here still goes through the API: anything that needs git, the
 * files on the API server, its search index or its health. A screen does not
 * need to know which is which: `useOp` and `useWrite` in the app choose.
 */

type In<Id extends OperationId> = Operations[Id]['input']
type Position = { key: string | number; id: string } | null
type Page = { items: Array<unknown>; next: Position }

/** Who is reading, for the few lists whose cursor names them. */
export type Reader = { handle: string | null }

type Context = { at: number; after: Position; limit: number }

export type Read<Id extends OperationId> = {
  fn: FunctionReference<'query'>
  /** `at` is the time the answer is for, to the hour: a query may not read the clock. */
  args: (input: In<Id>, c: Context) => Record<string, unknown>
  /** A list read a page at a time: what its cursor's fingerprint is made of. */
  page?: (input: In<Id>, reader: Reader) => Array<string | undefined>
  /** A list answered whole, in one page. */
  list?: true
}

export type Write<Id extends OperationId> = {
  fn: FunctionReference<'mutation'>
  args: (input: In<Id>) => Record<string, unknown>
  /** The part of the function's answer the operation answers with. */
  pick?: string
  /** The operation answers nothing (204). */
  empty?: true
}

// ----- the API's list envelope and cursors (`ops/common.ts`, `cursor.ts`) -----

export const PAGE = { default: 50, max: 200 }

function fingerprint(parts: ReadonlyArray<string | undefined>): string {
  let h = 5381
  const text = parts.map((p) => p ?? '').join('\u0000')
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i)
  return (h >>> 0).toString(36)
}

const base64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const unbase64url = (text: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    ),
  )

/** A cursor from this list, or none. One from another list starts over. */
function positionOf(cursor: string | undefined, fp: string): Position {
  if (!cursor?.startsWith('c_')) return null
  try {
    const [key, id, was] = JSON.parse(unbase64url(cursor.slice(2))) as [
      string | number,
      string,
      string,
    ]
    return was === fp ? { key, id } : null
  } catch {
    return null
  }
}

type Paging = { limit?: number; cursor?: string }

const repo = (i: { owner: string; repo: string }) => ({
  owner: i.owner,
  name: i.repo,
})
const flag = (s: 'true' | 'false' | undefined) =>
  s === undefined ? undefined : s === 'true'

// ----- reads ------------------------------------------------------------------

const reads: { [Id in OperationId]?: Read<Id> } = {
  'accounts.list': {
    fn: api.forge.accounts.list,
    args: () => ({}),
    list: true,
  },
  'accounts.get': {
    fn: api.forge.accounts.get,
    args: (i) => ({ handle: i.handle }),
  },
  'members.list': {
    fn: api.forge.accounts.listMembers,
    args: (i) => ({ handle: i.handle }),
    list: true,
  },
  'invitations.list': {
    fn: api.forge.accounts.listInvitations,
    args: (i, c) => ({ handle: i.handle, at: c.at }),
    list: true,
  },
  'repos.list': {
    fn: api.forge.repos.list,
    args: (i, c) => ({
      owner: i.owner,
      after: c.after,
      limit: c.limit,
      at: c.at,
    }),
    page: (i) => ['repos.list', i.owner],
  },
  'repos.get': {
    fn: api.forge.repos.get,
    args: (i, c) => ({ ...repo(i), at: c.at }),
  },
  'stars.get': { fn: api.forge.repos.getStar, args: (i) => repo(i) },
  'issues.list': {
    fn: api.forge.issues.list,
    args: (i, c) => ({
      ...repo(i),
      state: i.state ?? 'open',
      label: i.label,
      author: i.author,
      after: c.after,
      limit: c.limit,
    }),
    page: (i) => [
      'issues.list',
      i.owner,
      i.repo,
      i.state ?? 'open',
      i.label,
      i.author,
    ],
  },
  'issues.get': {
    fn: api.forge.issues.get,
    args: (i) => ({ ...repo(i), number: i.number }),
  },
  'labels.list': {
    fn: api.forge.issues.listLabels,
    args: (i) => repo(i),
    list: true,
  },
  'comments.list': {
    fn: api.forge.issues.listComments,
    args: (i, c) => ({
      ...repo(i),
      number: i.number,
      after: c.after,
      limit: c.limit,
    }),
    page: (i) => ['comments.list', i.owner, i.repo, String(i.number)],
  },
  'changes.list': {
    fn: api.forge.changes.list,
    args: (i, c) => {
      const sort = i.sort ?? '-updated_at'
      return {
        ...repo(i),
        state: i.state,
        author: i.author,
        label: i.label,
        branch: i.branch,
        sort: sort.replace('-', ''),
        desc: sort.startsWith('-'),
        after: c.after,
        limit: c.limit,
        expand: i.expand ? i.expand.split(',') : [],
        at: c.at,
      }
    },
    page: (i) => [
      'changes.list',
      i.owner,
      i.repo,
      i.state,
      i.author,
      i.label,
      i.branch,
      i.sort ?? '-updated_at',
      i.expand,
    ],
  },
  'changes.get': {
    fn: api.forge.changes.get,
    args: (i, c) => ({
      ...repo(i),
      ref: i.number,
      expand: i.expand?.split(',') ?? [],
      at: c.at,
    }),
  },
  'patch_sets.list': {
    fn: api.forge.changes.listPatchSets,
    args: (i, c) => ({ ...repo(i), ref: i.number, at: c.at }),
    list: true,
  },
  'patch_sets.files': {
    fn: api.forge.changes.getPatchSetFiles,
    args: (i) => ({ ...repo(i), ref: i.number, n: i.patchSet }),
  },
  'change_comments.list': {
    fn: api.forge.changes.listReviewComments,
    args: (i, c) => ({
      ...repo(i),
      ref: i.number,
      file: i.file,
      unresolved: flag(i.unresolved),
      at: c.at,
    }),
    list: true,
  },
  'policy.rules': {
    fn: api.forge.policy.get,
    args: (i, c) => ({ ...repo(i), at: c.at }),
  },
  'releases.list': {
    fn: api.forge.releases.list,
    args: (i, c) => ({
      ...repo(i),
      channel: i.channel,
      after: c.after,
      limit: c.limit,
    }),
    page: (i) => ['releases.list', i.owner, i.repo, i.channel],
  },
  'pipelines.list': {
    fn: api.forge.pipelines.list,
    args: (i, c) => ({
      ...repo(i),
      status: i.status,
      workflow: i.workflow,
      after: c.after,
      limit: c.limit,
    }),
    page: (i) => ['pipelines.list', i.owner, i.repo, i.status, i.workflow],
  },
  'pipelines.get': {
    fn: api.forge.pipelines.get,
    args: (i) => ({ ...repo(i), n: i.run }),
  },
  'pipelines.log': {
    fn: api.forge.pipelines.log,
    args: (i) => ({ ...repo(i), n: i.run, job: i.job, step: i.step }),
  },
  'automations.list': {
    fn: api.forge.automations.list,
    args: (i) => repo(i),
    list: true,
  },
  'bots.list': {
    fn: api.forge.automations.listBots,
    args: (i) => ({ handle: i.handle }),
    list: true,
  },
  'people.list': {
    fn: api.forge.people.listPeople,
    args: (i, c) => ({ q: i.q, after: c.after, limit: c.limit }),
    page: (i) => ['people.list', i.q ?? ''],
  },
  'preferences.get': { fn: api.forge.people.getPrefs, args: () => ({}) },
  'notifications.list': {
    fn: api.forge.notifications.list,
    args: (i, c) => ({
      unread: flag(i.unread),
      kind: i.kind,
      after: c.after,
      limit: c.limit,
    }),
    page: (i, r) => [
      'notifications.list',
      r.handle ?? undefined,
      i.unread === undefined ? '' : String(i.unread === 'true'),
      i.kind,
    ],
  },
  'notifications.count': {
    fn: api.forge.notifications.unreadCount,
    args: () => ({}),
  },
  'notifications.preferences': {
    fn: api.forge.notifications.getPrefs,
    args: () => ({}),
  },
  'integrations.list': {
    fn: api.forge.integrations.listConnections,
    args: (i) => ({ handle: i.handle }),
    list: true,
  },
  'integrations.repo': {
    fn: api.forge.integrations.listRepoIntegrations,
    args: (i) => repo(i),
    list: true,
  },
  'links.list': {
    fn: api.forge.integrations.listLinks,
    args: (i) => ({ handle: i.handle }),
    list: true,
  },
}

// ----- writes -----------------------------------------------------------------

const writes: { [Id in OperationId]?: Write<Id> } = {
  'issues.create': {
    fn: api.forge.issues.create,
    args: (i) => ({ ...repo(i), ...i.body }),
    pick: 'issue',
  },
  'issues.update': {
    fn: api.forge.issues.update,
    args: (i) => ({
      ...repo(i),
      number: i.number,
      body: i.body,
      fields: Object.keys(i.body),
    }),
  },
  'comments.create': {
    fn: api.forge.issues.createComment,
    args: (i) => ({ ...repo(i), number: i.number, body: i.body.body }),
  },
  'change_comments.create': {
    fn: api.forge.changes.createReviewComment,
    args: (i) => ({ ...repo(i), ref: i.number, ...i.body }),
  },
  'change_comments.update': {
    fn: api.forge.changes.updateReviewComment,
    args: (i) => ({ ...repo(i), ref: i.number, id: i.comment, ...i.body }),
  },
  'findings.resolve': {
    fn: api.forge.changes.setFinding,
    args: (i) => ({
      ...repo(i),
      ref: i.number,
      finding: i.finding,
      to: 'resolved',
      reason: null,
    }),
  },
  'findings.dismiss': {
    fn: api.forge.changes.setFinding,
    args: (i) => ({
      ...repo(i),
      ref: i.number,
      finding: i.finding,
      to: 'dismissed',
      reason: i.body.reason,
    }),
  },
  'links.set': {
    fn: api.forge.integrations.link,
    args: (i) => ({ handle: i.handle, host: i.host, ...i.body }),
  },
  'links.remove': {
    fn: api.forge.integrations.unlink,
    args: (i) => ({ handle: i.handle, host: i.host }),
    empty: true,
  },
  'integrations.set': {
    fn: api.forge.integrations.setRepoIntegration,
    args: (i) => ({ ...repo(i), id: i.integration, on: i.body.enabled }),
  },
  'integrations.connect': {
    fn: api.forge.integrations.connect,
    args: (i) => ({ handle: i.handle, id: i.integration, key: i.body.key }),
    pick: 'connection',
  },
  'integrations.disconnect': {
    fn: api.forge.integrations.disconnect,
    args: (i) => ({ handle: i.handle, id: i.integration }),
    empty: true,
  },
  'policy.update_rule': {
    fn: api.forge.policy.setRuleMode,
    args: (i) => ({ ...repo(i), rule: i.rule, mode: i.body.mode }),
  },
  'policy.create_rule': {
    fn: api.forge.policy.createRule,
    args: (i) => {
      const { name, ...rest } = i.body
      return { ...repo(i), ruleName: name, ...rest }
    },
    pick: 'rule',
  },
  'policy.delete_rule': {
    fn: api.forge.policy.deleteRule,
    args: (i) => ({ ...repo(i), rule: i.rule }),
    empty: true,
  },
  'policy.add_exception': {
    fn: api.forge.policy.addException,
    args: (i) => ({ ...repo(i), ...i.body }),
  },
  'policy.remove_exception': {
    fn: api.forge.policy.removeException,
    args: (i) => ({ ...repo(i), id: i.exception }),
    empty: true,
  },
  'pipelines.rerun': {
    fn: api.forge.pipelines.rerun,
    args: (i) => ({ ...repo(i), n: i.run }),
  },
  'pipelines.cancel': {
    fn: api.forge.pipelines.cancel,
    args: (i) => ({ ...repo(i), n: i.run }),
  },
  'notifications.read': {
    fn: api.forge.notifications.markRead,
    args: (i) => ({ id: i.notification }),
    empty: true,
  },
  'notifications.read_all': {
    fn: api.forge.notifications.markRead,
    args: () => ({ id: null }),
    empty: true,
  },
  'notifications.update_preferences': {
    fn: api.forge.notifications.updatePrefs,
    args: (i) => ({ prefs: i.body }),
  },
  'invitations.create': {
    fn: api.forge.accounts.invite,
    args: (i) => ({ handle: i.handle, ...i.body }),
    pick: 'invitation',
  },
  'invitations.revoke': {
    fn: api.forge.accounts.revokeInvitation,
    args: (i) => ({ handle: i.handle, id: i.invitation }),
    empty: true,
  },
  'bots.update': {
    fn: api.forge.automations.updateBot,
    args: (i) => ({ slug: i.bot, ...i.body }),
  },
  'automations.create': {
    fn: api.forge.automations.create,
    args: (i) => ({ ...repo(i), body: i.body }),
  },
  'automations.update': {
    fn: api.forge.automations.update,
    args: (i) => ({ ...repo(i), id: i.automation, body: i.body }),
  },
  'automations.run': {
    fn: api.forge.automations.run,
    args: (i) => ({ ...repo(i), id: i.automation }),
  },
  'runs.start': {
    fn: api.forge.runs.start,
    args: (i) => ({ ...repo(i), ttl_minutes: 60, ...i.body }),
    pick: 'run',
  },
}

// ----- what a screen uses ------------------------------------------------------

/** The hour a page reads for. A query may not read the clock, so it is passed in. */
export const hourOf = (ms: number) => ms - (ms % 3_600_000)

export type ScreenRead = {
  fn: FunctionReference<'query'>
  args: Record<string, unknown>
  /** The function's answer (JSON text) as the operation answers it. */
  answer: (text: string) => unknown
}

/** The Convex read behind an operation, when a screen can make it itself. */
export function screenRead<Id extends OperationId>(
  id: Id,
  input: In<Id>,
  reader: Reader,
  now: number,
): ScreenRead | null {
  const spec = reads[id]
  if (!spec) return null
  const paging = input as Paging
  const fp = spec.page && fingerprint(spec.page(input, reader))
  const args = spec.args(input, {
    at: hourOf(now),
    after: fp ? positionOf(paging.cursor, fp) : null,
    limit: Math.min(Math.max(1, paging.limit ?? PAGE.default), PAGE.max),
  })
  // Convex takes no `undefined`: an argument left out is absent.
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k]
  return {
    fn: spec.fn,
    args,
    answer: (text) => {
      const value = JSON.parse(text) as unknown
      if (fp) {
        const p = value as Page
        return {
          object: 'list',
          data: p.items,
          has_more: p.next !== null,
          next_cursor: p.next
            ? `c_${base64url(JSON.stringify([p.next.key, p.next.id, fp]))}`
            : null,
        }
      }
      if (spec.list)
        return {
          object: 'list',
          data: value,
          has_more: false,
          next_cursor: null,
        }
      return value
    },
  }
}

export type ScreenWrite = {
  fn: FunctionReference<'mutation'>
  args: Record<string, unknown>
  answer: (text: string) => unknown
}

/** The Convex write behind an operation, when a screen can make it itself. */
export function screenWrite<Id extends OperationId>(
  id: Id,
  input: In<Id>,
): ScreenWrite | null {
  const spec = writes[id]
  if (!spec) return null
  const args = spec.args(input)
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k]
  return {
    fn: spec.fn,
    args,
    answer: (text) => {
      if (spec.empty) return null
      const value = JSON.parse(text) as Record<string, unknown>
      return spec.pick ? value[spec.pick] : value
    },
  }
}

export const screenReads = Object.keys(reads) as Array<OperationId>
export const screenWrites = Object.keys(writes) as Array<OperationId>
