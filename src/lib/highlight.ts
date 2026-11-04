import { preloadHighlighter } from '@pierre/diffs'

/**
 * Warm the code highlighter as soon as the page loads. A file mounted before it
 * is ready (opening one from "Go to file", say) can finish with an empty body,
 * so load the themes and the languages the file browser shows up front.
 */
if (typeof window !== 'undefined') {
  void preloadHighlighter({
    themes: ['pierre-light', 'pierre-dark'],
    langs: ['rust', 'typescript', 'markdown', 'yaml', 'shellscript', 'dotenv'],
  }).catch(() => undefined)
}
