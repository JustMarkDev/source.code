/**
 * The cost of running source.code per customer, and the margin each plan earns.
 *
 * Private business logic: keep it out of any public mirror.
 *
 * Every vendor rate is copied from the vendor's public page, with the date it
 * was read. Every usage number is an ASSUMPTION and is labelled as one: change
 * it when real usage data exists. `pricing-model.test.ts` fails when a price
 * stops covering its cost.
 */
import { perMonth, plans } from '../src/lib/pricing'
import type { Plan } from '../src/lib/pricing'

export const HOURS_PER_MONTH = 730

/** Vendor rates, USD. Read on 2026-11-04. Re-check before relying on them. */
export const vendor = {
  codeStorage: {
    source: 'https://code.storage/pricing',
    hotPerGbHour: 0.005, // replicated, low latency
    coldPerGbHour: 0.0002, // untouched for more than 7 days
    inboundPerGb: 0.06,
    outboundPerGb: 0.15,
    minimumMonthly: 20, // Starter minimum spend
  },
  convex: {
    source: 'https://www.convex.dev/pricing',
    proPerMonth: 25,
    includedCalls: 25_000_000,
    perMillionCalls: 2,
  },
  r2: {
    source: 'https://developers.cloudflare.com/r2/pricing',
    perGbMonth: 0.015, // egress is free
  },
  payments: {
    // Stripe 2.9% + $0.30, Billing 0.7%, Tax 0.5% (sources vary: 0.5 to 0.8%),
    // plus 1.5% on international cards for an assumed 30% of volume.
    source: 'https://stripe.com/pricing',
    percent: 0.029 + 0.007 + 0.005 + 0.015 * 0.3,
    fixed: 0.3,
  },
} as const

/**
 * Monthly costs that exist with zero customers. Hosting, email, error tracking
 * and the status page are ASSUMED list prices for a small team plan.
 */
export const fixedMonthly = [
  { name: 'Convex Pro', usd: vendor.convex.proPerMonth },
  { name: 'Web hosting', usd: 40 },
  { name: 'Transactional email', usd: 20 },
  { name: 'Error tracking', usd: 26 },
  { name: 'Status page', usd: 29 },
  { name: 'Domain, DNS and misc', usd: 10 },
  { name: 'Code Storage minimum', usd: vendor.codeStorage.minimumMonthly },
]

/** Cost that scales with customers but not with their storage: support time, abuse handling. ASSUMED. */
export const supportPerSeat = 0.5
/** Backend calls and small database rows per seat. ASSUMED from 50k calls a month. */
export const convexPerSeat = 0.1
/** Release files in object storage per seat. ASSUMED 3 GB. */
export const releasesPerSeat = 3 * vendor.r2.perGbMonth

export type Usage = {
  storageGb: number
  /** Share of storage touched in the last 7 days, so billed at the hot rate. */
  hotShare: number
  pushGb: number
  transferGb: number
}

export type Breakdown = {
  storage: number
  transfer: number
  push: number
  other: number
  /** Everything except payment fees. */
  variable: number
}

export function storageCost(gb: number, hotShare: number): number {
  const c = vendor.codeStorage
  const hot = c.hotPerGbHour * HOURS_PER_MONTH
  const cold = c.coldPerGbHour * HOURS_PER_MONTH
  return gb * hotShare * hot + gb * (1 - hotShare) * cold
}

/** Reproduces the worked example on code.storage/pricing: 20 GB hot, 250 GB cold, 250 GB in, 250 GB out = $162. */
export function codeStorageBill(u: {
  hotGb: number
  coldGb: number
  inGb: number
  outGb: number
}): number {
  const c = vendor.codeStorage
  return (
    u.hotGb * c.hotPerGbHour * HOURS_PER_MONTH +
    u.coldGb * c.coldPerGbHour * HOURS_PER_MONTH +
    u.inGb * c.inboundPerGb +
    u.outGb * c.outboundPerGb
  )
}

/** What one seat costs us in a month for a given usage. Payment fees are separate. */
export function seatCost(u: Usage): Breakdown {
  const storage = storageCost(u.storageGb, u.hotShare)
  const transfer = u.transferGb * vendor.codeStorage.outboundPerGb
  const push = u.pushGb * vendor.codeStorage.inboundPerGb
  const other = convexPerSeat + releasesPerSeat + supportPerSeat
  return {
    storage,
    transfer,
    push,
    other,
    variable: storage + transfer + push + other,
  }
}

export const paymentFee = (price: number) =>
  price * vendor.payments.percent + vendor.payments.fixed

export type Profile = 'typical' | 'agentHeavy' | 'atCap'

/**
 * Three ways a customer can use a plan. ASSUMPTIONS, by plan.
 *  typical:    what we expect an average customer to use.
 *  agentHeavy: typical storage, three quarters of the transfer allowance,
 *              because agents clone and fetch a lot.
 *  atCap:      every allowance used, with a large share of data hot.
 */
const typicalUsage: Record<Plan['id'], Usage> = {
  solo: { storageGb: 1.5, hotShare: 0.25, pushGb: 0.5, transferGb: 4 },
  team: { storageGb: 3, hotShare: 0.25, pushGb: 1.5, transferGb: 10 },
  business: { storageGb: 6, hotShare: 0.3, pushGb: 4, transferGb: 25 },
}

export function usageFor(plan: Plan, profile: Profile): Usage {
  const t = typicalUsage[plan.id]
  const l = plan.limits
  if (profile === 'typical') return t
  if (profile === 'agentHeavy') return { ...t, transferGb: l.transferGb * 0.75 }
  return {
    storageGb: l.storageGb,
    hotShare: 0.4,
    pushGb: l.pushGb,
    transferGb: l.transferGb,
  }
}

export type Economics = {
  price: number
  variable: number
  fees: number
  profit: number
  /** Gross margin: profit as a share of price. */
  margin: number
}

export function economics(
  plan: Plan,
  profile: Profile,
  cycle: 'month' | 'year' = 'month',
): Economics {
  // Yearly customers pay a rounded-down monthly price: the same costs against less revenue.
  const price = perMonth(plan, cycle)
  const { variable } = seatCost(usageFor(plan, profile))
  // A yearly customer is charged once a year, so the fixed $0.30 happens once in 12 months.
  const fees =
    price * vendor.payments.percent +
    (cycle === 'year' ? vendor.payments.fixed / 12 : vendor.payments.fixed)
  const profit = price - variable - fees
  return { price, variable, fees, profit, margin: profit / price }
}

export const fixedTotal = fixedMonthly.reduce((n, f) => n + f.usd, 0)

/** Paying customers needed before the fixed costs are covered, at typical usage. */
export function breakEvenCustomers(plan: Plan): number {
  const e = economics(plan, 'typical')
  return Math.ceil(fixedTotal / e.profit)
}

/**
 * What one trial costs us. A trial uses its storage fully hot for the whole
 * period (it is all fresh pushes), plus its transfer allowance.
 */
export function trialCost(t: {
  days: number
  storageGb: number
  transferGb: number
}): number {
  const c = vendor.codeStorage
  return (
    t.storageGb * c.hotPerGbHour * 24 * t.days +
    t.transferGb * c.outboundPerGb +
    t.storageGb * c.inboundPerGb +
    convexPerSeat
  )
}

export { plans }
