import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createSampleApi } from '@source-code/api'
import { Callers, forgeOver } from './forge'
import type { CurrentUser } from '~/lib/auth/server'
import type { AuthStore } from '@source-code/api/auth'

const person = (handle: string, name: string): CurrentUser => ({
  id: handle,
  name,
  email: `${handle}@example.com`,
  handle,
})
const dana = person('dana', 'Dana Okafor')

function setup(user: CurrentUser | null, now?: () => number) {
  const api = createSampleApi({
    base: 'http://app.test/api/v1',
    mount: '/api/v1',
    htmlBase: 'http://app.test',
    now,
  })
  const callers = new Callers(api, 'http://app.test/api/v1', now)
  const forge = forgeOver(async () => ({ client: await callers.for(user) }))
  return { api, callers, forge }
}

const run = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(effect)
const failure = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(Effect.flip(effect))

test('a visitor reads a public repository and cannot see a private one', async () => {
  const { forge } = setup(null)
  const repo = await run(
    forge.call('repos.get', { owner: 'dana', repo: 'gitfs' }),
  )
  expect(repo.full_name).toBe('dana/gitfs')
  const hidden = await failure(
    forge.call('repos.get', { owner: 'dana', repo: 'notes' }),
  )
  expect(hidden._tag).toBe('NotFound')
})

test('the signed-in person sees what they may see, as themselves', async () => {
  const { forge } = setup(dana)
  const notes = await run(
    forge.call('repos.get', { owner: 'dana', repo: 'notes' }),
  )
  expect(notes.visibility).toBe('private')
  const me = await run(forge.call('auth.principal', {}))
  expect(me.login).toBe('dana')
})

test('someone else signed in does not see it', async () => {
  const { forge } = setup(person('stranger', 'Sam Stranger'))
  const hidden = await failure(
    forge.call('git.tree', { owner: 'dana', repo: 'notes' }),
  )
  expect(hidden._tag).toBe('NotFound')
})

test('a person the domain has not met is known after their first call', async () => {
  const { forge, api } = setup(person('newcomer', 'New Comer'))
  const me = await run(forge.call('auth.principal', {}))
  expect(me.login).toBe('newcomer')
  const account = await api.domain.getAccount('newcomer', null)
  expect(account.name).toBe('New Comer')
})

test('a refusal carries the code and a message for the person', async () => {
  const { forge } = setup(person('stranger', 'Sam Stranger'))
  const refused = await failure(
    forge.call('repos.update', {
      owner: 'dana',
      repo: 'gitfs',
      body: { description: 'mine now' },
    }),
  )
  expect(refused._tag).toBe('Refused')
  if (refused._tag !== 'Refused') throw new Error('unreachable')
  expect(refused.code).toBe('forbidden')
  expect(refused.status).toBe(403)
  expect(refused.message.length).toBeGreaterThan(0)
})

test('a person acts as themself, and no token is made for it', async () => {
  const { callers, api } = setup(dana)
  const before = (api.domain.svc.auth as AuthStore).list('dana', [
    'personal',
    'bot',
    'run',
    'oauth',
  ]).length
  const first = await callers.for(dana)
  expect(await callers.for(dana)).toBe(first)
  const me = await first.call('auth.principal', {})
  expect(me.login).toBe('dana')
  expect(me.class).toBe('human')
  // Signing in mints nothing: there is no secret to leak or let expire.
  expect(
    (api.domain.svc.auth as AuthStore).list('dana', [
      'personal',
      'bot',
      'run',
      'oauth',
    ]).length,
  ).toBe(before)
  callers.drop('dana')
  expect(await callers.for(dana)).not.toBe(first)
})

test('the app token is not among the tokens a person lists', async () => {
  const { forge } = setup(dana)
  const listed = await run(forge.call('tokens.list', {}))
  expect(listed.data.some((t) => t.name === 'web session')).toBe(false)
})

test('the code screen reads every path in one call', async () => {
  const { forge } = setup(null)
  const tree = await run(
    forge.call('git.tree', { owner: 'dana', repo: 'gitfs', recursive: 'true' }),
  )
  expect(tree.entries.length).toBeGreaterThan(1)
  const blob = await run(
    forge.call('git.blob', {
      owner: 'dana',
      repo: 'gitfs',
      path: tree.entries[0].path,
      ref: tree.ref,
    }),
  )
  expect(blob.path).toBe(tree.entries[0].path)
})
