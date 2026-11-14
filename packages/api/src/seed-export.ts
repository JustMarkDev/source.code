import type { AuthStore } from './auth'
import type { MemoryDomain } from './domain'
import type { World } from './world'
import type { ExtrasStore } from './extras'

export type { World } from './world'

/**
 * The sample data as plain documents for Convex (`convex/seed.ts` loads it).
 * It is built by the same code that builds the in-memory sample, so both
 * start from the same world. References are by handle and public id; the
 * loader turns them into database ids.
 */
export function exportWorld(d: MemoryDomain, auth: AuthStore): World {
  const accounts = [...d.accounts.values()].map((a) => ({
    publicId: a.id,
    kind: a.kind,
    handle: a.handle,
    name: a.name,
    bio: a.bio,
    created: a.created,
    updated: a.updated,
    version: a.version,
    members: [...a.members],
    invites: [...a.invites.values()],
  }))
  const accountHandles = new Set(d.accounts.keys())
  const actors = [...d.actors.entries()]
    .filter(([key, a]) => !(accountHandles.has(key) && a.class === 'human'))
    .map(([key, a]) => ({
      key,
      publicId: a.id,
      handle: a.handle,
      class: a.class,
    }))
  const repos = [...d.repos.values()].map((r) => {
    let openChanges = 0
    for (const c of r.changes.values())
      if (c.state === 'open' || c.state === 'draft') openChanges++
    let openIssues = 0
    for (const i of r.issues.values()) if (i.state === 'open') openIssues++
    return {
      publicId: r.id,
      storeId: r.storeId,
      owner: r.owner,
      name: r.name,
      description: r.description,
      visibility: r.visibility,
      defaultBranch: r.defaultBranch,
      stars: r.stars,
      starsTodayBase: r.starsTodayBase,
      forks: r.forks,
      upstream: r.upstream,
      install: r.install,
      category: r.category,
      languages: r.languages,
      license: r.license,
      website: r.website,
      docsUrl: r.docsUrl,
      collaborators: [...r.collaborators],
      installs: [...r.installs],
      maintainers: [...r.maintainers],
      maintainerGrants: [...r.maintainerGrants],
      env: r.env,
      ...(r.sampleCommitFacts ? { sampleFacts: true } : {}),
      created: r.created,
      updated: r.updated,
      version: r.version,
      starredBy: [...r.starredBy].map(
        (h, i) => [h, r.starTimes[i] ?? r.created] as const,
      ),
      labels: [...r.labels.values()].map((l) => ({
        publicId: l.id,
        name: l.name,
        color: l.color,
        description: l.description,
        created: l.created,
      })),
      pipelines: (r.pipelines ?? []).map((x) => JSON.stringify(x)),
      releases: (r.releases ?? []).map((x) => JSON.stringify(x)),
      changes: [...r.changes.values()].map((c) => {
        const { latest: _latest, policyMemo: _memo, ...rest } = c
        return JSON.stringify(rest)
      }),
      policy:
        r.ruleModes?.size || r.customRules?.length || r.policyExceptions?.length
          ? {
              ruleModes: [...(r.ruleModes ?? [])],
              customRules: JSON.stringify(r.customRules ?? []),
              exceptions: JSON.stringify(r.policyExceptions ?? []),
            }
          : null,
      issues: [...r.issues.values()].map((i) => ({
        publicId: i.id,
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state,
        author: i.author,
        labels: i.labels,
        assignees: i.assignees ?? [],
        created: i.created,
        updated: i.updated,
        closed: i.closed,
        version: i.version,
        comments: (i.comments ?? []).map((c) => ({
          publicId: c.id,
          author: c.author,
          body: c.body,
          created: c.created,
          updated: c.updated,
          version: c.version,
        })),
      })),
      counters: {
        nextNumber: r.nextNumber,
        seq: 0,
        rev: r.rev,
        changeRev: r.changeRev,
        issueRev: r.issueRev,
        labelRev: r.labelRev,
        policyRev: r.policyRev ?? 0,
        openChanges,
        openIssues,
      },
    }
  })
  const teams = [...d.teams.values()].map((t) => ({
    publicId: t.id,
    org: t.org,
    slug: t.slug,
    name: t.name,
    description: t.description,
    created: t.created,
    updated: t.updated,
    version: t.version,
    members: [...t.members],
    repos: [...t.repos],
  }))
  const tokens = [...auth.entries()].map(({ hash, record: t }) => ({
    publicId: t.id,
    hash,
    name: t.name,
    kind: t.kind,
    handle: t.handle,
    actingAs: t.actingAs,
    class: t.class,
    scopes: [...t.scopes],
    repos: t.repos ? [...t.repos] : null,
    audience: [...t.audience],
    prefix: t.prefix,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
    ...(t.authorizationId ? { authorizationId: t.authorizationId } : {}),
    ...(t.limitKey ? { limitKey: t.limitKey } : {}),
  }))
  const authorizations = [...auth.authorizations.values()].map((a) => ({
    publicId: a.id,
    clientId: a.clientId,
    clientName: a.clientName,
    handle: a.handle,
    scopes: [...a.scopes],
    audience: [...a.audience],
    createdAt: a.createdAt,
    lastUsedAt: a.lastUsedAt,
    revokedAt: a.revokedAt,
  }))
  return {
    accounts,
    actors,
    repos,
    aliases: [...d.aliases],
    extras: [...(d.svc.extras as ExtrasStore).entries()].map(([full, x]) => [
      full,
      JSON.stringify(x),
    ]),
    downloadDays: [...d.downloadTimes].flatMap(([full, times]) => {
      const days = new Map<number, number>()
      for (const t of times)
        days.set(
          Math.floor(t / 86_400_000),
          (days.get(Math.floor(t / 86_400_000)) ?? 0) + 1,
        )
      return [...days].map(([day, n]) => ({ repo: full, day, n }))
    }),
    accountPrefs: [...d.accountPrefs].map(([h, prefs]) => [
      h,
      JSON.stringify(prefs),
    ]),
    follows: [...d.following].flatMap(([who, set]) =>
      [...set].map((whom) => [who, whom] as [string, string]),
    ),
    contributions: [...d.repos.values()].flatMap((r) => {
      const repo = `${r.owner}/${r.name}`
      const found: World['contributions'] = []
      for (const c of r.changes.values()) {
        found.push({
          handle: c.author.handle,
          kind: 'change',
          at: c.created,
          title: `Opened #${c.number} ${c.title}`,
          repo,
          agent: false,
        })
        for (const v of c.reviews)
          found.push({
            handle: v.actor.handle,
            kind: 'review',
            at: v.created,
            title: `Reviewed #${c.number} ${c.title}`,
            repo,
            agent: c.author.class !== 'human' && v.state === 'approved',
          })
      }
      for (const i of r.issues.values())
        found.push({
          handle: i.author.handle,
          kind: 'issue',
          at: i.created,
          title: `Opened issue #${i.number} ${i.title}`,
          repo,
          agent: false,
        })
      for (const x of r.releases ?? [])
        found.push({
          handle: x.author.handle,
          kind: 'release',
          at: x.published,
          title: `Published ${x.tag}`,
          repo,
          agent: false,
        })
      return found
    }),
    connections: [...d.connections].flatMap(([account, m]) =>
      [...m.values()].map((c) => ({
        account,
        integration: c.id,
        hint: c.hint,
        keyHash: c.keyHash,
        by: c.by,
        connected: c.connected,
      })),
    ),
    repoIntegrations: [...d.repoIntegrations].map(([full, set]) => [
      full,
      [...set],
    ]),
    links: [...d.links].flatMap(([handle, list]) =>
      list.map((l) => ({ handle, ...l })),
    ),
    bots: [...d.bots.values()].map((b) => ({ ...b, scopes: [...b.scopes] })),
    automations: [...d.automations].map(([full, list]) => [
      full,
      list.map((a) => JSON.stringify(a)),
    ]),
    notifications: [...d.inboxes].flatMap(([handle, list]) =>
      // Oldest first, as they arrived.
      [...list].reverse().map((n) => ({ handle, ...n })),
    ),
    notificationPrefs: [...d.notificationPrefs].map(([h, prefs]) => [
      h,
      { ...prefs },
    ]),
    teams,
    tokens,
    authorizations,
  }
}
