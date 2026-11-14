/**
 * Change guides: what a change does and the order to read its files in,
 * written by an agent (or a person) for the reviewers. A newer guide
 * replaces the older one; one written for an older patch set says so.
 *
 * Plain JavaScript, shared with the Convex functions.
 */

type Fail = (
  code: string,
  detail: string,
  more?: {
    errors?: Array<{ pointer: string; code: string; message: string }>
  },
) => never

export type GuideBody = {
  summary: string
  order: Array<{ path: string; why: string; risk: 'low' | 'medium' | 'high' }>
  patch_set?: number
}

type GuideLike = {
  patchSet: number
  summary: string
  order: GuideBody['order']
  by: { id: string; handle: string; class: 'human' | 'agent' | 'bot' }
  run: string | null
  created: number
}

/** Checks a guide against the patch set it is for. Answers that patch set. */
export function checkGuide(
  patchSets: ReadonlyArray<{ n: number; files: Record<string, unknown> }>,
  body: GuideBody,
  fail: Fail,
): number {
  const head = patchSets[patchSets.length - 1]
  const n = body.patch_set ?? head.n
  const ps = patchSets.find((x) => x.n === n)
  if (!ps)
    fail('invalid_request', `There is no patch set ${n}.`, {
      errors: [
        {
          pointer: '/body/patch_set',
          code: 'unknown',
          message: `Patch sets run from 1 to ${head.n}.`,
        },
      ],
    })
  const seen = new Set<string>()
  for (const [k, item] of body.order.entries()) {
    if (!(item.path in ps.files))
      fail('invalid_request', `${item.path} is not in patch set ${n}.`, {
        errors: [
          {
            pointer: `/body/order/${k}/path`,
            code: 'unknown',
            message: 'Name a file the change touches.',
          },
        ],
      })
    if (seen.has(item.path))
      fail('invalid_request', `${item.path} is in the order twice.`, {
        errors: [
          {
            pointer: `/body/order/${k}/path`,
            code: 'duplicate',
            message: 'Name each file once.',
          },
        ],
      })
    seen.add(item.path)
  }
  return n
}

export function presentGuide<TActor>(
  change: number,
  head: number,
  g: GuideLike,
  actor: (a: GuideLike['by']) => TActor,
  iso: (t: number) => string,
) {
  return {
    object: 'change_guide' as const,
    change,
    patch_set: g.patchSet,
    current: g.patchSet === head,
    summary: g.summary,
    order: g.order,
    by: actor(g.by),
    run: g.run,
    created_at: iso(g.created),
  }
}
