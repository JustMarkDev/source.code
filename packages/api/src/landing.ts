import type { Landing } from './policy-file'

/**
 * The landing engine's plan: every change of a stack (one, for a single
 * change) lands in its own step, then the policy file's landing steps run
 * once, in order. Each step is its own transaction and its outcome is kept
 * on the operation, so a person or an agent sees exactly where it stopped.
 *
 * Plain JavaScript: the Convex functions import it too.
 */

export type StepState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

export type LandingStepRec = {
  kind: 'land' | 'run_pipeline' | 'webhook'
  /** The change number, the pipeline's workflow, or the webhook's URL. */
  target: string
  state: StepState
  detail: string
  finished: number | null
}

/** Whether landing runs steps after the change lands, so it is an operation. */
export function hasAfterSteps(landing: Landing) {
  return landing.steps.some((s) => !('wait_checks' in s))
}

export function landingPlan(
  numbers: ReadonlyArray<number>,
  landing: Landing,
): Array<LandingStepRec> {
  const plan: Array<LandingStepRec> = numbers.map((n) => ({
    kind: 'land',
    target: String(n),
    state: 'pending',
    detail: '',
    finished: null,
  }))
  for (const s of landing.steps)
    if ('run_pipeline' in s)
      plan.push({
        kind: 'run_pipeline',
        target: s.run_pipeline,
        state: 'pending',
        detail: '',
        finished: null,
      })
    else if ('webhook' in s)
      plan.push({
        kind: 'webhook',
        target: s.webhook,
        state: 'pending',
        detail: '',
        finished: null,
      })
  return plan
}

export function stepName(s: LandingStepRec) {
  if (s.kind === 'land') return `Land #${s.target}`
  if (s.kind === 'run_pipeline') return `Run the ${s.target} pipeline`
  return `Call ${s.target}`
}

/** A plan as the API shows it on an operation. */
export function presentSteps(
  steps: ReadonlyArray<LandingStepRec>,
  iso: (t: number) => string,
) {
  return steps.map((s) => ({
    name: stepName(s),
    kind: s.kind,
    target: s.target,
    state: s.state,
    detail: s.detail,
    finished_at: s.finished === null ? null : iso(s.finished),
  }))
}

/** After a step fails, the ones after it never run. */
export function skipRest(steps: Array<LandingStepRec>, from: number) {
  for (const s of steps.slice(from))
    if (s.state === 'pending') {
      s.state = 'skipped'
      s.detail = 'Not run: a step before it failed.'
    }
}
