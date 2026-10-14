// Task 9: the export is the analysis pipeline's input, so its column names and
// types are a contract. The pipeline hard-codes them; anything that forces a
// cleaning step downstream is a defect here, not there.
//
// The v1 export failed on three counts this file exists to fix: camelCase
// column names, Python's `True`/`False` (not a CSV boolean convention), and the
// string "NaN" standing in for absent values.

// Column name → how to read it off a serialized trade. Order is the column
// order in the file, and it is stable: the pipeline reads by name, but a human
// diffing two exports should see the same shape.
const COLUMNS = [
  ['id', t => t.id],
  ['schema_version', t => t.schemaVersion],

  // Task 1 — the join key to broker execution data.
  ['broker_position_id', t => t.brokerPositionId],
  ['broker_account_id', t => t.brokerAccountId],
  ['broker_platform', t => t.brokerPlatform],
  ['account_id', t => t.accountId],

  // Task 6 — instrument and unambiguous times.
  ['pair', t => t.pair],
  ['direction', t => t.direction],
  ['entry_time_utc', t => t.entryTimeUtc],
  ['exit_time_utc', t => t.exitTimeUtc],
  ['capture_timezone', t => t.captureTimezone],

  // Task 5 — prices, size, and the figures derived from them.
  ['entry_price', t => t.entryPrice],
  ['stop_loss', t => t.stopLoss],
  ['take_profit', t => t.takeProfit],
  ['exit_price', t => t.exitPrice],
  ['lot_size', t => t.lotSize],
  ['risk_dollars', t => t.riskDollars],
  ['pnl', t => t.pnl],
  ['outcome', t => t.outcome],
  ['r_multiple', t => t.rMultiple],

  // Task 3 — the two orthogonal axes.
  ['technical_setup', t => t.technicalSetup],
  ['emotional_state', t => t.emotionalState],

  // Task 4 — answers, not defaults. Empty means unanswered.
  ['followed_checklist', t => t.followedChecklist],
  ['full_port', t => t.fullPort],

  // Task 7 — workflow state and the amendment trail.
  ['entry_stage', t => t.entryStage],
  ['was_amended', t => t.wasAmended],
  ['amended_at', t => t.amendedAt],

  // Task 2 — journaling latency.
  ['journaled_at', t => t.journaledAt],
  ['last_edited_at', t => t.lastEditedAt],
  ['journaling_lag_minutes', t => t.journalingLagMinutes],

  // Task 8 — what is wrong with this row, if anything.
  ['data_quality_flags', t => t.dataQualityFlags],

  // The session plan the trade was logged under, and which of its rules the
  // trade broke. Kept apart from data_quality_flags: a flag is about the
  // record, a violation is about the decision, and the pipeline will want to
  // split on them separately ("do the rule-break trades lose more?").
  ['session_id', t => t.sessionId],
  ['rule_violations', t => t.ruleViolations],
  ['legacy_setup', t => t.legacySetup],

  ['notes', t => t.notes],
  ['setup_notes', t => t.setupNotes],
  ['exit_notes', t => t.exitNotes],

  // The images themselves are base64 data URLs — a CSV is the wrong place for
  // them, so the export carries how many exist, not what they contain.
  ['screenshot_count', t => t.screenshotCount ?? t.screenshots?.length ?? 0],
]

export const CSV_COLUMNS = COLUMNS.map(([name]) => name)

// Multi-valued cells. A pipe never appears in a flag name, so this round-trips
// with a plain `str.split('|')` downstream.
const FLAG_SEPARATOR = '|'

// ISO 8601 with an explicit +00:00 offset rather than a bare `Z`. Both are
// valid UTC, but v1's `Z` turned out not to be trustworthy, and an offset that
// spells itself out leaves nothing to infer.
function formatTimestamp(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

// The v1 export wrote Python's str() output straight into the file: `True`,
// `False`, and `NaN`. None of those are CSV conventions, and every one of them
// forced a coercion step in the pipeline.
function formatValue(value) {
  // Empty means empty. Never "NaN", never "None", never "null".
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (value instanceof Date) return formatTimestamp(value)
  if (Array.isArray(value)) return value.join(FLAG_SEPARATOR)

  // Timestamps arrive from the API as ISO strings; normalise them to the same
  // explicit-offset form as Date values.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return formatTimestamp(value)
  }
  return String(value)
}

// Quote when the value contains a delimiter, a quote, a newline, or edge
// whitespace that a reader would otherwise silently eat.
function escape(raw) {
  const str = formatValue(raw)
  if (str === '') return ''
  if (/[",\n\r]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// Task 8: v1 rows are excluded unless explicitly asked for. They are real
// trades, but they carry no broker linkage and cannot meet the v2 contract, so
// letting them into an export by default would put them into analysis as if
// they had.
export function selectExportRows(trades, { includeLegacy = false } = {}) {
  return includeLegacy ? trades : trades.filter(t => t.schemaVersion === 2)
}

export function tradesToCsv(trades, options = {}) {
  const rows = selectExportRows(trades, options)
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map(trade =>
    COLUMNS.map(([, read]) => escape(read(trade))).join(',')
  )
  // A trailing newline: POSIX text convention, and it keeps the last row from
  // being merged with anything appended later.
  return [header, ...lines].join('\n') + '\n'
}

// --- sessions and reviews ------------------------------------------------------------
//
// The same contract as the trade export, for the two tables the pipeline joins
// against it: session_id is trades.session_id, and a review's review_date is
// the session_date of that day's plans. Together they answer what the trade
// table alone cannot — how sleep, the plan, and the market's day relate to
// the results.

const SESSION_COLUMNS = [
  ['session_id', s => s.id],
  ['session_date', s => s.sessionDate],
  ['timezone', s => s.timezone],
  ['account_id', s => s.accountId],
  ['account_name', s => s.account?.name],
  ['status', s => s.status],
  // asia | london | new_york; empty on a blocked day and on plans from
  // before the label existed.
  ['market_session', s => s.marketSession],
  ['sleep_hours', s => s.sleepHours],
  ['fit_to_trade', s => s.fitToTrade],
  ['min_sleep_hours_applied', s => s.minSleepHoursApplied],
  ['blocked_reasons', s => s.blockedReasons],
  ['bias', s => s.bias],
  ['want_to_see', s => s.wantToSee],
  // JSON rather than a pipe list: a scenario is two free-text halves, and
  // free text can contain anything. json.loads() reads it back exactly.
  ['scenarios', s => (s.scenarios == null ? null : JSON.stringify(s.scenarios))],
  ['scenario_count', s => (Array.isArray(s.scenarios) ? s.scenarios.length : null)],
  ['no_trade_if', s => s.noTradeIf],
  ['max_trades', s => s.maxTrades],
  ['trades_logged', s => s.tradesLogged],
  // More trades logged than the plan allowed — on a blocked day, any at all.
  ['over_limit', s => (s.maxTrades == null ? s.tradesLogged > 0 : s.tradesLogged > s.maxTrades)],
  ['opened_at', s => s.openedAt],
  ['closed_at', s => s.closedAt],
  ['followed_plan', s => s.followedPlan],
  ['review', s => s.review],
  ['screenshot_count', s => s.screenshotCount ?? s.screenshots?.length ?? 0],
]

const REVIEW_COLUMNS = [
  ['review_id', r => r.id],
  ['review_date', r => r.reviewDate],
  ['symbol', r => r.symbol],
  ['market_timezone', r => r.marketTimezone],
  ['market_open_time', r => r.marketOpenTime],
  ['day_type', r => r.dayType],
  ['summary', r => r.summary],
  ['open_behavior', r => r.openBehavior],
  ['key_levels', r => r.keyLevels],
  ['liquidity_taken', r => r.liquidityTaken],
  ['plan_played_out', r => r.planPlayedOut],
  ['valid_setup', r => r.validSetup],
  ['lesson', r => r.lesson],
  ['screenshot_count', r => r.screenshotCount ?? r.screenshots?.length ?? 0],
  // When it was written relative to its day: a backtest is practice on an
  // old day; written_late and edited_after_close are derived by the server.
  ['is_backtest', r => r.isBacktest],
  ['written_late', r => r.writtenLate],
  ['edited_after_close', r => r.editedAfterClose],
  ['written_at', r => r.writtenAt],
  ['last_edited_at', r => r.lastEditedAt],
]

export const SESSION_CSV_COLUMNS = SESSION_COLUMNS.map(([name]) => name)
export const REVIEW_CSV_COLUMNS = REVIEW_COLUMNS.map(([name]) => name)

function toCsv(columns, rows) {
  const header = columns.map(([name]) => name).join(',')
  const lines = rows.map(row => columns.map(([, read]) => escape(read(row))).join(','))
  return [header, ...lines].join('\n') + '\n'
}

export const sessionsToCsv = (sessions) => toCsv(SESSION_COLUMNS, sessions)
export const reviewsToCsv = (reviews) => toCsv(REVIEW_COLUMNS, reviews)

export function exportFilename(date = new Date(), table = 'trades-v2') {
  return `edgeledger-${table}-${date.toISOString().slice(0, 10)}.csv`
}

export function downloadCsv(trades, options = {}) {
  saveCsv(tradesToCsv(trades, options), exportFilename())
}

export function saveCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
