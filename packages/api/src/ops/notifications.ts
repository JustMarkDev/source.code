import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape } from './common'

const mine = {
  tags: ['notifications'],
  auth: 'required' as const,
}
const read = {
  ...mine,
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
}
const write = {
  ...mine,
  pool: 'write' as const,
  safety: 'write' as const,
  idempotent: true,
}
const yes = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

export const listNotifications = defineOp({
  ...read,
  id: 'notifications.list',
  summary: 'Your inbox',
  description:
    'Newest first. What reaches it follows your preferences, and something about a repository you can no longer read drops out.',
  method: 'GET',
  path: '/notifications',
  query: z.strictObject({
    ...pageShape,
    unread: yes.describe('Only unread ones'),
    kind: z.enum(S.notificationKinds).optional(),
  }),
  response: S.listOf(S.Notification),
  errors: ['cursor_mismatch'],
  probe: (ctx, d) => d.notificationsVersion(ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const f = fp(
        'notifications.list',
        ctx.principal?.handle,
        String(ctx.query.unread ?? ''),
        ctx.query.kind,
      )
      const page = yield* run((d) =>
        d.listNotifications(ctx.principal, {
          unread: ctx.query.unread,
          kind: ctx.query.kind,
          after: afterOf(ctx.query.cursor, f),
          limit: ctx.query.limit,
        }),
      )
      return listOf(page.items, page.next, f)
    }),
})

export const countNotifications = defineOp({
  ...read,
  id: 'notifications.count',
  summary: 'How many are unread',
  description: 'For a badge. Cheap, and answers `304` until it changes.',
  method: 'GET',
  path: '/notifications/count',
  response: S.NotificationCount,
  probe: (ctx, d) => d.notificationsVersion(ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.unreadCount(ctx.principal))
    }),
})

export const readNotification = defineOp({
  ...write,
  id: 'notifications.read',
  summary: 'Mark one as read',
  method: 'POST',
  path: '/notifications/{notification}/read',
  params: z.strictObject({
    notification: z.string().describe('The notification id'),
  }),
  response: z.null(),
  status: 204,
  errors: ['not_found'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.markRead(ctx.principal, ctx.params.notification))
      return reply(null, { status: 204 })
    }),
})

export const readAllNotifications = defineOp({
  ...write,
  id: 'notifications.read_all',
  summary: 'Mark every one as read',
  method: 'POST',
  path: '/notifications/read',
  response: z.null(),
  status: 204,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) => d.markRead(ctx.principal, null))
      return reply(null, { status: 204 })
    }),
})

export const getNotificationPrefs = defineOp({
  ...read,
  id: 'notifications.preferences',
  summary: 'What reaches your inbox',
  method: 'GET',
  path: '/notifications/preferences',
  response: S.NotificationPreferences,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) => d.getNotificationPrefs(ctx.principal))
    }),
})

export const updateNotificationPrefs = defineOp({
  ...write,
  id: 'notifications.update_preferences',
  summary: 'Choose what reaches your inbox',
  description:
    'Send only what changes. Turning a kind off stops new ones; what is already in the inbox stays.',
  method: 'PATCH',
  path: '/notifications/preferences',
  body: bodies['notifications.update_preferences'],
  response: S.NotificationPreferences,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateNotificationPrefs(ctx.principal, ctx.body),
      )
    }),
})

export const notificationOps = [
  listNotifications,
  countNotifications,
  readNotification,
  readAllNotifications,
  getNotificationPrefs,
  updateNotificationPrefs,
]
