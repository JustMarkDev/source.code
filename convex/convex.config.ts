import { defineApp } from 'convex/server'
import { v } from 'convex/values'

const app = defineApp({
  env: {
    // Shared by the HTTP API servers and this deployment. The functions in
    // `apiStores.ts` refuse everyone while it is unset, and when it is shorter
    // than 16 characters. Set it with `npx convex env set API_STORE_SECRET <value>`.
    API_STORE_SECRET: v.optional(v.string()),
  },
})

export default app
