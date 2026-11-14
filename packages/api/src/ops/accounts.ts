import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'

const read = {
  auth: 'required' as const,
  scopes: ['repo:read' as const],
  pool: 'read' as const,
  safety: 'read' as const,
  idempotent: true,
  tags: ['accounts'],
}
const write = {
  auth: 'required' as const,
  scopes: ['repo:write' as const],
  pool: 'write' as const,
  safety: 'write' as const,
  idempotent: true,
  dryRun: true,
  tags: ['accounts'],
}

const account = z.object({ handle: z.string().describe('Account handle') })
const org = z.object({
  handle: z.string().describe('Handle of the organization'),
})
const member = org.extend({
  login: z.string().describe('Handle of the person'),
})
const handleRule = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/,
    'Lower-case letters, digits and dashes; up to 24; no dash at either end',
  )
const role = z.enum(['owner', 'admin', 'member'])

export const createAccount = defineOp({
  ...write,
  id: 'accounts.create',
  summary: 'Create an organization',
  description:
    'You become its first owner. People and organizations share one namespace, so the handle must be free: one that a person, another organization or a page of the site has answers `invalid_state`. Naturally idempotent on the handle: asking for an organization you already own returns it with `Sx-Outcome: unchanged`. Only a person can create one, not an agent or a bot. A person is not created here; a person signs up.',
  method: 'POST',
  path: '/accounts',
  body: z.strictObject({
    handle: handleRule,
    name: z.string().min(1).max(100).optional(),
    bio: z.string().max(300).optional(),
  }),
  response: S.Account,
  status: 201,
  errors: ['forbidden', 'human_required', 'invalid_state'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.createOrganization(ctx.principal!, ctx.body, ctx.dryRun),
      )
      return reply(r.account, {
        status: r.created ? 201 : 200,
        headers: {
          'sx-outcome': r.created ? 'created' : 'unchanged',
          ...(r.created ? { location: r.account.url } : {}),
        },
      })
    }),
})

export const updateAccount = defineOp({
  ...write,
  id: 'accounts.update',
  summary: 'Change the name or the bio of an account',
  description:
    'Your own account, or an organization you own or administer. Send If-Match with the ETag you read. The handle is not changed here.',
  method: 'PATCH',
  path: '/accounts/{handle}',
  params: account,
  ifMatch: true,
  body: z.strictObject({
    name: z.string().min(1).max(100).optional(),
    bio: z.string().max(300).optional(),
  }),
  response: S.Account,
  errors: ['not_found', 'forbidden', 'version_mismatch'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.updateAccount(
          ctx.params.handle,
          ctx.principal!,
          ctx.body,
          ctx.ifMatch,
          ctx.dryRun,
        ),
      )
    }),
})

export const listMembers = defineOp({
  ...read,
  id: 'members.list',
  auth: 'optional',
  summary: "An organization's members",
  description:
    'Who is in an organization, and as what, is public, like the organization itself. Invitations are not: see `invitations.list`.',
  method: 'GET',
  path: '/accounts/{handle}/members',
  params: org,
  response: z.strictObject({
    object: z.literal('list'),
    data: z.array(S.Member),
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
  errors: ['not_found'],
  probe: (ctx, d) => d.membersVersion(ctx.params.handle, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listMembers(ctx.params.handle, ctx.principal),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false as const,
        next_cursor: null,
      }
    }),
})

export const setMember = defineOp({
  ...write,
  id: 'members.set',
  summary: 'Add a person to an organization, or change their role',
  description:
    'Owners and admins only. Only an owner can make someone an owner or change an owner. An organization always keeps one owner: changing the last one answers `invalid_state`. Setting the role someone already has changes nothing (`Sx-Outcome: unchanged`).',
  method: 'PUT',
  path: '/accounts/{handle}/members/{login}',
  params: member,
  body: z.strictObject({ role }),
  response: S.Member,
  errors: ['not_found', 'forbidden', 'invalid_state', 'limit_reached'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.setMember(
          ctx.params.handle,
          ctx.params.login,
          ctx.body.role,
          ctx.principal!,
          ctx.dryRun,
        ),
      )
      return reply(r.member, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: { 'sx-outcome': r.outcome },
      })
    }),
})

export const removeMember = defineOp({
  ...write,
  id: 'members.remove',
  summary: 'Remove a person from an organization',
  description:
    'Owners and admins, or the person themself to leave. They also leave its teams. Only an owner removes an owner, and the last owner cannot be removed. Removing someone who is not a member changes nothing.',
  method: 'DELETE',
  path: '/accounts/{handle}/members/{login}',
  params: member,
  safety: 'destructive',
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden', 'invalid_state'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.removeMember(
          ctx.params.handle,
          ctx.params.login,
          ctx.principal!,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

const invitation = org.extend({
  invitation: z.string().describe('Invitation id'),
})

export const listInvitations = defineOp({
  ...read,
  id: 'invitations.list',
  summary: 'Invitations that were not accepted yet',
  description:
    'Owners and admins only. Newest first. An invitation that expired is not listed.',
  method: 'GET',
  path: '/accounts/{handle}/invitations',
  params: org,
  response: z.strictObject({
    object: z.literal('list'),
    data: z.array(S.Invitation),
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
  errors: ['not_found', 'forbidden'],
  probe: (ctx, d) => d.membersVersion(ctx.params.handle, ctx.principal),
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const data = yield* run((d) =>
        d.listInvitations(ctx.params.handle, ctx.principal!),
      )
      return {
        object: 'list' as const,
        data,
        has_more: false as const,
        next_cursor: null,
      }
    }),
})

export const createInvitation = defineOp({
  ...write,
  id: 'invitations.create',
  summary: 'Invite someone to an organization by email',
  description:
    'Owners and admins only; only an owner invites an owner. They get an email with a link that works for 7 days. Opening it signed in makes them a member; until then they have no access. Inviting the same email again sends a new link and ends the old one (`Sx-Outcome: updated`). To add someone who already has an account, `members.set` needs no email.',
  method: 'POST',
  path: '/accounts/{handle}/invitations',
  params: org,
  body: bodies['invitations.create'],
  response: S.Invitation,
  status: 201,
  errors: ['not_found', 'forbidden', 'limit_reached'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const r = yield* run((d) =>
        d.invite(ctx.params.handle, ctx.principal!, ctx.body, ctx.dryRun),
      )
      return reply(r.invitation, {
        status: r.outcome === 'created' ? 201 : 200,
        headers: { 'sx-outcome': r.outcome },
      })
    }),
})

export const revokeInvitation = defineOp({
  ...write,
  id: 'invitations.revoke',
  summary: 'Revoke an invitation',
  description:
    'Owners and admins only. Its link stops working. Revoking one that is gone changes nothing.',
  method: 'DELETE',
  path: '/accounts/{handle}/invitations/{invitation}',
  params: invitation,
  safety: 'destructive',
  response: z.null(),
  status: 204,
  errors: ['not_found', 'forbidden'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      yield* run((d) =>
        d.revokeInvitation(
          ctx.params.handle,
          ctx.params.invitation,
          ctx.principal!,
          ctx.dryRun,
        ),
      )
      return reply(null, { status: 204 })
    }),
})

export const acceptInvitation = defineOp({
  ...write,
  id: 'invitations.accept',
  // The link is what lets you in, so any token of yours can use it.
  scopes: ['repo:read'],
  summary: 'Join an organization with an invitation',
  description:
    'Send the token from the link in the email. You join with the role the invitation names, as the person you are signed in as, and the link stops working. If you are already a member with a higher role you keep it. A token that is unknown, revoked or older than 7 days answers `not_found`.',
  method: 'POST',
  path: '/invitations/accept',
  idempotent: false,
  body: z.strictObject({ token: z.string().min(8).max(200) }),
  response: S.Member,
  errors: ['not_found', 'forbidden', 'human_required', 'limit_reached'],
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      return yield* run((d) =>
        d.acceptInvitation(ctx.body.token, ctx.principal!, ctx.dryRun),
      )
    }),
})

export const accountOps = [
  createAccount,
  updateAccount,
  listMembers,
  setMember,
  removeMember,
  listInvitations,
  createInvitation,
  revokeInvitation,
  acceptInvitation,
]
