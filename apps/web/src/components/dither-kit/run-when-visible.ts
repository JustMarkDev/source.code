import type { RefObject } from 'react'

/** A running paint loop. `wake` asks it to look at the chart state again. */
export type FrameLoop = { stop: () => void; wake: () => void }

/**
 * A paint loop that sleeps when there is nothing to do.
 *
 * `draw` returns what should happen next:
 *   `true`    draw again next frame (an animation is still settling),
 *   a number  sleep that many ms, then draw once (idle twinkle),
 *   `false`   sleep until `wake()`.
 *
 * Charts call `wake()` whenever their state changes (hover, data, theme), so an
 * idle chart costs no frames at all, instead of a callback 60 times a second.
 */
export function createFrameLoop(
  draw: (now: number) => boolean | number,
): FrameLoop {
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const schedule = () => {
    if (!raf && !stopped) raf = requestAnimationFrame(frame)
  }
  const frame = (now: number) => {
    raf = 0
    if (stopped) return
    const next = draw(now)
    if (next === true) schedule()
    else if (typeof next === 'number')
      timer = setTimeout(() => {
        timer = undefined
        schedule()
      }, next)
  }
  schedule()

  return {
    wake: () => {
      clearTimeout(timer)
      timer = undefined
      schedule()
    },
    stop: () => {
      stopped = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    },
  }
}

/**
 * Run a canvas paint loop only while its canvas is on screen.
 *
 * `start` begins the loop and returns its cleanup. The first time the canvas
 * scrolls into view the loop starts normally, so the entrance plays when the
 * chart is actually seen. Leaving the viewport stops the loop (no frames, no
 * filter repaints). Coming back restarts it with the entrance skipped, so a
 * chart never replays its reveal just because you scrolled past it.
 */
export function runWhenVisible<S extends { animate: boolean }>(
  el: Element,
  state: RefObject<S>,
  start: () => FrameLoop | undefined,
  wakeRef: { current: (() => void) | null },
): () => void {
  let loop: FrameLoop | undefined
  let played = false
  wakeRef.current = () => loop?.wake()

  if (typeof IntersectionObserver === 'undefined') {
    loop = start()
    return () => loop?.stop()
  }

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.at(-1)?.isIntersecting ?? false
      if (visible && !loop) {
        if (!played) {
          played = true
          loop = start()
          return
        }
        // Loops read `animate` once, at start. Hand them a copy with the
        // entrance off, then put the live state back.
        const live = state.current
        state.current = { ...live, animate: false }
        try {
          loop = start()
        } finally {
          state.current = live
        }
      } else if (!visible && loop) {
        loop.stop()
        loop = undefined
      }
    },
    { rootMargin: '120px' },
  )
  io.observe(el)

  return () => {
    io.disconnect()
    loop?.stop()
    loop = undefined
    wakeRef.current = null
  }
}
