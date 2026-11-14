import { createServerFn } from '@tanstack/react-start'

/**
 * The Convex token of the person this request comes from, or null. The
 * server render reads Convex with it, as the browser does afterwards.
 */
export const convexToken = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { convexTokenNow } = await import('./server')
    return await convexTokenNow()
  },
)
