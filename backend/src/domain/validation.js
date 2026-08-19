// Every rule that decides whether a trade is allowed into the journal.
//
// Design note: this module returns a list of `{ field, message }` rather than
// throwing on the first problem, so the entry form can show everything wrong at
// once instead of making the user resubmit six times.

import {
  BROKER_PLATFORMS,
  DIRECTIONS,
  EMOTIONAL_STATES,
  TECHNICAL_SETUPS,
} from './tradeSchema.js'
import { computeOutcome } from './derived.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isFilledString = (v) => typeof v === 'string' && v.trim().length > 0

// --- helpers ---------------------------------------------------------------

function parseTimestamp(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// An IANA zone name is validated by asking the platform to use it — there is no
// static list worth shipping, and `Intl` already knows the real one.
//
// But `Intl` alone is too permissive for Task 6: it also accepts legacy
// abbreviations like "CST", which is US Central in Chicago and China Standard
// in Shanghai. Accepting one would reintroduce exactly the ambiguity this field
// exists to remove, so the Area/Location form is required. "UTC" is the one
// bare name allowed, because it is the one that cannot be ambiguous.
const IANA_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/

function isValidIanaTimezone(tz) {
  if (!isFilledString(tz)) return false
  const zone = tz.trim()
  if (zone !== 'UTC' && !IANA_ZONE_PATTERN.test(zone)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Task 6: `Other` is not an instrument. What we want is the broker's exact
// symbol string, so it joins to execution data without a mapping table.
const SYMBOL_PATTERN = /^[A-Za-z0-9]{3,12}([._-][A-Za-z0-9]{1,8})?$/

// --- Stage A: everything knowable before or at entry ------------------------

export function validateStageA(input) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  // Task 1 — broker linkage. Without this the journal and the execution data
  // are two unrelated datasets.
  if (!isFilledString(input.brokerPositionId)) {
    add('brokerPositionId', 'Broker position ID is required — it is the only key that links this entry to the broker\'s execution record.')
  }
  if (!isFilledString(input.brokerAccountId)) {
    add('brokerAccountId', 'Broker account ID is required — which account the trade was taken on.')
  }
  if (!BROKER_PLATFORMS.includes(input.brokerPlatform)) {
    add('brokerPlatform', `Broker platform must be one of: ${BROKER_PLATFORMS.join(', ')}.`)
  }

  // Task 6 — instrument
  if (!isFilledString(input.pair)) {
    add('pair', 'Instrument symbol is required.')
  } else if (input.pair.trim().toLowerCase() === 'other') {
    add('pair', '"Other" is not an instrument. Enter the broker\'s exact symbol, e.g. XAUUSD.pro.')
  } else if (!SYMBOL_PATTERN.test(input.pair.trim())) {
    add('pair', 'Instrument must be the broker\'s exact symbol string, e.g. XAUUSD.pro or NAS100.pro.')
  }

  if (!DIRECTIONS.includes(input.direction)) {
    add('direction', `Direction must be one of: ${DIRECTIONS.join(', ')}.`)
  }

  // Task 6 — unambiguous timestamps
  const entryTime = parseTimestamp(input.entryTimeUtc)
  if (!entryTime) {
    add('entryTimeUtc', 'Entry time is required and must be a valid ISO 8601 timestamp.')
  }
  if (!isValidIanaTimezone(input.captureTimezone)) {
    add('captureTimezone', 'Capture timezone is required and must be an IANA zone name, e.g. America/Chicago.')
  }

  // Task 5 — risk fields required and sane
  if (!isNum(input.entryPrice)) {
    add('entryPrice', 'Entry price is required and must be a number.')
  } else if (input.entryPrice <= 0) {
    add('entryPrice', 'Entry price must be greater than 0.')
  }

  if (!isNum(input.stopLoss)) {
    add('stopLoss', 'Stop loss is required and must be a number — without it the R-multiple cannot be computed.')
  } else if (input.stopLoss <= 0) {
    add('stopLoss', 'Stop loss must be greater than 0.')
  }

  if (!isNum(input.lotSize)) {
    add('lotSize', 'Lot size is required and must be a number.')
  } else if (input.lotSize <= 0) {
    add('lotSize', 'Lot size must be greater than 0.')
  }

  if (input.takeProfit != null && (!isNum(input.takeProfit) || input.takeProfit <= 0)) {
    add('takeProfit', 'Take profit must be greater than 0 when provided.')
  }

  // Stop must sit on the losing side of entry for the stated direction.
  if (isNum(input.entryPrice) && isNum(input.stopLoss) && input.stopLoss > 0 && input.entryPrice > 0) {
    if (input.direction === 'long' && input.stopLoss >= input.entryPrice) {
      add('stopLoss', `For a long, stop loss must be below entry price (got stop ${input.stopLoss} ≥ entry ${input.entryPrice}).`)
    }
    if (input.direction === 'short' && input.stopLoss <= input.entryPrice) {
      add('stopLoss', `For a short, stop loss must be above entry price (got stop ${input.stopLoss} ≤ entry ${input.entryPrice}).`)
    }
  }

  // Task 3 — both axes required, neither defaulted
  if (!TECHNICAL_SETUPS.includes(input.technicalSetup)) {
    add('technicalSetup', `Technical setup is required and must be one of: ${TECHNICAL_SETUPS.join(', ')}.`)
  }
  if (!EMOTIONAL_STATES.includes(input.emotionalState)) {
    add('emotionalState', `Emotional state is required and must be one of: ${EMOTIONAL_STATES.join(', ')}.`)
  }

  // Task 4 — booleans must be answered, not inherited from a default
  if (typeof input.followedChecklist !== 'boolean') {
    add('followedChecklist', 'Answer whether the checklist was followed — this field has no default.')
  }
  if (typeof input.fullPort !== 'boolean') {
    add('fullPort', 'Answer whether this was a full-port trade — this field has no default.')
  }

  return errors
}

// --- Stage B: everything only knowable after the exit -----------------------

// `existing` supplies the locked Stage A values the close is checked against.
export function validateStageB(input, existing) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  const exitTime = parseTimestamp(input.exitTimeUtc)
  if (!exitTime) {
    add('exitTimeUtc', 'Exit time is required to close a trade, and must be a valid ISO 8601 timestamp.')
  }

  if (!isNum(input.exitPrice)) {
    add('exitPrice', 'Exit price is required to close a trade and must be a number.')
  } else if (input.exitPrice <= 0) {
    add('exitPrice', 'Exit price must be greater than 0.')
  }

  if (!isNum(input.pnl)) {
    add('pnl', 'Realised P&L is required to close a trade and must be a number.')
  }

  const entryTime = parseTimestamp(existing?.entryTimeUtc)
  if (exitTime && entryTime && exitTime.getTime() < entryTime.getTime()) {
    add('exitTimeUtc', `Exit time must be at or after entry time (entry ${entryTime.toISOString()}, exit ${exitTime.toISOString()}).`)
  }

  // The sign of P&L has to agree with the direction the price actually went.
  // A long that exited above entry cannot have lost money, and a row claiming
  // otherwise is a transcription error, not a trade.
  //
  // A zero price move imposes no constraint: commission and swap legitimately
  // decide the sign of a scratch trade.
  if (isNum(input.pnl) && isNum(input.exitPrice) && isNum(existing?.entryPrice) && existing?.direction) {
    const move = existing.direction === 'long'
      ? input.exitPrice - existing.entryPrice
      : existing.entryPrice - input.exitPrice
    const priceOutcome = computeOutcome(move)
    const pnlOutcome = computeOutcome(input.pnl)
    if (priceOutcome !== 'Break-even' && pnlOutcome !== priceOutcome) {
      add('pnl', `P&L sign disagrees with the price move: a ${existing.direction} from ${existing.entryPrice} to ${input.exitPrice} is a ${priceOutcome.toLowerCase()}, but P&L of ${input.pnl} is a ${String(pnlOutcome).toLowerCase()}.`)
    }
  }

  return errors
}

// --- amendments -------------------------------------------------------------

// An amendment re-runs the full Stage A rule set against the merged result, so
// a trade cannot be edited into a state it could never have been created in.
export function validateAmendment(merged) {
  return validateStageA(merged)
}

export function formatErrors(errors) {
  return errors.map(e => `${e.field}: ${e.message}`).join(' ')
}
