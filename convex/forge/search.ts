import { v } from 'convex/values'
import { query } from '../_generated/server'
import { system } from '../lib/actor'
import { out } from '../lib/errors'
import { repoUrl } from '../lib/present'

/**
 * Everything searchable, a page of repositories at a time, for an API
 * server building its search index. The index is the server's cache; it
 * follows the event feed after this.
 */
export const docs = query({
  args: { after: v.union(v.null(), v.string()), repos: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    await system(ctx)
    const page = await ctx.db
      .query('repos')
      .withIndex('by_publicId', (q) =>
        a.after ? q.gt('publicId', a.after) : q,
      )
      .take(a.repos)
    const found = []
    for (const r of page) {
      const full = `${r.owner}/${r.name}`
      const url = repoUrl(r)
      found.push({
        key: `repo:${r.publicId}`,
        type: 'repo',
        id: r.publicId,
        repo: full,
        number: null,
        title: full,
        text: r.description,
        state: r.visibility,
        author: r.owner,
        labels: [],
        updated: r.updated,
        url,
      })
      for await (const c of ctx.db
        .query('changes')
        .withIndex('by_repoId_and_number', (q) => q.eq('repoId', r._id)))
        found.push({
          key: `change:${c.publicId}`,
          type: 'change',
          id: c.publicId,
          repo: full,
          number: c.number,
          title: c.title,
          text: c.description,
          state: c.state,
          author: c.author.handle,
          labels: c.labels,
          updated: c.updated,
          url: `${url}/changes/${c.number}`,
        })
      for await (const i of ctx.db
        .query('issues')
        .withIndex('by_repoId_and_number', (q) => q.eq('repoId', r._id)))
        found.push({
          key: `issue:${i.publicId}`,
          type: 'issue',
          id: i.publicId,
          repo: full,
          number: i.number,
          title: i.title,
          text: i.body,
          state: i.state,
          author: i.author.handle,
          labels: i.labels,
          updated: i.updated,
          url: `${url}/issues/${i.number}`,
        })
    }
    return out({
      docs: found,
      next: page.length === a.repos ? page.at(-1)!.publicId : null,
    })
  },
})
