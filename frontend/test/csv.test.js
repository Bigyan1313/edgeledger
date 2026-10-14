// Task 9: the export format is a contract with the analysis pipeline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tradesToCsv, exportFilename, CSV_COLUMNS, selectExportRows,
  sessionsToCsv, reviewsToCsv, SESSION_CSV_COLUMNS, REVIEW_CSV_COLUMNS,
} from '../src/utils/csv.js'

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

test('rule violations export as their own list, apart from data-quality flags', () => {
  const csv = tradesToCsv([v2Trade({
    sessionId: 42,
    ruleViolations: ['over_trade_cap', 'before_plan'],
    dataQualityFlags: [],
  })])
  assert.equal(cell(csv, 'rule_violations'), 'over_trade_cap|before_plan')
  assert.equal(cell(csv, 'session_id'), '42')
  assert.equal(cell(csv, 'data_quality_flags'), '')
})

test('a trade from before session plans exports empty session columns', () => {
  const csv = tradesToCsv([v2Trade({ sessionId: null, ruleViolations: [] })])
  assert.equal(cell(csv, 'session_id'), '')
  assert.equal(cell(csv, 'rule_violations'), '')
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

// --- sessions and reviews ------------------------------------------------------------


// A row parser that respects quotes, so free text with commas reads back whole.
function parseRow(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}
const table = (csv) => {
  const [header, ...rows] = csv.trimEnd().split('\n')
  const cols = header.split(',')
  return rows.map(r => Object.fromEntries(parseRow(r).map((v, i) => [cols[i], v])))
}

const OPEN_DAY = {
  id: 42, sessionDate: '2026-10-14', timezone: 'America/Chicago', accountId: 7, account: { id: 7, name: 'Lucid 50K' },
  status: 'closed', sleepHours: 7.5, fitToTrade: true, minSleepHoursApplied: 6, blockedReasons: [],
  bias: 'long', wantToSee: 'Sweep of the Asia low, then a 5m BOS', noTradeIf: 'Chop inside Asia, past 10:30',
  scenarios: [{ if: 'Asia low swept, "reclaimed"', then: 'Long the retest, stop under the sweep' }, { if: 'High taken first', then: 'Stand aside' }],
  maxTrades: 2, tradesLogged: 3, openedAt: '2026-10-14T13:20:00.000Z', closedAt: '2026-10-14T19:00:00.000Z',
  followedPlan: false, review: 'Took a third, after two stops.',
}
const BLOCKED_DAY = {
  id: 43, sessionDate: '2026-10-15', timezone: 'America/Chicago', accountId: 7, account: { id: 7, name: 'Lucid 50K' },
  status: 'blocked', sleepHours: 4.5, fitToTrade: true, minSleepHoursApplied: 6,
  blockedReasons: ['Slept 4.5h — the floor is 6h.'], bias: null, wantToSee: null, noTradeIf: null,
  scenarios: null, maxTrades: null, tradesLogged: 0, openedAt: '2026-10-15T12:00:00.000Z', closedAt: null,
  followedPlan: null, review: null,
}

test('session columns are snake_case and carry the join key', () => {
  assert.ok(SESSION_CSV_COLUMNS.includes('session_id'))
  assert.ok(SESSION_CSV_COLUMNS.every(c => !/[A-Z]/.test(c)))
})

test('scenarios survive as JSON, quotes and commas included', () => {
  const [row] = table(sessionsToCsv([OPEN_DAY]))
  assert.deepEqual(JSON.parse(row.scenarios), OPEN_DAY.scenarios)
  assert.equal(row.scenario_count, '2')
})

test('a day over its limit says so — and a blocked day with no trades does not', () => {
  const [open, blocked] = table(sessionsToCsv([OPEN_DAY, BLOCKED_DAY]))
  assert.equal(open.over_limit, 'true')
  assert.equal(blocked.over_limit, 'false')
  assert.equal(table(sessionsToCsv([{ ...BLOCKED_DAY, tradesLogged: 1 }]))[0].over_limit, 'true')
})

test('a blocked day exports empty plan cells, never "null"', () => {
  const [row] = table(sessionsToCsv([BLOCKED_DAY]))
  assert.equal(row.want_to_see, '')
  assert.equal(row.scenarios, '')
  assert.equal(row.max_trades, '')
  assert.equal(row.followed_plan, '')
  assert.equal(row.blocked_reasons, 'Slept 4.5h — the floor is 6h.')
})

test('the session label and chart count travel with each session', () => {
  const [row] = table(sessionsToCsv([{ ...OPEN_DAY, marketSession: 'new_york', screenshotCount: 2 }]))
  assert.equal(row.market_session, 'new_york')
  assert.equal(row.screenshot_count, '2')
  assert.equal(table(sessionsToCsv([BLOCKED_DAY]))[0].market_session, '')
})

test('a review says whether it was a backtest, late, or edited after its day', () => {
  const [row] = table(reviewsToCsv([{
    id: 3, reviewDate: '2026-10-13', symbol: 'MNQZ6', marketTimezone: 'America/New_York', marketOpenTime: '09:30',
    dayType: 'range', summary: 'Ranged inside the Asia session all morning.', validSetup: false,
    isBacktest: false, writtenLate: true, editedAfterClose: true, writtenAt: '2026-10-15T14:00:00.000Z', lastEditedAt: '2026-10-16T14:00:00.000Z',
  }]))
  assert.equal(row.is_backtest, 'false')
  assert.equal(row.written_late, 'true')
  assert.equal(row.edited_after_close, 'true')
})

test('review columns are snake_case and export booleans and times plainly', () => {
  assert.ok(REVIEW_CSV_COLUMNS.every(c => !/[A-Z]/.test(c)))
  const [row] = table(reviewsToCsv([{
    id: 9, reviewDate: '2026-10-14', symbol: 'MNQZ6', marketTimezone: 'America/New_York', marketOpenTime: '09:30',
    dayType: 'reversal', summary: 'Swept the Asia low, reclaimed, trended to PDH.', openBehavior: null, keyLevels: null,
    liquidityTaken: 'sell_side', planPlayedOut: 'partly', validSetup: true, lesson: null, screenshotCount: 2,
    writtenAt: '2026-10-14T17:00:00.000Z', lastEditedAt: null,
  }]))
  assert.equal(row.valid_setup, 'true')
  assert.equal(row.screenshot_count, '2')
  assert.equal(row.written_at, '2026-10-14T17:00:00+00:00')
  assert.equal(row.summary, 'Swept the Asia low, reclaimed, trended to PDH.')
  assert.equal(row.last_edited_at, '')
})
