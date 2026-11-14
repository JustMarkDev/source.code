import { Effect } from 'effect'
import { z } from 'zod'
import { bodies } from '../bodies'
import { Domain, defineOp, reply } from '../registry'
import * as S from '../schemas'
import { changeParams, repoParams } from './common'

/**
 * Who else is looking at a change or an issue, people and agents alike. A
 * heartbeat says you are; it is not an event and nothing keeps it once you
 * stop sending.
 */

const issueParams = repoParams.extend({
  number: z.coerce.number().int().min(1).describe('The issue number'),
})

const kinds = [
  {
    kind: 'change' as const,
    tag: 'changes',
    path: '/repos/{owner}/{repo}/changes/{number}/presence',
    params: changeParams,
    scope: 'pulls:read' as const,
  },
  {
    kind: 'issue' as const,
    tag: 'issues',
    path: '/repos/{owner}/{repo}/issues/{number}/presence',
    params: issueParams,
    scope: 'issues:read' as const,
  },
]

const ops = kinds.flatMap((k) => {
  const plural = k.tag
  const base = {
    auth: 'required' as const,
    scopes: [k.scope],
    tags: [plural],
    path: k.path,
    params: k.params,
    response: S.Presence,
  }
  return [
    defineOp({
      ...base,
      id: `${plural}.presence.get`,
      summary: `Who is looking at ${k.kind === 'change' ? 'a change' : 'an issue'}`,
      description: `The people and agents with the ${k.kind} open now, and the file each is on. It changes by the second, so it is never cached.`,
      method: 'GET',
      pool: 'read',
      safety: 'read',
      idempotent: true,
      errors: ['not_found', 'moved'],
      handler: (ctx) =>
        Effect.gen(function* () {
          const { run } = yield* Domain
          const out = yield* run((d) =>
            d.presence(
              ctx.params.owner,
              ctx.params.repo,
              { kind: k.kind, ref: String(ctx.params.number) },
              ctx.principal!,
            ),
          )
          return reply(out, {
            headers: { 'cache-control': 'private, no-store' },
          })
        }),
    }),
    defineOp({
      ...base,
      id: `${plural}.presence.put`,
      summary: `Say you are looking at ${k.kind === 'change' ? 'a change' : 'an issue'}`,
      description: `A heartbeat: send one every \`interval\` seconds while the ${k.kind} is open, with the file you are on, and \`leave\` when you close it. The MCP server sends one for an agent while its run works on a change. Answers who is looking, you included. Not an event, and nothing is kept once you stop.`,
      method: 'PUT',
      pool: 'write',
      safety: 'write',
      idempotent: true,
      body: bodies['presence.put'],
      errors: ['not_found', 'invalid_request', 'moved'],
      handler: (ctx) =>
        Effect.gen(function* () {
          const { run } = yield* Domain
          const out = yield* run((d) =>
            d.heartbeat(
              ctx.params.owner,
              ctx.params.repo,
              { kind: k.kind, ref: String(ctx.params.number) },
              ctx.principal!,
              ctx.body,
            ),
          )
          return reply(out, {
            headers: { 'cache-control': 'private, no-store' },
          })
        }),
    }),
  ]
})

export const presenceOps = ops
