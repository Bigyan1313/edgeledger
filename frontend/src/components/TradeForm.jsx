import { useState, useEffect } from 'react'
import { tradesApi } from '../api/trades.js'
import AccountSelector from './AccountSelector.jsx'
import { fileToCompressedDataUrl } from '../utils/image.js'
import {
  BROKER_PLATFORMS,
  EMOTIONAL_STATES,
  RISKY_EMOTIONAL_STATES,
  RISKY_TECHNICAL_SETUPS,
  SYMBOL_SUGGESTIONS,
  TECHNICAL_SETUPS,
  detectTimezone,
} from '../constants/trade.js'

const MAX_SCREENSHOTS = 5 // intentionally not surfaced in the UI

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time, not ISO/UTC.
function isoToLocalInput(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Task 3 + Task 4: nothing here is pre-selected. An empty string is "not
// answered yet", and the server rejects it — which is the point. A default
// would come back as data indistinguishable from an observation, which is how
// v1 ended up with `Calm` on all 44 rows.
const EMPTY = {
  accountId: null,
  brokerPositionId: '',
  brokerAccountId: '',
  brokerPlatform: 'cTrader',
  pair: '',
  direction: 'long',
  entryTimeUtc: '',
  entryPrice: '',
  stopLoss: '',
  takeProfit: '',
  lotSize: '',
  technicalSetup: '',
  emotionalState: '',
  followedChecklist: '',
  fullPort: '',
  notes: '',
  setupNotes: '',
  screenshots: [],
}

// Turn a saved trade into form state (strings, local datetime) for amending.
function tradeToForm(t) {
  return {
    accountId: t.accountId ?? null,
    brokerPositionId: t.brokerPositionId ?? '',
    brokerAccountId: t.brokerAccountId ?? '',
    brokerPlatform: t.brokerPlatform ?? 'cTrader',
    pair: t.pair ?? '',
    direction: t.direction ?? 'long',
    entryTimeUtc: t.entryTimeUtc ? isoToLocalInput(t.entryTimeUtc) : '',
    entryPrice: t.entryPrice ?? '',
    stopLoss: t.stopLoss ?? '',
    takeProfit: t.takeProfit ?? '',
    lotSize: t.lotSize ?? '',
    technicalSetup: t.technicalSetup ?? '',
    emotionalState: t.emotionalState ?? '',
    followedChecklist: t.followedChecklist == null ? '' : String(t.followedChecklist),
    fullPort: t.fullPort == null ? '' : String(t.fullPort),
    notes: t.notes ?? '',
    setupNotes: t.setupNotes ?? '',
    screenshots: t.screenshots ?? [],
  }
}

function plannedRR(form) {
  const { direction, entryPrice: e, stopLoss: sl, takeProfit: tp } = form
  const entry = parseFloat(e), stop = parseFloat(sl), target = parseFloat(tp)
  if (!entry || !stop || !target) return null
  const risk = direction === 'long' ? entry - stop : stop - entry
  const reward = direction === 'long' ? target - entry : entry - target
  if (risk <= 0 || reward <= 0) return null
  return (reward / risk).toFixed(2)
}

const num = (v) => (v === '' || v === null ? null : parseFloat(v))
const bool = (v) => (v === '' ? null : v === 'true')

export default function TradeForm({ amendTrade, accounts = [], onAddAccount, onCreated, onAmended, onCancelAmend }) {
  const isAmending = Boolean(amendTrade)
  const [form, setForm] = useState(amendTrade ? tradeToForm(amendTrade) : EMPTY)
  const [reason, setReason] = useState('')
  const [timezone, setTimezone] = useState(detectTimezone())
  const [saving, setSaving] = useState(false)
  const [processingImg, setProcessingImg] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    setForm(amendTrade ? tradeToForm(amendTrade) : EMPTY)
    setTimezone(amendTrade?.captureTimezone || detectTimezone())
    setReason('')
    setError(null)
    setFieldErrors({})
  }, [amendTrade])

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

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

  const stampNow = () => set('entryTimeUtc', isoToLocalInput(new Date().toISOString()))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      const payload = {
        accountId: form.accountId ?? null,
        brokerPositionId: form.brokerPositionId,
        brokerAccountId: form.brokerAccountId,
        brokerPlatform: form.brokerPlatform,
        pair: form.pair,
        direction: form.direction,
        // The input is local wall-clock time; this is where it becomes an
        // unambiguous instant. captureTimezone records which wall clock it was.
        entryTimeUtc: form.entryTimeUtc ? new Date(form.entryTimeUtc).toISOString() : null,
        captureTimezone: timezone,
        entryPrice: num(form.entryPrice),
        stopLoss: num(form.stopLoss),
        takeProfit: num(form.takeProfit),
        lotSize: num(form.lotSize),
        technicalSetup: form.technicalSetup,
        emotionalState: form.emotionalState,
        followedChecklist: bool(form.followedChecklist),
        fullPort: bool(form.fullPort),
        notes: form.notes,
        setupNotes: form.setupNotes.trim() || null,
        screenshots: form.screenshots,
      }

      if (isAmending) {
        const updated = await tradesApi.amend(amendTrade.id, payload, reason)
        onAmended(updated)
      } else {
        const created = await tradesApi.create(payload)
        onCreated(created)
        setForm(EMPTY)
      }
    } catch (err) {
      setError(err.message)
      setFieldErrors(Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message])))
    } finally {
      setSaving(false)
    }
  }

  const rr = plannedRR(form)
  const setupWarning = RISKY_TECHNICAL_SETUPS.has(form.technicalSetup)
  const stateWarning = RISKY_EMOTIONAL_STATES.has(form.emotionalState)

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">
            {isAmending ? `Amend Trade #${amendTrade.id}` : 'Log Trade — before you enter'}
          </h2>
          {!isAmending && (
            <p className="text-xs text-muted mt-1">
              Stage 1 of 2. Record the plan now; the result goes in after the exit.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AccountSelector
            accounts={accounts}
            value={form.accountId}
            onChange={(id) => set('accountId', id)}
            onAdd={onAddAccount}
          />
          {isAmending && (
            <button type="button" onClick={onCancelAmend}
              className="text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>

      {isAmending && (
        <div className="bg-amber-950/60 border border-amber-700/60 rounded-lg px-4 py-3 text-amber-300 text-sm space-y-2">
          <p>
            <strong>This is an amendment.</strong> These fields locked when the pre-trade entry was
            saved. Every change is recorded with its original value, and the trade is permanently
            marked as amended — the analysis pipeline can filter it out.
          </p>
        </div>
      )}

      {(setupWarning || stateWarning) && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm flex items-start gap-2">
          <span className="text-red-400">⚠</span>
          <span>
            {stateWarning && <><strong>{form.emotionalState}.</strong> Logging it is the right call — taking it may not be. </>}
            {setupWarning && <><strong>{form.technicalSetup}.</strong> No confirmed structure behind this one.</>}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Broker linkage — the join key to execution data */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-300 mb-2">Broker linkage</legend>
        <p className="text-xs text-muted -mt-1 mb-2">
          Copy the platform's own Position ID. Without it this entry can never be matched to the
          execution record.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Position ID" required error={fieldErrors.brokerPositionId}>
            <input value={form.brokerPositionId} onChange={e => set('brokerPositionId', e.target.value)}
              placeholder="e.g. 184052117" className={inputCls(fieldErrors.brokerPositionId)} />
          </Field>
          <Field label="Broker Account" required error={fieldErrors.brokerAccountId}>
            <input value={form.brokerAccountId} onChange={e => set('brokerAccountId', e.target.value)}
              placeholder="e.g. 5039284" className={inputCls(fieldErrors.brokerAccountId)} />
          </Field>
          <Field label="Platform" required error={fieldErrors.brokerPlatform}>
            <select value={form.brokerPlatform} onChange={e => set('brokerPlatform', e.target.value)}
              className={inputCls(fieldErrors.brokerPlatform)}>
              {BROKER_PLATFORMS.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>

      {/* Instrument, time, direction */}
      <div className="grid grid-cols-3 gap-4 items-end">
        <Field label="Symbol" required error={fieldErrors.pair}
          hint="exact broker string">
          <input list="symbol-suggestions" value={form.pair}
            onChange={e => set('pair', e.target.value)}
            placeholder="e.g. XAUUSD.pro" className={inputCls(fieldErrors.pair)} />
          <datalist id="symbol-suggestions">
            {SYMBOL_SUGGESTIONS.map(s => <option key={s} value={s} />)}
          </datalist>
        </Field>
        <Field label="Entry Time" required error={fieldErrors.entryTimeUtc}
          hint={timezone}>
          <div className="flex gap-1 min-w-0">
            <input type="datetime-local" required value={form.entryTimeUtc}
              onChange={e => set('entryTimeUtc', e.target.value)}
              className={`${inputCls(fieldErrors.entryTimeUtc)} min-w-0`} />
            <button type="button" onClick={stampNow} title="Stamp the current time"
              className="px-2 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 shrink-0">
              Now
            </button>
          </div>
        </Field>
        <Field label="Direction" required>
          <div className="flex gap-2 pt-1">
            {['long', 'short'].map(dir => (
              <button key={dir} type="button" onClick={() => set('direction', dir)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.direction === dir
                    ? dir === 'long'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-red-500/20 border-red-500 text-red-400'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}>
                {dir === 'long' ? '▲ Long' : '▼ Short'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Prices and size — all required in v2 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">Levels &amp; size</span>
          {rr && (
            <span className="text-xs text-gray-400">
              Planned R:R <span className="text-emerald-400 font-semibold">{rr}R</span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Entry" required error={fieldErrors.entryPrice}>
            <input type="number" step="any" value={form.entryPrice}
              onChange={e => set('entryPrice', e.target.value)} className={inputCls(fieldErrors.entryPrice)} />
          </Field>
          <Field label="Stop Loss" required error={fieldErrors.stopLoss}>
            <input type="number" step="any" value={form.stopLoss}
              onChange={e => set('stopLoss', e.target.value)} className={inputCls(fieldErrors.stopLoss)} />
          </Field>
          <Field label="Take Profit" error={fieldErrors.takeProfit}>
            <input type="number" step="any" placeholder="optional" value={form.takeProfit}
              onChange={e => set('takeProfit', e.target.value)} className={inputCls(fieldErrors.takeProfit)} />
          </Field>
          <Field label="Lot Size" required error={fieldErrors.lotSize}>
            <input type="number" step="any" min="0" placeholder="e.g. 0.10" value={form.lotSize}
              onChange={e => set('lotSize', e.target.value)} className={inputCls(fieldErrors.lotSize)} />
          </Field>
        </div>
        <p className="text-xs text-muted mt-2">
          Risk in dollars is computed from these — it is not something you type.
        </p>
      </div>

      {/* Task 3: two orthogonal axes, neither pre-selected */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Technical Setup" required error={fieldErrors.technicalSetup}
          hint="What the chart was doing">
          <select value={form.technicalSetup} onChange={e => set('technicalSetup', e.target.value)}
            className={inputCls(fieldErrors.technicalSetup)}>
            <option value="" disabled>Choose…</option>
            {TECHNICAL_SETUPS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Emotional State" required error={fieldErrors.emotionalState}
          hint="What you were doing">
          <select value={form.emotionalState} onChange={e => set('emotionalState', e.target.value)}
            className={inputCls(fieldErrors.emotionalState)}>
            <option value="" disabled>Choose…</option>
            {EMOTIONAL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      {/* Task 4: no default, so both are a real answer */}
      <div className="grid grid-cols-2 gap-4">
        <YesNo label="Followed checklist?" value={form.followedChecklist}
          error={fieldErrors.followedChecklist} onChange={v => set('followedChecklist', v)} />
        <YesNo label="Full port?" value={form.fullPort} tone="danger"
          error={fieldErrors.fullPort} onChange={v => set('fullPort', v)} />
      </div>

      <Field label="Pre-trade notes">
        <textarea rows={3} placeholder="What do you see? Why this entry, now?"
          value={form.notes} onChange={e => set('notes', e.target.value)}
          className={`${inputCls()} resize-none`} />
      </Field>

      <Field label="Setup notes" hint="why this setup qualified">
        <textarea rows={2} placeholder="What made this a valid instance of the setup?"
          value={form.setupNotes} onChange={e => set('setupNotes', e.target.value)}
          className={`${inputCls()} resize-none`} />
      </Field>

      {/* Screenshots are evidence, not an intent claim, so they stay editable
          after Stage A without costing an amendment. */}
      <Field label="Screenshots" hint="chart context">
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
      </Field>

      {isAmending && (
        <Field label="Reason for amendment" required error={fieldErrors.reason}>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Transposed the stop when I typed it in"
            className={inputCls(fieldErrors.reason)} />
        </Field>
      )}

      <button type="submit" disabled={saving}
        className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold rounded-lg transition-colors">
        {saving ? 'Saving…' : isAmending ? 'Record Amendment' : 'Save Pre-Trade Entry'}
      </button>

      {!isAmending && (
        <p className="text-xs text-muted text-center -mt-3">
          These fields lock once saved. Changing one later needs an amendment, and leaves a record.
        </p>
      )}
    </form>
  )
}

// A tri-state control: yes, no, or nothing chosen yet. A checkbox cannot
// express the third state, which is exactly how v1's booleans ended up
// carrying no information.
function YesNo({ label, value, onChange, error, tone = 'normal' }) {
  const options = [['true', 'Yes'], ['false', 'No']]
  const activeCls = (v) =>
    tone === 'danger' && v === 'true'
      ? 'bg-red-500/20 border-red-500 text-red-400'
      : 'bg-emerald-500/20 border-emerald-500 text-emerald-400'

  return (
    <Field label={label} required error={error}>
      <div className="flex gap-2 pt-1">
        {options.map(([v, text]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
              value === v ? activeCls(v) : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}>
            {text}
          </button>
        ))}
      </div>
    </Field>
  )
}

function Field({ label, required, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        {hint && <span className="ml-2 normal-case tracking-normal text-gray-600">{hint}</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

const baseInput = 'bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none w-full'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-red-600 focus:border-red-500' : 'border-gray-700 focus:border-emerald-500'}`
