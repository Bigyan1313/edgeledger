import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { tradesApi } from '../api/trades.js'

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time, not ISO/UTC.
function isoToLocalInput(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const num = (v) => (v === '' || v === null ? null : parseFloat(v))

// Stage B — the post-trade record.
//
// Deliberately a separate screen from Stage A. Schema alone cannot stop someone
// filling in their intent after seeing the result; taking the result through a
// different door, after the plan is already locked, can. The Stage A values are
// shown here read-only: they are context for the review, not fields to revisit.
//
// Two modes, same fields. `close` records the result for the first time;
// `review` edits it afterwards. Neither is an amendment — there is no intent to
// protect in a result, so revising one leaves no audit mark.
export default function CloseTradeForm({ trade, mode = 'close', onClosed, onCancel }) {
  const isReview = mode === 'review'
  const [form, setForm] = useState({
    exitTimeUtc: isoToLocalInput(trade.exitTimeUtc ?? new Date().toISOString()),
    exitPrice: trade.exitPrice ?? '',
    pnl: trade.pnl ?? '',
    exitNotes: trade.exitNotes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      const payload = {
        exitTimeUtc: form.exitTimeUtc ? new Date(form.exitTimeUtc).toISOString() : null,
        exitPrice: num(form.exitPrice),
        pnl: num(form.pnl),
        exitNotes: form.exitNotes,
      }
      const saved = isReview
        ? await tradesApi.update(trade.id, payload)
        : await tradesApi.close(trade.id, payload)
      onClosed(saved)
    } catch (err) {
      setError(err.message)
      setFieldErrors(Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message])))
    } finally {
      setSaving(false)
    }
  }

  const projectedR = (() => {
    const pnl = parseFloat(form.pnl)
    if (!Number.isFinite(pnl) || !trade.riskDollars) return null
    return (pnl / trade.riskDollars).toFixed(2)
  })()

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-bright tracking-tight">
            {isReview ? `Review Trade #${trade.id}` : `Close Trade #${trade.id}`}
          </h2>
          <p className="text-xs text-muted mt-1">
            {isReview
              ? 'Editing the result. The pre-trade entry stays locked.'
              : 'Stage 2 of 2. The plan is already on the record.'}
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="text-sm text-gray-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>

      {/* The locked plan, for reference only */}
      <div className="card p-5 space-y-3">
        <div className="text-[11px] text-muted">What you recorded before entry</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Readout label="Symbol" value={trade.pair} />
          <Readout label="Direction" value=<span className="inline-flex items-center gap-1">{trade.direction === 'long' ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownRight size={13} strokeWidth={2.5} />}{trade.direction === 'long' ? 'Long' : 'Short'}</span> />
          <Readout label="Entry" value={trade.entryPrice} />
          <Readout label="Stop" value={trade.stopLoss} />
          <Readout label="Target" value={trade.takeProfit ?? '—'} />
          <Readout label="Lots" value={trade.lotSize} />
          <Readout label="Risk" value={trade.riskDollars != null ? `$${trade.riskDollars}` : '—'} />
          <Readout label="Position ID" value={trade.brokerPositionId} />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm pt-1">
          <Readout label="Technical setup" value={trade.technicalSetup} />
          <Readout label="Emotional state" value={trade.emotionalState} />
        </div>
        {trade.notes && (
          <div className="text-sm text-gray-400 border-t border-line pt-3">
            <span className="text-[11px] text-muted block mb-1">Pre-trade notes</span>
            {trade.notes}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-loss/40 bg-loss-bg/80 px-4 py-3 text-loss/90 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Field label="Exit Time" required error={fieldErrors.exitTimeUtc}>
          <input type="datetime-local" required value={form.exitTimeUtc}
            onChange={e => set('exitTimeUtc', e.target.value)} className={inputCls(fieldErrors.exitTimeUtc)} />
        </Field>
        <Field label="Exit Price" required error={fieldErrors.exitPrice}>
          <input type="number" step="any" required value={form.exitPrice}
            onChange={e => set('exitPrice', e.target.value)} className={inputCls(fieldErrors.exitPrice)} />
        </Field>
        <Field label="Realised P&L ($)" required error={fieldErrors.pnl}>
          <input type="number" step="any" required placeholder="e.g. 165 or -55" value={form.pnl}
            onChange={e => set('pnl', e.target.value)} className={inputCls(fieldErrors.pnl)} />
        </Field>
      </div>

      {projectedR !== null && (
        <div className="text-sm text-gray-400">
          That is{' '}
          <span className={`font-semibold ${parseFloat(projectedR) >= 0 ? 'text-gain' : 'text-loss'}`}>
            {projectedR}R
          </span>{' '}
          against ${trade.riskDollars} of risk.
        </div>
      )}

      <Field label="Post-trade review">
        <textarea rows={3} placeholder="What actually happened? What would you do differently?"
          value={form.exitNotes} onChange={e => set('exitNotes', e.target.value)}
          className={`${inputCls()} resize-none`} />
      </Field>

      <button type="submit" disabled={saving}
        className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition-colors">
        {saving ? 'Saving…' : isReview ? 'Save Review' : 'Close Trade'}
      </button>
    </form>
  )
}

function Readout({ label, value }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-gray-200 truncate" title={String(value ?? '')}>{value ?? '—'}</div>
    </div>
  )
}

function Field({ label, required, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

const baseInput = 'bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none w-full transition-colors'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-loss/70 focus:border-loss' : 'border-line focus:border-violet-soft/70'}`
