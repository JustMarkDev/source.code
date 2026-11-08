/* eslint-disable @typescript-eslint/require-await --
   Domain.run takes an async function so the same handlers can read from Convex later;
   the in-memory domain answers synchronously. */
import { Effect } from 'effect'
import { z } from 'zod'
import { fragmentsOf, parseQuery } from '../search'
import { apiError } from '../problem'
import { Domain, Pre, defineOp } from '../registry'
import { iso } from '../domain'
import * as S from '../schemas'
import { afterOf, fp, listOf, pageShape } from './common'

const built = new WeakMap<object, Pre>()

export const searchOp = defineOp({
  id: 'search.query',
  summary: 'Search repositories, changes and issues',
  description:
    'Words must all match; the last is a prefix. "Quoted phrases" match exactly. Qualifiers narrow the result: `type:change` `repo:dana/gitfs` `state:open` `author:ines` `label:bug`. Results are one ordered list with no cap: title matches first, then newest. Only repositories you can read are searched.',
  tags: ['search'],
  method: 'GET',
  path: '/search',
  auth: 'optional',
  scopes: ['repo:read'],
  pool: 'search',
  cost: 1,
  safety: 'read',
  idempotent: true,
  query: z.strictObject({
    ...pageShape,
    q: z.string().min(1).max(256).describe('The query'),
  }),
  response: S.listOf(S.SearchResult),
  errors: ['cursor_mismatch'],
  shapeable: true,
  handler: (ctx) =>
    Effect.gen(function* () {
      const { run } = yield* Domain
      const q = ctx.query
      // The cursor belongs to one viewer: a different caller may see a
      // different list, so its cursor must not silently continue this one.
      const f = fp('search', q.q, ctx.principal?.capabilityKey ?? 'anon')
      const out = yield* run(async (d) => {
        const parsed = parseQuery(q.q)
        if (!parsed.terms.length && !parsed.phrases.length && !parsed.repo.length && !parsed.types.length && !parsed.state.length && !parsed.author.length && !parsed.label.length)
          throw apiError('invalid_request', 'The query has nothing to search for.', {
            errors: [{ pointer: '/query/q', code: 'empty_query', message: 'Give a word, a phrase or a qualifier.' }],
          })
        const hits = d.svc.search.search(parsed, d.canSee(ctx.principal), ctx.principal?.capabilityKey ?? 'anon')
        const visible = hits.filter((h) =>
          h.doc.type === 'change'
            ? !ctx.principal || ctx.principal.scopes.has('pulls:read')
            : h.doc.type === 'issue'
              ? !ctx.principal || ctx.principal.scopes.has('issues:read')
              : true,
        )
        const page = d.svc.search.page(visible, q.limit, afterOf(q.cursor, f), parsed)
        return {
          // Most of a result is the document, which does not change between queries. Keep
          // that as text and add only what depends on the query: the snippet and the score.
          items: page.items.map((h) => {
            // Hits are kept with their query's results, so their text is built once per query.
            let pre = built.get(h)
            if (!pre) {
              const frag = fragmentsOf(h.doc, iso)
              const json = `${frag.head}${h.snippet ? JSON.stringify(h.snippet) : 'null'},"score":${h.score}${frag.tail}`
              pre = new Pre(json, () => JSON.parse(json), `${h.doc.key}@${h.doc.updated}@${h.score}@${h.snippet}`)
              built.set(h, pre)
            }
            return pre
          }),
          next: page.next,
        }
      })
      return listOf(out.items as unknown as Array<z.infer<typeof S.SearchResult>>, out.next, f)
    }),
})

export const searchOps = [searchOp]
