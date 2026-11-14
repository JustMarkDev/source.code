import { z } from 'zod'
import { allScopes } from './auth'
import { automationTriggers } from './schemas'

/**
 * What a write may carry, for the writes a page makes straight to Convex.
 * The operation checks its body with it, and so does the Convex function,
 * so a write is refused the same way whoever sends it: a client of the API,
 * a page, or anyone calling the deployment with their own sign-in.
 */

const mode = z.enum(['enforce', 'dry-run', 'off'])

const automation = {
  name: z.string().min(1).max(100),
  triggers: z.array(z.enum(automationTriggers)).min(1).max(8),
  runtime: z.string().min(1).max(50),
  target: z.string().min(1).max(50),
  instructions: z.string().min(1).max(4000),
  enabled: z.boolean(),
  every: z
    .enum(['hour', 'day', 'week'])
    .describe('How often the `schedule` trigger fires; weekly if left out'),
}

export const bodies = {
  'issues.create': z.strictObject({
    title: z.string().min(1).max(300),
    body: z.string().max(65536).optional(),
    labels: z.array(z.string().max(50)).max(50).optional(),
    assignees: z
      .array(z.string().max(39))
      .max(10)
      .optional()
      .describe('Handles of people or agents who can read the repository'),
  }),
  'issues.update': z.strictObject({
    title: z.string().min(1).max(300).optional(),
    body: z.string().max(65536).optional(),
    labels: z.array(z.string().max(50)).max(50).optional(),
    state: z.enum(['open', 'closed']).optional(),
    assignees: z
      .array(z.string().max(39))
      .max(10)
      .optional()
      .describe('Replaces who is assigned. `[]` unassigns everyone'),
  }),
  'comments.create': z.strictObject({
    body: z.string().trim().min(1).max(65536),
  }),
  'change_comments.create': z.strictObject({
    body: z.string().trim().min(1).max(65536),
    file: z.string().min(1).max(1000).optional(),
    line: z.number().int().min(1).optional(),
    patch_set: z.number().int().min(1).optional(),
    reply_to: z
      .string()
      .optional()
      .describe(
        'A comment to answer; `file`, `line` and `patch_set` follow it',
      ),
    quote: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        'The text the comment is about, starting on `line`. Without it, the line itself. The comment follows this text into newer patch sets',
      ),
  }),
  'changes.guide.put': z.strictObject({
    summary: z.string().trim().min(1).max(4000),
    order: z
      .array(
        z.strictObject({
          path: z.string().min(1).max(1000),
          why: z.string().max(1000).default(''),
          risk: z.enum(['low', 'medium', 'high']).default('low'),
        }),
      )
      .min(1)
      .max(500)
      .describe('Files of the newest patch set, each once, in reading order'),
    patch_set: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The patch set it is for. Default: the newest'),
  }),
  'presence.put': z.strictObject({
    session: z
      .string()
      .min(8)
      .max(128)
      .describe(
        'One per open tab or agent process, so two of yours count once and leaving one leaves only it',
      ),
    path: z
      .string()
      .min(1)
      .max(1000)
      .nullable()
      .default(null)
      .describe('The file you have open'),
    leave: z
      .boolean()
      .default(false)
      .describe('Leave now instead of once the heartbeats stop'),
  }),
  'changes.seen.put': z.strictObject({
    paths: z.array(z.string().min(1).max(1000)).min(1).max(500),
    seen: z
      .boolean()
      .default(true)
      .describe('False takes the mark off, so the files read as unseen'),
  }),
  'change_comments.update': z.strictObject({
    body: z.string().trim().min(1).max(65536).optional(),
    resolved: z.boolean().optional(),
  }),
  'findings.dismiss': z.strictObject({ reason: z.string().min(1).max(1000) }),
  'links.set': z.strictObject({
    login: z.string().min(1).max(100),
    instance: z.url().optional(),
  }),
  'integrations.set': z.strictObject({ enabled: z.boolean() }),
  'integrations.connect': z.strictObject({
    key: z.string().min(3).max(500).optional(),
  }),
  'policy.update_rule': z.strictObject({ mode }),
  'policy.create_rule': z.strictObject({
    id: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,39}$/,
        'Lowercase letters, digits and dashes',
      ),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['required_check', 'path_approval', 'max_lines']),
    check: z.string().min(1).max(100).optional(),
    paths: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
    approvals: z.number().int().min(1).max(5).optional(),
    from: z.array(z.string()).max(20).optional(),
    max_lines: z.number().int().min(1).max(100000).optional(),
    mode: mode.optional(),
  }),
  'policy.proposals.create': z.strictObject({
    edits: z
      .array(
        z.discriminatedUnion('op', [
          z.strictObject({
            op: z.literal('set_mode'),
            rule: z.string(),
            mode,
          }),
          z.strictObject({
            op: z.literal('create_rule'),
            id: z
              .string()
              .regex(
                /^[a-z0-9][a-z0-9-]{1,39}$/,
                'Lowercase letters, digits and dashes',
              ),
            name: z.string().trim().min(1).max(100),
            kind: z.enum(['required_check', 'path_approval', 'max_lines']),
            check: z.string().min(1).max(100).optional(),
            paths: z
              .array(z.string().min(1).max(200))
              .min(1)
              .max(20)
              .optional(),
            approvals: z.number().int().min(1).max(5).optional(),
            from: z.array(z.string()).max(20).optional(),
            max_lines: z.number().int().min(1).max(100000).optional(),
            mode: mode.optional(),
          }),
          z.strictObject({ op: z.literal('delete_rule'), rule: z.string() }),
          z.strictObject({
            op: z.literal('add_exception'),
            rule: z.string(),
            who: z.string(),
            reason: z.string().min(1).max(500),
            expires_at: z.iso.datetime(),
          }),
          z.strictObject({
            op: z.literal('remove_exception'),
            exception: z.string(),
          }),
          z.strictObject({
            op: z.literal('set_landing'),
            strategy: z.enum(['squash', 'rebase', 'merge']).optional(),
            fresh_approvals: z.boolean().optional(),
            resolve: z.enum(['author', 'any_reviewer']).optional(),
            steps: z
              .array(
                z.union([
                  z.strictObject({
                    wait_checks: z.array(z.string().min(1).max(100)).min(1),
                  }),
                  z.strictObject({ run_pipeline: z.string().min(1).max(100) }),
                  z.strictObject({ webhook: z.url().startsWith('https://') }),
                ]),
              )
              .max(20)
              .optional(),
          }),
        ]),
      )
      .min(1)
      .max(50),
  }),
  'policy.add_exception': z.strictObject({
    rule: z.string(),
    who: z.string(),
    reason: z.string().min(1).max(500),
    expires_at: z.iso.datetime(),
  }),
  'notifications.update_preferences': z.strictObject({
    review: z.boolean().optional(),
    mention: z.boolean().optional(),
    release: z.boolean().optional(),
    ci: z.boolean().optional(),
    issue: z.boolean().optional(),
    import: z.boolean().optional(),
    digest: z.boolean().optional(),
  }),
  'invitations.create': z.strictObject({
    email: z.email().max(254),
    role: z.enum(['owner', 'admin', 'member']),
  }),
  'bots.update': z.strictObject({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(300).optional(),
    scopes: z
      .array(z.enum(allScopes))
      .min(1)
      .refine((s) => !s.includes('tokens:manage'), 'A bot never mints tokens')
      .optional(),
  }),
  'automations.create': z.strictObject({
    ...automation,
    bot: z.string().describe('The bot slug'),
    enabled: automation.enabled.optional(),
    every: automation.every.optional(),
  }),
  'automations.update': z.strictObject(automation).partial(),
  'runs.start': z.strictObject({
    task: z
      .string()
      .min(1)
      .max(500)
      .describe('What the run is for, in a sentence'),
    change: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The change it works on'),
    scopes: z
      .array(z.enum(allScopes))
      .max(allScopes.length)
      .optional()
      .describe(
        'Default: read, comment on issues and changes, read the env schema',
      ),
    ttl_minutes: z.number().int().min(1).max(240).default(60),
  }),
}

export type BodyOf<Id extends keyof typeof bodies> = z.output<
  (typeof bodies)[Id]
>

/**
 * A body checked as the API checks it, or the same `invalid_request` the API
 * answers: one entry per problem, pointing into the body.
 */
export function checkBody<Id extends keyof typeof bodies>(
  id: Id,
  value: unknown,
):
  | { ok: true; body: BodyOf<Id> }
  | {
      ok: false
      detail: string
      errors: Array<{ pointer: string; code: string; message: string }>
    } {
  const r = bodies[id].safeParse(value)
  if (r.success) return { ok: true, body: r.data as BodyOf<Id> }
  const errors = r.error.issues.map((i) => ({
    pointer: `/body${i.path.map((p) => `/${String(p)}`).join('')}`,
    code: i.code,
    message: i.message,
  }))
  return {
    ok: false,
    detail: `${errors.length} problem${errors.length === 1 ? '' : 's'} with the request.`,
    errors,
  }
}
