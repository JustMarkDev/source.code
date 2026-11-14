import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_LANDING,
  editPolicy,
  parsePolicy,
  policyYaml,
  unifiedDiff,
} from './policy-file'

const builtins = [
  { id: 'core-paths', mode: 'enforce' as const },
  { id: 'big-change', mode: 'dry-run' as const },
]
const NOW = Date.parse('2026-11-01T00:00:00Z')
const fail = (code: string, detail: string, more?: unknown): never => {
  throw Object.assign(new Error(detail), { code, more })
}

describe('the policy file', () => {
  const content = {
    modes: { 'big-change': 'enforce' as const },
    custom: [
      {
        id: 'docs-review',
        name: 'Docs need a writer',
        kind: 'path_approval' as const,
        paths: ['docs/**'],
        approvals: 1,
        from: ['hollis'],
        createdBy: 'dana',
        created: NOW,
      },
      {
        id: 'build',
        name: 'Build passes',
        kind: 'required_check' as const,
        check: 'ci/build',
        createdBy: 'dana',
        created: NOW,
      },
      {
        id: 'small',
        name: 'Small',
        kind: 'max_lines' as const,
        maxLines: 300,
        createdBy: 'dana',
        created: NOW,
      },
    ],
    exceptions: [
      {
        id: 'exc_1',
        rule: 'core-paths',
        who: 'hollis',
        reason: 'On call',
        createdBy: 'dana',
        created: NOW,
        expires: NOW + 7 * 86_400_000,
      },
    ],
    landing: { ...DEFAULT_LANDING, steps: [] },
  }

  test('settings written as a file read back as the same rules', () => {
    const text = policyYaml(content, builtins, NOW)
    expect(text).toContain('# .source/policy/main.yml')
    const { content: read, errors } = parsePolicy(text, builtins)
    expect(errors).toEqual([])
    expect(read!.modes).toEqual({
      'core-paths': 'enforce',
      'big-change': 'enforce',
      'docs-review': 'enforce',
      build: 'enforce',
      small: 'enforce',
    })
    expect(read!.custom.map((r) => [r.id, r.kind])).toEqual([
      ['docs-review', 'path_approval'],
      ['build', 'required_check'],
      ['small', 'max_lines'],
    ])
    expect(read!.custom[0]).toMatchObject({
      paths: ['docs/**'],
      from: ['hollis'],
      approvals: 1,
    })
    expect(read!.exceptions[0]).toMatchObject({
      id: 'exc_1',
      who: 'hollis',
      rule: 'core-paths',
    })
    expect(read!.exceptions[0].expires).toBeGreaterThanOrEqual(
      content.exceptions[0].expires,
    )
    expect(read!.landing).toEqual(DEFAULT_LANDING)
  })

  test('errors name the place, and a file with errors gives no rules', () => {
    const r = parsePolicy(
      'rules:\n  - id: core-paths\n    mode: sometimes\n  - id: mine\n    require: []\nlanding:\n  strategy: yolo\n',
      builtins,
    )
    expect(r.content).toBeNull()
    expect(r.errors.map((e) => e.path)).toEqual([
      'rules[0].mode',
      'rules[1].require',
      'landing.strategy',
    ])
    expect(r.errors[0].line).toBe(3)
    expect(parsePolicy('rules: [', builtins).errors.length).toBeGreaterThan(0)
    expect(parsePolicy('', builtins).content).not.toBeNull()
  })

  test('edits keep the comments and layout a person wrote', () => {
    const text =
      '# Ours. Do not reorder.\nrules:\n  - id: core-paths # the important one\n    mode: enforce\n'
    const next = editPolicy(
      text,
      [
        { op: 'set_mode', rule: 'big-change', mode: 'off' },
        { op: 'set_mode', rule: 'core-paths', mode: 'dry-run' },
        {
          op: 'set_landing',
          landing: {
            fresh_approvals: true,
            steps: [{ wait_checks: ['ci/test'] }],
          },
        },
      ],
      builtins,
      fail,
    )
    expect(next).toContain('# Ours. Do not reorder.')
    expect(next).toContain('# the important one')
    const read = parsePolicy(next, builtins).content!
    expect(read.modes).toEqual({ 'core-paths': 'dry-run', 'big-change': 'off' })
    expect(read.landing).toMatchObject({
      fresh_approvals: true,
      steps: [{ wait_checks: ['ci/test'] }],
    })
    expect(unifiedDiff('main.yml', text, next)).toContain('-    mode: enforce')
    expect(() =>
      editPolicy(
        text,
        [{ op: 'delete_rule', rule: 'core-paths' }],
        builtins,
        fail,
      ),
    ).toThrow('built in')
    expect(() =>
      editPolicy(
        text,
        [{ op: 'remove_exception', exception: 'exc_x' }],
        builtins,
        fail,
      ),
    ).toThrow('No exception')
  })
})
