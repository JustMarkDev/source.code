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

export default crons
