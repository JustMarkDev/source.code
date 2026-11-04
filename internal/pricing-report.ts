/** `bun internal/pricing-report.ts` prints the numbers behind the prices. */
import { overage, plans, trial } from '../src/lib/pricing'
import {
  breakEvenCustomers,
  economics,
  fixedMonthly,
  fixedTotal,
  paymentFee,
  seatCost,
  storageCost,
  trialCost,
  usageFor,
  vendor,
} from './pricing-model'
import type { Profile } from './pricing-model'

const usd = (n: number) => `$${n.toFixed(2)}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const profiles: Array<Profile> = ['typical', 'agentHeavy', 'atCap']

console.log('# Pricing model\n')
console.log(
  `Per GB per month at Code Storage: hot ${usd(storageCost(1, 1))}, cold ${usd(storageCost(1, 0))}. Transfer out ${usd(vendor.codeStorage.outboundPerGb)}/GB, push ${usd(vendor.codeStorage.inboundPerGb)}/GB.\n`,
)
console.log('## Per seat, per month\n')
console.log(
  '| Plan | Price | Profile | Our cost | Payment fees | Profit | Gross margin |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const p of plans)
  for (const prof of profiles) {
    const e = economics(p, prof)
    console.log(
      `| ${p.name} | ${usd(p.monthly)} | ${prof} | ${usd(e.variable)} | ${usd(e.fees)} | ${usd(e.profit)} | ${pct(e.margin)} |`,
    )
  }
console.log('\n## Where the cost goes at typical use\n')
for (const p of plans) {
  const b = seatCost(usageFor(p, 'typical'))
  console.log(
    `- ${p.name}: storage ${usd(b.storage)}, transfer ${usd(b.transfer)}, push ${usd(b.push)}, other ${usd(b.other)}`,
  )
}
console.log(
  '\n## Yearly billing (10 months for 12, rounded down to a whole dollar a month)\n',
)
for (const p of plans)
  console.log(
    `- ${p.name}: typical margin ${pct(economics(p, 'typical', 'year').margin)}`,
  )
console.log('\n## Fixed monthly costs\n')
for (const f of fixedMonthly) console.log(`- ${f.name}: ${usd(f.usd)}`)
console.log(`- Total: ${usd(fixedTotal)}\n`)
console.log(
  '## Break-even (customers to cover fixed costs, excluding your own pay)\n',
)
for (const p of plans)
  console.log(`- ${p.name} only: ${breakEvenCustomers(p)} customers`)
console.log('\n## Trial\n')
console.log(
  `- ${trial.days} days, ${trial.storageGb} GB, ${trial.transferGb} GB transfer: ${usd(trialCost(trial))} per trial`,
)
for (const conv of [0.1, 0.2, 0.3])
  console.log(
    `- at ${pct(conv)} conversion: ${usd(trialCost(trial) / conv)} of trial cost per paying customer`,
  )
console.log(
  `\n## Overage\n\n- Storage ${usd(overage.storagePerGbMonth)}/GB/month, transfer ${usd(overage.transferPerGb)}/GB.`,
)
console.log('\n## Sensitivity: Solo typical margin by hot share of storage\n')
const solo = plans[0]
for (const hot of [0.1, 0.25, 0.5, 0.75]) {
  const u = { ...usageFor(solo, 'typical'), hotShare: hot }
  const v = seatCost(u).variable
  const price = solo.monthly
  console.log(
    `- ${(hot * 100).toFixed(0)}% hot: ${pct((price - v - paymentFee(price)) / price)}`,
  )
}
console.log('\n## Sensitivity: Solo typical margin by storage used\n')
for (const gb of [1.5, 3, 4]) {
  const u = { ...usageFor(solo, 'typical'), storageGb: gb }
  const v = seatCost(u).variable
  console.log(
    `- ${gb} GB: ${pct((solo.monthly - v - paymentFee(solo.monthly)) / solo.monthly)}`,
  )
}
