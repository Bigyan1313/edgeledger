import { useState, useEffect } from 'react'
import { tradesApi } from '../api/trades.js'
import { fileToCompressedDataUrl } from '../utils/image.js'
import AccountSelector from './AccountSelector.jsx'

const pad = n => String(n).padStart(2, '0')

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time, not ISO/UTC.
function isoToLocalInput(iso) {
  return toLocalInput(new Date(iso))
}

// Default a fresh trade to "now", floored to the nearest 15 minutes — so the
// field is pre-filled and already snapped to the grid the user logs on.
function nowRoundedLocalInput() {
  const d = new Date()
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  return toLocalInput(d)
}

// Snap any local-datetime string to the nearest 15 minutes (keeps the value
// valid against the input's step so it never blocks submit).
function snapTo15(local) {
  if (!local) return local
  const d = new Date(local)
  if (isNaN(d.getTime())) return local
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0)
  return toLocalInput(d)
}

const DATETIME_STEP = 900 // 15 minutes, in seconds
const MAX_SCREENSHOTS = 5 // intentionally not surfaced in the UI

// Turn a saved trade (numbers, ISO date) into form state (strings, local date).
function tradeToForm(t) {
  return {
    accountId:         t.accountId ?? null,
    date:              isoToLocalInput(t.date),
    pair:              t.pair,
    direction:         t.direction,
    setup:             t.setup,
    setupNotes:        t.setupNotes ?? '',
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
    screenshots:       t.screenshots ?? [],
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

// Futures first (what the user actually trades), then forex, then Other.
const PAIRS = ['NQ', 'MNQ', 'ES', 'MES', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'USDCAD', 'Other']

function emptyForm() {
  return {
    accountId: null,
    date: nowRoundedLocalInput(),
    pair: 'NQ',
    direction: 'long',
    setup: 'A+ Session sweep + rejection retest',
    setupNotes: '',
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
    screenshots: [],
    notes: '',
  }
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

export default function TradeForm({ editTrade, accounts = [], onAddAccount, onCreated, onUpdated, onCancelEdit }) {
  const isEditing = Boolean(editTrade)
  const [form, setForm] = useState(editTrade ? tradeToForm(editTrade) : emptyForm())
  const [saving, setSaving] = useState(false)
  const [processingImg, setProcessingImg] = useState(false)
  const [error, setError] = useState(null)

  // When the trade being edited changes (or we switch in/out of edit mode),
  // reset the form to match. Runs whenever editTrade changes identity.
  useEffect(() => {
    setForm(editTrade ? tradeToForm(editTrade) : emptyForm())
    setError(null)
  }, [editTrade])

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  // Compress each picked image and append (silently capped at MAX_SCREENSHOTS).
  const addScreenshots = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    const room = MAX_SCREENSHOTS - form.screenshots.length
    if (room <= 0) return
    setProcessingImg(true)
    setError(null)
    try {
      const urls = []
      for (const file of files.slice(0, room)) {
        urls.push(await fileToCompressedDataUrl(file))
      }
      setForm(f => ({ ...f, screenshots: [...f.screenshots, ...urls].slice(0, MAX_SCREENSHOTS) }))
    } catch (err) {
      setError(err.message || 'Could not add image')
    } finally {
      setProcessingImg(false)
    }
  }

  const removeScreenshot = (i) =>
    setForm(f => ({ ...f, screenshots: f.screenshots.filter((_, idx) => idx !== i) }))

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
        setupNotes:  form.setupNotes.trim() || null,
        entryPrice:  form.entryPrice  ? parseFloat(form.entryPrice)  : null,
        stopLoss:    form.stopLoss    ? parseFloat(form.stopLoss)    : null,
        takeProfit:  form.takeProfit  ? parseFloat(form.takeProfit)  : null,
        exitPrice:   form.exitPrice   ? parseFloat(form.exitPrice)   : null,
        lotSize:     form.lotSize     ? parseFloat(form.lotSize)     : null,
        riskDollars: form.riskDollars ? parseFloat(form.riskDollars) : null,
        pnl:         parseFloat(form.pnl),
        accountId:   form.accountId ?? null,
      }
      if (isEditing) {
        const updated = await tradesApi.update(editTrade.id, payload)
        onUpdated(updated)
      } else {
        const created = await tradesApi.create(payload)
        onCreated(created)
        setForm(emptyForm())
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
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">
          {isEditing ? `Edit Trade #${editTrade.id}` : 'Log Trade'}
        </h2>
        <div className="flex items-center gap-3">
          <AccountSelector
            accounts={accounts}
            value={form.accountId}
            onChange={(id) => set('accountId', id)}
            onAdd={onAddAccount}
          />
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

      {/* ── Trade basics ─────────────────────────────────────────── */}
      <Section title="Trade">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Date & Time" required>
            <input
              type="datetime-local"
              required
              step={DATETIME_STEP}
              value={form.date}
              onChange={e => set('date', snapTo15(e.target.value))}
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
      </Section>

      {/* ── Setup + why it qualified ─────────────────────────────── */}
      <Section title="Setup">
        <Field label="Setup">
          <select value={form.setup} onChange={e => set('setup', e.target.value)} className={input}>
            {SETUPS.map(s => (
              <option key={s} value={s} className={DANGER_SETUPS.has(s) ? 'text-red-400' : ''}>
                {DANGER_SETUPS.has(s) ? `⚠ ${s}` : s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Setup notes">
          <textarea
            rows={2}
            placeholder="Why did this setup qualify? Confluence, session, HTF bias…"
            value={form.setupNotes}
            onChange={e => set('setupNotes', e.target.value)}
            className={`${input} resize-none`}
          />
        </Field>
      </Section>

      {/* ── Prices ───────────────────────────────────────────────── */}
      <Section title="Prices" action={rr && (
        <span className="text-xs text-gray-400">
          Planned R:R <span className="text-emerald-400 font-semibold">{rr}R</span>
        </span>
      )}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
      </Section>

      {/* ── Result ───────────────────────────────────────────────── */}
      <Section title="Result" action={realR !== null && (
        <span className="text-xs text-gray-400">
          Realized R <span className={`font-semibold ${parseFloat(realR) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{realR}R</span>
        </span>
      )}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <Field label="Size (contracts)">
            <input
              type="number"
              step="any"
              placeholder="e.g. 2"
              value={form.lotSize}
              onChange={e => set('lotSize', e.target.value)}
              className={input}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="flex flex-wrap gap-6">
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
      </Section>

      {/* ── Screenshots ──────────────────────────────────────────── */}
      <Section title="Screenshots" subtitle="Attach chart screenshots of the trade.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {form.screenshots.map((src, i) => (
            <div key={i} className="relative group aspect-video rounded-lg overflow-hidden border border-gray-700 bg-gray-900">
              <img src={src} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeScreenshot(i)}
                aria-label="Remove screenshot"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          {form.screenshots.length < MAX_SCREENSHOTS && (
            <label className="aspect-video rounded-lg border-2 border-dashed border-gray-700 hover:border-emerald-500 cursor-pointer flex flex-col items-center justify-center text-gray-500 hover:text-emerald-400 transition-colors">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { addScreenshots(e.target.files); e.target.value = '' }}
              />
              {processingImg ? (
                <span className="text-xs">Adding…</span>
              ) : (
                <>
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-[11px] mt-1">Add image</span>
                </>
              )}
            </label>
          )}
        </div>
      </Section>

      {/* ── Notes ────────────────────────────────────────────────── */}
      <Section title="Notes">
        <Field label="Notes">
          <textarea
            rows={3}
            placeholder="What happened? What did you see?"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            className={`${input} resize-none`}
          />
        </Field>
      </Section>

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

function Section({ title, subtitle, action, children }) {
  return (
    <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
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
