import { LineCounter, isMap, isSeq, parseDocument } from 'yaml'
import type { Document, YAMLMap, YAMLSeq } from 'yaml'

/**
 * The policy file, `.source/policy/main.yml`: the rules a repository lands
 * changes under, kept in the repository like its code.
 *
 *   rules:
 *     - id: core-paths          # a built-in rule: its mode only
 *       mode: enforce
 *     - id: docs-review         # a rule of the repository's own
 *       name: Docs need a writer
 *       when: { paths: ["docs/**"] }
 *       require:
 *         - approval: { min: 1, class: human, from: [hollis] }
 *   exceptions:
 *     - { id: exc_…, rule: core-paths, for: hollis, reason: "…", expires: 2026-12-01 }
 *   landing:
 *     strategy: squash
 *     fresh_approvals: true
 *     resolve: author
 *     steps:
 *       - wait_checks: [ci/test]
 *
 * Reading it, writing it from settings, and editing it in place so the
 * comments and layout a person gave it stay. Plain JavaScript and the `yaml`
 * package: the Convex functions import it too.
 */

export const POLICY_FILE = '.source/policy/main.yml'
export const POLICY_DIR = '.source/policy/'

export type RuleMode = 'enforce' | 'dry-run' | 'off'

export type CustomRule = {
  id: string
  name: string
  kind: 'required_check' | 'path_approval' | 'max_lines'
  check?: string
  paths?: Array<string>
  approvals?: number
  from?: Array<string>
  maxLines?: number
  createdBy: string
  created: number
}

export type PolicyException = {
  id: string
  rule: string
  who: string
  reason: string
  createdBy: string
  created: number
  expires: number
}

export type LandingStep =
  | { wait_checks: Array<string> }
  | { run_pipeline: string }
  | { webhook: string }

export type Landing = {
  strategy: 'squash' | 'rebase' | 'merge'
  /** Approvals count only on the newest patch set, not carried over a rebase. */
  fresh_approvals: boolean
  /** Who may settle a review thread: the person who started it, or any reviewer. */
  resolve: 'author' | 'any_reviewer'
  steps: Array<LandingStep>
}

/** How changes land when the file says nothing: today's behaviour. */
export const DEFAULT_LANDING: Landing = {
  strategy: 'squash',
  fresh_approvals: false,
  resolve: 'any_reviewer',
  steps: [],
}

/** What a policy file says. */
export type PolicyContent = {
  modes: Record<string, RuleMode>
  custom: Array<CustomRule>
  exceptions: Array<PolicyException>
  landing: Landing
}

export type FileError = { path: string; line: number | null; message: string }

const MODES = ['enforce', 'dry-run', 'off']
const day = (t: number) => new Date(t).toISOString().slice(0, 10)

// ---- writing the file from settings ----------------------------------------------

/**
 * The file for a repository whose rules are still settings: what the move to
 * the file writes. After the move nothing writes the file from settings.
 */
export function policyYaml(
  content: PolicyContent,
  builtins: ReadonlyArray<{ id: string; mode: RuleMode }>,
  now: number,
): string {
  const rules: Array<Record<string, unknown>> = builtins.map((b) => ({
    id: b.id,
    mode: content.modes[b.id] ?? b.mode,
  }))
  for (const r of content.custom)
    rules.push(ruleNode(r, content.modes[r.id] ?? 'enforce'))
  const live = content.exceptions.filter((e) => e.expires > now)
  const doc = {
    rules,
    ...(live.length ? { exceptions: live.map(exceptionNode) } : {}),
    landing: content.landing,
  }
  const d = parseDocument('{}')
  d.contents = d.createNode(doc) as never
  // Flow style for the small maps inside a rule, so a rule reads as one block.
  flowSmall(d)
  return [
    `# ${POLICY_FILE}`,
    '# The rules changes in this repository land under. Edit it in a change;',
    '# policy owners review it. https://source.code/docs/reference/policy-file',
    d.toString({ lineWidth: 0 }),
  ].join('\n')
}

function ruleNode(r: CustomRule, mode: RuleMode): Record<string, unknown> {
  const head = { id: r.id, name: r.name, mode }
  if (r.kind === 'required_check')
    return {
      ...head,
      require: [{ evidence: { check: r.check, bound_to: 'tree' } }],
    }
  if (r.kind === 'max_lines')
    return { ...head, require: [{ max_lines: r.maxLines }] }
  return {
    ...head,
    when: { paths: r.paths ?? [] },
    require: [
      {
        approval: {
          min: r.approvals ?? 1,
          class: 'human',
          ...(r.from?.length ? { from: r.from } : {}),
        },
      },
    ],
  }
}

function exceptionNode(e: PolicyException): Record<string, unknown> {
  return {
    id: e.id,
    rule: e.rule,
    for: e.who,
    reason: e.reason,
    expires: day(e.expires),
    created_by: e.createdBy,
    created: day(e.created),
  }
}

function flowSmall(d: Document, from: unknown = d.contents, start = 0) {
  const visit = (n: unknown, depth: number) => {
    if (isMap(n) || isSeq(n)) {
      // `when: { paths: [...] }` and each `- approval: { … }` on one line.
      if (isMap(n) ? depth === 3 || depth >= 5 : depth >= 4)
        (n as YAMLMap).flow = true
      for (const item of (n as YAMLSeq).items)
        visit(isMap(n) ? (item as { value: unknown }).value : item, depth + 1)
    }
  }
  visit(from, start)
}

// ---- reading it -------------------------------------------------------------------

/**
 * What a policy file says, or why it cannot be read. A file with errors
 * gives no content: the last valid rules stay in force.
 */
export function parsePolicy(
  text: string,
  builtins: ReadonlyArray<{ id: string; mode: RuleMode }>,
): { content: PolicyContent | null; errors: Array<FileError> } {
  const lc = new LineCounter()
  const d = parseDocument(text, { lineCounter: lc, prettyErrors: false })
  const errors: Array<FileError> = []
  const lineOf = (n: unknown): number | null => {
    const range = (n as { range?: [number, number, number] } | null)?.range
    return range ? lc.linePos(range[0]).line : null
  }
  for (const e of d.errors)
    errors.push({
      path: '',
      line: e.linePos?.[0].line ?? null,
      message: e.message.split('\n')[0],
    })
  if (errors.length) return { content: null, errors }
  const err = (path: string, node: unknown, message: string) =>
    errors.push({ path, line: lineOf(node), message })
  const root = d.contents
  if (root === null) return { content: emptyContent(), errors }
  if (!isMap(root)) {
    err('', root, 'The file is a map with rules, exceptions and landing.')
    return { content: null, errors }
  }
  for (const pair of root.items) {
    const key = (pair.key as { value?: unknown } | null)?.value
    const k = typeof key === 'string' ? key : JSON.stringify(key)
    if (!['rules', 'exceptions', 'landing'].includes(k))
      err(k, pair.key, `Unknown key ${k}. Use rules, exceptions or landing.`)
  }
  const js = d.toJS({ maxAliasCount: 0 }) as Record<string, unknown>
  const content = emptyContent()
  const known = new Set(builtins.map((b) => b.id))
  const ids = new Set<string>()

  const rules = js.rules ?? []
  const rulesNode = root.get('rules', true)
  if (!Array.isArray(rules)) err('rules', rulesNode, 'rules is a list.')
  else
    rules.forEach((raw: unknown, i) => {
      const at = `rules[${i}]`
      const node = isSeq(rulesNode) ? rulesNode.items[i] : rulesNode
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return err(at, node, 'A rule is a map with an id.')
      const r = raw as Record<string, unknown>
      // A field's own line, where it has one.
      const field = (key: string) =>
        (isMap(node) ? node.get(key, true) : undefined) ?? node
      const id = r.id
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
        return err(`${at}.id`, node, 'id is lowercase letters, digits and -.')
      if (ids.has(id)) return err(`${at}.id`, node, `${id} appears twice.`)
      ids.add(id)
      if (r.mode !== undefined) {
        if (!MODES.includes(r.mode as string))
          err(`${at}.mode`, field('mode'), 'mode is enforce, dry-run or off.')
        else content.modes[id] = r.mode as RuleMode
      }
      if (known.has(id)) {
        if (r.require !== undefined || r.when !== undefined)
          err(
            at,
            node,
            `${id} is built in: give its mode only. Write a rule of your own for anything else.`,
          )
        return
      }
      const rule = readRule(id, r, (path, message) =>
        err(`${at}.${path}`, field(path.split(/[.[]/)[0]), message),
      )
      if (rule) content.custom.push(rule)
    })

  const exceptions = js.exceptions ?? []
  const excNode = root.get('exceptions', true)
  if (!Array.isArray(exceptions))
    err('exceptions', excNode, 'exceptions is a list.')
  else
    exceptions.forEach((raw: unknown, i) => {
      const at = `exceptions[${i}]`
      const node = isSeq(excNode) ? excNode.items[i] : excNode
      const e = (raw ?? {}) as Record<string, unknown>
      const date = (v: unknown) =>
        typeof v === 'string' ? Date.parse(v) : Number.NaN
      const expires = date(e.expires)
      const created = date(e.created)
      if (typeof e.rule !== 'string' || !ids.has(e.rule))
        return err(`${at}.rule`, node, 'Name a rule in this file.')
      if (typeof e.for !== 'string' || !e.for)
        return err(`${at}.for`, node, 'for names the person it bends for.')
      if (typeof e.reason !== 'string' || !e.reason.trim())
        return err(`${at}.reason`, node, 'An exception needs a reason.')
      if (Number.isNaN(expires))
        return err(`${at}.expires`, node, 'expires is a date, like 2026-12-01.')
      content.exceptions.push({
        id: typeof e.id === 'string' ? e.id : `exc_${e.rule}_${e.for}`,
        rule: e.rule,
        who: e.for,
        reason: e.reason,
        createdBy: typeof e.created_by === 'string' ? e.created_by : e.for,
        created: Number.isNaN(created) ? expires : created,
        // A date is the whole of that day.
        expires:
          String(e.expires).length <= 10 ? expires + 86_400_000 - 1 : expires,
      })
    })

  const landing = js.landing
  const landNode = root.get('landing', true)
  if (landing !== undefined && landing !== null) {
    if (typeof landing !== 'object' || Array.isArray(landing))
      err('landing', landNode, 'landing is a map.')
    else
      content.landing = readLanding(
        landing as Record<string, unknown>,
        (p, m) => err(`landing.${p}`, landNode, m),
      )
  }
  return errors.length ? { content: null, errors } : { content, errors }
}

function emptyContent(): PolicyContent {
  return {
    modes: {},
    custom: [],
    exceptions: [],
    landing: { ...DEFAULT_LANDING, steps: [] },
  }
}

function readRule(
  id: string,
  r: Record<string, unknown>,
  err: (path: string, message: string) => void,
): CustomRule | null {
  const name = typeof r.name === 'string' && r.name.trim() ? r.name : id
  const require = r.require
  if (!Array.isArray(require) || require.length !== 1) {
    err(
      'require',
      'A rule of your own has one require item: approval, evidence or max_lines.',
    )
    return null
  }
  const q = (require[0] ?? {}) as Record<string, unknown>
  const when = (r.when ?? {}) as Record<string, unknown>
  const base = { id, name, createdBy: '', created: 0 }
  if ('evidence' in q) {
    const ev = (q.evidence ?? {}) as Record<string, unknown>
    if (typeof ev.check !== 'string' || !ev.check) {
      err('require[0].evidence.check', 'Name the check that has to pass.')
      return null
    }
    return { ...base, kind: 'required_check', check: ev.check }
  }
  if ('max_lines' in q) {
    const n = q.max_lines
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      err('require[0].max_lines', 'max_lines is a whole number above 0.')
      return null
    }
    return { ...base, kind: 'max_lines', maxLines: n }
  }
  if ('approval' in q) {
    const a = (q.approval ?? {}) as Record<string, unknown>
    const paths = when.paths
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      !paths.every((p) => typeof p === 'string' && p)
    ) {
      err('when.paths', 'An approval rule names the paths it is for.')
      return null
    }
    const min = a.min ?? 1
    if (
      typeof min !== 'number' ||
      !Number.isInteger(min) ||
      min < 1 ||
      min > 10
    ) {
      err('require[0].approval.min', 'min is 1 to 10.')
      return null
    }
    const from = a.from ?? []
    if (!Array.isArray(from) || !from.every((h) => typeof h === 'string')) {
      err('require[0].approval.from', 'from is a list of handles.')
      return null
    }
    return {
      ...base,
      kind: 'path_approval',
      paths: paths as Array<string>,
      approvals: min,
      from: from,
    }
  }
  err('require[0]', 'Require approval, evidence or max_lines.')
  return null
}

function readLanding(
  l: Record<string, unknown>,
  err: (path: string, message: string) => void,
): Landing {
  const out: Landing = { ...DEFAULT_LANDING, steps: [] }
  for (const k of Object.keys(l))
    if (!['strategy', 'fresh_approvals', 'resolve', 'steps'].includes(k))
      err(k, `Unknown key ${k}.`)
  if (l.strategy !== undefined) {
    if (!['squash', 'rebase', 'merge'].includes(l.strategy as string))
      err('strategy', 'strategy is squash, rebase or merge.')
    else out.strategy = l.strategy as Landing['strategy']
  }
  if (l.fresh_approvals !== undefined) {
    if (typeof l.fresh_approvals !== 'boolean')
      err('fresh_approvals', 'fresh_approvals is true or false.')
    else out.fresh_approvals = l.fresh_approvals
  }
  if (l.resolve !== undefined) {
    if (!['author', 'any_reviewer'].includes(l.resolve as string))
      err('resolve', 'resolve is author or any_reviewer.')
    else out.resolve = l.resolve as Landing['resolve']
  }
  if (l.steps !== undefined && l.steps !== null) {
    if (!Array.isArray(l.steps)) err('steps', 'steps is a list.')
    else
      l.steps.forEach((s: unknown, i) => {
        const step = (s ?? {}) as Record<string, unknown>
        const keys = Object.keys(step)
        if (keys.length !== 1)
          return err(
            `steps[${i}]`,
            'A step is one of wait_checks, run_pipeline or webhook.',
          )
        const [k] = keys
        const v = step[k]
        if (
          k === 'wait_checks' &&
          Array.isArray(v) &&
          v.length &&
          v.every((x) => typeof x === 'string')
        )
          out.steps.push({ wait_checks: v })
        else if (k === 'run_pipeline' && typeof v === 'string' && v)
          out.steps.push({ run_pipeline: v })
        else if (
          k === 'webhook' &&
          typeof v === 'string' &&
          v.startsWith('https://')
        )
          out.steps.push({ webhook: v })
        else
          err(
            `steps[${i}]`,
            'wait_checks takes a list of checks, run_pipeline a pipeline name, webhook an https URL.',
          )
      })
  }
  return out
}

// ---- editing it in place ------------------------------------------------------------

export type PolicyEdit =
  | { op: 'set_mode'; rule: string; mode: RuleMode }
  | {
      op: 'create_rule'
      rule: Omit<CustomRule, 'createdBy' | 'created'> & { mode?: RuleMode }
    }
  | { op: 'delete_rule'; rule: string }
  | {
      op: 'add_exception'
      exception: Omit<PolicyException, 'created' | 'createdBy'> & {
        createdBy: string
        created: number
      }
    }
  | { op: 'remove_exception'; exception: string }
  | { op: 'set_landing'; landing: Partial<Landing> }

/**
 * The file with the edits made, through the document so comments and layout
 * stay. Answers the new text and, when it no longer reads, why.
 */
export function editPolicy(
  text: string,
  edits: ReadonlyArray<PolicyEdit>,
  builtins: ReadonlyArray<{ id: string; mode: RuleMode }>,
  fail: (
    code: string,
    detail: string,
    more?: {
      errors?: Array<{ pointer: string; code: string; message: string }>
    },
  ) => never,
): string {
  const d = parseDocument(text)
  if (d.errors.length || (d.contents !== null && !isMap(d.contents)))
    fail(
      'invalid_state',
      `${POLICY_FILE} does not read as YAML, so it cannot be edited here. Fix it in a change.`,
    )
  if (d.contents === null) d.contents = d.createNode({}) as never
  const root = d.contents as unknown as YAMLMap
  const seq = (key: string): YAMLSeq => {
    const s: unknown = root.get(key, true)
    if (isSeq(s)) return s
    const made = d.createNode([]) as unknown as YAMLSeq
    root.set(key, made)
    return made
  }
  const find = (s: YAMLSeq, id: string) =>
    s.items.findIndex((n) => isMap(n) && n.get('id') === id)
  const builtin = new Set(builtins.map((b) => b.id))
  const bad = (k: number, field: string, message: string): never =>
    fail('invalid_request', message, {
      errors: [
        {
          pointer: `/body/edits/${k}/${field}`,
          code: 'invalid',
          message,
        },
      ],
    })
  edits.forEach((e, k) => {
    if (e.op === 'set_mode') {
      const rules = seq('rules')
      const at = find(rules, e.rule)
      if (at >= 0) (rules.items[at] as YAMLMap).set('mode', e.mode)
      else if (builtin.has(e.rule))
        rules.items.push(d.createNode({ id: e.rule, mode: e.mode }))
      else bad(k, 'rule', `No rule ${e.rule}.`)
    } else if (e.op === 'create_rule') {
      if (builtin.has(e.rule.id))
        bad(k, 'id', `${e.rule.id} is a built-in rule; pick another id.`)
      const rules = seq('rules')
      const node = d.createNode(
        ruleNode(
          { ...e.rule, createdBy: '', created: 0 },
          e.rule.mode ?? 'enforce',
        ),
      ) as YAMLMap
      flowSmall(d, node, 2)
      const at = find(rules, e.rule.id)
      if (at >= 0) rules.items[at] = node
      else rules.items.push(node)
    } else if (e.op === 'delete_rule') {
      if (builtin.has(e.rule))
        fail(
          'invalid_state',
          `${e.rule} is built in. Turn it off instead: set its mode to off.`,
        )
      const rules = seq('rules')
      const at = find(rules, e.rule)
      if (at < 0) bad(k, 'rule', `No rule ${e.rule}.`)
      rules.items.splice(at, 1)
      const exc = root.get('exceptions', true)
      if (isSeq(exc))
        exc.items = exc.items.filter(
          (n) => !(isMap(n) && n.get('rule') === e.rule),
        )
    } else if (e.op === 'add_exception') {
      const node = d.createNode(exceptionNode(e.exception)) as YAMLMap
      seq('exceptions').items.push(node)
    } else if (e.op === 'remove_exception') {
      const exc = seq('exceptions')
      const at = find(exc, e.exception)
      if (at < 0) bad(k, 'exception', `No exception ${e.exception}.`)
      exc.items.splice(at, 1)
    } else {
      const had: unknown = root.get('landing', true)
      let l: YAMLMap
      if (isMap(had)) l = had
      else {
        l = d.createNode({})
        root.set('landing', l)
      }
      for (const [key, value] of Object.entries(e.landing) as Array<
        [string, unknown]
      >)
        if (value !== undefined) l.set(key, d.createNode(value))
    }
  })
  const next = d.toString({ lineWidth: 0 })
  const read = parsePolicy(next, builtins)
  if (read.errors.length)
    fail('invalid_request', `The edits leave ${POLICY_FILE} invalid.`, {
      errors: read.errors.map((x) => ({
        pointer: '/body/edits',
        code: 'invalid_policy',
        message: `${x.path ? `${x.path}: ` : ''}${x.message}`,
      })),
    })
  return next
}

// ---- what an edit changed --------------------------------------------------------

/** A unified diff of two texts, for a person to read before the change lands. */
export function unifiedDiff(path: string, before: string, after: string) {
  const x = before.split('\n')
  const y = after.split('\n')
  const dp = Array.from({ length: x.length + 1 }, () =>
    Array.from({ length: y.length + 1 }, () => 0),
  )
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] =
        x[i] === y[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  const lines: Array<string> = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      lines.push(` ${x[i]}`)
      i++
      j++
    } else if (
      i < x.length &&
      (j >= y.length || dp[i + 1][j] >= dp[i][j + 1])
    ) {
      // What goes comes before what replaces it, as `diff -u` writes it.
      lines.push(`-${x[i]}`)
      i++
    } else {
      lines.push(`+${y[j]}`)
      j++
    }
  }
  if (!lines.some((l) => l[0] !== ' ')) return ''
  return [`--- a/${path}`, `+++ b/${path}`, ...lines].join('\n')
}

/** Lines added and removed, for a patch set's file stats. */
export function lineStats(before: string, after: string) {
  const d = unifiedDiff('', before, after).split('\n').slice(2)
  return {
    add: d.filter((l) => l.startsWith('+')).length,
    del: d.filter((l) => l.startsWith('-')).length,
  }
}

// ---- the rules protect themselves ---------------------------------------------------

export const POLICY_RULE = 'policy-file'

/**
 * What a change to the policy folder needs: a maintainer's approval, and a
 * policy file that reads. Null for a change that leaves the folder alone.
 * Not a rule a repository can turn off or bend.
 */
export function policyFileCheck(
  head: {
    n: number
    files: Record<string, unknown>
    contents?: Record<string, string | null>
  },
  builtins: ReadonlyArray<{ id: string; mode: RuleMode }>,
  isMaintainer: (handle: string) => boolean,
  humanApprovals: ReadonlyArray<string>,
) {
  if (!Object.keys(head.files).some((f) => f.startsWith(POLICY_DIR)))
    return null
  const text = head.contents?.[POLICY_FILE]
  const errors =
    typeof text === 'string' ? parsePolicy(text, builtins).errors : []
  const owners = humanApprovals.filter(isMaintainer)
  const base = {
    id: POLICY_RULE,
    rule: 'Policy changes need a maintainer and a file that reads',
    blocking: [] as Array<string>,
  }
  if (errors.length)
    return {
      ...base,
      state: 'fail' as const,
      detail: `${POLICY_FILE} does not read: ${errors
        .slice(0, 3)
        .map(
          (e) =>
            `${e.path ? `${e.path}${e.line ? ` (line ${e.line})` : ''}: ` : ''}${e.message}`,
        )
        .join('; ')}`,
      needs: { valid_policy_file: true },
    }
  return {
    ...base,
    state: owners.length ? ('pass' as const) : ('pending' as const),
    detail: owners.length
      ? `${owners.join(', ')} approved the policy change on patch set ${head.n}.`
      : `${POLICY_DIR} needs 1 human approval from a maintainer.`,
    needs: owners.length
      ? null
      : { approval: { min: 1, class: 'human', from: 'maintainers' } },
  }
}

/**
 * The landing steps that hold a change back now: the checks `wait_checks`
 * names that have not passed on the tree that lands.
 */
export function landingWaits(
  landing: Landing,
  checks: ReadonlyArray<{
    id: string
    key?: string
    name: string
    tree: string
    state: 'pass' | 'fail' | 'pending'
    updated: number
  }>,
  head: { tree: string },
) {
  const out = []
  for (const step of landing.steps) {
    if (!('wait_checks' in step)) continue
    for (const name of step.wait_checks) {
      const run = checks
        .filter(
          (k) => (k.key === name || k.name === name) && k.tree === head.tree,
        )
        .sort((a, b) => b.updated - a.updated)
        .at(0)
      const state = run?.state ?? 'pending'
      if (state === 'pass') continue
      out.push({
        id: `landing:wait_checks:${name}`,
        rule: `Landing waits for ${name}`,
        state,
        detail:
          state === 'fail'
            ? `${name} failed on tree ${head.tree}.`
            : `Landing waits for ${name} on tree ${head.tree}.`,
        needs: { check: name, bound_to: 'tree', tree: head.tree },
        blocking: state === 'fail' && run ? [run.id] : [],
      })
    }
  }
  return out
}
