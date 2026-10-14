// The daily price action review: when it may be written, and what it must say.
//
// Today's review opens three hours after the market opens — before then the
// morning has not played out, and a review written while positions are open
// is commentary, not review.
//
// Past days can be reviewed too — a missed day caught up, or old days studied
// as backtests — and reviews can be corrected at any time. What makes that
// honest is that the record says when: a review written after its day closed
// is marked late, an edit after the day closed is marked as such with its
// time, and a backtest never counts toward the daily record. Hindsight is not
// forbidden; it is labelled.

import { isValidTimezone } from './profile.js'
import { localDate, nextDate } from './session.js'
import { validateCharts, MAX_CHARTS } from './charts.js'

export const REVIEW_DELAY_MINUTES = 3 * 60

// The New York cash open — where index futures traders mean "the open". Used
// only when the trader has not set their own; every review records the open it
// was written against, so changing the setting never rewrites an old window.
export const DEFAULT_MARKET_OPEN_TIME = '09:30'
export const DEFAULT_MARKET_TIMEZONE = 'America/New_York'

export const DAY_TYPES = ['trend_up', 'trend_down', 'range', 'reversal', 'chop']
export const LIQUIDITY_TAKEN = ['buy_side', 'sell_side', 'both', 'neither']
export const PLAN_OUTCOMES = ['yes', 'partly', 'no']

export const MIN_SUMMARY = 20
const MAX_TEXT = 2000
const MAX_SYMBOL = 32
export const MAX_REVIEW_SCREENSHOTS = MAX_CHARTS

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const text = (v) => (typeof v === 'string' ? v.trim() : '')

// "HH:MM", 24-hour. Capped at 20:59 so the window — which opens three hours
// later — still opens before the market's day ends.
const MARKET_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export function isValidMarketOpenTime(value) {
  if (typeof value !== 'string' || !MARKET_TIME.test(value)) return false
  return Number(value.slice(0, 2)) < 21
}

export function marketSettings(profile) {
  return {
    marketOpenTime: isValidMarketOpenTime(profile?.marketOpenTime) ? profile.marketOpenTime : DEFAULT_MARKET_OPEN_TIME,
    marketTimezone: profile?.marketTimezone && isValidTimezone(profile.marketTimezone)
      ? profile.marketTimezone
      : DEFAULT_MARKET_TIMEZONE,
  }
}

// --- wall-clock time in a zone, as an instant -----------------------------------

// Minutes the zone is ahead of UTC at a given instant. h23 rather than
// hour12:false, which renders midnight as "24" on some engines.
function offsetMinutes(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map(p => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000
}

// 09:30 (or 09:30:15) on a date in a zone, as the instant it happens. Two passes: the first
// guesses with the offset at the wrong instant, the second corrects for an
// offset that changed in between — which is what a daylight-saving date does.
export function zonedTimeToInstant(ymd, hhmm, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm, ss = 0] = hhmm.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss)
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60000
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60000
  return new Date(instant)
}

export function isWeekend(ymd) {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

// --- the window -----------------------------------------------------------------

// Where `now` falls for the review of the market's current day. Pure: the clock
// is a parameter, so every boundary is testable without waiting for it.
export function reviewWindow(now, { marketOpenTime, marketTimezone }) {
  const reviewDate = localDate(now, marketTimezone)
  const marketOpensAt = zonedTimeToInstant(reviewDate, marketOpenTime, marketTimezone)
  const opensAt = new Date(marketOpensAt.getTime() + REVIEW_DELAY_MINUTES * 60000)
  const closesAt = zonedTimeToInstant(nextDate(reviewDate), '00:00', marketTimezone)

  let state = 'open'
  if (isWeekend(reviewDate)) state = 'weekend'
  else if (now < opensAt) state = 'not_yet'

  return { reviewDate, marketOpensAt, opensAt, closesAt, state, marketOpenTime, marketTimezone }
}

// When a review was written and changed, relative to the end of its own day
// in the market it was written against. These are derived, never stored, so
// they cannot be set by hand.
export function reviewFlags(review) {
  const closesAt = zonedTimeToInstant(nextDate(review.reviewDate), '00:00', review.marketTimezone)
  const writtenAt = new Date(review.writtenAt)
  const editedAt = review.lastEditedAt ? new Date(review.lastEditedAt) : null
  return {
    closesAt,
    writtenLate: writtenAt >= closesAt,
    editedAfterClose: editedAt != null && editedAt >= closesAt,
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
export function isValidDate(ymd) {
  if (typeof ymd !== 'string' || !YMD.test(ymd)) return false
  const d = new Date(`${ymd}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd
}

// Where a given trading day stands for reviewing, as of `now`:
//   weekend · future · not_yet (today, before the window) · open (today) · past
export function reviewDayState(date, now, settings) {
  if (isWeekend(date)) return 'weekend'
  const today = localDate(now, settings.marketTimezone)
  if (date > today) return 'future'
  if (date === today) return reviewWindow(now, settings).state
  return 'past'
}

// The last n trading days up to and including `today`, newest first. Weekends
// only — a market holiday will show as missed, which is the honest default
// for an app that does not know the exchange calendar.
export function recentWeekdays(today, n) {
  const days = []
  const d = new Date(`${today}T12:00:00Z`)
  while (days.length < n) {
    const ymd = d.toISOString().slice(0, 10)
    if (!isWeekend(ymd)) days.push(ymd)
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return days
}

// --- the review -----------------------------------------------------------------

export function coerceReview(body) {
  const opt = (v) => (blank(v) ? null : String(v).trim())
  return {
    symbol: text(body.symbol),
    dayType: opt(body.dayType),
    summary: text(body.summary),
    openBehavior: opt(body.openBehavior),
    keyLevels: opt(body.keyLevels),
    liquidityTaken: opt(body.liquidityTaken),
    planPlayedOut: opt(body.planPlayedOut),
    validSetup: body.validSetup,
    lesson: opt(body.lesson),
    screenshots: Array.isArray(body.screenshots) ? body.screenshots : [],
  }
}

// `planExists` decides whether the plan comparison is required. A day that
// had a plan cannot be reviewed without saying whether the plan's picture
// actually appeared — that comparison is the point of the review.
export function validateReview(input, { planExists }) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  if (!input.symbol) add('symbol', 'Which instrument is this review for?')
  else if (input.symbol.length > MAX_SYMBOL) add('symbol', `Keep the symbol under ${MAX_SYMBOL} characters.`)

  if (!DAY_TYPES.includes(input.dayType)) add('dayType', 'What kind of day was it? Pick one.')

  if (input.summary.length < MIN_SUMMARY) {
    add('summary', `Describe what price did — at least ${MIN_SUMMARY} characters.`)
  } else if (input.summary.length > MAX_TEXT) {
    add('summary', `Keep it under ${MAX_TEXT} characters.`)
  }

  for (const field of ['openBehavior', 'keyLevels', 'lesson']) {
    if (input[field] && input[field].length > MAX_TEXT) add(field, `Keep it under ${MAX_TEXT} characters.`)
  }

  if (input.liquidityTaken !== null && !LIQUIDITY_TAKEN.includes(input.liquidityTaken)) {
    add('liquidityTaken', `Liquidity taken must be one of: ${LIQUIDITY_TAKEN.join(', ')}.`)
  }

  if (planExists && !PLAN_OUTCOMES.includes(input.planPlayedOut)) {
    add('planPlayedOut', 'You wrote a plan today. Did what you wanted to see actually happen?')
  }

  if (typeof input.validSetup !== 'boolean') {
    add('validSetup', 'Was there a valid setup by your rules today — whether or not you took it?')
  }

  errors.push(...validateCharts(input.screenshots))

  return errors
}

export function serializeReview(review) {
  if (!review) return review
  const { closesAt, writtenLate, editedAfterClose } = reviewFlags(review)
  return { ...review, closesAt, writtenLate, editedAfterClose, screenshotCount: review.screenshots?.length ?? 0 }
}

// What the list view needs without the images, which can be large.
export function summarizeReview(review) {
  const { screenshots, ...rest } = serializeReview(review)
  return rest
}

// A day's status in the review record: reviewed on time, reviewed late,
// missed, or — for today — due or not yet open. Backtests are excluded by the
// caller: practice on an old day is not a review of a traded one.
export function dayRecordStatus(date, reviewsForDay, { today, windowState }) {
  const live = reviewsForDay.filter(r => !r.isBacktest)
  if (live.some(r => !reviewFlags(r).writtenLate)) return 'reviewed'
  if (live.length) return 'late'
  if (date !== today) return 'missed'
  return windowState === 'open' ? 'due' : 'pending'
}
