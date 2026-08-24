// Task 8: flags describe, they never repair.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDataQualityFlags } from '../src/domain/dataQuality.js'

// A v1 row as it arrives from the migration: no broker link, no stop, no
// prices, and whatever the trader typed in the notes.
const legacyRow = (overrides = {}) => ({
  schemaVersion: 1,
  entryStage: 'complete',
  brokerPositionId: null,
  stopLoss: null,
  entryPrice: null,
  exitPrice: null,
  lotSize: 0.1,
  pnl: 120,
  notes: 'standard entry',
  entryTimeUtc: new Date('2026-06-01T08:00:00Z'),
  journaledAt: new Date('2026-06-01T08:04:00Z'),
  ...overrides,
})

test('an unlinked row is flagged legacy_unlinked', () => {
  assert.ok(computeDataQualityFlags(legacyRow()).includes('legacy_unlinked'))
})

test('a linked row is not', () => {
  const flags = computeDataQualityFlags(legacyRow({ brokerPositionId: '12345' }))
  assert.ok(!flags.includes('legacy_unlinked'))
})

test('a missing stop is flagged', () => {
  assert.ok(computeDataQualityFlags(legacyRow()).includes('missing_stop_loss'))
  assert.ok(!computeDataQualityFlags(legacyRow({ stopLoss: 2345 })).includes('missing_stop_loss'))
})

test('either end of the price pair missing counts as missing_prices', () => {
  assert.ok(computeDataQualityFlags(legacyRow({ entryPrice: null, exitPrice: 2360 })).includes('missing_prices'))
  assert.ok(computeDataQualityFlags(legacyRow({ entryPrice: 2350, exitPrice: null })).includes('missing_prices'))
  assert.ok(!computeDataQualityFlags(legacyRow({ entryPrice: 2350, exitPrice: 2360 })).includes('missing_prices'))
})

test('an open v2 trade is not flagged for the exit price it has not reached yet', () => {
  const open = legacyRow({
    schemaVersion: 2,
    entryStage: 'pending_exit',
    brokerPositionId: '999',
    stopLoss: 2345,
    entryPrice: 2350,
    exitPrice: null,
    pnl: null,
  })
  assert.deepEqual(computeDataQualityFlags(open), [])
})

test('the three negative lot sizes are flagged, and left exactly as they are', () => {
  for (const lotSize of [-16.83, -0.5, -2]) {
    const row = legacyRow({ lotSize })
    assert.ok(computeDataQualityFlags(row).includes('invalid_lot_size'))
    assert.equal(row.lotSize, lotSize, 'flagging must not modify the value')
  }
})

test('a row that merges several trades is flagged multi_trade_entry', () => {
  const phrasings = [
    'This entry merges three separate trades taken around the same level.',
    'combined 2 trades into one row',
    'three trades, logged together',
    'trades merged because they shared a stop',
  ]
  for (const notes of phrasings) {
    assert.ok(
      computeDataQualityFlags(legacyRow({ notes })).includes('multi_trade_entry'),
      `expected to flag: ${notes}`
    )
  }
})

test('ordinary notes are not mistaken for a merged entry', () => {
  for (const notes of ['standard entry', 'Took the retest, trailed to breakeven.', 'One trade, clean.']) {
    assert.ok(
      !computeDataQualityFlags(legacyRow({ notes })).includes('multi_trade_entry'),
      `false positive on: ${notes}`
    )
  }
})

test('"journaled late" in the notes is flagged retroactive_journal', () => {
  for (const notes of ['journaled late, reconstructed from the platform', 'Journaled late.', 'logged this after the fact']) {
    assert.ok(
      computeDataQualityFlags(legacyRow({ notes })).includes('retroactive_journal'),
      `expected to flag: ${notes}`
    )
  }
})

test('Task 2 makes retroactive journaling detectable without a confession in the notes', () => {
  // Same innocuous note; the lag alone gives it away.
  const late = legacyRow({
    notes: 'standard entry',
    entryTimeUtc: new Date('2026-06-01T08:00:00Z'),
    journaledAt: new Date('2026-06-02T14:00:00Z'),
  })
  assert.ok(computeDataQualityFlags(late).includes('retroactive_journal'))

  const prompt = legacyRow({ notes: 'standard entry' })
  assert.ok(!computeDataQualityFlags(prompt).includes('retroactive_journal'))
})

test('a clean v2 trade carries no flags at all', () => {
  const clean = {
    schemaVersion: 2,
    entryStage: 'complete',
    brokerPositionId: '123456789',
    entryPrice: 2350,
    stopLoss: 2345,
    exitPrice: 2360,
    lotSize: 0.5,
    pnl: 500,
    notes: 'Swept the Asia high, waited for the retest.',
    exitNotes: 'Target hit.',
    entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
    journaledAt: new Date('2026-08-01T13:32:00Z'),
  }
  assert.deepEqual(computeDataQualityFlags(clean), [])
})
