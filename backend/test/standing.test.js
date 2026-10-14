// Distance to losing an account. Each drawdown type is checked against
// numbers worked out by hand, because the trailing variants are where a
// plausible-looking floor is most easily an off-by-a-day wrong one.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeStanding, validateAccountRules, coerceAccountRules } from '../src/domain/standing.js'

const NY = 'America/New_York'
// Wednesday 14 Oct 2026, 14:00 in New York.
const NOW = new Date('2026-10-14T18:00:00Z')
const closed = (iso, pnl) => ({ entryStage: 'complete', exitTimeUtc: iso, entryTimeUtc: iso, pnl })
const open = (pair, entryPrice, stopLoss, lotSize) => ({ entryStage: 'pending_exit', pair, entryPrice, stopLoss, lotSize, pnl: null })
const account = (over = {}) => ({ startingBalance: 50000, ...over })
const standing = (acct, trades, extra = {}) => computeStanding({ account: acct, trades, now: NOW, timeZone: NY, ...extra })

// Two earlier days and today.
const MON = '2026-10-12T15:00:00Z'
const TUE = '2026-10-13T15:00:00Z'
const WED_AM = '2026-10-14T14:00:00Z'
const WED_LATE = '2026-10-14T15:30:00Z'

describe('without a starting balance there is nothing to measure from', () => {
  test('it says what is missing instead of inventing a number', () => {
    const s = standing({ startingBalance: null, maxDrawdown: 2000, drawdownType: 'static' }, [])
    assert.equal(s.configured, false)
    assert.deepEqual(s.missing, ['startingBalance'])
  })

  test('a balance with no rules has a balance and no room', () => {
    const s = standing(account(), [closed(MON, 300)])
    assert.equal(s.balance, 50300)
    assert.equal(s.status, 'no_rules')
    assert.equal(s.room, null)
  })
})

describe('static drawdown', () => {
  test('the floor never moves', () => {
    const s = standing(account({ maxDrawdown: 2000, drawdownType: 'static' }), [closed(MON, 1500), closed(TUE, -500)])
    assert.equal(s.floor, 48000)
    assert.equal(s.balance, 51000)
    assert.equal(s.distanceToFloor, 3000)
  })
})

describe('end-of-day trailing', () => {
  test("the floor trails finished days' closing balances — not today's", () => {
    // Mon closes +1000 (51,000). Tue closes −400 (50,600). Today +800 so far.
    const s = standing(account({ maxDrawdown: 2000, drawdownType: 'eod_trailing' }),
      [closed(MON, 1000), closed(TUE, -400), closed(WED_AM, 800)])
    assert.equal(s.floor, 49000) // 51,000 peak close − 2,000; today's 51,400 does not count yet
    assert.equal(s.balance, 51400)
    assert.equal(s.distanceToFloor, 2400)
  })

  test('the trail stops at the lock balance', () => {
    const s = standing(account({ maxDrawdown: 2000, drawdownType: 'eod_trailing', drawdownLockBalance: 50000 }),
      [closed(MON, 3000)])
    // Trailing would put the floor at 51,000; the lock holds it at 50,000.
    assert.equal(s.floor, 50000)
    assert.equal(s.distanceToFloor, 3000)
  })

  test('a day is the market\'s day: 22:00 in New York is still that day', () => {
    // 02:00 UTC Thursday is 22:00 Wednesday in New York — so it is today, and
    // does not yet raise the end-of-day trail.
    const lateWed = '2026-10-15T02:00:00Z'
    const s = computeStanding({
      account: account({ maxDrawdown: 2000, drawdownType: 'eod_trailing', dailyLossLimit: 1000 }),
      trades: [closed(lateWed, -300)],
      now: new Date('2026-10-15T03:00:00Z'), timeZone: NY,
    })
    assert.equal(s.today, '2026-10-14')
    assert.equal(s.todayPnl, -300)
    assert.equal(s.floor, 48000)
  })
})

describe('intraday trailing', () => {
  test('the floor follows the highest balance reached, including today', () => {
    // +1500 then −1000 today: the peak was 51,500.
    const s = standing(account({ maxDrawdown: 2000, drawdownType: 'intraday_trailing' }),
      [closed(WED_AM, 1500), closed(WED_LATE, -1000)])
    assert.equal(s.floor, 49500)
    assert.equal(s.balance, 50500)
    assert.equal(s.distanceToFloor, 1000)
    assert.match(s.notes.join(' '), /may be higher/)
  })
})

describe('the daily loss limit', () => {
  test("today's losses use it up; earlier days do not", () => {
    const s = standing(account({ dailyLossLimit: 1000 }), [closed(TUE, -900), closed(WED_AM, -600)])
    assert.equal(s.todayPnl, -600)
    assert.equal(s.dailyRemaining, 400)
  })

  test('the closer limit is the one that binds', () => {
    const s = standing(account({ dailyLossLimit: 1000, maxDrawdown: 2000, drawdownType: 'static' }),
      [closed(WED_AM, -600)])
    // Daily: 400 left. Drawdown: 49,400 − 48,000 = 1,400 left.
    assert.equal(s.binding, 'daily')
    assert.equal(s.room, 400)
  })
})

describe('open trades and the trade being planned', () => {
  const rules = account({ dailyLossLimit: 1000 })

  test('open stops are subtracted from the room', () => {
    // MNQ, 20 points, 2 contracts → $80 at risk.
    const s = standing(rules, [closed(WED_AM, -600), open('MNQZ6', 21000, 20980, 2)])
    assert.equal(s.openRisk, 80)
    assert.equal(s.roomIfStopsHit, 320)
    assert.equal(s.status, 'ok')
  })

  test('a planned trade that would use up the room is flagged before it is taken', () => {
    const s = standing(rules, [closed(WED_AM, -600), open('MNQZ6', 21000, 20980, 2)], { plannedRisk: 400 })
    assert.equal(s.roomAfterPlanned, -80)
    assert.equal(s.status, 'danger')
  })

  test('an open trade whose risk cannot be computed is reported, not silently treated as zero', () => {
    const s = standing(rules, [open('ZZZZ6', 100, 99, 1)])
    assert.equal(s.openRiskUnknown, 1)
    assert.match(s.notes.join(' '), /no computable risk/)
  })

  test('past a limit, the account reads as breached', () => {
    const s = standing(rules, [closed(WED_AM, -1100)])
    assert.equal(s.room, -100)
    assert.equal(s.status, 'breached')
  })
})

describe('legacy rows', () => {
  test('a v1 trade with P&L but no exit time still counts toward the balance', () => {
    const v1 = { entryStage: 'complete', exitTimeUtc: null, entryTimeUtc: MON, pnl: 250 }
    assert.equal(standing(account(), [v1]).balance, 50250)
  })
})

describe('the rules themselves', () => {
  const check = (body) => validateAccountRules(coerceAccountRules(body)).map(e => e.field)

  test('complete trailing rules pass', () => {
    assert.deepEqual(check({ startingBalance: 50000, dailyLossLimit: 1000, maxDrawdown: 2000, drawdownType: 'eod_trailing', drawdownLockBalance: 50100 }), [])
  })
  test('a drawdown needs both a size and a type', () => {
    assert.deepEqual(check({ maxDrawdown: 2000 }), ['drawdownType'])
    assert.deepEqual(check({ drawdownType: 'static' }), ['maxDrawdown'])
  })
  test('amounts must be positive', () => {
    assert.deepEqual(check({ dailyLossLimit: -1000 }), ['dailyLossLimit'])
    assert.deepEqual(check({ startingBalance: 0 }), ['startingBalance'])
  })
  test('an unknown drawdown type is refused', () => {
    assert.deepEqual(check({ maxDrawdown: 2000, drawdownType: 'trailing' }), ['drawdownType'])
  })
  test('a static drawdown has nothing to lock', () => {
    assert.deepEqual(check({ maxDrawdown: 2000, drawdownType: 'static', drawdownLockBalance: 50000 }), ['drawdownLockBalance'])
  })
  test('blank clears a rule rather than storing zero', () => {
    assert.deepEqual(coerceAccountRules({ dailyLossLimit: '' }), { dailyLossLimit: null })
  })
})
