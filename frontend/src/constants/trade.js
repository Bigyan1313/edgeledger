// The v2 vocabulary, mirroring backend/src/domain/tradeSchema.js.
//
// The backend is the authority — it revalidates everything — but the form needs
// these lists to render, and shipping a stale copy would let the UI offer a
// choice the server rejects. Keep the two files in step.

export const SCHEMA_VERSION = 2

export const BROKER_PLATFORMS = ['cTrader', 'MT4', 'MT5', 'other']

// Chart structure only. No `Other`: in v1 it was the largest bucket, which
// meant the taxonomy was failing rather than that the trades were
// unclassifiable. `No defined setup` is the honest label for what `Other` was
// really being used to say.
export const TECHNICAL_SETUPS = [
  'Trend continuation',
  'Sweep → displacement → retest',
  'A+ Session sweep + rejection retest',
  'Anticipation (no confirmation)',
  'Break & retest',
  'No defined setup',
]

// Trader state only. Recorded independently of the setup, because a revenge
// trade is still *some* setup and forcing one choice destroys both facts.
export const EMOTIONAL_STATES = [
  'Calm',
  'FOMO / Impulsive',
  'Revenge',
  'Anxious',
  'Overconfident',
]

// Worth a warning at entry time. Advisory only — nothing is blocked.
export const RISKY_TECHNICAL_SETUPS = new Set([
  'Anticipation (no confirmation)',
  'No defined setup',
])
export const RISKY_EMOTIONAL_STATES = new Set([
  'FOMO / Impulsive',
  'Revenge',
  'Overconfident',
])

// Autocomplete hints, not a whitelist. The point of v2 is that the stored value
// is the broker's exact symbol string, whatever it happens to be.
export const SYMBOL_SUGGESTIONS = [
  'XAUUSD.pro', 'NAS100.pro', 'US30.pro', 'EURUSD.pro',
  'GBPUSD.pro', 'GBPJPY.pro', 'USDJPY.pro', 'BTCUSD.pro',
]

export const DATA_QUALITY_FLAG_LABELS = {
  legacy_unlinked: 'No broker position ID — cannot be joined to execution data',
  missing_stop_loss: 'No stop loss recorded — R-multiple is uncomputable',
  missing_prices: 'Entry or exit price missing',
  invalid_lot_size: 'Lot size is zero or negative',
  multi_trade_entry: 'This row merges more than one trade',
  retroactive_journal: 'Journaled after the outcome was known',
}

// The user's zone at the moment of entry, as an IANA name. Recorded so
// time-of-day questions stay answerable without making the stored instant
// ambiguous.
export function detectTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
