import { v } from 'convex/values'
import { Presence } from '@convex-dev/presence'
import { PRESENCE_INTERVAL } from '@source-code/api/presence'
import { components } from '../_generated/api'
import { query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { signedIn } from '../lib/actor'
import { resolve } from '../lib/access'
import { fail, out } from '../lib/errors'
import { actorFor } from '../lib/events'
import { actorOut, iso } from '../lib/present'
import { issueOf } from '../lib/issues'
import { loadChange } from '../lib/changes'
import type { ActorRef } from '../lib/events'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * Who else is looking at a change or an issue, people and agents alike.
 *
 * Each change and each issue is a room (`change:<id>`, `issue:<id>`) in the
 * presence component. Whoever has it open sends a heartbeat every
 * `INTERVAL`, naming the file they are on; an agent's MCP server sends one
 * while its run calls operations on the change. A session that stops
 * sending is dropped after two and a half intervals. Nothing here is an
 * event or a part of the change: it is gone once everyone leaves.
 */

const presence = new Presence(components.presence)

const INTERVAL = PRESENCE_INTERVAL

type Data = { actor: ActorRef; path: string | null; at: number }

const kind = v.union(v.literal('change'), v.literal('issue'))

/** The room of a change (by number or id) or an issue, and its number. */
async function roomOf(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  k: 'change' | 'issue',
  ref: string,
): Promise<{ room: string; number: number }> {
  if (k === 'change') {
    const { rec } = await loadChange(ctx, repo, ref)
    return { room: `change:${rec.id}`, number: rec.number }
  }
  const i = await issueOf(ctx, repo, Number(ref))
  return { room: `issue:${i.publicId}`, number: i.number }
}

async function present(
  ctx: QueryCtx,
  room: string,
  k: 'change' | 'issue',
  number: number,
) {
  const row = await ctx.db
    .query('presenceRooms')
    .withIndex('by_room', (q) => q.eq('room', room))
    .unique()
  const listed = row ? await presence.list(ctx, row.token, 50) : []
  return {
    object: 'presence',
    kind: k,
    number,
    interval: INTERVAL / 1000,
    viewers: listed
      // The worker that drops a silent session may not have run yet.
      .filter(
        (x) =>
          x.online &&
          x.data &&
          Date.now() - (x.data as Data).at <= INTERVAL * 2.5,
      )
      .map((x) => {
        const d = x.data as Data
        return {
          actor: actorOut(d.actor),
          path: d.path,
          seen_at: iso(d.at),
        }
      }),
  }
}

export const heartbeat = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    kind,
    ref: v.string(),
    path: v.optional(v.union(v.string(), v.null())),
    session: v.string(),
    /** Leave the room now instead of once the heartbeats stop. */
    leave: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    if (a.session.length < 8 || a.session.length > 128)
      fail('invalid_request', 'A session is 8 to 128 characters.', {
        errors: [
          {
            pointer: '/body/session',
            code: 'out_of_range',
            message: 'Send 8 to 128 characters.',
          },
        ],
      })
    const { room, number } = await roomOf(ctx, repo, a.kind, a.ref)
    // A person and their agent share a handle; they are two viewers.
    const user = p.class === 'human' ? p.handle : `${p.handle}~${p.class}`
    const { roomToken, sessionToken } = await presence.heartbeat(
      ctx,
      room,
      user,
      `${room}|${user}|${a.session}`,
      INTERVAL,
    )
    if (a.leave) {
      await presence.disconnect(ctx, sessionToken)
      return out(await present(ctx, room, a.kind, number))
    }
    const data: Data = {
      actor: await actorFor(ctx, p.handle, p.class),
      path: a.path ?? null,
      at: Date.now(),
    }
    await presence.updateRoomUser(ctx, room, user, data)
    const row = await ctx.db
      .query('presenceRooms')
      .withIndex('by_room', (q) => q.eq('room', room))
      .unique()
    if (!row) await ctx.db.insert('presenceRooms', { room, token: roomToken })
    else if (row.token !== roomToken)
      await ctx.db.patch('presenceRooms', row._id, { token: roomToken })
    return out(await present(ctx, room, a.kind, number))
  },
})

export const list = query({
  args: { owner: v.string(), name: v.string(), kind, ref: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    const { room, number } = await roomOf(ctx, repo, a.kind, a.ref)
    return out(await present(ctx, room, a.kind, number))
  },
})
