import { checkBody } from '@source-code/api/bodies'
import { signedIn } from './actor'
import { fail } from './errors'
import type { BodyOf, bodies } from '@source-code/api/bodies'
import type { QueryCtx } from '../_generated/server'

/**
 * A write's body, checked the way the API checks it (`bodies.ts`). A page
 * calls these functions itself, and so can anyone with a sign-in, so the
 * function refuses what the API would have: the same code, the same
 * pointers. The caller must be signed in first, as the API asks before it
 * reads a body.
 */
export async function bodyOf<Id extends keyof typeof bodies>(
  ctx: Pick<QueryCtx, 'auth' | 'db'>,
  id: Id,
  value: Record<string, unknown>,
): Promise<BodyOf<Id>> {
  await signedIn(ctx)
  const given: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (v !== undefined) given[k] = v
  const r = checkBody(id, given)
  if (!r.ok) fail('invalid_request', r.detail, { errors: r.errors })
  return r.body
}
