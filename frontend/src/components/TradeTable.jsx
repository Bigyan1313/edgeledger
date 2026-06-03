import { useState } from 'react'
import { tradesApi } from '../api/trades.js'

const DANGER_SETUPS = new Set([
  'Anticipation (no confirmation)',
  'FOMO / Impulsive',
  'News / Full-port',
  'Revenge',
])

function realizedR(trade) {
  const { direction, entryPrice: e, stopLoss: sl, exitPrice: ex, riskDollars: rd, pnl } = trade
  if (e && sl && ex) {
    const risk = direction === 'long' ? e - sl : sl - e
    if (risk <= 0) return null
    return direction === 'long' ? (ex - e) / risk : (e - ex) / risk
  }
  if (rd && pnl !== null) return pnl / rd
  return null
}

function fmt(n, decimals = 2) {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

export default function TradeTable({ trades, onDeleted, onEdit }) {
  const [deleting, setDeleting] = useState(null)

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
    return (
      <div className="text-center py-16 text-gray-600">
        No trades logged yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-800">
            {['Date', 'Pair', 'Dir', 'Setup', 'P&L', 'R', 'Outcome', 'Emotion', '✓', ''].map(h => (
              <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {trades.map(trade => {
            const r = realizedR(trade)
            const isDanger = DANGER_SETUPS.has(trade.setup)
            return (
              <tr key={trade.id} className="hover:bg-gray-800/30 transition-colors">
                <td className="px-3 py-3 text-gray-400 whitespace-nowrap">
                  {new Date(trade.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                </td>
                <td className="px-3 py-3 text-white font-medium">{trade.pair}</td>
                <td className="px-3 py-3">
                  <span className={`text-xs font-semibold ${trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trade.direction === 'long' ? '▲ L' : '▼ S'}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-[180px]">
                  <span
                    className={`text-xs truncate block ${isDanger ? 'text-red-400' : 'text-gray-300'}`}
                    title={trade.setup}
                  >
                    {isDanger && '⚠ '}{trade.setup}
                  </span>
                </td>
                <td className={`px-3 py-3 font-semibold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {trade.pnl >= 0 ? '+' : ''}{fmt(trade.pnl)}
                </td>
                <td className={`px-3 py-3 text-xs ${r == null ? 'text-gray-600' : r >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {r == null ? '—' : `${fmt(r)}R`}
                </td>
                <td className="px-3 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    trade.outcome === 'Win'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : trade.outcome === 'Loss'
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}>
                    {trade.outcome}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-gray-400">{trade.emotionBefore ?? '—'}</td>
                <td className="px-3 py-3 text-center">
                  {trade.followedChecklist
                    ? <span className="text-emerald-400">✓</span>
                    : <span className="text-gray-700">✗</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <button
                    onClick={() => onEdit(trade)}
                    className="text-gray-600 hover:text-emerald-400 transition-colors text-xs mr-3"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(trade.id)}
                    disabled={deleting === trade.id}
                    className="text-gray-600 hover:text-red-400 transition-colors text-xs disabled:opacity-50"
                  >
                    {deleting === trade.id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
