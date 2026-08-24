// Turning HTTP JSON into the types the validation rules expect.
//
// The rule that matters here: coercion never invents a value. An empty string
// becomes null so the "required" rule can fire, rather than becoming 0 and
// sailing through as if the user had answered.

import { STAGE_A_FIELDS, STAGE_B_FIELDS } from './tradeSchema.js'

// null for absent/blank, NaN for present-but-unparseable. Both fail the numeric
// rules; keeping them distinct means a future caller can tell "not answered"
// from "answered with nonsense".
export function toNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

export function toBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  // Anything else — including undefined and null — stays unanswered.
  return undefined
}

export function toTrimmedString(value) {
  if (typeof value !== 'string') return value == null ? null : value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const NUMERIC_FIELDS = new Set(['entryPrice', 'stopLoss', 'takeProfit', 'exitPrice', 'lotSize', 'pnl'])
const BOOLEAN_FIELDS = new Set(['followedChecklist', 'fullPort'])
const DATE_FIELDS = new Set(['entryTimeUtc', 'exitTimeUtc'])
const ARRAY_FIELDS = new Set(['screenshots'])

function coerceField(field, value) {
  // Screenshots arrive as an array of data URLs; anything else is not a list of
  // screenshots and becomes an empty one rather than a malformed column.
  if (ARRAY_FIELDS.has(field)) return Array.isArray(value) ? value : []
  if (NUMERIC_FIELDS.has(field)) return toNumber(value)
  if (BOOLEAN_FIELDS.has(field)) return toBoolean(value)
  if (DATE_FIELDS.has(field)) return toDate(value)
  return toTrimmedString(value)
}

// Pick only the named fields off the body and coerce each. Anything the client
// sends that is not in `fields` is dropped — the client does not get to decide
// what a trade record contains.
export function coerceFields(body, fields) {
  const out = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      out[field] = coerceField(field, body[field])
    }
  }
  return out
}

export const coerceStageA = (body) => coerceFields(body, STAGE_A_FIELDS)
export const coerceStageB = (body) => coerceFields(body, STAGE_B_FIELDS)
