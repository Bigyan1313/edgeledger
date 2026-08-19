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

export function exportFilename(date = new Date()) {
  return `edgeledger-trades-v2-${date.toISOString().slice(0, 10)}.csv`
}

export function downloadCsv(trades, options = {}) {
  const csv = tradesToCsv(trades, options)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportFilename()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
