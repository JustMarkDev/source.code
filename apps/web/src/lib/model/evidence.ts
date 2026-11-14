// What a person looks at to understand a change without reading the diff:
// screenshots, recordings and test runs attached as evidence.

export type Tone = 'dim' | 'ok' | 'bad' | 'warn' | 'add' | 'del'
export type Line = { t: string; tone?: Tone }

/** Who produced a piece of evidence. Agents and CI attach it as they work. */
export type Origin = {
  by: string
  kind: 'human' | 'agent' | 'ci'
  /** Where it ran, for an agent or a runner. */
  via?: string
}

export type Media = {
  id: string
  title: string
  caption?: string
  origin: Origin
} & (
  | {
      kind: 'compare'
      before: string
      after: string
      beforeLabel?: string
      afterLabel?: string
    }
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  /** A page kept as a file, drawn sandboxed from its address. */
  | { kind: 'page'; src: string }
  | { kind: 'frame'; label: 'Recording' | 'Interactive'; html: string }
)

export type TestResult = 'pass' | 'fail' | 'skipped'

export type TestCase = {
  suite: string
  name: string
  ms: number
  /** The same test against the base. `fail` means it reproduces the bug. */
  base: TestResult | 'missing'
  head: TestResult
  /** Screenshots from the test, before and after. */
  shot?: { before: string; after: string; note: string }
}

export type TestRun = {
  runner: string
  run: number
  tree: string
  origin: Origin
  cases: Array<TestCase>
}
