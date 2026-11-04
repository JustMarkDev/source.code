/**
 * Motion rules for the whole app.
 *
 * - Only `opacity` and `transform` are animated, so nothing triggers layout.
 * - Durations stay between 150ms and 250ms, one shared easing.
 * - Nothing animates during the first paint (server HTML must be visible and
 *   hydration must match), and nothing animates under `prefers-reduced-motion`.
 * - Enter-only. Exits never delay navigation.
 *
 * `motion/mini` drives the small stuff: it uses the Web Animations API, costs
 * about 2 KB and does not re-render React. The full `motion/react` feature set
 * is loaded lazily and only for shared-layout and spring interactions.
 */
import * as React from 'react'
import { animate } from 'motion/mini'

/** Out-expo-ish: fast start, long soft landing. */
export const EASE = [0.22, 1, 0.36, 1] as const
export const DURATION = 0.2
export const STAGGER = 0.028
/** Lists longer than this do not stagger the extra rows; they just appear. */
export const STAGGER_CAP = 10

/** False until the app has hydrated, so first paint is never animated. */
let ready = false
export function markMotionReady() {
  ready = true
}

export function canAnimate(): boolean {
  return (
    ready &&
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const useIsoLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** Fade and rise an element in. Clears its inline styles afterwards. */
export function enter(el: HTMLElement, rise = 6) {
  if (!canAnimate()) return
  void animate(
    el,
    { opacity: [0, 1], transform: [`translateY(${rise}px)`, 'none'] },
    { duration: DURATION, ease: EASE },
  ).then(() => {
    el.style.removeProperty('opacity')
    el.style.removeProperty('transform')
  })
}

/**
 * Re-run the enter animation on the returned element whenever `trigger`
 * changes, without remounting its children (so their state survives).
 */
export function useEnterOnChange<T extends HTMLElement>(trigger: unknown) {
  const ref = React.useRef<T>(null)
  const last = React.useRef(trigger)
  useIsoLayoutEffect(() => {
    if (last.current === trigger) return
    last.current = trigger
    if (ref.current) enter(ref.current)
  }, [trigger])
  return ref
}

/** Animate the element's children in one after another when it mounts. */
export function useStaggerIn<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  useIsoLayoutEffect(() => {
    const parent = ref.current
    if (!parent || !canAnimate()) return
    const items = Array.from(parent.children).slice(
      0,
      STAGGER_CAP,
    ) as Array<HTMLElement>
    if (items.length === 0) return
    items.forEach((el, i) => {
      void animate(
        el,
        { opacity: [0, 1], transform: ['translateY(8px)', 'none'] },
        { duration: DURATION + 0.04, ease: EASE, delay: i * STAGGER },
      ).then(() => {
        el.style.removeProperty('opacity')
        el.style.removeProperty('transform')
      })
    })
  }, [])
  return ref
}
