import * as React from 'react'
import { preloadHighlighter } from '@pierre/diffs'

/** The syntax colours for code. Both themes keep every token at 4.5:1 or better on our surfaces. */
export const codeTheme = (dark: boolean) =>
  dark ? ('github-dark' as const) : ('github-light' as const)

const phone = '(max-width: 640px)'

/**
 * Code wraps on a phone, where sideways scrolling inside a small box is easy to
 * miss and cannot be reached by keyboard, and scrolls everywhere else, where
 * long lines keep their shape.
 */
export function useCodeOverflow(): 'scroll' | 'wrap' {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(phone)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => (matchMedia(phone).matches ? 'wrap' : 'scroll'),
    () => 'scroll',
  )
}

/**
 * Warm the code highlighter as soon as the page loads. A file mounted before it
 * is ready (opening one from "Go to file", say) can finish with an empty body,
 * so load the themes and the languages the file browser shows up front.
 */
if (typeof window !== 'undefined') {
  void preloadHighlighter({
    themes: [codeTheme(false), codeTheme(true)],
    langs: ['rust', 'typescript', 'markdown', 'yaml', 'shellscript', 'dotenv'],
  }).catch(() => undefined)
}
