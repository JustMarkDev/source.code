/**
 * Who else is looking at a change or an issue. Whoever has one open sends a
 * heartbeat every `PRESENCE_INTERVAL` milliseconds; a viewer who sends none
 * for two and a half intervals is gone.
 *
 * Plain JavaScript with no dependencies: the Convex functions import it too.
 */
export const PRESENCE_INTERVAL = 20_000
