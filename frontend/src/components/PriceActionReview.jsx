import { useEffect, useState } from 'react'
import {
  CandlestickChart, Hourglass, CalendarCheck, Eye, GitBranch, OctagonX, Crosshair,
  Layers, Droplets, Lightbulb, Target, Pencil, Plus, ImageUp, X, CheckCircle2,
} from 'lucide-react'
import {
  reviewsApi, DAY_TYPES, LIQUIDITY_TAKEN, PLAN_OUTCOMES, MIN_SUMMARY, MAX_REVIEW_SCREENSHOTS,
} from '../api/reviews.js'
import { fileToCompressedDataUrl } from '../utils/image.js'

// The daily price action review: what the market did, written once the
// morning has played out and set beside what the plan expected.
//
// The server owns the window. This screen only shows it — a countdown before
// it opens, the form while it is open — and never offers a date to write for.

export default function PriceActionReview({ onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(null) // a saved review, or 'new'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    reviewsApi.today()
      .then(d => { if (!cancelled) { setData(d); setError(null) } })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [version])

  // The countdown ticks, and the screen reloads itself the moment the window
  // opens rather than waiting for the trader to notice.
  useEffect(() => {
    if (data?.window.state !== 'not_yet') return
    const opensAt = new Date(data.window.opensAt).getTime()
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= opensAt) setVersion(v => v + 1)
    }, 30_000)
    return () => clearInterval(id)
  }, [data])

  const saved = () => { setEditing(null); setVersion(v => v + 1); onChanged?.() }

  if (error) return <Shell><Notice tone="loss">{error}</Notice></Shell>
  if (!data) return <Shell><p className="text-sm text-muted">Loading today…</p></Shell>

  const { window, reviews, plans, planExists, recentDays, lastSymbol } = data
  const isOpen = window.state === 'open'
  // A blank form when nothing is written yet, or when asked for another symbol.
  const writingNew = isOpen && (editing === 'new' || (editing === null && reviews.length === 0))
  const offerAnother = isOpen && editing === null && reviews.length > 0

  return (
    <Shell window={window}>
      <RecentDays days={recentDays} />

      {window.state === 'weekend' && (
        <section className="card p-6 text-sm text-faint">Markets are closed today. No price action to review.</section>
      )}

      {window.state === 'not_yet' && (
        <section className="card p-6 space-y-2">
          <p className="text-base font-semibold text-bright flex items-center gap-2">
            <Hourglass size={18} strokeWidth={2} className="text-violet-soft" />
            Opens at {clock(window.opensAt, window.marketTimezone)}{' '}
            <span className="text-muted font-normal text-sm tnum">— in {until(window.opensAt, now)}</span>
          </p>
          <p className="text-sm text-muted">
            Three hours after the {window.marketOpenTime} open. Let the morning play out — a review
            written with positions open is commentary, not review.
          </p>
        </section>
      )}

      {isOpen && reviews.map(r => (
        editing?.id === r.id
          ? <ReviewForm key={r.id} review={r} plans={plans} planExists={planExists} onSaved={saved} onCancel={() => setEditing(null)} />
          : <SavedReview key={r.id} review={r} onEdit={() => setEditing(r)} />
      ))}

      {writingNew && (
        <ReviewForm key="new" plans={plans} planExists={planExists} defaultSymbol={reviews.length ? '' : (lastSymbol ?? '')}
          onSaved={saved} onCancel={reviews.length ? () => setEditing(null) : null} />
      )}

      {offerAnother && (
        <button type="button" onClick={() => setEditing('new')}
          className="w-full py-2.5 rounded-xl border border-line bg-surface-2 text-faint hover:text-bright hover:bg-surface-3 transition-colors flex items-center justify-center gap-2">
          <Plus size={15} strokeWidth={2.25} /> Review another symbol
        </button>
      )}

      {!isOpen && plans.length > 0 && <PlanReference plans={plans} title="Today's plan" />}
    </Shell>
  )
}

function Shell({ window, children }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-bright tracking-tight flex items-center gap-2">
          <CandlestickChart size={20} strokeWidth={2} className="text-violet-soft" />
          Price action review
        </h2>
        <p className="text-xs text-muted mt-1 tnum">
          {window
            ? `${formatDay(window.reviewDate)} · ${window.marketOpenTime} open, ${window.marketTimezone} · written ${clock(window.opensAt, window.marketTimezone)} to midnight`
            : ' '}
        </p>
      </div>
      {children}
    </div>
  )
}

// --- the form ------------------------------------------------------------------

function ReviewForm({ review = null, plans, planExists, defaultSymbol = '', onSaved, onCancel }) {
  const [form, setForm] = useState(() => ({
    symbol: review?.symbol ?? defaultSymbol,
    dayType: review?.dayType ?? null,
    summary: review?.summary ?? '',
    openBehavior: review?.openBehavior ?? '',
    keyLevels: review?.keyLevels ?? '',
    liquidityTaken: review?.liquidityTaken ?? null,
    planPlayedOut: review?.planPlayedOut ?? null,
    validSetup: review?.validSetup ?? null,
    lesson: review?.lesson ?? '',
    screenshots: review?.screenshots ?? [],
  }))
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(fe => { const n = { ...fe }; delete n[field]; return n })
  }

  const addCharts = async (files) => {
    const room = MAX_REVIEW_SCREENSHOTS - form.screenshots.length
    if (room <= 0) return
    setProcessing(true)
    try {
      const urls = []
      for (const file of Array.from(files).slice(0, room)) urls.push(await fileToCompressedDataUrl(file))
      setForm(f => ({ ...f, screenshots: [...f.screenshots, ...urls].slice(0, MAX_REVIEW_SCREENSHOTS) }))
    } catch (err) {
      setError(err.message || 'Could not add that image')
    } finally {
      setProcessing(false)
    }
  }

  const submit = async () => {
    setSaving(true); setError(null); setFieldErrors({})
    try {
      const payload = { ...form, planPlayedOut: planExists ? form.planPlayedOut : null }
      onSaved(review ? await reviewsApi.update(review.id, payload) : await reviewsApi.create(payload))
    } catch (err) {
      const fe = Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message]))
      setFieldErrors(fe)
      setError(Object.keys(fe).length ? null : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-bright">{review ? `Edit — ${review.symbol}` : 'What did the market do?'}</h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-bright transition-colors">Cancel</button>
        )}
      </div>

      <div className="grid sm:grid-cols-[10rem_1fr] gap-5">
        <Field label="Symbol" error={fieldErrors.symbol}>
          <input value={form.symbol} onChange={e => set('symbol', e.target.value)} placeholder="e.g. MNQZ6"
            className={inputCls(fieldErrors.symbol)} />
        </Field>
        <Field label="Day type" error={fieldErrors.dayType}>
          <Segmented options={DAY_TYPES} value={form.dayType} onChange={v => set('dayType', v)} wrap />
        </Field>
      </div>

      <Field label="What price did" icon={CandlestickChart} error={fieldErrors.summary}>
        <textarea rows={3} value={form.summary} onChange={e => set('summary', e.target.value)}
          placeholder="e.g. Swept the Asia low at 9:42, reclaimed by 10:05, trended into PDH by noon."
          className={inputCls(fieldErrors.summary)} />
        {form.summary.trim().length < MIN_SUMMARY && (
          <span className="text-[11px] text-muted tnum">{form.summary.trim().length}/{MIN_SUMMARY} characters minimum</span>
        )}
      </Field>

      <div className="grid sm:grid-cols-2 gap-5">
        <Field label="The open" hint="first 30–60 min" icon={Crosshair} error={fieldErrors.openBehavior}>
          <textarea rows={2} value={form.openBehavior} onChange={e => set('openBehavior', e.target.value)}
            placeholder="How did it open? Fast, slow, which way first?" className={inputCls(fieldErrors.openBehavior)} />
        </Field>
        <Field label="Key levels" hint="what mattered" icon={Layers} error={fieldErrors.keyLevels}>
          <textarea rows={2} value={form.keyLevels} onChange={e => set('keyLevels', e.target.value)}
            placeholder="Which levels held, broke, or got swept?" className={inputCls(fieldErrors.keyLevels)} />
        </Field>
      </div>

      <Field label="Liquidity taken" hint="optional" icon={Droplets} error={fieldErrors.liquidityTaken}>
        <Segmented options={LIQUIDITY_TAKEN} value={form.liquidityTaken}
          onChange={v => set('liquidityTaken', form.liquidityTaken === v ? null : v)} />
      </Field>

      {planExists && (
        <div className="rounded-2xl border border-violet/30 bg-violet/[0.07] p-4 space-y-4">
          <PlanReference plans={plans} title="Your plan from before the open" flat />
          <Field label="Did what you wanted to see actually happen?" icon={Eye} error={fieldErrors.planPlayedOut}>
            <Segmented options={PLAN_OUTCOMES} value={form.planPlayedOut} onChange={v => set('planPlayedOut', v)} />
          </Field>
        </div>
      )}

      <Field label="Was there a valid setup by your rules — taken or not?" icon={Target} error={fieldErrors.validSetup}>
        <Segmented options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
          value={form.validSetup} onChange={v => set('validSetup', v)} />
      </Field>

      <Field label="Lesson / watch tomorrow" hint="optional" icon={Lightbulb} error={fieldErrors.lesson}>
        <textarea rows={2} value={form.lesson} onChange={e => set('lesson', e.target.value)}
          placeholder="One thing to carry into tomorrow's plan." className={inputCls(fieldErrors.lesson)} />
      </Field>

      <Field label="Charts" hint={`up to ${MAX_REVIEW_SCREENSHOTS}`} error={fieldErrors.screenshots}>
        <div className="flex flex-wrap gap-3">
          {form.screenshots.map((src, i) => (
            <div key={i} className="relative w-28 h-20 rounded-xl overflow-hidden border border-line">
              <img src={src} alt={`Chart ${i + 1}`} className="w-full h-full object-cover" />
              <button type="button" aria-label={`Remove chart ${i + 1}`}
                onClick={() => set('screenshots', form.screenshots.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-loss">
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {form.screenshots.length < MAX_REVIEW_SCREENSHOTS && (
            <label className="w-28 h-20 rounded-xl border border-dashed border-line-soft bg-surface-2/40 text-muted hover:text-violet-soft hover:border-violet-soft/60 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors">
              <ImageUp size={18} strokeWidth={2} />
              <span className="text-[11px]">{processing ? 'Adding…' : 'Add chart'}</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addCharts(e.target.files); e.target.value = '' }} />
            </label>
          )}
        </div>
      </Field>

      {/* Counted live: fixing a field shrinks it, fixing the last one clears it. */}
      {Object.keys(fieldErrors).length > 0 && (
        <Notice tone="loss">
          Fix the {Object.keys(fieldErrors).length === 1 ? 'highlighted field' : `${Object.keys(fieldErrors).length} highlighted fields`} above.
        </Notice>
      )}
      {error && <Notice tone="loss">{error}</Notice>}

      <button type="button" disabled={saving || processing} onClick={submit}
        className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition">
        {saving ? 'Saving…' : review ? 'Save changes' : "Save today's review"}
      </button>
      <p className="text-xs text-muted text-center -mt-2">Editable until midnight in the market. After that it is closed.</p>
    </section>
  )
}

// --- what is already written ---------------------------------------------------------

function SavedReview({ review, onEdit }) {
  const label = (list, v) => list.find(o => o.value === v)?.label
  return (
    <section className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-bright">{review.symbol}</span>
          <Pill>{label(DAY_TYPES, review.dayType)}</Pill>
          {review.planPlayedOut && <Pill tone={review.planPlayedOut === 'yes' ? 'gain' : review.planPlayedOut === 'no' ? 'loss' : 'warn'}>plan: {review.planPlayedOut}</Pill>}
          <Pill tone={review.validSetup ? 'gain' : 'muted'}>{review.validSetup ? 'valid setup' : 'no valid setup'}</Pill>
        </div>
        <button type="button" onClick={onEdit}
          className="text-sm text-muted hover:text-bright inline-flex items-center gap-1.5 transition-colors shrink-0">
          <Pencil size={13} strokeWidth={2} /> Edit
        </button>
      </div>
      <p className="text-sm text-bright whitespace-pre-wrap">{review.summary}</p>
      {(review.openBehavior || review.keyLevels) && (
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {review.openBehavior && <Block icon={Crosshair} label="The open">{review.openBehavior}</Block>}
          {review.keyLevels && <Block icon={Layers} label="Key levels">{review.keyLevels}</Block>}
        </div>
      )}
      {review.liquidityTaken && <p className="text-xs text-muted uppercase tracking-wider">Liquidity · <span className="text-faint">{label(LIQUIDITY_TAKEN, review.liquidityTaken)}</span></p>}
      {review.lesson && <Block icon={Lightbulb} label="Lesson">{review.lesson}</Block>}
      {review.screenshots?.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {review.screenshots.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noreferrer" className="w-28 h-20 rounded-xl overflow-hidden border border-line block">
              <img src={src} alt={`Chart ${i + 1}`} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

function PlanReference({ plans, title, flat = false }) {
  return (
    <div className={flat ? 'space-y-3' : 'card p-6 space-y-3'}>
      <p className="text-xs font-medium uppercase tracking-wider text-violet-soft">{title}</p>
      {plans.map(p => (
        <div key={p.id} className="space-y-2 text-sm">
          {plans.length > 1 && <p className="text-xs text-muted">{p.account?.name ?? 'No account'}</p>}
          <p className="text-bright"><Eye size={13} strokeWidth={2.25} className="inline -mt-0.5 mr-1.5 text-muted" />{p.wantToSee}</p>
          <ul className="space-y-1">
            {p.scenarios.map((s, i) => (
              <li key={i} className="text-faint">
                <GitBranch size={12} strokeWidth={2.25} className="inline -mt-0.5 mr-1.5 text-muted" />
                <span className="text-violet-soft font-semibold">If</span> {s.if} <span className="text-violet-soft font-semibold">→</span> {s.then}
              </li>
            ))}
          </ul>
          <p className="text-faint"><OctagonX size={12} strokeWidth={2.25} className="inline -mt-0.5 mr-1.5 text-loss/80" /><span className="text-loss/90">No trade if</span> {p.noTradeIf}</p>
        </div>
      ))}
    </div>
  )
}

// Ten trading days, newest first. Missed is the word on purpose.
function RecentDays({ days }) {
  const style = {
    reviewed: 'bg-gain-bg text-gain border-gain/30',
    missed: 'bg-loss-bg/70 text-loss/90 border-loss/30',
    due: 'bg-violet/20 text-violet-soft border-violet/40',
    pending: 'bg-surface-2 text-muted border-line',
  }
  const reviewed = days.filter(d => d.status === 'reviewed').length
  return (
    <div>
      <p className="text-xs text-muted mb-2 flex items-center gap-1.5">
        <CalendarCheck size={13} strokeWidth={2} /> Last 10 trading days · <span className="tnum">{reviewed}/10</span> reviewed
      </p>
      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
        {[...days].reverse().map(d => (
          <div key={d.date} title={`${formatDay(d.date)} — ${d.status}`}
            className={`rounded-lg border px-1 py-1.5 text-center ${style[d.status]}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-80">{weekday(d.date)}</div>
            <div className="text-xs font-semibold tnum">{Number(d.date.slice(8))}</div>
            <div className="h-3 flex items-center justify-center">
              {d.status === 'reviewed' && <CheckCircle2 size={11} strokeWidth={2.5} />}
              {d.status === 'missed' && <X size={11} strokeWidth={2.5} />}
              {d.status === 'due' && <span className="w-1.5 h-1.5 rounded-full bg-violet-soft" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- pieces ------------------------------------------------------------------------

function Block({ icon: Icon, label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted mb-1 flex items-center gap-1.5"><Icon size={12} strokeWidth={2.25} />{label}</p>
      <p className="text-sm text-faint whitespace-pre-wrap">{children}</p>
    </div>
  )
}

function Pill({ tone = 'muted', children }) {
  const tones = {
    gain: 'bg-gain-bg text-gain border-gain/30',
    loss: 'bg-loss-bg text-loss border-loss/30',
    warn: 'bg-warn-bg text-warn border-warn/30',
    muted: 'bg-surface-2 text-faint border-line',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>
}

function Notice({ tone, children }) {
  const tones = { loss: 'border-loss/40 bg-loss-bg/80 text-loss/90' }
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>
}

function Field({ label, hint, icon: Icon, error, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        {Icon && <Icon size={12} strokeWidth={2.25} />}
        {label}
        {hint && <span className="ml-1 normal-case tracking-normal text-gray-600">{hint}</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

function Segmented({ options, value, onChange, wrap = false }) {
  return (
    <div className={`flex gap-1.5 rounded-xl bg-surface-2 border border-line p-1 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map(o => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`flex-1 py-2 px-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            value === o.value ? 'bg-violet text-white shadow' : 'text-faint hover:text-bright hover:bg-surface-3'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const clock = (iso, timeZone) =>
  new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))

function until(iso, now) {
  const mins = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
}

const formatDay = (ymd) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const weekday = (ymd) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })

const baseInput = 'bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none w-full transition-colors'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-loss/70 focus:border-loss' : 'border-line focus:border-violet-soft/70'}`
