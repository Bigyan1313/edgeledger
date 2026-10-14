// The review window and the review's rules, without a database. The window is
// pinned to real dates either side of a daylight-saving change: "09:30 in New
// York" is a different UTC instant in October and November, and a window
// computed by adding a fixed offset would open an hour wrong half the year.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  REVIEW_DELAY_MINUTES, DEFAULT_MARKET_OPEN_TIME, DEFAULT_MARKET_TIMEZONE, MAX_REVIEW_SCREENSHOTS,
  zonedTimeToInstant, reviewWindow, reviewFlags, reviewDayState, dayRecordStatus, isValidDate, recentWeekdays, isWeekend,
  marketSettings, isValidMarketOpenTime, validateReview, coerceReview,
} from '../src/domain/review.js'

const NY = { marketOpenTime: '09:30', marketTimezone: 'America/New_York' }
const at = (iso) => new Date(iso)

describe('wall-clock time in a zone', () => {
  test('09:30 New York is 13:30 UTC in October (EDT)…', () => {
    assert.equal(zonedTimeToInstant('2026-10-14', '09:30', 'America/New_York').toISOString(), '2026-10-14T13:30:00.000Z')
  })

  test('…and 14:30 UTC after the clocks go back (EST)', () => {
    assert.equal(zonedTimeToInstant('2026-11-02', '09:30', 'America/New_York').toISOString(), '2026-11-02T14:30:00.000Z')
  })

  test('the Monday after clocks go forward is already on EDT', () => {
    assert.equal(zonedTimeToInstant('2026-03-09', '09:30', 'America/New_York').toISOString(), '2026-03-09T13:30:00.000Z')
  })

  test('a quarter-hour zone is handled', () => {
    assert.equal(zonedTimeToInstant('2026-10-14', '09:30', 'Asia/Kathmandu').toISOString(), '2026-10-14T03:45:00.000Z')
  })

  // The window closes at midnight, and midnight is where a single-pass
  // conversion goes wrong: the offset at "00:00 read as UTC" can be on the
  // far side of a change that the real instant is not.
  test('midnight just before clocks go forward (Sydney) is still on standard time', () => {
    assert.equal(zonedTimeToInstant('2026-10-04', '00:00', 'Australia/Sydney').toISOString(), '2026-10-03T14:00:00.000Z')
  })

  test('a time just before clocks go back (Berlin) is still on summer time', () => {
    assert.equal(zonedTimeToInstant('2026-10-25', '01:30', 'Europe/Berlin').toISOString(), '2026-10-24T23:30:00.000Z')
  })

  test('the same open expressed from Chicago is the same instant', () => {
    assert.equal(
      zonedTimeToInstant('2026-10-14', '08:30', 'America/Chicago').getTime(),
      zonedTimeToInstant('2026-10-14', '09:30', 'America/New_York').getTime(),
    )
  })
})

describe('the review window', () => {
  test(`it opens ${REVIEW_DELAY_MINUTES / 60} hours after the open, to the minute`, () => {
    assert.equal(reviewWindow(at('2026-10-14T16:29:00Z'), NY).state, 'not_yet')
    assert.equal(reviewWindow(at('2026-10-14T16:30:00Z'), NY).state, 'open')
  })

  test('after the clocks change, it opens an hour later in UTC — the same 12:30 in New York', () => {
    assert.equal(reviewWindow(at('2026-11-02T17:29:00Z'), NY).state, 'not_yet')
    assert.equal(reviewWindow(at('2026-11-02T17:30:00Z'), NY).state, 'open')
  })

  test('it closes at midnight in the market, and the next day starts not yet open', () => {
    const w = reviewWindow(at('2026-10-14T20:00:00Z'), NY)
    assert.equal(w.closesAt.toISOString(), '2026-10-15T04:00:00.000Z')
    const next = reviewWindow(at('2026-10-15T04:00:00Z'), NY)
    assert.equal(next.reviewDate, '2026-10-15')
    assert.equal(next.state, 'not_yet')
  })

  test("the day is the market's, not the trader's — New York's Wednesday, from Kathmandu's Thursday morning", () => {
    // 07:45 Thursday in Kathmandu is 22:00 Wednesday in New York.
    const w = reviewWindow(at('2026-10-15T02:00:00Z'), NY)
    assert.equal(w.reviewDate, '2026-10-14')
    assert.equal(w.state, 'open')
  })

  test('weekends are closed', () => {
    assert.equal(reviewWindow(at('2026-10-17T18:00:00Z'), NY).state, 'weekend')
    assert.equal(reviewWindow(at('2026-10-18T18:00:00Z'), NY).state, 'weekend')
    assert.equal(isWeekend('2026-10-16'), false)
  })

  test('the window reports the open it was computed from', () => {
    const w = reviewWindow(at('2026-10-14T18:00:00Z'), { marketOpenTime: '08:30', marketTimezone: 'America/Chicago' })
    assert.equal(w.opensAt.toISOString(), '2026-10-14T16:30:00.000Z')
    assert.equal(w.marketOpenTime, '08:30')
  })
})

describe('when a review was written, relative to its day', () => {
  const review = (writtenAt, lastEditedAt = null) => ({ reviewDate: '2026-10-14', marketTimezone: 'America/New_York', writtenAt, lastEditedAt })

  test('written before midnight in the market is on time', () => {
    const f = reviewFlags(review('2026-10-15T03:59:59Z'))
    assert.equal(f.writtenLate, false)
    assert.equal(f.closesAt.toISOString(), '2026-10-15T04:00:00.000Z')
  })

  test('written at or after the close is late', () => {
    assert.equal(reviewFlags(review('2026-10-15T04:00:00Z')).writtenLate, true)
  })

  test('an edit after the close is marked; one before it is not', () => {
    assert.equal(reviewFlags(review('2026-10-14T18:00:00Z', '2026-10-14T23:00:00Z')).editedAfterClose, false)
    assert.equal(reviewFlags(review('2026-10-14T18:00:00Z', '2026-10-16T13:02:00Z')).editedAfterClose, true)
    assert.equal(reviewFlags(review('2026-10-14T18:00:00Z')).editedAfterClose, false)
  })
})

describe('which days can be reviewed', () => {
  const now = at('2026-10-14T18:00:00Z') // Wednesday 14:00 New York, window open

  test('today follows the window; earlier weekdays are open for catching up or backtesting', () => {
    assert.equal(reviewDayState('2026-10-14', now, NY), 'open')
    assert.equal(reviewDayState('2026-10-14', at('2026-10-14T14:00:00Z'), NY), 'not_yet')
    assert.equal(reviewDayState('2026-10-13', now, NY), 'past')
    assert.equal(reviewDayState('2024-03-05', now, NY), 'past')
  })

  test('the future and weekends cannot be reviewed', () => {
    assert.equal(reviewDayState('2026-10-15', now, NY), 'future')
    assert.equal(reviewDayState('2026-10-10', now, NY), 'weekend')
  })

  test('dates are strict', () => {
    assert.equal(isValidDate('2026-10-14'), true)
    for (const bad of ['2026-02-30', '2026-13-01', '14/10/2026', '2026-1-4', '', null]) assert.equal(isValidDate(bad), false, String(bad))
  })
})

describe('the daily review record', () => {
  const ctx = { today: '2026-10-14', windowState: 'open' }
  const r = (writtenAt, isBacktest = false) => ({ reviewDate: '2026-10-13', marketTimezone: 'America/New_York', writtenAt, isBacktest })

  test('on time counts as reviewed; only late reviews count as late', () => {
    assert.equal(dayRecordStatus('2026-10-13', [r('2026-10-13T19:00:00Z')], ctx), 'reviewed')
    assert.equal(dayRecordStatus('2026-10-13', [r('2026-10-16T19:00:00Z')], ctx), 'late')
    assert.equal(dayRecordStatus('2026-10-13', [r('2026-10-16T19:00:00Z'), r('2026-10-13T19:00:00Z')], ctx), 'reviewed')
  })

  test('a backtest never fills a day in the record', () => {
    assert.equal(dayRecordStatus('2026-10-13', [r('2026-10-13T19:00:00Z', true)], ctx), 'missed')
  })

  test('today is due while open and pending before', () => {
    assert.equal(dayRecordStatus('2026-10-14', [], ctx), 'due')
    assert.equal(dayRecordStatus('2026-10-14', [], { ...ctx, windowState: 'not_yet' }), 'pending')
  })
})

describe('the trading days that should have a review', () => {
  test('weekends are skipped', () => {
    assert.deepEqual(recentWeekdays('2026-10-14', 5), ['2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08'])
  })
  test('counted from a weekend, it starts at Friday', () => {
    assert.deepEqual(recentWeekdays('2026-10-17', 2), ['2026-10-16', '2026-10-15'])
  })
})

describe('market settings', () => {
  test('unset or invalid settings fall back to the New York open', () => {
    assert.deepEqual(marketSettings(null), { marketOpenTime: DEFAULT_MARKET_OPEN_TIME, marketTimezone: DEFAULT_MARKET_TIMEZONE })
    assert.deepEqual(marketSettings({ marketOpenTime: '9:30', marketTimezone: 'EST' }), {
      marketOpenTime: DEFAULT_MARKET_OPEN_TIME, marketTimezone: DEFAULT_MARKET_TIMEZONE,
    })
    assert.deepEqual(marketSettings({ marketOpenTime: '08:30', marketTimezone: 'America/Chicago' }), {
      marketOpenTime: '08:30', marketTimezone: 'America/Chicago',
    })
  })

  test('an open time must leave room for the window before midnight', () => {
    for (const ok of ['00:00', '09:30', '20:59']) assert.equal(isValidMarketOpenTime(ok), true, ok)
    for (const bad of ['9:30', '21:00', '23:59', '24:00', '09:60', '', null]) assert.equal(isValidMarketOpenTime(bad), false, String(bad))
  })
})

describe('the review itself', () => {
  const REVIEW = {
    symbol: 'MNQZ6',
    dayType: 'reversal',
    summary: 'Swept the Asia low at 9:42, reclaimed by 10:05, trended to PDH by noon.',
    openBehavior: 'Fast drop into the Asia low on the open.',
    keyLevels: 'Asia low held as the sweep; PDH capped it.',
    liquidityTaken: 'sell_side',
    planPlayedOut: 'yes',
    validSetup: true,
    lesson: 'The retest came 20 minutes after the sweep — wait for it.',
    screenshots: [],
  }
  const fields = (input, opts) => validateReview(coerceReview(input), opts).map(e => e.field)

  test('a complete review passes', () => {
    assert.deepEqual(fields(REVIEW, { planExists: true }), [])
  })

  test('with a plan written today, the plan comparison is required', () => {
    assert.deepEqual(fields({ ...REVIEW, planPlayedOut: null }, { planExists: true }), ['planPlayedOut'])
    assert.deepEqual(fields({ ...REVIEW, planPlayedOut: 'mostly' }, { planExists: true }), ['planPlayedOut'])
  })

  test('without a plan, there is nothing to compare and it is not asked for', () => {
    assert.deepEqual(fields({ ...REVIEW, planPlayedOut: null }, { planExists: false }), [])
  })

  test('the required fields are required', () => {
    assert.deepEqual(fields({ ...REVIEW, symbol: '  ' }, { planExists: false }), ['symbol'])
    assert.deepEqual(fields({ ...REVIEW, dayType: 'bullish' }, { planExists: false }), ['dayType'])
    assert.deepEqual(fields({ ...REVIEW, summary: 'went up' }, { planExists: false }), ['summary'])
    assert.deepEqual(fields({ ...REVIEW, validSetup: undefined }, { planExists: false }), ['validSetup'])
    assert.deepEqual(fields({ ...REVIEW, validSetup: 'yes' }, { planExists: false }), ['validSetup'])
  })

  test('the optional fields stay optional, but constrained when given', () => {
    const minimal = { symbol: 'MNQZ6', dayType: 'chop', summary: 'Chopped inside the Asia range all morning.', validSetup: false }
    assert.deepEqual(fields(minimal, { planExists: false }), [])
    assert.deepEqual(fields({ ...minimal, liquidityTaken: 'up' }, { planExists: false }), ['liquidityTaken'])
  })

  test('charts are limited in number and must be images', () => {
    const img = 'data:image/jpeg;base64,AAAA'
    assert.deepEqual(fields({ ...REVIEW, screenshots: Array(MAX_REVIEW_SCREENSHOTS).fill(img) }, { planExists: true }), [])
    assert.deepEqual(fields({ ...REVIEW, screenshots: Array(MAX_REVIEW_SCREENSHOTS + 1).fill(img) }, { planExists: true }), ['screenshots'])
    assert.deepEqual(fields({ ...REVIEW, screenshots: ['javascript:alert(1)'] }, { planExists: true }), ['screenshots'])
  })
})
