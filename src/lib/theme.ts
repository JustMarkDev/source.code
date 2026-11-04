import * as React from 'react'

/**
 * The theme is the device's: light or dark follows the system setting, live.
 * There is no toggle and nothing is stored.
 */
const query = '(prefers-color-scheme: dark)'

/** Runs before first paint so there is no flash of the wrong theme. */
export const themeInitScript = `(function(){try{document.documentElement.classList.toggle('dark',matchMedia('${query}').matches)}catch(e){}})()`

function subscribe(cb: () => void) {
  const mq = matchMedia(query)
  const onChange = () => {
    document.documentElement.classList.toggle('dark', mq.matches)
    cb()
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True when the document is currently rendered dark. */
export function useIsDark(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => true,
  )
}
