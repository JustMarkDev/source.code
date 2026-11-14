import { env } from '../_generated/server'
import { roleIn } from './access'
import { counters } from './events'
import type { Actor } from './actor'
import type { ActorRef } from './events'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/** Where answers link to. */
export function urls() {
  const html = (env.SITE_URL ?? 'https://source.code').replace(/\/$/, '')
  return {
    html,
    api: (env.API_URL ?? `${html}/api/v1`).replace(/\/$/, ''),
  }
}

export const iso = (ms: number) => new Date(ms).toISOString()

export const actorOut = (a: ActorRef) => ({
  object: 'actor' as const,
  id: a.id,
  handle: a.handle,
  class: a.class,
})

export const repoUrl = (r: { owner: string; name: string }) =>
  `${urls().api}/repos/${r.owner}/${r.name}`

export const repoRef = (r: Doc<'repos'>) => ({
  object: 'repo' as const,
  id: r.publicId,
  full_name: `${r.owner}/${r.name}`,
  url: repoUrl(r),
})

export async function presentAccount(
  ctx: QueryCtx,
  a: Doc<'accounts'>,
  p: Actor | null,
) {
  const u = urls()
  return {
    object: 'account' as const,
    id: a.publicId,
    handle: a.handle,
    name: a.name,
    kind: a.kind,
    bio: a.bio,
    role: !p
      ? null
      : a.handle === p.handle
        ? ('owner' as const)
        : a.kind === 'organization'
          ? await roleIn(ctx, a, p.handle)
          : null,
    url: `${u.api}/accounts/${a.handle}`,
    html_url: `${u.html}/${a.handle}`,
    created_at: iso(a.created),
    updated_at: iso(a.updated),
    version: a.version,
  }
}

/** Stars given in the day before `at`. */
export async function starsToday(ctx: QueryCtx, r: Doc<'repos'>, at: number) {
  const recent = await ctx.db
    .query('stars')
    .withIndex('by_repoId_and_at', (q) =>
      q.eq('repoId', r._id).gt('at', at - 86_400_000),
    )
    .take(10_000)
  return r.starsTodayBase + recent.length
}

export async function presentRepo(
  ctx: QueryCtx,
  r: Doc<'repos'>,
  at: number,
  shown: Partial<Doc<'repos'>> = {},
) {
  const x = { ...r, ...shown }
  const c = await counters(ctx, r)
  const u = urls()
  return {
    object: 'repo' as const,
    id: x.publicId,
    owner: x.owner,
    name: x.name,
    full_name: `${x.owner}/${x.name}`,
    description: x.description,
    visibility: x.visibility,
    default_branch: x.defaultBranch,
    stars: x.stars,
    stars_today: await starsToday(ctx, r, at),
    forks: x.forks,
    upstream: x.upstream,
    install: x.install,
    category: x.category,
    language: (x.languages[0]?.[0] as string | undefined) ?? null,
    languages: x.languages.map(([name, percent]) => ({
      name: name as string,
      percent: percent as number,
    })),
    license: x.license,
    website: x.website,
    docs_url: x.docsUrl,
    maintainers: [...x.maintainers].sort(),
    open_changes: c.openChanges,
    open_issues: c.openIssues,
    url: repoUrl(x),
    html_url: `${u.html}/${x.owner}/${x.name}`,
    created_at: iso(x.created),
    updated_at: iso(x.updated),
    version: x.version,
  }
}
