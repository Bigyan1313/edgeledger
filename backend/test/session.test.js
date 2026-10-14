// The session rules, tested without a database. Every number in here is a
// rule a trader will hit at 9:29 with an order half-typed, so each one is
// pinned down explicitly — including the edges, where a guard most often
// quietly stops guarding.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TRADES_CEILING, DEFAULT_MIN_SLEEP_HOURS, BEFORE_PLAN_TOLERANCE_MS,
  localDate, nextDate, resolveTimezone, effectiveMinSleep,
  readinessVerdict, validateReadiness, validatePlan, validateClose,
  evaluateTrade, serializeSession, describeViolations,
} from '../src/domain/session.js'

const PLAN = {
  bias: 'long',
  wantToSee: 'Sweep of Asia low, then 5m BOS back above it',
  noTradeIf: 'Price chops inside Asia range past 10:30',
  scenarios: [{ if: 'NY sweeps Asia low and reclaims', then: 'long the retest, stop under sweep' }],
  maxTrades: 2,
}

describe('the trading day is a local date', () => {
  test('one instant is two different dates in two zones', () => {
    // 02:00 UTC on the 15th is still the evening of the 14th in New York.
    const instant = new Date('2026-10-15T02:00:00Z')
    assert.equal(localDate(instant, 'America/New_York'), '2026-10-14')
    assert.equal(localDate(instant, 'Asia/Kathmandu'), '2026-10-15')
  })

  test('the next date is computed on the calendar, not by adding 24h', () => {
    assert.equal(nextDate('2026-10-14'), '2026-10-15')
    assert.equal(nextDate('2026-10-31'), '2026-11-01')
    assert.equal(nextDate('2026-12-31'), '2027-01-01')
    assert.equal(nextDate('2028-02-28'), '2028-02-29')
    // The US DST change: an instant + 24h lands on the wrong wall-clock day
    // in some zones. Calendar arithmetic does not care.
    assert.equal(nextDate('2026-11-01'), '2026-11-02')
  })

  test('the zone falls back in order, and an ambiguous abbreviation is skipped', () => {
    assert.equal(resolveTimezone('America/Chicago', 'Europe/London'), 'America/Chicago')
    assert.equal(resolveTimezone(null, 'Europe/London'), 'Europe/London')
    assert.equal(resolveTimezone('CST', 'Asia/Kathmandu'), 'Asia/Kathmandu')
    assert.equal(resolveTimezone(undefined, ''), 'UTC')
  })
})

describe('readiness', () => {
  test('the default floor applies only when the trader has not set one', () => {
    assert.equal(effectiveMinSleep(null), DEFAULT_MIN_SLEEP_HOURS)
    assert.equal(effectiveMinSleep({ minSleepHours: null }), DEFAULT_MIN_SLEEP_HOURS)
    assert.equal(effectiveMinSleep({ minSleepHours: 7 }), 7)
  })

  test('below the floor is blocked; at the floor is not', () => {
    assert.equal(readinessVerdict({ sleepHours: 5.5, fitToTrade: true }, 6).status, 'blocked')
    assert.equal(readinessVerdict({ sleepHours: 6, fitToTrade: true }, 6).status, 'open')
  })

  test('saying you are not fit blocks the day regardless of sleep', () => {
    const v = readinessVerdict({ sleepHours: 9, fitToTrade: false }, 6)
    assert.equal(v.status, 'blocked')
    assert.match(v.reasons[0], /not fit/)
  })

  test('only an explicit yes counts as fit — a missing answer is not a yes', () => {
    assert.equal(readinessVerdict({ sleepHours: 8, fitToTrade: undefined }, 6).status, 'blocked')
  })

  test('a no on one account cannot be dodged by asking again on another', () => {
    const v = readinessVerdict({ sleepHours: 8, fitToTrade: true }, 6, { blockedElsewhere: 'Lucid 50K' })
    assert.equal(v.status, 'blocked')
    assert.match(v.reasons[0], /Lucid 50K/)
  })

  test('every failing reason is reported, not just the first', () => {
    const v = readinessVerdict({ sleepHours: 3, fitToTrade: false }, 6)
    assert.equal(v.reasons.length, 2)
    assert.match(v.reasons[0], /Slept 3h — the floor is 6h/)
  })

  test('the readiness answers are required and range-checked', () => {
    assert.deepEqual(validateReadiness({ sleepHours: 7, fitToTrade: true }), [])
    const fields = (input) => validateReadiness(input).map(e => e.field)
    assert.deepEqual(fields({ fitToTrade: true }), ['sleepHours'])
    assert.deepEqual(fields({ sleepHours: 25, fitToTrade: true }), ['sleepHours'])
    assert.deepEqual(fields({ sleepHours: -1, fitToTrade: true }), ['sleepHours'])
    assert.deepEqual(fields({ sleepHours: 7 }), ['fitToTrade'])
    // A string is not an answer. The form sends a real boolean.
    assert.deepEqual(fields({ sleepHours: 7, fitToTrade: 'true' }), ['fitToTrade'])
  })
})

describe('the plan', () => {
  test('a complete plan passes', () => {
    assert.deepEqual(validatePlan(PLAN), [])
  })

  test(`the ceiling is ${MAX_TRADES_CEILING} and the refusal says it does not go higher`, () => {
    const errors = validatePlan({ ...PLAN, maxTrades: 3 })
    assert.equal(errors.length, 1)
    assert.equal(errors[0].field, 'maxTrades')
    assert.match(errors[0].message, /does not go higher/)
    assert.equal(validatePlan({ ...PLAN, maxTrades: 99 })[0].field, 'maxTrades')
  })

  test('1 and 2 are the only valid limits', () => {
    assert.deepEqual(validatePlan({ ...PLAN, maxTrades: 1 }), [])
    assert.deepEqual(validatePlan({ ...PLAN, maxTrades: 2 }), [])
    for (const bad of [0, -1, 1.5, null, '', 'two']) {
      assert.equal(validatePlan({ ...PLAN, maxTrades: bad })[0]?.field, 'maxTrades', `maxTrades=${JSON.stringify(bad)}`)
    }
  })

  test('"x" is not a plan', () => {
    const fields = validatePlan({ ...PLAN, wantToSee: 'x', noTradeIf: 'idk' }).map(e => e.field)
    assert.deepEqual(fields.sort(), ['noTradeIf', 'wantToSee'])
  })

  test('whitespace does not count toward the minimum', () => {
    assert.equal(validatePlan({ ...PLAN, wantToSee: '   ok        ' })[0]?.field, 'wantToSee')
  })

  test('at least one if/then, each with both halves', () => {
    assert.equal(validatePlan({ ...PLAN, scenarios: [] })[0].field, 'scenarios')
    assert.equal(validatePlan({ ...PLAN, scenarios: undefined })[0].field, 'scenarios')
    const half = validatePlan({ ...PLAN, scenarios: [PLAN.scenarios[0], { if: 'gap up', then: '  ' }] })
    assert.equal(half[0].field, 'scenarios.1')
  })

  test('too many branches is refused', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ if: `case ${i}`, then: 'do a thing' }))
    assert.equal(validatePlan({ ...PLAN, scenarios: six })[0].field, 'scenarios')
  })

  test('bias is optional but constrained', () => {
    assert.deepEqual(validatePlan({ ...PLAN, bias: null }), [])
    assert.equal(validatePlan({ ...PLAN, bias: 'bullish' })[0].field, 'bias')
  })

  test('closing a session requires an honest yes or no', () => {
    assert.deepEqual(validateClose({ followedPlan: false }), [])
    assert.equal(validateClose({})[0].field, 'followedPlan')
    assert.equal(validateClose({ followedPlan: true, review: 'x'.repeat(2001) })[0].field, 'review')
  })
})

describe('the gate', () => {
  const openedAt = new Date('2026-10-14T13:25:00Z')
  const open = (over = {}) => ({ status: 'open', maxTrades: 2, tradesLogged: 0, openedAt, ...over })
  const at = (iso) => ({ entryTimeUtc: iso })
  const after = at('2026-10-14T13:40:00Z')

  test('nothing is enforced until the first plan is ever written', () => {
    assert.deepEqual(evaluateTrade({ gateActive: false, session: null, ...after }), [])
  })

  test('once adopted, a day with no plan is a violation', () => {
    assert.deepEqual(evaluateTrade({ gateActive: true, session: null, ...after }), ['no_session_plan'])
  })

  test('an unplanned account on a day blocked elsewhere is refused as a no-trade day', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: null, blockedElsewhere: true, ...after }),
      ['trading_while_blocked'],
    )
  })

  test('a blocked day refuses every trade', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: open({ status: 'blocked' }), ...after }),
      ['trading_while_blocked'],
    )
  })

  test('a closed session refuses further trades', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: open({ status: 'closed' }), ...after }),
      ['after_session_closed'],
    )
  })

  test('trades 1 and 2 pass; trade 3 is over the cap', () => {
    assert.deepEqual(evaluateTrade({ gateActive: true, session: open({ tradesLogged: 0 }), ...after }), [])
    assert.deepEqual(evaluateTrade({ gateActive: true, session: open({ tradesLogged: 1 }), ...after }), [])
    assert.deepEqual(evaluateTrade({ gateActive: true, session: open({ tradesLogged: 2 }), ...after }), ['over_trade_cap'])
  })

  test('a plan that chose 1 trade stops at 1', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: open({ maxTrades: 1, tradesLogged: 1 }), ...after }),
      ['over_trade_cap'],
    )
  })

  test('a plan written after the trade is caught', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: open(), ...at('2026-10-14T13:10:00Z') }),
      ['before_plan'],
    )
  })

  test('a minute-rounded entry just before the save is not a false alarm', () => {
    const justBefore = new Date(openedAt.getTime() - BEFORE_PLAN_TOLERANCE_MS + 1000).toISOString()
    assert.deepEqual(evaluateTrade({ gateActive: true, session: open(), entryTimeUtc: justBefore }), [])
  })

  test('every broken rule is reported together', () => {
    assert.deepEqual(
      evaluateTrade({ gateActive: true, session: open({ tradesLogged: 2 }), ...at('2026-10-14T12:00:00Z') }),
      ['over_trade_cap', 'before_plan'],
    )
  })

  test('each code has a message a person can read', () => {
    for (const { message } of describeViolations(['no_session_plan', 'over_trade_cap', 'before_plan'])) {
      assert.ok(message.length > 20 && !message.includes('_'))
    }
  })
})

describe('what the client is told', () => {
  test('remaining trades never go negative, and only an open day has any', () => {
    assert.equal(serializeSession({ status: 'open', maxTrades: 2, tradesLogged: 0 }).tradesRemaining, 2)
    assert.equal(serializeSession({ status: 'open', maxTrades: 2, tradesLogged: 3 }).tradesRemaining, 0)
    assert.equal(serializeSession({ status: 'open', maxTrades: 2, tradesLogged: 3 }).canTrade, false)
    assert.equal(serializeSession({ status: 'blocked', maxTrades: null, tradesLogged: 0 }).canTrade, false)
    assert.equal(serializeSession({ status: 'closed', maxTrades: 2, tradesLogged: 1 }).tradesRemaining, 0)
    assert.equal(serializeSession(null), null)
  })
})
