// Task 8: data quality flags.
//
// The rule this module exists to enforce: never auto-correct, only mark. A
// negative lot size is a real thing that was really recorded, and quietly
// flipping it to positive invents data. Flagging it lets the analysis pipeline
// exclude the row on purpose instead of trusting a repair nobody witnessed.

import { computeJournalingLagMinutes } from './derived.js'

export const DATA_QUALITY_FLAGS = {
  LEGACY_UNLINKED: 'legacy_unlinked',
  MISSING_STOP_LOSS: 'missing_stop_loss',
  MISSING_PRICES: 'missing_prices',
  INVALID_LOT_SIZE: 'invalid_lot_size',
  MULTI_TRADE_ENTRY: 'multi_trade_entry',
  RETROACTIVE_JOURNAL: 'retroactive_journal',
}

// A v2 entry written more than an hour after the stated entry time was not
// written contemporaneously, whatever the notes say. One hour is generous
// enough that a genuinely-at-entry journal never trips it.
export const RETROACTIVE_LAG_THRESHOLD_MINUTES = 60

// v1 rows have no structural signal for any of this, so their notes are the
// only evidence available. These patterns are deliberately narrow: a false
// positive here mislabels a good row.
const RETROACTIVE_NOTE_PATTERN = /journal(?:ed|led|ing)?\s+(?:this\s+)?late|late\s+journal|logged\s+(?:this\s+)?(?:after|late)|retroactiv/i
const MULTI_TRADE_NOTE_PATTERN =
  /\b(?:merg\w+|combin\w+|lump\w+)\b[^.]{0,40}\btrades?\b|\b(?:\d+|two|three|four|several|multiple)\s+(?:separate\s+)?trades\b|\btrades?\s+(?:merged|combined)\b/i

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// Recomputed on every write, so the flags on a row always describe the row as
// it stands rather than as it was when first saved.
export function computeDataQualityFlags(trade) {
  const flags = []
  const notes = [trade.notes, trade.exitNotes].filter(Boolean).join('\n')

  // No broker position ID means the row cannot be joined to execution data at
  // all. Every v1 row carries this; a v2 row never can, because Task 1 makes
  // the field required at write time.
  if (!trade.brokerPositionId) flags.push(DATA_QUALITY_FLAGS.LEGACY_UNLINKED)

  if (!isNum(trade.stopLoss)) flags.push(DATA_QUALITY_FLAGS.MISSING_STOP_LOSS)

  // Plural on purpose: either end of the price pair missing breaks the
  // R-multiple, so both count as missing prices. An open v2 trade is exempt —
  // its exit price is not missing, it has not happened yet.
  const exitExpected = trade.entryStage !== 'pending_exit'
  if (!isNum(trade.entryPrice) || (exitExpected && !isNum(trade.exitPrice))) {
    flags.push(DATA_QUALITY_FLAGS.MISSING_PRICES)
  }

  // v1 contains three negative lot sizes, including -16.83. Preserved as-is.
  if (trade.lotSize != null && (!isNum(trade.lotSize) || trade.lotSize <= 0)) {
    flags.push(DATA_QUALITY_FLAGS.INVALID_LOT_SIZE)
  }

  // One v1 row merges three separate trades into a single entry, which makes
  // its P&L a sum and its prices meaningless.
  if (notes && MULTI_TRADE_NOTE_PATTERN.test(notes)) {
    flags.push(DATA_QUALITY_FLAGS.MULTI_TRADE_ENTRY)
  }

  // Two independent detectors: the note text (all v1 has) and the measured lag
  // between entry and first save (what Task 2 added so this stops depending on
  // the user volunteering it).
  const lag = computeJournalingLagMinutes(trade)
  const retroactiveByNote = notes && RETROACTIVE_NOTE_PATTERN.test(notes)
  const retroactiveByLag = isNum(lag) && lag > RETROACTIVE_LAG_THRESHOLD_MINUTES
  if (retroactiveByNote || retroactiveByLag) {
    flags.push(DATA_QUALITY_FLAGS.RETROACTIVE_JOURNAL)
  }

  return flags
}
