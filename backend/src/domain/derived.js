// Values that are *derived*, never stored, so they cannot drift out of sync
// with the facts they are derived from (Task 2 and Task 5).
//
// The single exception is `riskDollars` on v1 rows: those were user-entered
// and are preserved as legacy data, so the computation falls back to the
// stored column when a row predates schema v2.

import { contractSizeFor } from './tradeSchema.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Task 5: outcome is computed from pnl. Storing it lets it drift; a trade whose
// pnl says -120 and whose stored outcome says "Win" is a row nobody can trust.
// Returns null while the trade is still open — an unexited trade has no outcome,
// which is different from breaking even.
export function computeOutcome(pnl) {
  if (!isNum(pnl)) return null
  if (pnl > 0) return 'Win'
  if (pnl < 0) return 'Loss'
  return 'Break-even'
}

// Task 5: risk in account currency, from the numbers the trader actually
// committed rather than from a figure they typed in afterwards.
//
//   risk = |entry − stop| × lots × contract size
//
// Null (not zero, not a guess) when any input is missing or the instrument's
// contract size is unknown, so a null rMultiple downstream is honest about
// *why* it is null.
export function computeRiskDollars(trade) {
  const { entryPrice, stopLoss, lotSize, pair } = trade
  if (!isNum(entryPrice) || !isNum(stopLoss) || !isNum(lotSize)) return null
  if (lotSize <= 0) return null
  const contractSize = contractSizeFor(pair)
  if (!isNum(contractSize)) return null
  const risk = Math.abs(entryPrice - stopLoss) * lotSize * contractSize
  return risk > 0 ? round2(risk) : null
}

// v1 rows kept whatever the user typed into the old `riskDollars` box; v2 rows
// never write that column and always compute. `schemaVersion` decides which.
export function effectiveRiskDollars(trade) {
  const computed = computeRiskDollars(trade)
  if (computed != null) return computed
  if (trade.schemaVersion === 1 && isNum(trade.riskDollars)) return trade.riskDollars
  return null
}

// Task 5: R-multiple — the unit that lets trades be compared across account
// sizes and position sizes. Null when risk is unknown or zero.
export function computeRMultiple(trade) {
  const risk = effectiveRiskDollars(trade)
  if (!isNum(risk) || risk === 0) return null
  if (!isNum(trade.pnl)) return null
  return round2(trade.pnl / risk)
}

// Task 2: how long after the trade was entered did the journal entry appear?
// Large positive values mean the entry was written after the outcome was
// already known, which is exactly the contamination this field exists to
// expose. Negative values (journaled before the stated entry time) are
// possible and left as-is — pre-planning a trade is legitimate.
export function computeJournalingLagMinutes(trade) {
  const journaled = toDate(trade.journaledAt)
  const entered = toDate(trade.entryTimeUtc)
  if (!journaled || !entered) return null
  return Math.round((journaled.getTime() - entered.getTime()) / 60000)
}

// Task 7: did any locked Stage A field ever change after first save? The
// analysis pipeline filters on this to isolate trades whose recorded intent is
// provably original.
export function computeWasAmended(trade) {
  return Boolean(trade.amendedAt)
}

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function round2(n) {
  return Math.round(n * 100) / 100
}
