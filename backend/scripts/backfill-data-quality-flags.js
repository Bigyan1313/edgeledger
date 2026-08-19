#!/usr/bin/env node
// Recompute dataQualityFlags for every trade using src/domain/dataQuality.js.
//
// The schema v2 migration applies the same rules in SQL so that
// `prisma migrate deploy` alone leaves the database correct. But a migration is
// a frozen historical artifact — you do not edit one after it has run anywhere.
// When the flag rules change, change the domain module and run this script;
// this is the authoritative implementation and it wins on any disagreement.
//
//   node scripts/backfill-data-quality-flags.js [--dry-run]
//
// Flags describe, they never repair: no trade value other than
// dataQualityFlags is written.

import prisma from '../src/prisma/client.js'
import { computeDataQualityFlags } from '../src/domain/dataQuality.js'

const dryRun = process.argv.includes('--dry-run')

function sameFlags(a, b) {
  return a.length === b.length && a.every((flag, i) => flag === b[i])
}

async function main() {
  const trades = await prisma.trade.findMany({ orderBy: { id: 'asc' } })
  console.log(`Scanning ${trades.length} trade(s)${dryRun ? ' (dry run)' : ''}…`)

  const tally = new Map()
  let changed = 0

  for (const trade of trades) {
    const flags = computeDataQualityFlags(trade)
    for (const flag of flags) tally.set(flag, (tally.get(flag) ?? 0) + 1)

    if (sameFlags(flags, trade.dataQualityFlags ?? [])) continue
    changed++
    console.log(
      `  trade #${trade.id}: [${(trade.dataQualityFlags ?? []).join(', ')}] → [${flags.join(', ')}]`
    )
    if (!dryRun) {
      await prisma.trade.update({
        where: { id: trade.id },
        data: { dataQualityFlags: flags },
      })
    }
  }

  console.log(`\nFlag totals across all ${trades.length} row(s):`)
  for (const [flag, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${flag.padEnd(22)} ${count}`)
  }
  console.log(
    changed === 0
      ? '\nAll rows already carry the correct flags.'
      : `\n${dryRun ? 'Would update' : 'Updated'} ${changed} row(s).`
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
