// Computed values: outcome, riskDollars, rMultiple, journaling lag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeOutcome,
  computeRiskDollars,
  computeRMultiple,
  computeJournalingLagMinutes,
  computeWasAmended,
} from '../src/domain/derived.js'
import { serializeTrade } from '../src/domain/serialize.js'

test('Task 5: outcome is derived from pnl, so it cannot drift', () => {
  assert.equal(computeOutcome(165), 'Win')
  assert.equal(computeOutcome(-55), 'Loss')
  assert.equal(computeOutcome(0), 'Break-even')
})

test('Task 5: an unexited trade has no outcome — which is not break-even', () => {
  assert.equal(computeOutcome(null), null)
  assert.equal(computeOutcome(undefined), null)
})

test('Task 5: riskDollars is computed from price distance, lots and contract size', () => {
  // 5 points of gold at 0.5 lots = 5 × 0.5 × 100 oz = $250.
  const risk = computeRiskDollars({ pair: 'XAUUSD.pro', entryPrice: 2350, stopLoss: 2345, lotSize: 0.5 })
  assert.equal(risk, 250)
})

test('Task 5: risk is the same whichever side of entry the stop sits on', () => {
  const long = computeRiskDollars({ pair: 'XAUUSD', entryPrice: 2350, stopLoss: 2345, lotSize: 1 })
  const short = computeRiskDollars({ pair: 'XAUUSD', entryPrice: 2345, stopLoss: 2350, lotSize: 1 })
  assert.equal(long, short)
})

test('Task 5: an unknown instrument yields null risk, not a guess', () => {
  const risk = computeRiskDollars({ pair: 'MADEUP.pro', entryPrice: 100, stopLoss: 95, lotSize: 1 })
  assert.equal(risk, null)
})

test('Task 5: rMultiple is null when risk is unknown or zero', () => {
  assert.equal(computeRMultiple({ pair: 'MADEUP', entryPrice: 100, stopLoss: 95, lotSize: 1, pnl: 50 }), null)
  assert.equal(computeRMultiple({ pair: 'XAUUSD', entryPrice: 2350, stopLoss: 2350, lotSize: 1, pnl: 50 }), null)
})

test('Task 5: rMultiple is pnl over risk', () => {
  const trade = { pair: 'XAUUSD.pro', entryPrice: 2350, stopLoss: 2345, lotSize: 0.5, pnl: 500 }
  assert.equal(computeRiskDollars(trade), 250)
  assert.equal(computeRMultiple(trade), 2) // 500 / 250
})

test('a v1 row falls back to its stored, user-entered risk figure', () => {
  const legacy = { schemaVersion: 1, pair: 'Other', entryPrice: null, stopLoss: null, lotSize: null, riskDollars: 55, pnl: 110 }
  assert.equal(computeRMultiple(legacy), 2)
})

test('a v2 row never falls back — its risk comes from its own numbers', () => {
  const v2 = { schemaVersion: 2, pair: 'MADEUP', entryPrice: null, stopLoss: null, lotSize: null, riskDollars: 55, pnl: 110 }
  assert.equal(computeRMultiple(v2), null)
})

test('Task 2: journaling lag is the gap between entry and first save', () => {
  const lag = computeJournalingLagMinutes({
    entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
    journaledAt: new Date('2026-08-01T13:34:00Z'),
  })
  assert.equal(lag, 4)
})

test('Task 2: a trade journaled a day later shows it plainly', () => {
  const lag = computeJournalingLagMinutes({
    entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
    journaledAt: new Date('2026-08-02T13:30:00Z'),
  })
  assert.equal(lag, 1440)
})

test('Task 2: journaling ahead of entry is legitimate and stays negative', () => {
  const lag = computeJournalingLagMinutes({
    entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
    journaledAt: new Date('2026-08-01T13:00:00Z'),
  })
  assert.equal(lag, -30)
})

test('Task 7: wasAmended reflects whether a locked field ever changed', () => {
  assert.equal(computeWasAmended({ amendedAt: null }), false)
  assert.equal(computeWasAmended({ amendedAt: new Date() }), true)
})

test('the serialized trade carries the derived fields and drops the legacy risk column', () => {
  const serialized = serializeTrade({
    id: 7,
    schemaVersion: 2,
    pair: 'XAUUSD.pro',
    direction: 'long',
    entryPrice: 2350,
    stopLoss: 2345,
    lotSize: 0.5,
    pnl: 500,
    riskDollars: 999, // a stale v1-era column value; must not win
    entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
    journaledAt: new Date('2026-08-01T13:34:00Z'),
    amendedAt: null,
  })

  assert.equal(serialized.outcome, 'Win')
  assert.equal(serialized.riskDollars, 250, 'the computed figure must override the stale column')
  assert.equal(serialized.rMultiple, 2)
  assert.equal(serialized.journalingLagMinutes, 4)
  assert.equal(serialized.wasAmended, false)
})
