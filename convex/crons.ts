import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Rate-limit windows and idempotency keys are only useful for a while.
crons.interval(
  'sweep api stores',
  { minutes: 10 },
  internal.apiStores.sweep,
  {},
)

// Tokens past expiry, OAuth state that ran out, runs and operations long over.
crons.interval('sweep tokens', { hours: 1 }, internal.forge.tokens.sweep, {})
crons.interval('sweep oauth', { minutes: 15 }, internal.forge.oauth.sweep, {})
crons.interval('sweep runs', { hours: 6 }, internal.forge.runs.sweep, {})

// Scheduled automations: the tick fires those that are due.
crons.interval(
  'automation schedules',
  { minutes: 1 },
  internal.forge.automations.tickSchedules,
  {},
)

// The status page: health minutes and days past keeping, and the counts.
crons.interval('sweep health', { minutes: 30 }, internal.forge.health.sweep, {})
crons.interval(
  'status counts',
  { minutes: 1 },
  internal.forge.health.startCount,
  {},
)

export default crons
