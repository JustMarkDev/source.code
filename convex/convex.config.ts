import betterAuth from '@convex-dev/better-auth/convex.config'
import { defineApp } from 'convex/server'
import { v } from 'convex/values'

const app = defineApp({
  env: {
    // Shared by the HTTP API servers and this deployment. The functions in
    // `apiStores.ts` refuse everyone while it is unset, and when it is shorter
    // than 16 characters. Set it with `npx convex env set API_STORE_SECRET <value>`.
    API_STORE_SECRET: v.optional(v.string()),
    // Sign-in (`auth.ts`). SITE_URL is where people reach the web app, and
    // BETTER_AUTH_SECRET signs sessions. Sign-in refuses to start without
    // both: `npx convex env set SITE_URL http://localhost:3000` and
    // `npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"`.
    SITE_URL: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.optional(v.string()),
    // Email (`auth.ts`): verification and password reset go through Resend
    // when both are set, and to the deployment's log when not.
    // `npx convex env set RESEND_API_KEY re_...` and
    // `npx convex env set MAIL_FROM "source.code <hello@your.domain>"`.
    RESEND_API_KEY: v.optional(v.string()),
    // Where the forge's answers link to: the HTTP API's base
    // (`https://source.code/api/v1`). Links to pages use SITE_URL.
    API_URL: v.optional(v.string()),
    // The HTTP API's own JWTs (`auth.config.ts`): who signs them and the
    // public key, as a JWKS data URL. Both come from `bun scripts/api-keys.ts`.
    API_JWT_ISSUER: v.optional(v.string()),
    API_JWT_JWKS: v.optional(v.string()),
    // Signs code.storage's push webhooks (`http.ts`). Set it to the secret
    // code.storage shows for the webhook. Without it every webhook is refused.
    CODE_STORAGE_WEBHOOK_SECRET: v.optional(v.string()),
    MAIL_FROM: v.optional(v.string()),
  },
})

// Sign-in keeps its users, sessions and credentials in its own tables.
app.use(betterAuth)

export default app
