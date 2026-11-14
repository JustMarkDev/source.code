/**
 * The time a write happens at. Mutations may read the clock; queries take
 * the time as an argument when an answer depends on it, so a cached query is
 * never answered with a stale "now".
 */
export const now = () => Date.now()

export const iso = (ms: number) => new Date(ms).toISOString()
