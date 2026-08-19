import { useState } from 'react'
import { tradesApi } from '../api/trades.js'
import { DATA_QUALITY_FLAG_LABELS, RISKY_EMOTIONAL_STATES, RISKY_TECHNICAL_SETUPS } from '../constants/trade.js'

function fmt(n, decimals = 2) {
  if (n == null) return '—'
  return Number(n).toFixed(decimals)
}

export default function TradeTable({ trades, onDeleted, onClose, onAmend, onReview, onShowAmendments }) {
  const [deleting, setDeleting] = useState(null)
  const [viewing, setViewing] = useState(null) // { id, shots, loading } | null

  // Screenshots aren't in the list payload — fetch the full trade on demand.
  const openShots = async (trade) => {
    setViewing({ id: trade.id, shots: [], loading: true })
    try {
      const full = await tradesApi.get(trade.id)
      setViewing({ id: trade.id, shots: full.screenshots || [], loading: false })
    } catch {
      setViewing({ id: trade.id, shots: [], loading: false })
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this trade?')) return
    setDeleting(id)
    try {
      await tradesApi.remove(id)
      onDeleted(id)
    } finally {
      setDeleting(null)
    }
  }

  if (trades.length === 0) {
    return <div className="text-center py-16 text-gray-600">No trades logged yet.</div>
  }

  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-800">
            {['Entry (UTC)', 'Symbol', 'Dir', 'Setup', 'State', 'P&L', 'R', 'Outcome', 'Stage', 'Flags', '📷'].map(h => (
              <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
            ))}
            <th className="px-3 py-3 sticky right-0 bg-ink" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {trades.map(trade => {
            const isLegacy = trade.schemaVersion === 1
            const isOpen = trade.entryStage === 'pending_exit'
            const riskySetup = RISKY_TECHNICAL_SETUPS.has(trade.technicalSetup)
            const riskyState = RISKY_EMOTIONAL_STATES.has(trade.emotionalState)

            return (
              <tr key={trade.id} className={`hover:bg-gray-800/30 transition-colors ${isLegacy ? 'opacity-60' : ''}`}>
                <td className="px-3 py-3 text-gray-400 whitespace-nowrap">
                  {new Date(trade.entryTimeUtc).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: '2-digit',
                    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                  })}
                  {isLegacy && <span className="ml-2 text-[10px] text-amber-500/80 uppercase">v1</span>}
                </td>
                <td className="px-3 py-3 text-white font-medium whitespace-nowrap">{trade.pair}</td>
                <td className="px-3 py-3">
                  <span className={`text-xs font-semibold ${trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trade.direction === 'long' ? '▲ L' : '▼ S'}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-[170px]">
                  <span className={`text-xs truncate block ${riskySetup ? 'text-red-400' : 'text-gray-300'}`}
                    title={trade.technicalSetup ?? trade.legacySetup ?? ''}>
                    {trade.technicalSetup ?? (trade.legacySetup ? `${trade.legacySetup} (v1)` : '—')}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={`text-xs ${riskyState ? 'text-red-400' : 'text-gray-400'}`}>
                    {trade.emotionalState ?? '—'}
                  </span>
                </td>
                <td className={`px-3 py-3 font-semibold whitespace-nowrap ${
                  trade.pnl == null ? 'text-gray-600' : trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {trade.pnl == null ? '—' : `${trade.pnl >= 0 ? '+' : ''}${fmt(trade.pnl)}`}
                </td>
                <td className={`px-3 py-3 text-xs ${
                  trade.rMultiple == null ? 'text-gray-600' : trade.rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {trade.rMultiple == null ? '—' : `${fmt(trade.rMultiple)}R`}
                </td>
                <td className="px-3 py-3">
                  {trade.outcome ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      trade.outcome === 'Win' ? 'bg-emerald-500/15 text-emerald-400'
                        : trade.outcome === 'Loss' ? 'bg-red-500/15 text-red-400'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {trade.outcome}
                    </span>
                  ) : <span className="text-gray-600 text-xs">—</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {isOpen
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">open</span>
                    : <span className="text-xs text-gray-500">closed</span>}
                  {trade.wasAmended && (
                    <button onClick={() => onShowAmendments(trade)}
                      className="ml-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
                      title="See what changed, and why">
                      amended
                    </button>
                  )}
                </td>
                <td className="px-3 py-3">
                  <FlagPills flags={trade.dataQualityFlags ?? []} />
                </td>
                <td className="px-3 py-3 text-center">
                  {trade.screenshotCount > 0 ? (
                    <button onClick={() => openShots(trade)} title="View screenshots"
                      className="text-xs text-gray-400 hover:text-emerald-400 transition-colors">
                      📷 {trade.screenshotCount}
                    </button>
                  ) : (
                    <span className="text-gray-700 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-right sticky right-0 bg-ink">
                  {isOpen && !isLegacy && (
                    <button onClick={() => onClose(trade)}
                      className="text-emerald-500 hover:text-emerald-400 transition-colors text-xs mr-3 font-medium">
                      Close
                    </button>
                  )}
                  {!isOpen && !isLegacy && (
                    <button onClick={() => onReview(trade)}
                      className="text-gray-600 hover:text-gray-300 transition-colors text-xs mr-3">
                      Review
                    </button>
                  )}
                  {!isLegacy && (
                    <button onClick={() => onAmend(trade)} title="Change a locked pre-trade field — leaves a record"
                      className="text-gray-600 hover:text-amber-400 transition-colors text-xs mr-3">
                      Amend
                    </button>
                  )}
                  <button onClick={() => handleDelete(trade.id)} disabled={deleting === trade.id}
                    className="text-gray-600 hover:text-red-400 transition-colors text-xs disabled:opacity-50">
                    {deleting === trade.id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {viewing && (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-6"
        onClick={() => setViewing(null)}>
        <div className="bg-ink border border-gray-800 rounded-xl w-full max-w-4xl max-h-[88vh] overflow-y-auto p-5"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Trade #{viewing.id} · Screenshots</h3>
            <button onClick={() => setViewing(null)}
              className="text-gray-400 hover:text-white text-sm transition-colors">
              Close ✕
            </button>
          </div>
          {viewing.loading ? (
            <div className="text-gray-400 text-sm py-12 text-center">Loading…</div>
          ) : viewing.shots.length === 0 ? (
            <div className="text-gray-500 text-sm py-12 text-center">No screenshots on this trade.</div>
          ) : (
            <div className="space-y-4">
              {viewing.shots.map((src, i) => (
                <img key={i} src={src} alt={`Trade ${viewing.id} screenshot ${i + 1}`}
                  className="w-full rounded-lg border border-gray-800" />
              ))}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  )
}

// Flags describe what is wrong with a row. Surfacing them in the journal — not
// only in the export — is what tells the user a row will be excluded downstream,
// and why.
//
// Rendered as a count rather than a list of pills: v2 added enough columns that
// a wrapping pill list pushed the row actions off the edge of the table, and the
// detail belongs in the tooltip and the export either way.
function FlagPills({ flags }) {
  if (!flags.length) return <span className="text-gray-700 text-xs">—</span>
  const detail = flags.map(f => DATA_QUALITY_FLAG_LABELS[f] ?? f).join('\n')
  return (
    <span title={detail}
      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500/90 whitespace-nowrap cursor-help">
      ⚠ {flags.length}
    </span>
  )
}
