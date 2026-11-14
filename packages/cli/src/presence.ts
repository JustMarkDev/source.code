import { randomUUID } from 'node:crypto'
import { print, table } from './output'
import type { Ctx } from './output'

type Viewer = {
  actor: { handle: string; class: string }
  path: string | null
  seen_at: string
}

/**
 * One session per process: an MCP server or a long `sx` loop is one viewer
 * however many calls it makes. `SX_SESSION` names it across processes.
 */
const session = process.env.SX_SESSION ?? `sx-${randomUUID().slice(0, 13)}`

/**
 * Who is looking at a change or an issue. With `here`, `path` or `leave`,
 * say first that you are (or no longer are).
 */
export async function showPresence(
  ctx: Ctx,
  path: string,
  id: string,
  say: { here: boolean; path?: string; leave: boolean },
) {
  const api = ctx.api()
  const p =
    say.here || say.path !== undefined || say.leave
      ? (
          await api.put(path, {
            body: { session, path: say.path ?? null, leave: say.leave },
          })
        ).json
      : (await api.get(path)).json
  const viewers = p.viewers as Array<Viewer>
  print(ctx, { ...p, id }, () =>
    viewers.length
      ? table(
          viewers.map((v) => [
            `${v.actor.handle}${v.actor.class === 'human' ? '' : ` (${v.actor.class})`}`,
            v.path ?? '-',
            v.seen_at.slice(11, 19),
          ]),
          ['WHO', 'FILE', 'LAST SEEN'],
        )
      : 'nobody is looking',
  )
}

/** A heartbeat that never fails the call it rides along with. */
export async function heartbeat(ctx: Ctx, path: string) {
  try {
    await ctx.api().put(path, { body: { session, path: null, leave: false } })
  } catch {
    // Presence is a courtesy; the work goes on without it.
  }
}
