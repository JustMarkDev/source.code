import { Effect } from 'effect'
import { z } from 'zod'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape } from './common'

const handleParams = z.strictObject({
  handle: z.string().describe('The account handle'),
})

export const getAccountPrefs = defineOp({
  id: 'preferences.get',
  summary: 'What your profile shows, and how downloads pick a file',
  tags: ['accounts'],
  method: 'GET',
  path: '/user/preferences',
  auth: 'required',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  response: S.AccountPreferences,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getAccountPrefs(ctx.principal))
    }),
})

export const updateAccountPrefs = defineOp({
  id: 'preferences.update',
  summary: 'Change what your profile shows',
  description:
    'Send only what changes. Hiding activity hides the daily graph and the list of what you did from everyone else; turning `searchable` off takes you out of the people directory and search.',
  tags: ['accounts'],
  method: 'PATCH',
  path: '/user/preferences',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  body: z.strictObject({
    combined_total: z.boolean().optional(),
    private_totals: z.boolean().optional(),
    show_activity: z.boolean().optional(),
    show_agents: z.boolean().optional(),
    searchable: z.boolean().optional(),
    download_target: z
      .strictObject({
        os: z.enum(['macos', 'windows', 'linux']),
        arch: z.enum(['arm64', 'x64']),
      })
      .nullable()
      .optional(),
  }),
  response: S.AccountPreferences,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.updateAccountPrefs(ctx.principal, ctx.body))
    }),
})

export const followAccount = defineOp({
  id: 'follows.add',
  summary: 'Follow an account',
  description:
    'People only. Following someone you already follow changes nothing.',
  tags: ['accounts'],
  method: 'PUT',
  path: '/user/following/{handle}',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  params: handleParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.follow(ctx.principal, ctx.params.handle, true))
      return reply(null, { status: 204 })
    }),
})

export const unfollowAccount = defineOp({
  id: 'follows.remove',
  summary: 'Stop following an account',
  tags: ['accounts'],
  method: 'DELETE',
  path: '/user/following/{handle}',
  auth: 'required',
  pool: 'write',
  safety: 'write',
  idempotent: true,
  params: handleParams,
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.follow(ctx.principal, ctx.params.handle, false))
      return reply(null, { status: 204 })
    }),
})

const followList = (which: 'followers' | 'following') =>
  defineOp({
    id: `follows.${which}`,
    summary:
      which === 'followers'
        ? 'Who follows an account'
        : 'Who an account follows',
    tags: ['accounts'],
    method: 'GET',
    path: `/accounts/{handle}/${which}`,
    auth: 'optional',
    pool: 'read',
    safety: 'read',
    idempotent: true,
    params: handleParams,
    query: z.strictObject({ ...pageShape }),
    response: S.listOf(S.AccountRef),
    errors: ['not_found', 'cursor_mismatch'],
    probe: (ctx, d) => d.peopleVersion(ctx.principal),
    handler: (ctx) =>
      Effect.gen(function* () {
        const { run } = yield* Domain
        const f = fp(`follows.${which}`, ctx.params.handle)
        const page = yield* run((d) =>
          d.listFollows(ctx.params.handle, which, {
            after: afterOf(ctx.query.cursor, f),
            limit: ctx.query.limit,
          }),
        )
        return listOf(page.items, page.next, f)
      }),
  })

export const listFollowers = followList('followers')
export const listFollowing = followList('following')

export const getProfile = defineOp({
  id: 'accounts.profile',
  summary: "An account's profile: what they did, counted",
  description:
    'Worked out from commits, reviews, changes, issues and releases in the past year, in the repositories you can see. Work in private repositories adds to the totals as a number only, if the person allows it. What a person hides in their preferences is empty or null.',
  tags: ['accounts'],
  method: 'GET',
  path: '/accounts/{handle}/profile',
  auth: 'optional',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  params: handleParams,
  response: S.Profile,
  errors: ['not_found'],
  probe: (ctx, d) => d.profileVersion(ctx.params.handle, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.profile(ctx.params.handle, ctx.principal))
    }),
})

export const listPeople = defineOp({
  id: 'people.list',
  summary: 'The directory of people',
  description:
    'People who chose to be listed, most followed first. `q` matches the handle, the name or the bio.',
  tags: ['accounts'],
  method: 'GET',
  path: '/people',
  auth: 'optional',
  pool: 'read',
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    ...pageShape,
    q: z.string().max(100).optional().describe('Words to match'),
  }),
  response: S.listOf(S.PersonEntry),
  errors: ['cursor_mismatch'],
  probe: (ctx, d) => d.peopleVersion(ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp('people.list', ctx.query.q ?? '')
      const page = yield* run((d) =>
        d.listPeople(ctx.principal, {
          q: ctx.query.q,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const peopleOps = [
  getAccountPrefs,
  updateAccountPrefs,
  followAccount,
  unfollowAccount,
  listFollowers,
  listFollowing,
  getProfile,
  listPeople,
]
