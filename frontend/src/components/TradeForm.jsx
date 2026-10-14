import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ArrowRight, ImageUp, Lock, OctagonX, X } from 'lucide-react'
import { tradesApi } from '../api/trades.js'
import { sessionsApi } from '../api/sessions.js'
import AccountSelector from './AccountSelector.jsx'
import { fileToCompressedDataUrl } from '../utils/image.js'
import { isoToZonedInput, possibleInstantsForLocal, zonedInputToIso } from '../utils/datetime.js'
import { applyExtractedFields, notesForImport } from '../utils/extraction.js'
import ScreenshotImport from './ScreenshotImport.jsx'
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
  entryInstant: null,
  journaledAfterOutcome: false,
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

// A blank entry seeded with whatever the trader set as their defaults. Only the
// fields that are genuinely the same every time — the platform and the broker
// account. Never the setup or the emotional state: those are judgements about
// this trade, and a remembered answer is indistinguishable from a fresh one.
// The account is a context, not an answer about the trade: it is whichever
// account the trader is working on, so it carries over from the session plan
// rather than starting blank and making "Log a trade under this plan" land on
// a form that says there is no plan.
function emptyFormFor(profile, accountId = null) {
  return {
    ...EMPTY,
    accountId,
    brokerPlatform: profile?.defaultBrokerPlatform || EMPTY.brokerPlatform,
    brokerAccountId: profile?.defaultBrokerAccountId || '',
  }
}

// Turn a saved trade into form state (strings, local datetime) for amending.
function tradeToForm(t, timezone) {
  return {
    accountId: t.accountId ?? null,
    brokerPositionId: t.brokerPositionId ?? '',
    brokerAccountId: t.brokerAccountId ?? '',
    brokerPlatform: t.brokerPlatform ?? 'cTrader',
    pair: t.pair ?? '',
    direction: t.direction ?? 'long',
    entryTimeUtc: t.entryTimeUtc ? isoToZonedInput(t.entryTimeUtc, timezone) : '',
    entryInstant: t.entryTimeUtc ?? null,
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

export default function TradeForm({ amendTrade, accounts = [], onAddAccount, onCreated, onAmended, onCancelAmend, onGoSession, activeAccountId = null, onAccountChange, profile = null }) {
  const isAmending = Boolean(amendTrade)
  const [timezone] = useState(() => amendTrade?.captureTimezone || profile?.timezone || detectTimezone())
  const [form, setForm] = useState(() => amendTrade ? tradeToForm(amendTrade, timezone) : emptyFormFor(profile, activeAccountId))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [processingImg, setProcessingImg] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  // Today's session for the selected account, shown above the form so the plan
  // is in view at the moment of entry — and the gate's refusal, if the save is
  // turned away.
  const [gate, setGate] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [gateVersion, setGateVersion] = useState(0)

  useEffect(() => {
    if (isAmending) return
    let cancelled = false
    sessionsApi.today(form.accountId)
      .then(ctx => { if (!cancelled) setGate(ctx) })
      .catch(() => { if (!cancelled) setGate(null) })
    return () => { cancelled = true }
  }, [isAmending, form.accountId, gateVersion])

  const entryChoices = useMemo(() => {
    if (!form.entryTimeUtc) return []
    try { return possibleInstantsForLocal(form.entryTimeUtc, timezone) } catch { return [] }
  }, [form.entryTimeUtc, timezone])

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value, ...(field === 'entryTimeUtc' ? { entryInstant: null } : {}) }))
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

  // Apply an extraction to the form. Null fields are skipped rather than
  // written, so an import never wipes something the user already typed.
  const applyExtraction = (fields) => {
    setForm(f => applyExtractedFields(f, fields, timezone))
    setFieldErrors({})
    setImporting(false)
  }

  const stampNow = () => {
    const instant = new Date().toISOString()
    setForm(f => ({ ...f, entryTimeUtc: isoToZonedInput(instant, timezone), entryInstant: instant }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    return submit({ acknowledgeRuleBreak: false })
  }

  // acknowledgeRuleBreak is only ever sent from the refusal panel, after the
  // server has said which rules this trade breaks. It records a trade that was
  // already taken; it does not make the rules go away.
  const submit = async ({ acknowledgeRuleBreak }) => {
    setError(null)
    setFieldErrors({})
    setRefusal(null)
    setSaving(true)
    try {
      const payload = {
        accountId: form.accountId ?? null,
        brokerPositionId: form.brokerPositionId,
        brokerAccountId: form.brokerAccountId,
        brokerPlatform: form.brokerPlatform,
        pair: form.pair,
        direction: form.direction,
        entryTimeUtc: form.entryTimeUtc ? zonedInputToIso(form.entryTimeUtc, timezone, form.entryInstant) : null,
        captureTimezone: timezone,
        entryPrice: num(form.entryPrice),
        stopLoss: num(form.stopLoss),
        takeProfit: num(form.takeProfit),
        lotSize: num(form.lotSize),
        technicalSetup: form.technicalSetup,
        emotionalState: form.emotionalState,
        followedChecklist: bool(form.followedChecklist),
        fullPort: bool(form.fullPort),
        notes: notesForImport(form.notes, form.journaledAfterOutcome),
        setupNotes: form.setupNotes.trim() || null,
        screenshots: form.screenshots,
        ...(acknowledgeRuleBreak ? { acknowledgeRuleBreak: true } : {}),
      }

      if (isAmending) {
        const updated = await tradesApi.amend(amendTrade.id, payload, reason)
        onAmended(updated)
      } else {
        const created = await tradesApi.create(payload)
        onCreated(created)
        setForm(emptyFormFor(profile, form.accountId))
        setGateVersion(v => v + 1)
      }
    } catch (err) {
      if (err.code === 'SESSION_RULES') {
        setRefusal({ violations: err.violations, session: err.session })
      } else {
        setError(err.message)
        setFieldErrors(Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message])))
      }
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
          <h2 className="text-xl font-semibold text-bright tracking-tight">
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
            onChange={(id) => { set('accountId', id); if (!isAmending) onAccountChange?.(id) }}
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

      {!isAmending && <GateStrip gate={gate} onGoSession={onGoSession} />}

      {!isAmending && (
        importing ? (
          <ScreenshotImport onApply={applyExtraction} onDismiss={() => setImporting(false)} />
        ) : (
          <button type="button" onClick={() => setImporting(true)}
            className="w-full py-2.5 border border-dashed border-line-soft rounded-xl text-sm text-faint hover:border-violet-soft/60 hover:text-violet-soft bg-surface-2/40 transition-colors">
            <span className="inline-flex items-center gap-2"><ImageUp size={15} strokeWidth={2} />Import from a screenshot instead of typing</span>
          </button>
        )
      )}

      {isAmending && (
        <div className="rounded-xl border border-warn/35 bg-warn-bg/70 px-4 py-3 text-warn/90 text-sm space-y-2">
          <p>
            <strong>This is an amendment.</strong> These fields locked when the pre-trade entry was
            saved. Every change is recorded with its original value, and the trade is permanently
            marked as amended — the analysis pipeline can filter it out.
          </p>
        </div>
      )}

      {(setupWarning || stateWarning) && (
        <div className="rounded-xl border border-loss/40 bg-loss-bg/80 px-4 py-3 text-loss/90 text-sm flex items-start gap-2">
          <AlertTriangle size={16} strokeWidth={2} className="text-loss mt-0.5 shrink-0" />
          <span>
            {stateWarning && <><strong>{form.emotionalState}.</strong> Logging it is the right call — taking it may not be. </>}
            {setupWarning && <><strong>{form.technicalSetup}.</strong> No confirmed structure behind this one.</>}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-loss/40 bg-loss-bg/80 px-4 py-3 text-loss/90 text-sm">
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
            <input type="datetime-local" step="any" required value={form.entryTimeUtc}
              onChange={e => set('entryTimeUtc', e.target.value)}
              className={`${inputCls(fieldErrors.entryTimeUtc)} min-w-0`} />
            <button type="button" onClick={stampNow} title="Stamp the current time"
              className="px-2 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 shrink-0">
              Now
            </button>
          </div>
          {entryChoices.length > 1 && (
            <select aria-label="Entry time occurrence" required value={form.entryInstant ? new Date(form.entryInstant).toISOString() : ''}
              onChange={e => set('entryInstant', e.target.value)} className={inputCls(fieldErrors.entryTimeUtc)}>
              <option value="">Repeated time — choose occurrence</option>
              {entryChoices.map((instant, index) => (
                <option key={instant} value={instant}>{index === 0 ? 'First' : 'Second'} ({instant.slice(11, 19)} UTC)</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Direction" required>
          <div className="flex gap-2 pt-1">
            {['long', 'short'].map(dir => (
              <button key={dir} type="button" onClick={() => set('direction', dir)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.direction === dir
                    ? dir === 'long'
                      ? 'bg-gain-bg border-gain/60 text-gain'
                      : 'bg-loss-bg border-loss/60 text-loss'
                    : 'border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-faint'
                }`}>
                <span className="inline-flex items-center justify-center gap-1">{dir === 'long' ? <ArrowUpRight size={14} strokeWidth={2.5} /> : <ArrowDownRight size={14} strokeWidth={2.5} />}{dir === 'long' ? 'Long' : 'Short'}</span>
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
              Planned R:R <span className="text-gain font-semibold">{rr}R</span>
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
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {form.screenshots.length < MAX_SCREENSHOTS && (
            <label className="aspect-video rounded-lg border-2 border-dashed border-line-soft hover:border-violet-soft/60 cursor-pointer flex flex-col items-center justify-center text-muted hover:text-violet-soft transition-colors">
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

      {refusal ? (
        <RefusalPanel
          refusal={refusal}
          saving={saving}
          onBack={() => setRefusal(null)}
          onLogAsBreak={() => submit({ acknowledgeRuleBreak: true })}
          onGoSession={onGoSession}
        />
      ) : (
        <button type="submit" disabled={saving}
          className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition-colors">
          {saving ? 'Saving…' : isAmending ? 'Record Amendment' : 'Save Pre-Trade Entry'}
        </button>
      )}

      {!isAmending && (
        <p className="text-xs text-muted text-center -mt-3">
          These fields lock once saved. Changing one later needs an amendment, and leaves a record.
        </p>
      )}
    </form>
  )
}

// Where today stands for the selected account, in one line — plus the
// trader's own no-trade condition while it still applies. This is the moment
// the plan was written for.
function GateStrip({ gate, onGoSession }) {
  if (!gate) return null
  const { session, gateActive } = gate
  const link = (
    <button type="button" onClick={onGoSession}
      className="shrink-0 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
      {session ? 'Open plan' : 'Write the plan'} <ArrowRight size={13} strokeWidth={2.25} />
    </button>
  )

  if (!session && gate.blockedElsewhere) {
    return (
      <div className="rounded-xl border border-loss/40 bg-loss-bg/70 px-4 py-2.5 text-sm text-loss/90 flex items-center gap-2">
        <OctagonX size={15} strokeWidth={2.25} />No-trade day — recorded on {gate.blockedElsewhere}. That holds for every account.
      </div>
    )
  }
  if (!session && !gateActive) {
    return (
      <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-2.5 text-sm text-muted flex items-center justify-between gap-3">
        <span>No session plan yet. Writing one before the open turns on the 2-trade limit.</span>
        <span className="text-violet-soft">{link}</span>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="rounded-xl border border-loss/40 bg-loss-bg/70 px-4 py-2.5 text-sm text-loss/90 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2"><OctagonX size={15} strokeWidth={2.25} />No plan for today on this account. A trade will be refused.</span>
        {link}
      </div>
    )
  }
  if (session.status === 'blocked') {
    return (
      <div className="rounded-xl border border-loss/40 bg-loss-bg/70 px-4 py-2.5 text-sm text-loss/90 flex items-center gap-2">
        <OctagonX size={15} strokeWidth={2.25} />No-trade day. {session.blockedReasons[0]}
      </div>
    )
  }
  if (session.status === 'closed') {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn-bg/60 px-4 py-2.5 text-sm text-warn/90">
        Today's session is closed. No more trades today.
      </div>
    )
  }
  if (!session.canTrade) {
    return (
      <div className="rounded-xl border border-loss/40 bg-loss-bg/70 px-4 py-2.5 text-sm text-loss/90 flex items-center gap-2">
        <OctagonX size={15} strokeWidth={2.25} />
        Limit reached — {session.tradesLogged} of {session.maxTrades} trades used. The day is done.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-violet/30 bg-violet/10 px-4 py-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-violet-soft">
        <span className="flex items-center gap-2 font-medium">
          <Lock size={14} strokeWidth={2.25} />
          Plan locked · <span className="tnum">{session.tradesRemaining} of {session.maxTrades}</span> trade{session.maxTrades === 1 ? '' : 's'} left today
        </span>
        {link}
      </div>
      <p className="text-faint"><span className="text-loss/90 font-medium">No trade if:</span> {session.noTradeIf}</p>
    </div>
  )
}

// The refusal. It shows the rule broken and the trader's own words from before
// the open, and offers exactly two ways forward: do not log it, or log it as
// the rule break it was. There is no third button that makes the rule go away.
function RefusalPanel({ refusal, saving, onBack, onLogAsBreak, onGoSession }) {
  const { violations, session } = refusal
  return (
    <div className="rounded-2xl border border-loss/50 bg-loss-bg/80 p-5 space-y-4">
      <p className="text-base font-semibold text-loss flex items-center gap-2">
        <OctagonX size={18} strokeWidth={2.25} /> Not logged — this breaks today's plan.
      </p>
      <ul className="text-sm text-loss/90 space-y-1 list-disc pl-5">
        {violations.map(v => <li key={v.code}>{v.message}</li>)}
      </ul>
      {session?.noTradeIf && (
        <blockquote className="border-l-2 border-loss/60 pl-3 text-sm text-bright">
          <span className="block text-xs text-muted mb-0.5">Your rule, written before the open:</span>
          {session.noTradeIf}
        </blockquote>
      )}
      {!session && (
        <button type="button" onClick={onGoSession}
          className="text-sm text-violet-soft hover:text-bright inline-flex items-center gap-1 transition-colors">
          Write today's plan first <ArrowRight size={13} strokeWidth={2.25} />
        </button>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
        <button type="button" onClick={onBack}
          className="py-2.5 rounded-xl bg-surface-2 border border-line text-bright font-semibold hover:bg-surface-3 transition-colors">
          Don't take it
        </button>
        <button type="button" disabled={saving} onClick={onLogAsBreak}
          className="py-2.5 rounded-xl border border-loss/50 text-loss/90 text-sm hover:bg-loss/15 disabled:opacity-50 transition-colors">
          {saving ? 'Logging…' : 'Already taken — log it as a rule break'}
        </button>
      </div>
      <p className="text-xs text-muted">
        Logging it as a rule break keeps the trade in your journal with the broken rule marked on it,
        permanently. That record is the point — a trade left out of the journal teaches nothing.
      </p>
    </div>
  )
}

// A tri-state control: yes, no, or nothing chosen yet. A checkbox cannot
// express the third state, which is exactly how v1's booleans ended up
// carrying no information.
function YesNo({ label, value, onChange, error, tone = 'normal' }) {
  const options = [['true', 'Yes'], ['false', 'No']]
  const activeCls = (v) =>
    tone === 'danger' && v === 'true'
      ? 'bg-loss-bg border-loss/60 text-loss'
      : 'bg-gain-bg border-gain/60 text-gain'

  return (
    <Field label={label} required error={error}>
      <div className="flex gap-2 pt-1">
        {options.map(([v, text]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
              value === v ? activeCls(v) : 'border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-faint'
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

const baseInput = 'bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none w-full transition-colors'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-loss/70 focus:border-loss' : 'border-line focus:border-violet-soft/70'}`
