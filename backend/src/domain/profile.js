// Validation for the trader profile.
//
// Everything here is optional, so the rules are all of the form "if you set it,
// it has to mean something". An unset field stays unset; it never acquires a
// default, for the same reason the trade model refuses defaults — a value
// nobody chose is indistinguishable from one they did once it is stored.

import { BROKER_PLATFORMS } from './tradeSchema.js'

export const PROFILE_FIELDS = [
  'displayName', 'timezone', 'baseCurrency',
  'defaultBrokerPlatform', 'defaultBrokerAccountId', 'defaultRiskPercent',
]

// Display-only. Nothing is ever converted between currencies: a converted P&L
// is a number the journal did not witness, and it would silently depend on
// whatever rate was used.
export const BASE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD']

// Same rule the trade model applies to captureTimezone: the Area/Location form
// only, because "CST" is US Central in Chicago and China Standard in Shanghai.
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/

function isValidTimezone(tz) {
  const zone = String(tz).trim()
  if (zone !== 'UTC' && !IANA_ZONE.test(zone)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

export function validateProfile(input) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  if (!blank(input.displayName) && String(input.displayName).trim().length > 60) {
    add('displayName', 'Display name must be 60 characters or fewer.')
  }

  if (!blank(input.timezone) && !isValidTimezone(input.timezone)) {
    add('timezone', 'Timezone must be an IANA zone name like America/Chicago. Abbreviations such as "CST" are ambiguous.')
  }

  if (!blank(input.baseCurrency) && !BASE_CURRENCIES.includes(String(input.baseCurrency).trim().toUpperCase())) {
    add('baseCurrency', `Base currency must be one of: ${BASE_CURRENCIES.join(', ')}.`)
  }

  if (!blank(input.defaultBrokerPlatform) && !BROKER_PLATFORMS.includes(input.defaultBrokerPlatform)) {
    add('defaultBrokerPlatform', `Platform must be one of: ${BROKER_PLATFORMS.join(', ')}.`)
  }

  if (!blank(input.defaultBrokerAccountId) && String(input.defaultBrokerAccountId).trim().length > 64) {
    add('defaultBrokerAccountId', 'Broker account ID must be 64 characters or fewer.')
  }

  if (!blank(input.defaultRiskPercent)) {
    const pct = Number(input.defaultRiskPercent)
    if (!Number.isFinite(pct)) {
      add('defaultRiskPercent', 'Default risk must be a number.')
    } else if (pct <= 0 || pct > 100) {
      add('defaultRiskPercent', 'Default risk must be greater than 0 and at most 100 percent.')
    }
  }

  return errors
}

// Only the named fields, trimmed, with blanks becoming explicit nulls so
// clearing a field actually clears it rather than storing an empty string.
export function coerceProfile(body) {
  const out = {}
  for (const field of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const value = body[field]
    if (blank(value)) { out[field] = null; continue }
    if (field === 'defaultRiskPercent') { out[field] = Number(value); continue }
    if (field === 'baseCurrency') { out[field] = String(value).trim().toUpperCase(); continue }
    out[field] = String(value).trim()
  }
  return out
}

// A user who has never opened the profile screen still needs a shape to render.
export function emptyProfile() {
  return Object.fromEntries(PROFILE_FIELDS.map(f => [f, null]))
}
