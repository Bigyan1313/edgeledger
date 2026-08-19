// The wire shape of a trade. Derived values are attached here — once, at the
// boundary — so no client has to reimplement outcome or R-multiple logic and
// then disagree with the server about it.

import {
  computeOutcome,
  computeRMultiple,
  computeJournalingLagMinutes,
  computeWasAmended,
  effectiveRiskDollars,
} from './derived.js'

export function serializeTrade(trade) {
  if (!trade) return trade

  // `riskDollars` on the row is the legacy v1 user-entered column and is not
  // part of the API surface; the computed value takes its name.
  const { riskDollars: _legacyRiskDollars, ...stored } = trade

  return {
    ...stored,
    outcome: computeOutcome(trade.pnl),
    riskDollars: effectiveRiskDollars(trade),
    rMultiple: computeRMultiple(trade),
    journalingLagMinutes: computeJournalingLagMinutes(trade),
    wasAmended: computeWasAmended(trade),
  }
}

export function serializeTrades(trades) {
  return trades.map(serializeTrade)
}
