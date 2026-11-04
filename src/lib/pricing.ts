/**
 * What we charge. Public: the pricing page reads this.
 * The costs and margins behind these numbers live in `internal/pricing-model.ts`,
 * and a test fails if a price here stops covering them.
 */

export type PlanId = 'solo' | 'team' | 'business'

export type Limits = {
  /** Git storage included, per seat. */
  storageGb: number
  /** Data transferred out (clones, fetches, mirror pushes), per seat per month. */
  transferGb: number
  /** Data pushed in, per seat per month. */
  pushGb: number
  mirrors: number | 'unlimited'
}

export type Plan = {
  id: PlanId
  name: string
  blurb: string
  /** USD per seat per month, billed monthly. */
  monthly: number
  perSeat: boolean
  limits: Limits
  features: Array<string>
  lead?: string
  featured?: boolean
}

/** Yearly billing is 10 months for 12, then rounded down to a whole dollar a month. */
export const YEARLY_MONTHS = 10

export const trial = {
  days: 14,
  cardRequired: true,
  storageGb: 1,
  transferGb: 3,
}

/** Beyond a plan, billed in arrears at published rates. */
export const overage = { storagePerGbMonth: 3.5, transferPerGb: 0.3 }

export const plans: Array<Plan> = [
  {
    id: 'solo',
    name: 'Solo',
    blurb: 'For your own projects and your own history.',
    monthly: 15,
    perSeat: false,
    limits: { storageGb: 4, transferGb: 20, pushGb: 4, mirrors: 3 },
    features: [
      'Public and private repositories',
      'Import history from the hosts you use',
      '3 mirrors, so a copy lives elsewhere too',
      'Changes, policies and secrets in git',
      'The CLI, the MCP server and the agent skill',
      'Agent access to development secrets, with grants',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    blurb: 'For groups that review each other’s work.',
    monthly: 25,
    perSeat: true,
    limits: { storageGb: 8, transferGb: 32, pushGb: 8, mirrors: 10 },
    lead: 'Everything in Solo, plus',
    features: [
      'Teams as approvers, and approver classes for agents',
      'Shared policies across repositories',
      'Secrets recipients managed for the whole team',
      'Storage and transfer pooled across seats',
      'Two years of audit log',
      'Priority support',
    ],
    featured: true,
  },
  {
    id: 'business',
    name: 'Business',
    blurb: 'For larger codebases and heavier agent use.',
    monthly: 50,
    perSeat: true,
    limits: { storageGb: 20, transferGb: 80, pushGb: 20, mirrors: 'unlimited' },
    lead: 'Everything in Team, plus',
    features: [
      'Unlimited mirrors with sync alerts',
      'Policy dry runs and expiring exceptions',
      'Spend caps and token history for agents',
      'Five years of audit log',
      'Support with a named contact',
    ],
  },
]

/** Price per seat per month on a given billing cycle. Always a whole number, rounded down. */
export function perMonth(plan: Plan, cycle: 'month' | 'year'): number {
  return cycle === 'year'
    ? Math.floor((plan.monthly * YEARLY_MONTHS) / 12)
    : plan.monthly
}

/** What a yearly customer is charged once a year. */
export const perYear = (plan: Plan): number => perMonth(plan, 'year') * 12
