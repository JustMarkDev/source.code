import { describe, expect, test } from 'bun:test'
import { overage, plans, trial } from '../src/lib/pricing'
import {
  breakEvenCustomers,
  codeStorageBill,
  economics,
  storageCost,
  trialCost,
  vendor,
} from './pricing-model'

describe('the model matches the vendor', () => {
  test("Code Storage's own worked example comes to $162.00", () => {
    expect(
      codeStorageBill({ hotGb: 20, coldGb: 250, inGb: 250, outGb: 250 }),
    ).toBeCloseTo(162, 2)
  })
})

describe('every plan earns its margin', () => {
  for (const plan of plans) {
    test(`${plan.name}: 71% gross margin at typical use`, () => {
      expect(economics(plan, 'typical').margin).toBeGreaterThanOrEqual(0.71)
    })
    test(`${plan.name}: still above 60% when agents use most of the transfer`, () => {
      expect(economics(plan, 'agentHeavy').margin).toBeGreaterThanOrEqual(0.6)
    })
    test(`${plan.name}: never loses money with every allowance used`, () => {
      expect(economics(plan, 'atCap').profit).toBeGreaterThan(0)
    })
    test(`${plan.name}: yearly billing stays above 66% at typical use`, () => {
      expect(economics(plan, 'typical', 'year').margin).toBeGreaterThanOrEqual(
        0.66,
      )
    })
  }
})

describe('overage is priced above cost', () => {
  test('extra transfer earns at least 50%', () => {
    expect(
      1 - vendor.codeStorage.outboundPerGb / overage.transferPerGb,
    ).toBeGreaterThanOrEqual(0.5)
  })
  test('extra storage earns at least 50% even when 40% of it is hot', () => {
    expect(
      1 - storageCost(1, 0.4) / overage.storagePerGbMonth,
    ).toBeGreaterThanOrEqual(0.5)
  })
})

describe('trials and break-even', () => {
  test('a trial costs less than a month of the cheapest plan profit', () => {
    const solo = plans[0]
    expect(trialCost(trial)).toBeLessThan(economics(solo, 'typical').profit)
  })
  test('fixed costs are covered by a plausible number of customers', () => {
    expect(breakEvenCustomers(plans[0])).toBeLessThan(40)
  })
})
