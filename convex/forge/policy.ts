import { v } from 'convex/values'
import { newId } from '@source-code/api/ids'
import { internalMutation, query } from '../_generated/server'
import { mutation } from '../lib/functions'
import { bodyOf } from '../lib/input'
import { actorOf, signedIn } from '../lib/actor'
import { accessStamp, accountByHandle, resolve } from '../lib/access'
import { fail, finish, out } from '../lib/errors'
import { actorFor, counters, emit } from '../lib/events'
import {
  BIG_CHANGE,
  branchOwner,
  hydrate,
  loadPolicy,
  policyRules,
  savePolicy,
  viewFor,
} from '../lib/changes'
import type { Actor } from '../lib/actor'
import type { Loaded, RepoPolicy } from '../lib/changes'
import { urls } from '../lib/present'
import {
  POLICY_FILE,
  editPolicy,
  lineStats,
  policyYaml,
  unifiedDiff,
} from '@source-code/api/policy-file'
import { proposalEdits, proposalTitle } from '@source-code/api/policy-proposals'
import { commit, hex, patchSetEvent, pushPatchSet } from './changes'
import type { ChangeRec, CustomRuleRec, RuleMode } from '../lib/changeTypes'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { ActorRef } from '../lib/events'
import type { PolicyEdit } from '@source-code/api/policy-file'

/**
 * A repository's policy: which rules apply and how hard, its own rules, and
 * who a rule bends for and until when. Changes are evaluated by
 * `lib/changes.ts`; this edits what that reads and reports what rules did.
 */

const mode = v.union(
  v.literal('enforce'),
  v.literal('dry-run'),
  v.literal('off'),
)

/** How a repository's own rule reads in the list and the policy file. */
function describeCustomRule(r: CustomRuleRec) {
  if (r.kind === 'required_check')
    return {
      when: 'any change',
      requires: [`${r.check} passed, bound to the landing tree`],
    }
  if (r.kind === 'max_lines')
    return {
      when: 'any change',
      requires: [`at most ${r.maxLines} lines added and removed`],
    }
  const n = r.approvals ?? 1
  return {
    when: `paths ${(r.paths ?? []).join(', ')}`,
    requires: [
      `${n} approval${n === 1 ? '' : 's'}, human${r.from?.length ? `, from ${r.from.join(', ')}` : ''}`,
    ],
  }
}

function rulesOf(pol: RepoPolicy) {
  return [
    ...policyRules.map((r) => ({ ...r, custom: null as CustomRuleRec | null })),
    ...pol.customRules.map((r) => ({
      id: r.id,
      name: r.name,
      mode: 'enforce' as RuleMode,
      ...describeCustomRule(r),
      custom: r as CustomRuleRec | null,
    })),
  ]
}

const modeOf = (pol: RepoPolicy, id: string): RuleMode =>
  pol.ruleModes.get(id) ??
  policyRules.find((r) => r.id === id)?.mode ??
  'enforce'

/** The policy file as it stands on the default branch, or as the move would write it. */
function policyText(pol: RepoPolicy, at: number) {
  return (
    pol.file?.text ??
    policyYaml(
      {
        modes: Object.fromEntries(pol.ruleModes),
        custom: pol.customRules,
        exceptions: pol.exceptions,
        landing: pol.landing,
      },
      policyRules,
      at,
    )
  )
}

const presentException = (e: RepoPolicy['exceptions'][number]) => ({
  object: 'policy_exception' as const,
  id: e.id,
  rule: e.rule,
  who: e.who,
  reason: e.reason,
  created_by: e.createdBy,
  created_at: new Date(e.created).toISOString(),
  expires_at: new Date(e.expires).toISOString(),
})

async function policySet(
  ctx: QueryCtx,
  repo: Doc<'repos'>,
  p: Actor | null,
  at: number,
) {
  const pol = await loadPolicy(ctx, repo)
  const docs = (
    await ctx.db
      .query('changes')
      .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id))
      .take(5000)
  ).filter((c) => c.state !== 'abandoned')
  const loaded = await Promise.all(docs.map((d) => hydrate(ctx, d)))
  const view = await viewFor(
    ctx,
    repo,
    p,
    at,
    loaded.map((l) => l.rec),
  )
  // What each rule said about every change, enforced, as if no mode were set.
  const said = loaded.map(({ rec }) => ({
    c: rec,
    reqs: view.evaluateRules(rec, {}),
  }))
  return {
    object: 'policy_set' as const,
    repo: `${repo.owner}/${repo.name}`,
    file: POLICY_FILE,
    yaml: policyText(pol, at),
    rules: rulesOf(pol).map((r) => {
      const applied = said
        .map(({ c, reqs }) => ({ c, q: reqs.find((x) => x.id === r.id) }))
        .filter((x) => x.q && x.q.state !== 'na')
      const blocks = applied.filter(
        (x) => x.q!.state === 'fail' || x.q!.state === 'pending',
      )
      const m = modeOf(pol, r.id)
      return {
        id: r.id,
        name: r.name,
        mode: m,
        when: r.when,
        requires: r.requires,
        evaluated: applied.length,
        blocked: blocks.length,
        custom: !!r.custom,
        would_block:
          m === 'dry-run'
            ? blocks.map((x) => ({
                change: x.c.number,
                title: x.c.title,
                why: x.q!.detail,
              }))
            : [],
      }
    }),
    exceptions: pol.exceptions
      .filter((e) => e.expires > at)
      .map(presentException),
    large_change_lines: BIG_CHANGE,
    version: pol.rev,
    source: {
      state: !pol.file
        ? ('settings' as const)
        : pol.file.errors.length
          ? ('errors' as const)
          : ('file' as const),
      sha: pol.file?.sha ?? null,
      errors: pol.file?.errors ?? [],
      pending: loaded
        .map((l) => l.rec)
        .filter(
          (c) =>
            (c.state === 'open' || c.state === 'draft') &&
            POLICY_FILE in c.patchSets[c.patchSets.length - 1].files,
        )
        .map((c) => ({
          change: c.number,
          title: c.title,
          author: c.author.handle,
          url: `${urls().api}/repos/${repo.owner}/${repo.name}/changes/${c.number}`,
        })),
    },
    landing: pol.landing,
  }
}

/** Whether the rules live in the policy file, so writes propose. */
export const inFile = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    return !!(await loadPolicy(ctx, repo)).file
  },
})

/** Writes to settings stop once the rules live in the file. */
function settingsOnly(pol: RepoPolicy) {
  if (pol.file)
    fail(
      'invalid_state',
      `The rules live in ${POLICY_FILE}. Propose the edit: POST /repos/{owner}/{repo}/policy/proposals.`,
    )
}

/**
 * Edits to the rules as a change to the policy file. Your open policy change
 * takes them as a new patch set; without one a change is opened. Nothing
 * applies until it lands. In a repository whose rules are still settings,
 * the first proposal is the move: the file written from them, edits made.
 */
export const propose = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    edits: v.array(v.any()),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const { edits } = await bodyOf(ctx, 'policy.proposals.create', {
      edits: a.edits,
    })
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const by = await actorFor(ctx, p.handle, p.class)
    const at = Date.now()
    const people = new Map<string, boolean>()
    for (const e of edits)
      for (const h of e.op === 'create_rule'
        ? (e.from ?? [])
        : e.op === 'add_exception'
          ? [e.who]
          : [])
        people.set(h, (await accountByHandle(ctx, h))?.kind === 'person')
    const made = proposalEdits(
      edits,
      {
        now: at,
        by: p.handle,
        newId: () => newId('exception', at),
        isPerson: (h) => people.get(h) ?? false,
      },
      fail,
    )
    return proposeIn(ctx, repo, by, edits, made, !!a.dry)
  },
})

/** The edits as a change to the policy file: on the author's open one, or a new one. */
async function proposeIn(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  by: ActorRef,
  edits: ReadonlyArray<unknown>,
  made: Array<PolicyEdit>,
  dry: boolean,
) {
  const at = Date.now()
  const pol = await loadPolicy(ctx, repo)
  const branch = `policy/${by.handle}`
  const draftDoc = await branchOwner(ctx, repo, branch)
  const draft = draftDoc ? await hydrate(ctx, draftDoc) : null
  const mine =
    draft &&
    draft.rec.author.handle === by.handle &&
    (draft.rec.state === 'open' || draft.rec.state === 'draft')
      ? draft
      : null
  const main = policyText(pol, at)
  const base = mine
    ? (mine.rec.patchSets[mine.rec.patchSets.length - 1].contents?.[
        POLICY_FILE
      ] ?? main)
    : main
  const next = editPolicy(base, made, policyRules, fail)
  const diff = unifiedDiff(POLICY_FILE, base, next)
  const shownAs = (c: ChangeRec | null) => ({
    object: 'policy_proposal' as const,
    change: c?.number ?? null,
    url: c
      ? `${urls().api}/repos/${repo.owner}/${repo.name}/changes/${c.number}`
      : null,
    patch_set: c ? c.patchSets[c.patchSets.length - 1].n : null,
    created: !mine,
    edits,
    diff,
  })
  if (dry) return out(shownAs(null))
  const sha = hex(`${repo.publicId}/${branch}/${at}/${next}`)
  const files = {
    [POLICY_FILE]: { hash: sha.slice(0, 6), ...lineStats(main, next) },
  }
  const note = proposalTitle(made, !pol.file)
  if (mine) {
    const was = mine.rec.state
    pushPatchSet(mine.rec, by, {
      sha,
      kind: 'update',
      note,
      files,
      contents: { [POLICY_FILE]: next },
    })
    await commit(ctx, repo, mine, was, patchSetEvent(by, []))
    return out(shownAs(mine.rec))
  }
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, { nextNumber: c.nextNumber + 1 })
  const rec: ChangeRec = {
    id: newId('change', at),
    number: c.nextNumber,
    title: note,
    description: pol.file
      ? 'Proposed from the policy settings. The rules change when this lands.'
      : 'Moves the rules from the repository settings into the policy file. The settings stay in force until this lands; after it, the file is the rules.',
    state: 'open',
    author: by,
    base: repo.defaultBranch,
    branch,
    patchSets: [
      {
        n: 1,
        sha,
        tree: sha.slice(0, 7),
        note,
        author: by,
        created: at,
        files,
        kind: 'initial',
        contents: { [POLICY_FILE]: next },
      },
    ],
    reviews: [],
    findings: [],
    checks: [],
    stackId: null,
    labels: [],
    mirrors: [],
    evidence: [],
    comments: [],
    commentRev: 0,
    created: at,
    updated: at,
    landed: null,
    version: 1,
  }
  const l = { rec, parts: new Map() } as unknown as Loaded
  await commit(ctx, repo, l, null, {
    type: 'change.opened',
    by,
    changes: ['state'],
  })
  return out(shownAs(rec))
}

/**
 * The one-off move: each repository whose rules are still settings gets a
 * change that writes them to the policy file, opened by source.code. The
 * settings stay in force until it lands. Run once from the dashboard;
 * `after` pages through repositories.
 */
export const moveToFile = internalMutation({
  args: { after: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.object({
    opened: v.number(),
    next: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, a) => {
    const repos = await ctx.db
      .query('repos')
      .withIndex('by_publicId', (q) =>
        a.after ? q.gt('publicId', a.after) : q,
      )
      .take(a.limit ?? 50)
    const by = await actorFor(ctx, 'source-code', 'bot')
    let opened = 0
    for (const repo of repos) {
      if ((await loadPolicy(ctx, repo)).file) continue
      if (await branchOwner(ctx, repo, `policy/${by.handle}`)) continue
      await proposeIn(ctx, repo, by, [], [], false)
      opened++
    }
    return {
      opened,
      next:
        repos.length === (a.limit ?? 50)
          ? repos[repos.length - 1].publicId
          : null,
    }
  },
})

export const get = query({
  args: { owner: v.string(), name: v.string(), at: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await actorOf(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p)
    return out(await policySet(ctx, repo, p, a.at))
  },
})

export const version = query({
  args: { owner: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    const repo = await resolve(ctx, a.owner, a.name, await actorOf(ctx))
    const c = await counters(ctx, repo)
    return out(
      `${repo.publicId}.pol${c.policyRev}.${c.changeRev}.${await accessStamp(ctx, repo)}`,
    )
  },
})

/** Policy changed: every change's requirements are worked out again, so each change's version moves. */
async function policyChanged(
  ctx: MutationCtx,
  repo: Doc<'repos'>,
  pol: RepoPolicy,
  p: Actor,
  what: string,
) {
  await savePolicy(ctx, repo, pol)
  for (const c of await ctx.db
    .query('changes')
    .withIndex('by_repoId_and_number', (q) => q.eq('repoId', repo._id))
    .take(5000))
    await ctx.db.patch('changes', c._id, { version: c.version + 1 })
  const c = await counters(ctx, repo)
  await ctx.db.patch('repoCounters', c._id, { changeRev: c.changeRev + 1 })
  await emit(
    ctx,
    repo,
    'repo.policy_changed',
    await actorFor(ctx, p.handle, p.class),
    { object: 'repo', id: repo.publicId, number: null },
    [what],
    null,
  )
}

function ruleOf(pol: RepoPolicy, id: string) {
  const r = rulesOf(pol).find((x) => x.id === id)
  if (!r) fail('not_found', `No rule ${id}.`)
  return r
}

export const createRule = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    ruleName: v.string(),
    kind: v.union(
      v.literal('required_check'),
      v.literal('path_approval'),
      v.literal('max_lines'),
    ),
    check: v.optional(v.string()),
    paths: v.optional(v.array(v.string())),
    approvals: v.optional(v.number()),
    from: v.optional(v.array(v.string())),
    max_lines: v.optional(v.number()),
    mode: v.optional(mode),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, given) => {
    const checked = await bodyOf(ctx, 'policy.create_rule', {
      id: given.id,
      name: given.ruleName,
      kind: given.kind,
      check: given.check,
      paths: given.paths,
      approvals: given.approvals,
      from: given.from,
      max_lines: given.max_lines,
      mode: given.mode,
    })
    const a = { ...given, ruleName: checked.name }
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const bad = (pointer: string, message: string) =>
      fail('invalid_request', message, {
        errors: [{ pointer, code: 'invalid', message }],
      })
    if (policyRules.some((r) => r.id === a.id))
      bad('/body/id', `${a.id} is a built-in rule; pick another id.`)
    const need: Record<
      typeof a.kind,
      Array<'check' | 'paths' | 'max_lines'>
    > = {
      required_check: ['check'],
      path_approval: ['paths'],
      max_lines: ['max_lines'],
    }
    for (const k of need[a.kind])
      if (a[k] === undefined) bad(`/body/${k}`, `A ${a.kind} rule needs ${k}.`)
    for (const h of a.from ?? [])
      if ((await accountByHandle(ctx, h))?.kind !== 'person')
        bad('/body/from', `${h} is not a person.`)
    const pol = await loadPolicy(ctx, repo)
    settingsOnly(pol)
    const have = pol.customRules.find((r) => r.id === a.id)
    const rec: CustomRuleRec = {
      id: a.id,
      name: a.ruleName,
      kind: a.kind,
      ...(a.kind === 'required_check' ? { check: a.check } : {}),
      ...(a.kind === 'path_approval'
        ? { paths: a.paths, approvals: a.approvals ?? 1, from: a.from ?? [] }
        : {}),
      ...(a.kind === 'max_lines' ? { maxLines: a.max_lines } : {}),
      createdBy: have?.createdBy ?? p.handle,
      created: have?.created ?? Date.now(),
    }
    pol.customRules = [...pol.customRules.filter((r) => r.id !== a.id), rec]
    pol.ruleModes.set(a.id, a.mode ?? 'enforce')
    await policyChanged(ctx, repo, pol, p, 'rules')
    const set = await policySet(
      ctx,
      (await ctx.db.get('repos', repo._id))!,
      p,
      Date.now(),
    )
    return finish(a.dry, {
      rule: set.rules.find((r) => r.id === a.id),
      created: !have,
    })
  },
})

export const deleteRule = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    rule: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const pol = await loadPolicy(ctx, repo)
    settingsOnly(pol)
    const r = ruleOf(pol, a.rule)
    if (!r.custom)
      fail(
        'invalid_state',
        `${a.rule} is built in. Turn it off instead: PATCH it with mode=off.`,
      )
    pol.customRules = pol.customRules.filter((x) => x.id !== a.rule)
    pol.ruleModes.delete(a.rule)
    pol.exceptions = pol.exceptions.filter((e) => e.rule !== a.rule)
    await policyChanged(ctx, repo, pol, p, 'rules')
    return finish(a.dry, null)
  },
})

export const setRuleMode = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    rule: v.string(),
    mode,
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'policy.update_rule', { mode: a.mode })
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const pol = await loadPolicy(ctx, repo)
    settingsOnly(pol)
    ruleOf(pol, a.rule)
    if (modeOf(pol, a.rule) !== a.mode) {
      pol.ruleModes.set(a.rule, a.mode)
      await policyChanged(ctx, repo, pol, p, 'rules')
    }
    const set = await policySet(
      ctx,
      (await ctx.db.get('repos', repo._id))!,
      p,
      Date.now(),
    )
    return finish(
      a.dry,
      set.rules.find((r) => r.id === a.rule),
    )
  },
})

export const addException = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    rule: v.string(),
    who: v.string(),
    reason: v.string(),
    expires_at: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    await bodyOf(ctx, 'policy.add_exception', {
      rule: a.rule,
      who: a.who,
      reason: a.reason,
      expires_at: a.expires_at,
    })
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const pol = await loadPolicy(ctx, repo)
    settingsOnly(pol)
    ruleOf(pol, a.rule)
    if ((await accountByHandle(ctx, a.who))?.kind !== 'person')
      fail('invalid_request', `${a.who} is not a person.`, {
        errors: [
          {
            pointer: '/body/who',
            code: 'not_a_person',
            message: `${a.who} is not a person.`,
          },
        ],
      })
    const expires = Date.parse(a.expires_at)
    const now = Date.now()
    if (!(expires > now) || expires - now > 90 * 86_400_000)
      fail('invalid_request', 'An exception lasts up to 90 days.', {
        errors: [
          {
            pointer: '/body/expires_at',
            code: 'out_of_range',
            message: 'Set an end in the future, at most 90 days away.',
          },
        ],
      })
    const e = {
      id: newId('exception', now),
      rule: a.rule,
      who: a.who,
      reason: a.reason,
      createdBy: p.handle,
      created: now,
      expires,
    }
    pol.exceptions = [...pol.exceptions, e]
    await policyChanged(ctx, repo, pol, p, 'exceptions')
    return finish(a.dry, presentException(e))
  },
})

export const removeException = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    id: v.string(),
    dry: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    const p = await signedIn(ctx)
    const repo = await resolve(ctx, a.owner, a.name, p, 'write')
    const pol = await loadPolicy(ctx, repo)
    settingsOnly(pol)
    if (!pol.exceptions.some((e) => e.id === a.id))
      fail('not_found', `No exception ${a.id}.`)
    pol.exceptions = pol.exceptions.filter((e) => e.id !== a.id)
    await policyChanged(ctx, repo, pol, p, 'exceptions')
    return finish(a.dry, null)
  },
})
