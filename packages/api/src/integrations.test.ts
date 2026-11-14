import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const A = '/accounts/dana/integrations'
const R = '/repos/dana/gitfs/integrations'

describe('integrations', () => {
  test('what an account connected, and what a repository uses', async () => {
    const h = harness()
    const mine = (await h.call('GET', A)).json.data
    expect(
      mine.map((c: { integration: string }) => c.integration).sort(),
    ).toEqual(['coderabbit', 'selfhosted', 't3code', 'varlock'])
    const repo = (await h.call('GET', R)).json.data
    expect(
      repo.find((r: { integration: string }) => r.integration === 'selfhosted')
        .enabled,
    ).toBe(false)
    expect(
      repo.find((r: { integration: string }) => r.integration === 'coderabbit')
        .enabled,
    ).toBe(true)
  })

  test('a key is kept as a hint; the same key again changes nothing', async () => {
    const h = harness()
    const made = await h.call('PUT', `${A}/boat`, {
      body: { key: 'boat_secret_9f2c' },
    })
    expect(made.status).toBe(201)
    expect(made.json.key_hint).toBe('9f2c')
    expect(JSON.stringify(made.json)).not.toContain('boat_secret')
    const again = await h.call('PUT', `${A}/boat`, {
      body: { key: 'boat_secret_9f2c' },
    })
    expect(again.status).toBe(200)
    const missing = await h.call('PUT', `${A}/e2b`, { body: { key: 'xyz' } })
    expect(missing.status).toBe(409)
    const noKey = await h.call('PUT', `${A}/boat`, { body: {} })
    expect(noKey.status).toBe(400)
  })

  test('a repository uses only what its owner connected; disconnecting turns it off', async () => {
    const h = harness()
    expect(
      (await h.call('PUT', `${R}/blacksmith`, { body: { enabled: true } }))
        .status,
    ).toBe(409)
    await h.call('PUT', `${R}/selfhosted`, { body: { enabled: true } })
    expect(
      (await h.call('GET', R)).json.data.find(
        (r: { integration: string }) => r.integration === 'selfhosted',
      ).enabled,
    ).toBe(true)
    expect((await h.call('DELETE', `${A}/selfhosted`)).status).toBe(204)
    expect(
      (await h.call('GET', R)).json.data.some(
        (r: { integration: string }) => r.integration === 'selfhosted',
      ),
    ).toBe(false)
  })

  test('only the account itself, or its owners and admins', async () => {
    const h = harness()
    const other = await h.call('GET', A, { token: sampleTokens.hollis })
    expect(other.status).toBe(404)
    const member = await h.call(
      'PUT',
      '/accounts/northwind/integrations/coderabbit',
      {
        token: sampleTokens.hollis,
        body: {},
      },
    )
    expect(member.status).toBe(403)
    expect(
      (
        await h.call('PUT', '/accounts/northwind/integrations/coderabbit', {
          body: {},
        })
      ).status,
    ).toBe(201)
    expect((await h.call('PUT', `${A}/nope`, { body: {} })).status).toBe(404)
  })
})
