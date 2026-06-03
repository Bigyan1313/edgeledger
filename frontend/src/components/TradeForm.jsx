import { useState, useEffect } from 'react'
import { tradesApi } from '../api/trades.js'

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time, not ISO/UTC.
function isoToLocalInput(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Turn a saved trade (numbers, ISO date) into form state (strings, local date).
function tradeToForm(t) {
  return {
    date:              isoToLocalInput(t.date),
    pair:              t.pair,
    direction:         t.direction,
    setup:             t.setup,
    entryPrice:        t.entryPrice  ?? '',
    stopLoss:          t.stopLoss    ?? '',
    takeProfit:        t.takeProfit  ?? '',
    exitPrice:         t.exitPrice   ?? '',
    lotSize:           t.lotSize     ?? '',
    riskDollars:       t.riskDollars ?? '',
    pnl:               t.pnl         ?? '',
    outcome:           t.outcome,
    emotionBefore:     t.emotionBefore ?? 'Calm',
    followedChecklist: t.followedChecklist,
    fullPort:          t.fullPort,
    notes:             t.notes ?? '',
  }
}

const SETUPS = [
  'A+ Session sweep + rejection retest',
  'Sweep → displacement → retest',
  'Break & retest',
  'Trend continuation',
  'Anticipation (no confirmation)',
  'FOMO / Impulsive',
  'News / Full-port',
  'Revenge',
  'Other',
]

const DANGER_SETUPS = new Set([
  'Anticipation (no confirmation)',
  'FOMO / Impulsive',
  'News / Full-port',
  'Revenge',
])

const PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'USDCAD', 'Other']

const EMPTY = {
  date: '',
  pair: 'XAUUSD',
  direction: 'long',
  setup: 'A+ Session sweep + rejection retest',
  entryPrice: '',
  stopLoss: '',
  takeProfit: '',
  exitPrice: '',
  lotSize: '',
  riskDollars: '',
  pnl: '',
  outcome: 'Win',
  emotionBefore: 'Calm',
  followedChecklist: false,
  fullPort: false,
  notes: '',
}

function plannedRR(form) {
  const { direction, entryPrice: e, stopLoss: sl, takeProfit: tp } = form
  const entry = parseFloat(e), stop = parseFloat(sl), target = parseFloat(tp)
  if (!entry || !stop || !target) return null
  const risk   = direction === 'long' ? entry - stop  : stop  - entry
  const reward = direction === 'long' ? target - entry : entry - target
  if (risk <= 0 || reward <= 0) return null
  return (reward / risk).toFixed(2)
}

function realizedR(form) {
  const { direction, entryPrice: e, stopLoss: sl, exitPrice: ex, riskDollars: rd, pnl } = form
  const entry = parseFloat(e), stop = parseFloat(sl), exit = parseFloat(ex)
  if (entry && stop && exit) {
    const risk = direction === 'long' ? entry - stop : stop - entry
    if (risk <= 0) return null
    const result = direction === 'long' ? (exit - entry) / risk : (entry - exit) / risk
    return result.toFixed(2)
  }
  if (parseFloat(rd) && parseFloat(pnl)) {
    return (parseFloat(pnl) / parseFloat(rd)).toFixed(2)
  }
  return null
}

export default function TradeForm({ editTrade, onCreated, onUpdated, onCancelEdit }) {
  const isEditing = Boolean(editTrade)
  const [form, setForm] = useState(editTrade ? tradeToForm(editTrade) : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // When the trade being edited changes (or we switch in/out of edit mode),
  // reset the form to match. Runs whenever editTrade changes identity.
  useEffect(() => {
    setForm(editTrade ? tradeToForm(editTrade) : EMPTY)
    setError(null)
  }, [editTrade])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Guard rail: confirm before overwriting an existing trade.
    if (isEditing && !confirm('Do you really want to save changes to this trade? This overwrites the original.')) {
      return
    }

    setError(null)
    setSaving(true)
    try {
      const payload = {
        ...form,
        date:        new Date(form.date).toISOString(),
        entryPrice:  form.entryPrice  ? parseFloat(form.entryPrice)  : null,
        stopLoss:    form.stopLoss    ? parseFloat(form.stopLoss)    : null,
        takeProfit:  form.takeProfit  ? parseFloat(form.takeProfit)  : null,
        exitPrice:   form.exitPrice   ? parseFloat(form.exitPrice)   : null,
        lotSize:     form.lotSize     ? parseFloat(form.lotSize)     : null,
        riskDollars: form.riskDollars ? parseFloat(form.riskDollars) : null,
        pnl:         parseFloat(form.pnl),
      }
      if (isEditing) {
        const updated = await tradesApi.update(editTrade.id, payload)
        onUpdated(updated)
      } else {
        const created = await tradesApi.create(payload)
        onCreated(created)
        setForm(EMPTY)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const rr = plannedRR(form)
  const realR = realizedR(form)
  const isDanger = DANGER_SETUPS.has(form.setup)

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          {isEditing ? `Edit Trade #${editTrade.id}` : 'Log Trade'}
        </h2>
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {isEditing && (
        <div className="bg-amber-950/60 border border-amber-700/60 rounded-lg px-4 py-3 text-amber-300 text-sm">
          You're editing an existing trade. Saving will overwrite the original record.
        </div>
      )}

      {isDanger && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm flex items-center gap-2">
          <span className="text-red-400">⚠</span>
          <span><strong>Danger setup:</strong> {form.setup}. Make sure this is intentional.</span>
        </div>
      )}

      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Row 1: Date, Pair, Direction */}
      <div className="grid grid-cols-3 gap-4">
        <Field label="Date & Time" required>
          <input
            type="datetime-local"
            required
            value={form.date}
            onChange={e => set('date', e.target.value)}
            className={input}
          />
        </Field>
        <Field label="Pair">
          <select value={form.pair} onChange={e => set('pair', e.target.value)} className={input}>
            {PAIRS.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <div className="flex gap-2 pt-1">
            {['long', 'short'].map(dir => (
              <button
                key={dir}
                type="button"
                onClick={() => set('direction', dir)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.direction === dir
                    ? dir === 'long'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-red-500/20 border-red-500 text-red-400'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {dir === 'long' ? '▲ Long' : '▼ Short'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Setup */}
      <Field label="Setup">
        <select value={form.setup} onChange={e => set('setup', e.target.value)} className={input}>
          {SETUPS.map(s => (
            <option key={s} value={s} className={DANGER_SETUPS.has(s) ? 'text-red-400' : ''}>
              {DANGER_SETUPS.has(s) ? `⚠ ${s}` : s}
            </option>
          ))}
        </select>
      </Field>

      {/* Prices */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-400">Prices (optional)</span>
          {rr && (
            <span className="text-xs text-gray-400">
              Planned R:R <span className="text-emerald-400 font-semibold">{rr}R</span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[
            ['entryPrice', 'Entry'],
            ['stopLoss',   'Stop Loss'],
            ['takeProfit', 'Take Profit'],
            ['exitPrice',  'Exit'],
          ].map(([field, label]) => (
            <Field key={field} label={label}>
              <input
                type="number"
                step="any"
                placeholder="—"
                value={form[field]}
                onChange={e => set(field, e.target.value)}
                className={input}
              />
            </Field>
          ))}
        </div>
      </div>

      {/* P&L row */}
      <div className="grid grid-cols-3 gap-4">
        <Field label="P&L ($)" required>
          <input
            type="number"
            step="any"
            required
            placeholder="e.g. 165 or -55"
            value={form.pnl}
            onChange={e => {
              set('pnl', e.target.value)
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) set('outcome', v > 0 ? 'Win' : v < 0 ? 'Loss' : 'Break-even')
            }}
            className={input}
          />
        </Field>
        <Field label="Risk ($)">
          <input
            type="number"
            step="any"
            placeholder="e.g. 55"
            value={form.riskDollars}
            onChange={e => set('riskDollars', e.target.value)}
            className={input}
          />
        </Field>
        <Field label="Lot Size">
          <input
            type="number"
            step="any"
            placeholder="e.g. 0.10"
            value={form.lotSize}
            onChange={e => set('lotSize', e.target.value)}
            className={input}
          />
        </Field>
      </div>

      {/* Realized R display */}
      {realR !== null && (
        <div className="text-sm text-gray-400">
          Realized R: <span className={`font-semibold ${parseFloat(realR) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{realR}R</span>
        </div>
      )}

      {/* Outcome, Emotion */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Outcome">
          <select value={form.outcome} onChange={e => set('outcome', e.target.value)} className={input}>
            {['Win', 'Loss', 'Break-even'].map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Emotion Before">
          <select value={form.emotionBefore} onChange={e => set('emotionBefore', e.target.value)} className={input}>
            {['Calm', 'Tempted', 'Angry', 'Off'].map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
      </div>

      {/* Checkboxes */}
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.followedChecklist}
            onChange={e => set('followedChecklist', e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-400"
          />
          <span className="text-sm text-gray-300">Followed checklist</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.fullPort}
            onChange={e => set('fullPort', e.target.checked)}
            className="w-4 h-4 rounded accent-red-400"
          />
          <span className="text-sm text-gray-300">Full port</span>
        </label>
      </div>

      {/* Notes */}
      <Field label="Notes">
        <textarea
          rows={3}
          placeholder="What happened? What did you see?"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          className={`${input} resize-none`}
        />
      </Field>

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Log Trade'}
      </button>
    </form>
  )
}

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const input = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500 w-full'
