import { describe, expect, test } from 'bun:test'
import { ConvexError } from 'convex/values'
import { SxError, createClient } from '@source-code/sdk'
import { convexFactory } from './convex-testing'
import { createSampleApi } from './index'
import { T0, sampleTokens } from './sample'
import {
  hourOf,
  screenRead,
  screenReads,
  screenWrite,
  screenWrites,
} from './screens'
import { clock } from './testing'
import type { OperationId, Operations } from '@source-code/sdk'

/**
 * A page calls Convex itself (`screens.ts`); a client of the API calls the
 * operation. Both must answer the same, so a screen sees exactly what the
 * API would show the same person. Each read and write a screen makes runs
 * both ways here, and the answers are compared.
 */

type Who = 'dana' | 'hollis' | null
type Person = (
  kind: 'query' | 'mutation',
  ref: unknown,
  args: unknown,
  handle: string | null,
) => Promise<unknown>

function world() {
  // On the hour, so the hour a page reads for is the API's own clock.
  const now = clock(hourOf(T0) + 3 * 3_600_000)
  const api = createSampleApi({
    mount: '/v1',
    now,
    domainFactory: convexFactory,
  })
  const asPerson = (api.port as unknown as { asPerson: Person }).asPerson
  const client = (who: Who) =>
    createClient({
      baseUrl: 'https://api.test/v1',
      token: who ? sampleTokens[who] : undefined,
      retries: 0,
      cacheSize: 0,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        api.fetch(new Request(input, init))) as typeof fetch,
    })
  const viaApi = async <Id extends OperationId>(
    who: Who,
    id: Id,
    input: Operations[Id]['input'],
  ) => {
    try {
      return { ok: (await client(who).call(id, input)) ?? null }
    } catch (e) {
      if (e instanceof SxError) return { refused: e.code }
      throw e
    }
  }
  const direct = async (
    kind: 'query' | 'mutation',
    r: { fn: unknown; args: unknown; answer: (t: string) => unknown },
    who: Who,
  ) => {
    try {
      return {
        ok: r.answer((await asPerson(kind, r.fn, r.args, who)) as string),
      }
    } catch (e) {
      const data =
        e instanceof ConvexError ? (e.data as { code?: string }) : null
      if (data?.code) return { refused: data.code }
      // Arguments of the wrong shape never reach the function.
      if (e instanceof Error && /Validator error/.test(e.message))
        return { refused: 'invalid_request' }
      throw e
    }
  }
  const viaScreen = <Id extends OperationId>(
    who: Who,
    id: Id,
    input: Operations[Id]['input'],
  ) => {
    const r = screenRead(id, input, { handle: who }, now())
    if (!r) throw new Error(`${id} is not a screen read`)
    return direct('query', r, who)
  }
  const writeViaScreen = <Id extends OperationId>(
    who: Who,
    id: Id,
    input: Operations[Id]['input'],
  ) => {
    const r = screenWrite(id, input)
    if (!r) throw new Error(`${id} is not a screen write`)
    return direct('mutation', r, who)
  }
  return { api, viaApi, viaScreen, writeViaScreen, now }
}

/** Ids and times differ between two worlds that each made the same thing. */
function normal(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/\b[a-z]{2,5}_[0-9a-z]{16,}\b/g, '<id>')
      .replace(/\bsx[a-z]_[0-9A-Za-z_-]{20,}/g, '<token>')
      .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'),
  )
}

const covered = new Set<OperationId>()

describe('a screen reads what the API answers', () => {
  const w = world()
  const same = async <Id extends OperationId>(
    who: Who,
    id: Id,
    input: Operations[Id]['input'],
  ) => {
    covered.add(id)
    const a = await w.viaApi(who, id, input)
    const b = await w.viaScreen(who, id, input)
    expect({ id, who, input, answer: b }).toEqual({ id, who, input, answer: a })
    return a.ok as Operations[Id]['output']
  }
  const at = { owner: 'dana', repo: 'gitfs' }

  test('accounts and people', async () => {
    await same('dana', 'accounts.list', {})
    await same('dana', 'accounts.get', { handle: 'dana' })
    await same(null, 'accounts.get', { handle: 'northwind' })
    await same('dana', 'members.list', { handle: 'northwind' })
    await same('hollis', 'members.list', { handle: 'northwind' })
    await same('dana', 'invitations.list', { handle: 'northwind' })
    await same('dana', 'preferences.get', {})
    await same('dana', 'links.list', { handle: 'dana' })
    await same('dana', 'integrations.list', { handle: 'dana' })
    await same('dana', 'bots.list', { handle: 'dana' })
    const people = await same('dana', 'people.list', { limit: 2 })
    expect(people.next_cursor).not.toBeNull()
    await same('dana', 'people.list', {
      limit: 2,
      cursor: people.next_cursor ?? undefined,
    })
    await same(null, 'people.list', { limit: 200 })
  })

  test('repositories', async () => {
    const first = await same('dana', 'repos.list', { limit: 2 })
    await same('dana', 'repos.list', {
      limit: 2,
      cursor: first.next_cursor ?? undefined,
    })
    await same('dana', 'repos.list', { owner: 'dana', limit: 100 })
    await same(null, 'repos.list', { limit: 200 })
    await same('dana', 'repos.get', at)
    await same(null, 'repos.get', at)
    await same('dana', 'repos.get', { owner: 'dana', repo: 'no-such-repo' })
    await same('dana', 'stars.get', at)
    await same('dana', 'integrations.repo', at)
    await same('dana', 'policy.rules', at)
    await same('dana', 'automations.list', at)
    await same('dana', 'releases.list', { ...at, limit: 50 })
  })

  test('issues', async () => {
    const open = await same('dana', 'issues.list', { ...at, limit: 2 })
    await same('dana', 'issues.list', {
      ...at,
      limit: 2,
      cursor: open.next_cursor ?? undefined,
    })
    await same('dana', 'issues.list', { ...at, state: 'closed', limit: 100 })
    await same(null, 'issues.list', { ...at, state: 'all' })
    const number = open.data[0].number
    await same('dana', 'issues.get', { ...at, number })
    await same('dana', 'issues.get', { ...at, number: 99_999 })
    await same('dana', 'comments.list', { ...at, number, limit: 200 })
    await same('dana', 'labels.list', at)
  })

  test('changes', async () => {
    const all = await same('dana', 'changes.list', {
      ...at,
      state: 'all',
      limit: 2,
    })
    await same('dana', 'changes.list', {
      ...at,
      state: 'all',
      limit: 2,
      cursor: all.next_cursor ?? undefined,
    })
    await same('dana', 'changes.list', { ...at, limit: 100 })
    const number = String(all.data[0].number)
    await same('dana', 'changes.get', {
      ...at,
      number,
      expand: 'findings,check_runs',
    })
    await same(null, 'changes.get', { ...at, number })
    const sets = await same('dana', 'patch_sets.list', { ...at, number })
    for (const p of sets.data)
      await same('dana', 'patch_sets.files', {
        ...at,
        number,
        patchSet: p.number,
      })
    await same('dana', 'change_comments.list', { ...at, number })
    await same('dana', 'change_comments.list', {
      ...at,
      number,
      unresolved: 'true',
    })
  })

  test('pipelines', async () => {
    const runs = await same('dana', 'pipelines.list', { ...at, limit: 2 })
    await same('dana', 'pipelines.list', { ...at, limit: 100 })
    const run = runs.data[0].number
    const one = await same('dana', 'pipelines.get', { ...at, run })
    const job = one.jobs?.[0]
    if (job)
      await same('dana', 'pipelines.log', { ...at, run, job: 1, step: 1 })
  })

  test('notifications', async () => {
    await same('dana', 'notifications.list', { limit: 100 })
    const page = await same('dana', 'notifications.list', { limit: 1 })
    expect(page.next_cursor).not.toBeNull()
    await same('dana', 'notifications.list', { unread: 'true' })
    await same('dana', 'notifications.count', {})
    await same('dana', 'notifications.preferences', {})
    await same(null, 'notifications.count', {})
  })

  test('every read a screen makes is checked here', () => {
    expect([...covered].sort()).toEqual([...screenReads].sort())
  })
})

describe('a screen writes what the API writes', () => {
  // Two worlds, the same writes: one through the API, one as a page makes
  // them. What one write made has a new id in each world, so an input that
  // names it is made once per side.
  const worlds = [world(), world()] as const
  type Side = 0 | 1
  const done = new Set<OperationId>()
  const same = async <Id extends OperationId>(
    who: Who,
    id: Id,
    input: Operations[Id]['input'] | ((side: Side) => Operations[Id]['input']),
  ) => {
    done.add(id)
    const of = (s: Side) => (typeof input === 'function' ? input(s) : input)
    const a = await worlds[0].viaApi(who, id, of(0))
    const b = await worlds[1].writeViaScreen(who, id, of(1))
    expect({ id, answer: normal(b) }).toEqual({ id, answer: normal(a) })
    return [a.ok, b.ok] as [Operations[Id]['output'], Operations[Id]['output']]
  }
  const read = <Id extends OperationId>(
    id: Id,
    input: Operations[Id]['input'],
  ) => worlds[0].viaApi('dana', id, input).then((r) => r.ok!)
  const at = { owner: 'dana', repo: 'gitfs' }

  test('issues and comments', async () => {
    const issue = await same('dana', 'issues.create', {
      ...at,
      body: { title: 'From a page', body: 'Both ways', labels: [] },
    })
    await same('dana', 'issues.update', (s) => ({
      ...at,
      number: issue[s].number,
      body: { state: 'closed', title: 'Closed from a page' },
    }))
    await same('dana', 'comments.create', (s) => ({
      ...at,
      number: issue[s].number,
      body: { body: '  A comment, trimmed  ' },
    }))
    await same('dana', 'comments.create', (s) => ({
      ...at,
      number: issue[s].number,
      body: { body: '   ' },
    }))
    await same('dana', 'issues.create', { ...at, body: { title: '' } })
    await same('dana', 'issues.create', {
      ...at,
      body: { title: 'x'.repeat(301) },
    })
    await same(null, 'issues.create', { ...at, body: { title: 'Visitor' } })
    await same('dana', 'issues.create', {
      owner: 'dana',
      repo: 'no-such-repo',
      body: { title: 'Nowhere' },
    })
  })

  test('review comments and findings', async () => {
    const list = await read('changes.list', {
      ...at,
      state: 'all',
      expand: 'findings',
    })
    const change = list.data.find((c) => (c.findings?.length ?? 0) > 1)!
    const number = String(change.number)
    const comment = await same('dana', 'change_comments.create', {
      ...at,
      number,
      body: { body: 'On the whole change' },
    })
    await same('dana', 'change_comments.update', (s) => ({
      ...at,
      number,
      comment: comment[s].id,
      body: { resolved: true },
    }))
    const [first, second] = change.findings ?? []
    await same('dana', 'findings.resolve', {
      ...at,
      number,
      finding: first.id,
    })
    await same('dana', 'findings.dismiss', {
      ...at,
      number,
      finding: second.id,
      body: { reason: '' },
    })
    await same('dana', 'findings.dismiss', {
      ...at,
      number,
      finding: second.id,
      body: { reason: 'Not this time' },
    })
  })

  test('policy', async () => {
    const rule = await same('dana', 'policy.create_rule', {
      ...at,
      body: {
        id: 'size',
        name: '  Small changes ',
        kind: 'max_lines',
        max_lines: 400,
        mode: 'dry-run',
      },
    })
    await same('dana', 'policy.create_rule', {
      ...at,
      body: { id: 'Bad Id', name: 'x', kind: 'max_lines', max_lines: 1 },
    })
    await same('dana', 'policy.update_rule', (s) => ({
      ...at,
      rule: rule[s].id,
      body: { mode: 'enforce' },
    }))
    const ex = await same('dana', 'policy.add_exception', (s) => ({
      ...at,
      body: {
        rule: rule[s].id,
        who: 'hollis',
        reason: 'Migrating',
        expires_at: new Date(worlds[s].now() + 86_400_000).toISOString(),
      },
    }))
    await same('dana', 'policy.remove_exception', (s) => ({
      ...at,
      exception: ex[s].id,
    }))
    await same('dana', 'policy.delete_rule', (s) => ({
      ...at,
      rule: rule[s].id,
    }))
  })

  test('pipelines, automations and runs', async () => {
    const runs = await read('pipelines.list', at)
    const finished = runs.data.find(
      (r) => r.status === 'success' || r.status === 'failure',
    )!
    await same('dana', 'pipelines.rerun', { ...at, run: finished.number })
    const going = runs.data.find(
      (r) => r.status === 'running' || r.status === 'queued',
    )
    if (going)
      await same('dana', 'pipelines.cancel', { ...at, run: going.number })
    const bots = await read('bots.list', { handle: 'dana' })
    const bot =
      bots.data.find((b) => b.installs.includes('dana/gitfs')) ?? bots.data[0]
    await same('dana', 'bots.update', {
      bot: bot.slug,
      body: { description: 'Changed from a page' },
    })
    const made = await same('dana', 'automations.create', {
      ...at,
      body: {
        name: 'Triage',
        bot: bot.slug,
        triggers: ['issue.created'],
        runtime: 'claude',
        target: 'issues',
        instructions: 'Label it.',
      },
    })
    await same('dana', 'automations.update', (s) => ({
      ...at,
      automation: made[s].id,
      body: { enabled: false },
    }))
    await same('dana', 'automations.update', (s) => ({
      ...at,
      automation: made[s].id,
      body: { enabled: true },
    }))
    await same('dana', 'automations.run', (s) => ({
      ...at,
      automation: made[s].id,
    }))

    await same('dana', 'runs.start', { ...at, body: { task: 'Tidy the docs' } })
    await same('dana', 'runs.start', { ...at, body: { task: '' } })
  })

  test('accounts, links and integrations', async () => {
    await same('dana', 'links.set', {
      handle: 'dana',
      host: 'gitlab',
      body: { login: 'dana-gl' },
    })
    await same('dana', 'links.set', {
      handle: 'dana',
      host: 'gitlab',
      body: { login: '' },
    })
    await same('dana', 'links.remove', { handle: 'dana', host: 'gitlab' })
    const catalog = await read('integrations.list', { handle: 'dana' })
    expect(catalog.object).toBe('list')
    await same('dana', 'integrations.connect', {
      handle: 'dana',
      integration: 'linear',
      body: { key: 'lin_api_0123456789abcdef' },
    })
    await same('dana', 'integrations.set', {
      ...at,
      integration: 'linear',
      body: { enabled: true },
    })
    await same('dana', 'integrations.disconnect', {
      handle: 'dana',
      integration: 'linear',
    })
    const inv = await same('dana', 'invitations.create', {
      handle: 'northwind',
      body: { email: 'new@example.com', role: 'member' },
    })
    await same('dana', 'invitations.create', {
      handle: 'northwind',
      body: { email: 'not an address', role: 'member' },
    })
    await same('dana', 'invitations.revoke', (s) => ({
      handle: 'northwind',
      invitation: inv[s].id,
    }))
    // A member, not an admin: refused both ways.
    await same('dana', 'invitations.create', {
      handle: 'lumen-studio',
      body: { email: 'other@example.com', role: 'member' },
    })
  })

  test('notifications', async () => {
    await same('dana', 'notifications.update_preferences', {
      body: { digest: false },
    })
    const list = await read('notifications.list', { unread: 'true' })
    await same('dana', 'notifications.read', {
      notification: list.data[0].id,
    })
    await same('dana', 'notifications.read_all', {})
  })

  test('every write a screen makes is checked here', () => {
    expect([...done].sort()).toEqual([...screenWrites].sort())
  })
})
