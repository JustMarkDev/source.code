import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { clock, harness } from './testing'

const R = '/repos/dana/gitfs'

describe('bots', () => {
  test('the bots an account owns, where they are installed, their tokens', async () => {
    const h = harness()
    const bots = (await h.call('GET', '/accounts/dana/bots')).json.data
    const triage = bots.find((b: { slug: string }) => b.slug === 'triage-bot')
    expect(triage).toMatchObject({
      object: 'bot',
      class: 'bot',
      installs: ['dana/gitfs', 'dana/tinyqueue'],
    })
    expect(triage.tokens).toBe(1)
    expect(
      (
        await h.call('GET', '/accounts/dana/bots', {
          token: sampleTokens.hollis,
        })
      ).status,
    ).toBe(404)
  })

  test('making one, installing it, and a token limited to where it is installed', async () => {
    const h = harness()
    const made = await h.call('POST', '/accounts/dana/bots', {
      body: {
        slug: 'docs-bot',
        name: 'Docs bot',
        scopes: ['repo:read', 'pulls:comment'],
      },
    })
    expect(made.status).toBe(201)
    expect(made.json.installs).toEqual([])
    const again = await h.call('POST', '/accounts/dana/bots', {
      body: { slug: 'docs-bot', name: 'Docs bot', scopes: ['repo:read'] },
    })
    expect(again.status).toBe(200)
    const taken = await h.call('POST', '/accounts/dana/bots', {
      body: { slug: 'hollis', name: 'x', scopes: ['repo:read'] },
    })
    expect(taken.status).toBe(400)
    const installed = await h.call('PUT', `${R}/bots/docs-bot`, {
      body: { installed: true },
    })
    expect(installed.json.installs).toEqual(['dana/gitfs'])
    const t = await h.call('POST', '/bots/docs-bot/tokens', {
      body: { days: 7 },
    })
    expect(t.status).toBe(201)
    expect(t.json.repos).toEqual(['dana/gitfs'])
    expect(t.json.token).toMatch(/^sxb_/)
    // The token works as the bot, in the repository it is installed on.
    const who = await h.call('GET', '/auth/principal', { token: t.json.token })
    expect(who.json).toMatchObject({ login: 'docs-bot', class: 'bot' })
    expect(
      (await h.call('GET', '/repos/dana/notes', { token: t.json.token }))
        .status,
    ).toBe(404)
  })
})

test('an installed bot can lose scopes but not gain them', async () => {
  const h = harness()
  const less = await h.call('PATCH', '/bots/triage-bot', {
    body: { scopes: ['repo:read', 'issues:read'] },
  })
  expect(less.json.scopes).toEqual(['repo:read', 'issues:read'])
  const more = await h.call('PATCH', '/bots/triage-bot', {
    body: { scopes: ['repo:read', 'issues:read', 'repo:write'] },
  })
  expect(more.status).toBe(409)
})

describe('automations', () => {
  test('listed for people who can change the repository', async () => {
    const h = harness()
    const list = (await h.call('GET', `${R}/automations`)).json.data
    expect(list.map((a: { name: string }) => a.name)).toContain(
      'Triage new issues',
    )
    expect(
      (
        await h.call('GET', `${R}/automations`, {
          token: sampleTokens.stranger,
        })
      ).status,
    ).toBe(403)
  })

  test('counted each time its trigger fires, not when turned off', async () => {
    const h = harness()
    const triage = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { name: string }) => a.name === 'Triage new issues',
    )
    await h.call('POST', `${R}/issues`, { body: { title: 'A new one' } })
    const after = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { id: string }) => a.id === triage.id,
    )
    expect(after.triggered).toBe(triage.triggered + 1)
    await h.call('PATCH', `${R}/automations/${triage.id}`, {
      body: { enabled: false },
    })
    await h.call('POST', `${R}/issues`, { body: { title: 'Another one' } })
    const off = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { id: string }) => a.id === triage.id,
    )
    expect(off.triggered).toBe(after.triggered)
  })

  test('needs its bot installed; can be deleted', async () => {
    const h = harness()
    const body = {
      name: 'Review docs',
      bot: 'triage-bot',
      triggers: ['change.opened'],
      runtime: 'Claude Code',
      target: 'T3 Code',
      instructions: 'Read the docs changes and comment.',
    }
    const ok = await h.call('POST', `${R}/automations`, { body })
    expect(ok.status).toBe(201)
    expect(ok.json.enabled).toBe(true)
    const nope = await h.call('POST', '/repos/dana/notes/automations', { body })
    expect(nope.status).toBe(409)
    expect(
      (await h.call('DELETE', `${R}/automations/${ok.json.id}`)).status,
    ).toBe(204)
  })
})

describe('running an automation', () => {
  test('a trigger starts a run its bot picks up with its own token', async () => {
    const h = harness()
    await h.call('POST', `${R}/issues`, { body: { title: 'Wakes the bot' } })
    const auto = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { bot: string }) => a.bot === 'triage-bot',
    )
    expect(auto.last_run).toStartWith('run_')
    const run = (await h.call('GET', `${R}/runs/${auto.last_run}`)).json
    expect(run).toMatchObject({ state: 'running' })
    expect(run.actor.handle).toBe('triage-bot')
    expect(run.task).toContain('issue.created')
    // Someone else cannot take it.
    expect(
      (await h.call('POST', `${R}/runs/${auto.last_run}/claim`)).status,
    ).toBe(403)
    const claimed = await h.call('POST', `${R}/runs/${auto.last_run}/claim`, {
      token: sampleTokens.triage,
    })
    expect(claimed.status).toBe(200)
    expect(claimed.json.token).toStartWith('sxr_')
    // The run's token reports on its own run.
    const noted = await h.call('POST', `${R}/runs/${auto.last_run}/notes`, {
      token: claimed.json.token,
      body: { text: 'Labelled it.' },
    })
    expect(noted.status).toBe(200)
  })

  test('a comment that names the bot wakes it', async () => {
    const h = harness()
    await h.call('POST', `${R}/automations`, {
      body: {
        name: 'Answer when asked',
        bot: 'triage-bot',
        triggers: ['bot.mentioned'],
        runtime: 'Claude Code',
        target: 'E2B',
        instructions: 'Answer the question.',
      },
    })
    await h.call('POST', `${R}/issues/4/comments`, {
      body: { body: '@triage-bot can you label this?' },
    })
    const mine = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { name: string }) => a.name === 'Answer when asked',
    )
    expect(mine.triggered).toBe(1)
    expect(mine.last_run).toStartWith('run_')
  })
})

describe('the other triggers', () => {
  test('a raised finding wakes the bot that fixes findings', async () => {
    const h = harness()
    const raised = await h.call('POST', `${R}/changes/216/findings`, {
      token: sampleTokens.hollis,
      body: {
        severity: 'high',
        file: 'src/refs.rs',
        line: 3,
        title: 'The cache never forgets a ref that later appears',
      },
    })
    expect(raised.status).toBe(201)
    expect(raised.json).toMatchObject({ state: 'open', severity: 'high' })
    expect(raised.json.label).toMatch(/^F-\d+$/)
    const fixer = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { triggers: Array<string> }) => a.triggers.includes('finding.raised'),
    )
    expect(fixer.last_run).toStartWith('run_')
    const run = (await h.call('GET', `${R}/runs/${fixer.last_run}`)).json
    expect(run.task).toContain('finding.raised')
    expect(run.change).toBe(216)
    // A high finding holds the change back.
    const c = (await h.call('GET', `${R}/changes/216`)).json
    expect(c.policy.state).toBe('blocked')
  })

  test('a finding goes on a file the change touches', async () => {
    const h = harness()
    const bad = await h.call('POST', `${R}/changes/216/findings`, {
      body: { severity: 'low', file: 'nope.rs', line: 1, title: 'x' },
    })
    expect(bad.status).toBe(400)
  })

  test('a schedule fires when it is due, once', async () => {
    const now = clock()
    const h = harness({ now })
    const made = (
      await h.call('POST', `${R}/automations`, {
        body: {
          name: 'Hourly sweep',
          bot: 'triage-bot',
          triggers: ['schedule'],
          runtime: 'Claude Code',
          target: 'E2B',
          instructions: 'Sweep.',
          every: 'hour',
        },
      })
    ).json
    expect(made.every).toBe('hour')
    expect(Date.parse(made.next_run_at) - now()).toBe(3_600_000)
    const d = h.api.port
    expect(await d.tickSchedules()).toBe(0)
    now.advance(3_600_000)
    expect(await d.tickSchedules()).toBe(1)
    // Missed intervals do not pile up: the next is an hour after this one.
    now.advance(5 * 3_600_000)
    expect(await d.tickSchedules()).toBe(1)
    expect(await d.tickSchedules()).toBe(0)
    const after = (await h.call('GET', `${R}/automations`)).json.data.find(
      (a: { id: string }) => a.id === made.id,
    )
    expect(after.triggered).toBe(2)
    expect(after.last_run).toStartWith('run_')
  })

  test('run now starts the bot run straight away', async () => {
    const h = harness()
    const [first] = (await h.call('GET', `${R}/automations`)).json.data
    const r = await h.call('POST', `${R}/automations/${first.id}/run`)
    expect(r.status).toBe(201)
    expect(r.json.task).toContain('started by dana')
    expect(r.json.actor.handle).toBe(first.bot)
  })
})
