import { useEffect, useState } from 'react'
import { tradesApi } from '../api/trades.js'

// Field names as the entry form labels them, so the audit trail reads in the
// same vocabulary the user filled in.
const FIELD_LABELS = {
  brokerPositionId: 'Position ID',
  brokerAccountId: 'Broker account',
  brokerPlatform: 'Platform',
  pair: 'Symbol',
  direction: 'Direction',
  entryTimeUtc: 'Entry time',
  captureTimezone: 'Capture timezone',
  entryPrice: 'Entry price',
  stopLoss: 'Stop loss',
  takeProfit: 'Take profit',
  lotSize: 'Lot size',
  technicalSetup: 'Technical setup',
  emotionalState: 'Emotional state',
  followedChecklist: 'Followed checklist',
  fullPort: 'Full port',
  notes: 'Pre-trade notes',
}

// Values are stored as text. Timestamps are the one case where the raw form is
// unreadable, so they get rendered back into something a human recognises.
function displayValue(raw) {
  if (raw == null || raw === '') return '—'
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: '2-digit',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }) + ' UTC'
    }
  }
  return raw
}

// The other half of Task 7. Recording the original values is only worth doing if
// someone can read them back — otherwise "amended" is a badge with nothing
// behind it, and the trail may as well not exist.
export default function AmendmentHistory({ trade, onClose }) {
  const [amendments, setAmendments] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    tradesApi.amendments(trade.id)
      .then(rows => { if (!cancelled) setAmendments(rows) })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [trade.id])

  // Several fields can change in one amendment; they share an amendedAt and a
  // reason, so they belong together as one entry in the history.
  const groups = []
  for (const row of amendments ?? []) {
    const key = `${row.amendedAt}|${row.reason ?? ''}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, amendedAt: row.amendedAt, reason: row.reason, rows: [row] })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 px-4 py-10 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-surface border border-line rounded-xl w-full max-w-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              Amendment history — trade #{trade.id}
            </h3>
            <p className="text-xs text-muted mt-1">
              What changed after the pre-trade entry was saved, and why. The original values are
              kept exactly as first recorded.
            </p>
          </div>
          <button onClick={onClose}
            className="text-sm text-gray-400 hover:text-white transition-colors shrink-0">
            Close
          </button>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!error && amendments === null && (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        )}

        {!error && amendments?.length === 0 && (
          <p className="text-sm text-gray-500 py-6 text-center">
            This trade has never been amended — every pre-trade value is as first recorded.
          </p>
        )}

        {groups.map((group, i) => (
          <div key={group.key + i} className="bg-surface-2 rounded-lg p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-xs text-faint">
                {new Date(group.amendedAt).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', year: '2-digit',
                  hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                })} UTC
              </span>
              <span className="text-[11px] text-muted">
                {group.rows.length} field{group.rows.length !== 1 ? 's' : ''} changed
              </span>
            </div>

            {group.reason && (
              <p className="text-sm text-gray-300 italic border-l-2 border-amber-700/60 pl-3">
                “{group.reason}”
              </p>
            )}

            <div className="space-y-2">
              {group.rows.map(row => (
                <div key={row.id} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3 text-sm items-baseline">
                  <span className="text-xs text-muted truncate" title={FIELD_LABELS[row.field] ?? row.field}>
                    {FIELD_LABELS[row.field] ?? row.field}
                  </span>
                  <span className="flex items-baseline gap-2 flex-wrap min-w-0">
                    <span className="text-red-400/90 line-through break-all">{displayValue(row.oldValue)}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-emerald-400 break-all">{displayValue(row.newValue)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
