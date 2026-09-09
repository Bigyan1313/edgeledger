import { useState } from 'react'
import { tradesApi } from '../api/trades.js'
import { fileToCompressedDataUrl } from '../utils/image.js'

// Which extracted fields map onto which form control, and what to call them
// when reporting what was and wasn't found.
const FIELD_LABELS = {
  brokerPositionId: 'Position ID',
  brokerAccountId: 'Broker account',
  brokerPlatform: 'Platform',
  pair: 'Symbol',
  direction: 'Direction',
  entryTimeUtc: 'Entry time',
  exitTimeUtc: 'Exit time',
  entryPrice: 'Entry price',
  stopLoss: 'Stop loss',
  takeProfit: 'Take profit',
  exitPrice: 'Exit price',
  lotSize: 'Lot size',
  pnl: 'P&L',
}

function displayValue(field, value) {
  if (value === null || value === undefined) return '—'
  if (field === 'entryTimeUtc' || field === 'exitTimeUtc') {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC'
  }
  return String(value)
}

// Reads a broker screenshot into the entry form.
//
// It prefills; it never saves. Everything below is built around the user seeing
// exactly what was read before any of it becomes a record — a wrong entry price
// that slips through corrupts every R-multiple derived from it afterwards, and
// looks identical to a right one once it is stored.
export default function ScreenshotImport({ onApply, onDismiss }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)

  const handleFile = async (file) => {
    if (!file) return
    setError(null); setResult(null); setBusy(true)
    try {
      const dataUrl = await fileToCompressedDataUrl(file)
      setPreview(dataUrl)
      setResult(await tradesApi.extract(dataUrl))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const found = result ? Object.entries(FIELD_LABELS).filter(([f]) => result.fields[f] != null) : []
  const missing = result ? Object.entries(FIELD_LABELS).filter(([f]) => result.fields[f] == null) : []

  return (
    <div className="bg-surface border border-line rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Import from a screenshot</h3>
          <p className="text-xs text-muted mt-1">
            Drop in your platform's position or history panel. Everything read is filled into the
            form below for you to check — nothing is saved until you save it.
          </p>
        </div>
        <button type="button" onClick={onDismiss}
          className="text-xs text-gray-500 hover:text-white transition-colors shrink-0">
          Close
        </button>
      </div>

      {!result && (
        <label className={`block rounded-lg border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
          busy ? 'border-gray-700 text-gray-600' : 'border-gray-700 hover:border-emerald-500 text-gray-500 hover:text-emerald-400'
        }`}>
          <input type="file" accept="image/*" className="hidden" disabled={busy}
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
          {busy ? 'Reading the screenshot…' : <><span className="text-2xl leading-none block mb-1">⇪</span><span className="text-xs">Choose a screenshot</span></>}
        </label>
      )}

      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            {preview && (
              <img src={preview} alt="Uploaded screenshot"
                className="w-32 rounded border border-gray-800 shrink-0" />
            )}
            <div className="text-sm">
              <div className="text-gray-200">
                Read <strong>{result.coverage.found}</strong> of {result.coverage.total} key fields.
              </div>
              <div className="text-xs text-muted mt-1">
                Check every value against your platform before saving.
              </div>
            </div>
          </div>

          {result.journaledAfterOutcome && (
            <div className="bg-amber-950/50 border border-amber-800/60 rounded-lg px-3 py-2 text-amber-300/90 text-xs">
              This screenshot shows a <strong>closed</strong> trade, so the entry is being written after
              the result was known. It will be saved with a <code>retroactive_journal</code> flag — that
              is accurate, not a problem, but it means the recorded intent is not contemporaneous.
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-400/90">
                  <strong>{FIELD_LABELS[w.field] ?? w.field}:</strong> {w.message}
                </li>
              ))}
            </ul>
          )}

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {found.map(([field, label]) => (
              <div key={field} className="flex justify-between gap-2 text-sm border-b border-line-soft py-1">
                <span className="text-muted text-xs">{label}</span>
                <span className="text-gray-100 truncate">{displayValue(field, result.fields[field])}</span>
              </div>
            ))}
          </div>

          {missing.length > 0 && (
            <p className="text-xs text-muted">
              Not found in the image, you'll need to fill these in:{' '}
              <span className="text-gray-400">{missing.map(([, l]) => l).join(', ')}</span>
            </p>
          )}

          <p className="text-xs text-muted">
            Your setup and emotional state are never read from a screenshot — no image contains them.
          </p>

          <div className="flex gap-2">
            <button type="button" onClick={() => onApply(result.fields)}
              className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold rounded-lg transition-colors">
              Fill the form with these
            </button>
            <button type="button" onClick={() => { setResult(null); setPreview(null) }}
              className="px-4 py-2 border border-gray-700 text-gray-300 text-sm rounded-lg hover:border-gray-500 transition-colors">
              Try another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
