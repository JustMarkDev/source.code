/**
 * The dashboard was designed on `mock/dashboard`'s shape. This turns the API's
 * dashboard and the account's repositories into it.
 */
import type { LinkProps } from '@tanstack/react-router'
import type { Repo as ApiRepo, Dashboard } from '@source-code/sdk'
import type { Activity, DashboardData, Health } from '~/lib/model/dashboard'
import { timeAgo, toRepo } from '~/lib/repo'

const DAY = 86_400_000

/** A path the API gave, such as `/dana/gitfs/issues?n=4`, as a link. */
function linkTo(path: string): LinkProps {
  const [to, query = ''] = path.split('?')
  return {
    to,
    search: Object.fromEntries(new URLSearchParams(query)),
  } as unknown as LinkProps
}

const hostName: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  codeberg: 'Codeberg',
  gitea: 'Gitea',
}

/** An event, in words. */
function said(
  type: string,
  n: number | null,
): { did: string; what: string; kind: Activity['kind'] } {
  const ref = n === null ? '' : `#${n}`
  switch (type) {
    case 'issue.created':
      return { did: 'opened issue', what: ref, kind: 'other' }
    case 'issue.closed':
      return { did: 'closed issue', what: ref, kind: 'other' }
    case 'issue.commented':
      return { did: 'commented on', what: ref, kind: 'other' }
    case 'change.opened':
      return { did: 'opened change', what: ref, kind: 'review' }
    case 'change.reviewed':
      return { did: 'reviewed', what: ref, kind: 'review' }
    case 'change.landed':
      return { did: 'landed', what: ref, kind: 'review' }
    case 'release.published':
      return { did: 'published', what: 'a release', kind: 'release' }
    case 'ci.failed':
      return { did: 'reported failing checks on', what: ref, kind: 'other' }
    default:
      return {
        did: type.replace('.', ' ').replace('_', ' '),
        what: ref,
        kind: 'other',
      }
  }
}

function dayOf(iso: string, now: number): Activity['day'] {
  const d = Math.floor(now / DAY) - Math.floor(Date.parse(iso) / DAY)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : 'Earlier this week'
}

export function toDashboardData(
  d: Dashboard,
  repos: Array<ApiRepo>,
  now = Date.now(),
): DashboardData {
  const health: Record<string, Health | undefined> = {}
  for (const r of d.repos)
    health[r.repo.split('/')[1]] = {
      checks: r.checks,
      openChanges: r.open_changes,
      openIssues: r.open_issues,
      updated: timeAgo(r.updated_at, now),
    }
  return {
    empty: d.empty,
    needsYou: d.needs_you.map((n) => ({
      severity: n.severity,
      title: n.title,
      where: n.repo,
      note: n.note,
      age: timeAgo(n.at, now),
      action: n.action,
      link: linkTo(n.path),
    })),
    inProgress: d.in_progress.map((p) => ({
      kind: p.kind,
      title: p.title,
      where: p.repo,
      status: p.status,
      tone:
        p.status === 'Running'
          ? 'warning'
          : p.kind === 'agent'
            ? 'info'
            : 'muted',
      detail: p.detail,
      link: linkTo(p.path),
    })),
    activity: d.activity
      .filter((a) => now - Date.parse(a.at) < 7 * DAY)
      .map((a) => {
        const w = said(a.type, a.subject)
        return {
          who: a.who,
          did: w.did,
          what: w.what,
          where: a.repo ?? undefined,
          when: timeAgo(a.at, now),
          day: dayOf(a.at, now),
          kind: a.class === 'human' ? w.kind : 'agent',
        }
      }),
    repos: repos.map((r) => toRepo(r)),
    health,
    mirrors: d.mirrors
      .filter((m) => m.host in hostName)
      .map((m) => ({
        host: m.host as 'github' | 'gitlab' | 'codeberg',
        name: hostName[m.host],
        state: m.state,
        note:
          m.state === 'stopped'
            ? 'Stopped. Open its repository settings to reconnect.'
            : `${m.repos} ${m.repos === 1 ? 'repository' : 'repositories'} in sync`,
      })),
    storage: {
      usedGb: Math.round((d.storage.used_bytes / 1024 ** 3) * 100) / 100,
      limitGb: Math.round(d.storage.limit_bytes / 1024 ** 3),
    },
    imported: d.imported,
    downloads: {
      daily: d.downloads.daily,
      total: d.downloads.total,
      change: d.downloads.change ?? 0,
    },
    contributions: {
      daily: d.contributions.daily.map((value, i) => ({
        label: `Day ${i + 1}`,
        value,
      })),
      total: d.contributions.total,
      change: d.contributions.change ?? 0,
      commits: d.contributions.commits,
      reviews: d.contributions.reviews,
      changes: d.contributions.changes,
    },
    stars: d.stars,
  }
}
