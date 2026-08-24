// Schema v2 vocabulary: the enums, field groups, and instrument metadata that
// every other layer (validation, serialisation, migration, export) reads from.
// Nothing here talks to the database — it is pure data so the same definitions
// can be imported by route handlers, scripts and tests alike.

export const SCHEMA_VERSION = 2

// --- Task 1: broker linkage -------------------------------------------------

export const BROKER_PLATFORMS = ['cTrader', 'MT4', 'MT5', 'other']
export const DEFAULT_BROKER_PLATFORM = 'cTrader'

// --- Task 3: the two orthogonal setup axes ---------------------------------

// Chart structure only. No emotional states in this list, and deliberately no
// `Other`: in v1 `Other` was the largest bucket (9 of 44), which meant the
// taxonomy was failing rather than that the trades were unclassifiable.
// `No defined setup` is the honest label. If a real setup is missing, add it
// here rather than reintroducing a catch-all.
export const TECHNICAL_SETUPS = [
  'Trend continuation',
  'Sweep → displacement → retest',
  'A+ Session sweep + rejection retest',
  'Anticipation (no confirmation)',
  'Break & retest',
  'No defined setup',
]

// Trader state only. A revenge trade is still *some* setup, so this axis is
// recorded independently of the technical one.
export const EMOTIONAL_STATES = [
  'Calm',
  'FOMO / Impulsive',
  'Revenge',
  'Anxious',
  'Overconfident',
]

// Setups/states worth a visible warning at entry time. Advisory only — nothing
// is blocked on the strength of this set.
export const RISKY_TECHNICAL_SETUPS = new Set([
  'Anticipation (no confirmation)',
  'No defined setup',
])
export const RISKY_EMOTIONAL_STATES = new Set([
  'FOMO / Impulsive',
  'Revenge',
  'Overconfident',
])

export const DIRECTIONS = ['long', 'short']

// --- Task 7: the two entry stages ------------------------------------------

export const ENTRY_STAGES = ['pending_exit', 'complete']

// Stage A is everything knowable before or at entry. Once saved these lock:
// changing any of them requires the explicit amend path, which writes an audit
// row. This is what makes "the intent was recorded before the outcome" a fact
// about the data rather than a claim about the user's habits.
export const STAGE_A_FIELDS = [
  'brokerPositionId',
  'brokerAccountId',
  'brokerPlatform',
  'pair',
  'direction',
  'entryTimeUtc',
  'captureTimezone',
  'entryPrice',
  'stopLoss',
  'takeProfit',
  'lotSize',
  'technicalSetup',
  'emotionalState',
  'followedChecklist',
  'fullPort',
  'notes',
  // Why the setup qualified — an intent claim like `notes`, so it locks too.
  'setupNotes',
]

// Stage B is everything only knowable after the exit. Freely editable — there
// is no intent to protect here, only a result to record.
export const STAGE_B_FIELDS = [
  'exitTimeUtc',
  'exitPrice',
  'pnl',
  'exitNotes',
]

// Not part of either stage. `accountId` is app-level bookkeeping (which
// EdgeLedger account a trade is filed under), not a claim about the trade.
// `screenshots` are evidence rather than a claim: attaching a chart after the
// fact is legitimate and must not cost an amendment.
export const UNLOCKED_METADATA_FIELDS = ['accountId', 'screenshots']

// --- Task 6: instruments ---------------------------------------------------

// Contract size = how many units of the instrument one lot controls. This is
// what turns a price distance into money, and therefore what makes
// `riskDollars` computable instead of user-entered (Task 5).
//
// Keyed by the symbol with any broker suffix stripped (`XAUUSD.pro` →
// `XAUUSD`), because the suffix is a venue detail, not a different instrument.
// An unknown symbol yields a null riskDollars — and therefore a null
// rMultiple — rather than a wrong number.
export const CONTRACT_SIZES = {
  // Metals — 1 lot = 100 oz gold / 5000 oz silver
  XAUUSD: 100,
  XAGUSD: 5000,
  // FX majors & crosses — 1 lot = 100,000 units of the base currency
  EURUSD: 100_000,
  GBPUSD: 100_000,
  AUDUSD: 100_000,
  NZDUSD: 100_000,
  USDCAD: 100_000,
  USDCHF: 100_000,
  USDJPY: 100_000,
  GBPJPY: 100_000,
  EURJPY: 100_000,
  EURGBP: 100_000,
  // Indices — 1 lot = 1 unit of the index per point
  NAS100: 1,
  US30: 1,
  SPX500: 1,
  GER40: 1,
  UK100: 1,
  // Crypto CFDs — 1 lot = 1 coin
  BTCUSD: 1,
  ETHUSD: 1,
}

// Common symbols offered as autocomplete hints. Not a whitelist: the point of
// Task 6 is that the user stores the broker's exact string, whatever it is.
export const SYMBOL_SUGGESTIONS = [
  'XAUUSD.pro', 'NAS100.pro', 'US30.pro', 'EURUSD.pro', 'GBPUSD.pro',
  'GBPJPY.pro', 'USDJPY.pro', 'BTCUSD.pro',
]

// Strip a broker suffix so `XAUUSD.pro`, `XAUUSD.raw` and `XAUUSD_i` all price
// the same instrument. Returns the bare symbol, upper-cased.
export function normalizeSymbol(pair) {
  if (typeof pair !== 'string') return null
  const bare = pair.trim().toUpperCase().replace(/[._-][A-Z0-9]+$/i, '')
  return bare || null
}

export function contractSizeFor(pair) {
  const symbol = normalizeSymbol(pair)
  if (!symbol) return null
  return CONTRACT_SIZES[symbol] ?? null
}
