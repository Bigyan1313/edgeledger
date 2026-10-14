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

// Futures: dollars per one full point of price, per contract. Same role as a
// CFD contract size in riskDollars = |entry − stop| × contracts × this, with
// lotSize read as the number of contracts. CME specifications.
export const FUTURES_POINT_VALUES = {
  // Equity indices
  NQ: 20, MNQ: 2,
  ES: 50, MES: 5,
  YM: 5, MYM: 0.5,
  RTY: 50, M2K: 5,
  // Metals
  GC: 100, MGC: 10,
  SI: 5000, SIL: 1000,
  HG: 25000, MHG: 2500,
  // Energy
  CL: 1000, MCL: 100,
  NG: 10000,
  // FX
  '6E': 125000, M6E: 12500,
  '6B': 62500,
  // Rates
  ZN: 1000, ZB: 1000,
  // Crypto
  BTC: 5, MBT: 0.1,
  ETH: 50, MET: 0.1,
}

const MONTH_CODES = 'FGHJKMNQUVXZ'

// A futures symbol as platforms write it, reduced to its root and contract
// month. The month matters for matching fills to trades; the root is what
// prices it. Returns null for anything that is not a known futures root, so a
// CFD symbol is never mistaken for one.
//
//   MNQZ6, MNQZ26, MNQZ2026   Tradovate, Rithmic, TradingView
//   MNQ 12-26                 NinjaTrader
//   MNQ1!                     TradingView continuous
//   /MNQZ6                    thinkorswim
//   MNQ                       bare root
//
// The month code is the letter right before the trailing year digits, so the
// split is unique even for roots that contain month letters (MNQ, NQ) or
// digits (M2K, 6E).
export function parseFuturesSymbol(pair) {
  if (typeof pair !== 'string') return null
  const s = pair.trim().toUpperCase().replace(/^\//, '')
  const known = (root) => Object.prototype.hasOwnProperty.call(FUTURES_POINT_VALUES, root)
  let m

  if ((m = /^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,4})$/.exec(s)) && known(m[1])) {
    return { root: m[1], month: m[2], year: Number(m[3]) % 10 }
  }
  if ((m = /^([A-Z0-9]+)\s+(\d{2})-(\d{2})$/.exec(s)) && known(m[1])) {
    const month = MONTH_CODES[Number(m[2]) - 1]
    return month ? { root: m[1], month, year: Number(m[3]) % 10 } : null
  }
  if ((m = /^([A-Z0-9]+?)\d!$/.exec(s)) && known(m[1])) {
    return { root: m[1], month: null, year: null }
  }
  if (known(s)) return { root: s, month: null, year: null }
  return null
}

export function contractSizeFor(pair) {
  // CFD and spot symbols first, unchanged: an existing XAUUSD.pro trade must
  // price exactly as it did before futures were added.
  const symbol = normalizeSymbol(pair)
  if (symbol && CONTRACT_SIZES[symbol] !== undefined) return CONTRACT_SIZES[symbol]
  const future = parseFuturesSymbol(pair)
  return future ? FUTURES_POINT_VALUES[future.root] : null
}
