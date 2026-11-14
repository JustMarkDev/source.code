import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const E = '/repos/dana/gitfs/env'

describe('secrets, as the settings page reads them', () => {
  test('variables say which environments need them and when they last changed', async () => {
    const h = harness()
    const list = (await h.call('GET', `${E}?environment=production`)).json.data
    const db = list.find((v: { name: string }) => v.name === 'DATABASE_URL')
    expect(db).toMatchObject({
      required: ['development', 'production'],
      rotated_by: 'dana',
      set: true,
    })
    expect(db.rotated_at).not.toBe(null)
  })

  test('setting a value again is a rotation, in the audit log', async () => {
    const h = harness()
    const r = await h.call('PUT', `${E}/STRIPE_KEY/production`, {
      body: { ciphertext: 'age-encryption.org/v1 …' },
    })
    expect(r.status).toBe(200)
    expect(r.json.rotated_by).toBe('dana')
    const audit = (await h.call('GET', `${E}/audit`)).json.data
    expect(audit[0]).toMatchObject({
      kind: 'rotate',
      target: 'STRIPE_KEY in production',
    })
  })

  test('recipients by name; add one, remove one', async () => {
    const h = harness()
    const before = (await h.call('GET', `${E}/recipients`)).json.data
    expect(before[0]).toMatchObject({ name: 'dana', kind: 'member' })
    const added = await h.call('POST', `${E}/recipients`, {
      body: {
        name: 'preview deploy',
        kind: 'deploy',
        fingerprint: 'age1prev…x9',
        environments: ['preview'],
      },
    })
    expect(added.status).toBe(201)
    const again = await h.call('POST', `${E}/recipients`, {
      body: {
        name: 'preview deploy',
        kind: 'deploy',
        fingerprint: 'age1prev…x9',
        environments: ['preview'],
      },
    })
    expect(again.status).toBe(200)
    expect(
      (await h.call('DELETE', `${E}/recipients/${added.json.id}`)).status,
    ).toBe(204)
    const after = (await h.call('GET', `${E}/recipients`)).json.data
    expect(after).toHaveLength(before.length)
    expect((await h.call('DELETE', `${E}/recipients/nope`)).status).toBe(404)
  })

  test('only people who can change the repository manage recipients', async () => {
    const h = harness()
    const r = await h.call('POST', `${E}/recipients`, {
      token: sampleTokens.stranger,
      body: {
        name: 'x',
        kind: 'member',
        fingerprint: 'age1zzzz',
        environments: ['preview'],
      },
    })
    expect([403, 404]).toContain(r.status)
  })
})
