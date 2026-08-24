// Task 9: the export format is a contract with the analysis pipeline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tradesToCsv, exportFilename, CSV_COLUMNS, selectExportRows } from '../src/utils/csv.js'

const v2Trade = (overrides = {}) => ({
  id: 1,
  schemaVersion: 2,
  brokerPositionId: '123456789',
  brokerAccountId: 'CT-4471',
  brokerPlatform: 'cTrader',
  accountId: 3,
  pair: 'XAUUSD.pro',
  direction: 'long',
  entryTimeUtc: '2026-08-01T13:30:00.000Z',
  exitTimeUtc: '2026-08-01T15:00:00.000Z',
  captureTimezone: 'America/Chicago',
  entryPrice: 2350,
  stopLoss: 2345,
  takeProfit: 2365,
  exitPrice: 2360,
  lotSize: 0.5,
  riskDollars: 250,
  pnl: 500,
  outcome: 'Win',
  rMultiple: 2,
  technicalSetup: 'Break & retest',
  emotionalState: 'Calm',
  followedChecklist: true,
  fullPort: false,
  entryStage: 'complete',
  wasAmended: false,
  amendedAt: null,
  journaledAt: '2026-08-01T13:32:00.000Z',
  lastEditedAt: '2026-08-01T15:00:05.000Z',
  journalingLagMinutes: 2,
  dataQualityFlags: [],
  legacySetup: null,
  notes: 'Swept the Asia high, waited for the retest.',
  exitNotes: 'Target hit.',
  ...overrides,
})

const parse = (csv) => {
  const [header, ...rows] = csv.trimEnd().split('\n')
  return { header: header.split(','), rows }
}

const cell = (csv, column) => {
  const { header, rows } = parse(csv)
  // Good enough for these fixtures: no test value contains a quoted comma in a
  // column being read positionally.
  return rows[0].split(',')[header.indexOf(column)]
}

test('every column name is snake_case', () => {
  for (const name of CSV_COLUMNS) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `"${name}" is not snake_case`)
  }
})

test('the columns the pipeline hard-codes are all present', () => {
  for (const required of [
    'broker_position_id', 'entry_time_utc', 'technical_setup', 'r_multiple',
    'schema_version', 'journaled_at', 'journaling_lag_minutes',
    'data_quality_flags', 'entry_stage', 'was_amended',
  ]) {
    assert.ok(CSV_COLUMNS.includes(required), `missing column: ${required}`)
  }
})

test('no column needs renaming before the pipeline reads it', () => {
  const csv = tradesToCsv([v2Trade()])
  const { header } = parse(csv)
  assert.deepEqual(header, CSV_COLUMNS)
  assert.ok(!header.some(h => /[A-Z]/.test(h)), 'no camelCase survived')
})

test('booleans are true/false, not Python\'s True/False', () => {
  const csv = tradesToCsv([v2Trade({ followedChecklist: true, fullPort: false })])
  assert.equal(cell(csv, 'followed_checklist'), 'true')
  assert.equal(cell(csv, 'full_port'), 'false')
  assert.equal(cell(csv, 'was_amended'), 'false')
  assert.ok(!csv.includes('True'), 'found Python-style True')
  assert.ok(!csv.includes('False'), 'found Python-style False')
})

test('empty values are truly empty — never NaN, None or null', () => {
  const csv = tradesToCsv([v2Trade({
    exitTimeUtc: null,
    exitPrice: null,
    pnl: null,
    rMultiple: null,
    takeProfit: undefined,
    exitNotes: null,
    amendedAt: null,
  })])
  assert.equal(cell(csv, 'exit_price'), '')
  assert.equal(cell(csv, 'r_multiple'), '')
  assert.equal(cell(csv, 'take_profit'), '')
  for (const forbidden of ['NaN', 'None', 'null', 'undefined']) {
    assert.ok(!csv.includes(forbidden), `found "${forbidden}" standing in for an empty value`)
  }
})

test('timestamps are ISO 8601 with an explicit UTC offset', () => {
  const csv = tradesToCsv([v2Trade()])
  for (const column of ['entry_time_utc', 'exit_time_utc', 'journaled_at']) {
    assert.match(cell(csv, column), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/,
      `${column} is not an explicit-offset ISO 8601 timestamp`)
  }
})

test('timestamps round-trip through UTC without loss', () => {
  const instant = '2026-08-01T13:30:00.000Z'
  const csv = tradesToCsv([v2Trade({ entryTimeUtc: instant })])
  assert.equal(new Date(cell(csv, 'entry_time_utc')).getTime(), new Date(instant).getTime())
})

test('data quality flags survive as a parseable list', () => {
  const csv = tradesToCsv([v2Trade({
    schemaVersion: 1,
    dataQualityFlags: ['legacy_unlinked', 'missing_stop_loss', 'invalid_lot_size'],
  })], { includeLegacy: true })
  assert.equal(cell(csv, 'data_quality_flags'), 'legacy_unlinked|missing_stop_loss|invalid_lot_size')
})

test('a row with no flags exports an empty cell, not an empty-looking one', () => {
  const csv = tradesToCsv([v2Trade({ dataQualityFlags: [] })])
  assert.equal(cell(csv, 'data_quality_flags'), '')
})

test('Task 8: no v1 row appears in a default export', () => {
  const csv = tradesToCsv([
    v2Trade({ id: 1, schemaVersion: 2 }),
    v2Trade({ id: 2, schemaVersion: 1, brokerPositionId: null }),
  ])
  const { rows } = parse(csv)
  assert.equal(rows.length, 1)
  assert.ok(rows[0].startsWith('1,2,'), 'expected only the v2 row')
})

test('Task 8: the explicit toggle includes v1 rows', () => {
  const trades = [v2Trade({ id: 1 }), v2Trade({ id: 2, schemaVersion: 1 })]
  assert.equal(selectExportRows(trades, { includeLegacy: true }).length, 2)
  assert.equal(parse(tradesToCsv(trades, { includeLegacy: true })).rows.length, 2)
})

test('commas, quotes and newlines in notes do not break the row', () => {
  const csv = tradesToCsv([v2Trade({
    notes: 'Swept, then reversed. He said "wait for the retest".\nSecond line.',
  })])
  const { rows } = parse(csv.replace(/\n(?=Second line)/, '\\n'))
  assert.equal(rows.length, 1, 'an embedded newline must stay inside its quoted field')
  assert.ok(csv.includes('""wait for the retest""'), 'quotes must be doubled')
})

test('the filename states the schema version and the date', () => {
  assert.equal(exportFilename(new Date('2026-08-18T09:00:00Z')), 'edgeledger-trades-v2-2026-08-18.csv')
})

test('an empty journal still exports a valid header row', () => {
  const csv = tradesToCsv([])
  assert.equal(csv, CSV_COLUMNS.join(',') + '\n')
})
