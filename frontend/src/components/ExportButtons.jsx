import { useState } from 'react'
import { Download } from 'lucide-react'
import { downloadCsv, saveCsv, sessionsToCsv, reviewsToCsv, exportFilename } from '../utils/csv.js'
import { sessionsApi } from '../api/sessions.js'
import { reviewsApi } from '../api/reviews.js'

// Three exports for the pipeline: trades (already in memory), and the
// session plans and price action reviews, fetched in full when asked for.
export default function ExportButtons({ trades, includeLegacy, exportableCount }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const fetchAndSave = async (which) => {
    setBusy(which); setError(null)
    try {
      if (which === 'sessions') saveCsv(sessionsToCsv(await sessionsApi.list({ all: true })), exportFilename(new Date(), 'sessions'))
      else saveCsv(reviewsToCsv(await reviewsApi.list({ all: true })), exportFilename(new Date(), 'reviews'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const btn = 'text-sm px-3 py-2 border border-line bg-surface-2 rounded-xl text-faint hover:bg-surface-3 hover:text-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5'
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted inline-flex items-center gap-1 mr-0.5"><Download size={13} strokeWidth={2} />CSV</span>
      <button type="button" className={btn} disabled={exportableCount === 0} onClick={() => downloadCsv(trades, { includeLegacy })}>
        Trades ({exportableCount})
      </button>
      <button type="button" className={btn} disabled={busy !== null} onClick={() => fetchAndSave('sessions')}>
        {busy === 'sessions' ? 'Exporting…' : 'Sessions'}
      </button>
      <button type="button" className={btn} disabled={busy !== null} onClick={() => fetchAndSave('reviews')}>
        {busy === 'reviews' ? 'Exporting…' : 'Reviews'}
      </button>
      {error && <span className="text-xs text-loss w-full">{error}</span>}
    </div>
  )
}
