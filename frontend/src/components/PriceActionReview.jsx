import { useEffect, useState } from 'react'
import {
  CandlestickChart, Hourglass, CalendarCheck, CalendarSearch, Eye, GitBranch, OctagonX, Crosshair,
  Layers, Droplets, Lightbulb, Target, Pencil, Plus, X, CheckCircle2, Clock, FlaskConical, ArrowLeft,
} from 'lucide-react'
import { reviewsApi, DAY_TYPES, LIQUIDITY_TAKEN, PLAN_OUTCOMES, MIN_SUMMARY, MAX_REVIEW_SCREENSHOTS } from '../api/reviews.js'
import { sessionLabel } from '../api/sessions.js'
import ChartPicker, { Thumb } from './ChartPicker.jsx'

// The daily price action review: what the market did, written once the
// morning has played out and set beside what the plan expected.
//
// Today's review opens three hours after the open; the server owns that
// window, and this screen shows it. Past days can be opened too — from the
// ten-day strip, the date picker, or the list of past reviews — to catch up a
// missed day or to backtest an old one. Anything written after its day closed
// is shown as late, and an edit after the close as "edited later", with when.

export default function PriceActionReview({ onChanged }) {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(null) // a saved review, or 'new'
  const [now, setNow] = useState(() => Date.now())
  // A past day being viewed, or null for today.
  const [selected, setSelected] = useState(null)
  const [day, setDay] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([reviewsApi.today(), reviewsApi.list()])
      .then(([d, list]) => { if (!cancelled) { setData(d); setHistory(list); setError(null) } })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [version])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    reviewsApi.day(selected)
      .then(d => { if (!cancelled) setDay(d) })
      .catch(err => { if (!cancelled) setDay({ date: selected, error: err.message }) })
    return () => { cancelled = true }
  }, [selected, version])

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
  const pick = (date) => {
    setEditing(null)
    setSelected(!date || date === data?.window.reviewDate ? null : date)
  }

  if (error) return <Shell><Notice tone="loss">{error}</Notice></Shell>
  if (!data) return <Shell><p className="text-sm text-muted">Loading today…</p></Shell>

  const { window, reviews, plans, planExists, recentDays, lastSymbol } = data
  const viewingPast = selected !== null
  const past = viewingPast && day?.date === selected ? day : null

  return (
    <Shell window={window}>
      <RecentDays days={recentDays} selected={selected ?? window.reviewDate} onPick={pick} />
      <DayPicker today={window.reviewDate} value={selected ?? ''} onPick={pick} />

      {!viewingPast && (
        <>
          {window.state === 'weekend' && (
            <section className="card p-6 text-sm text-faint">Markets are closed today. Pick a past day above to catch up or backtest.</section>
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
          {window.state === 'open' && (
            <DayReviews reviews={reviews} plans={plans} planExists={planExists} reviewDate={null}
              lastSymbol={lastSymbol} editing={editing} setEditing={setEditing} onSaved={saved} />
          )}
          {window.state !== 'open' && plans.length > 0 && <PlanReference plans={plans} title="Today's plan" />}
        </>
      )}

      {viewingPast && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-bright font-medium">{formatDay(selected)} <span className="text-muted font-normal">· past day</span></p>
            <button type="button" onClick={() => pick(null)}
              className="text-sm text-violet-soft hover:text-bright inline-flex items-center gap-1.5 transition-colors">
              <ArrowLeft size={14} strokeWidth={2.25} /> Back to today
            </button>
          </div>
          {!past && <p className="text-sm text-muted">Loading {formatDay(selected)}…</p>}
          {past?.error && <Notice tone="loss">{past.error}</Notice>}
          {past && !past.error && past.state === 'weekend' && (
            <section className="card p-6 text-sm text-faint">That was a weekend — no price action to review.</section>
          )}
          {past && !past.error && past.state === 'past' && (
            <>
              <p className="text-xs text-muted">
                Written now, a review of this day is marked <b className="text-warn">late</b> — or tick backtest
                if it is practice on an old day. Neither counts as reviewed on time.
              </p>
              <DayReviews reviews={past.reviews} plans={past.plans} planExists={past.planExists} reviewDate={selected}
                lastSymbol={lastSymbol} editing={editing} setEditing={setEditing} onSaved={saved} />
            </>
          )}
        </>
      )}

      <PastReviews reviews={history} onPick={pick} />
    </Shell>
  )
}

// The reviews already written for one day, and the form for another. Shared
// by today and by any past day; `reviewDate` is null for today.
function DayReviews({ reviews, plans, planExists, reviewDate, lastSymbol, editing, setEditing, onSaved }) {
  const writingNew = editing === 'new' || (editing === null && reviews.length === 0)
  const offerAnother = editing === null && reviews.length > 0
  return (
    <>
      {reviews.map(r => (
        editing?.id === r.id
          ? <ReviewForm key={r.id} review={r} plans={plans} planExists={planExists} onSaved={onSaved} onCancel={() => setEditing(null)} />
          : <SavedReview key={r.id} review={r} onEdit={() => setEditing(r)} />
      ))}
      {writingNew && (
        <ReviewForm key={`new-${reviewDate ?? 'today'}`} plans={plans} planExists={planExists} reviewDate={reviewDate}
          defaultSymbol={reviews.length ? '' : (lastSymbol ?? '')}
          onSaved={onSaved} onCancel={reviews.length ? () => setEditing(null) : null} />
      )}
      {offerAnother && (
        <button type="button" onClick={() => setEditing('new')}
          className="w-full py-2.5 rounded-xl border border-line bg-surface-2 text-faint hover:text-bright hover:bg-surface-3 transition-colors flex items-center justify-center gap-2">
          <Plus size={15} strokeWidth={2.25} /> Review another symbol
        </button>
      )}
    </>
  )
}

function DayPicker({ today, value, onPick }) {
  return (
    <label className="flex items-center gap-2 text-sm text-faint">
      <CalendarSearch size={15} strokeWidth={2} className="text-muted" />
      <span>Open another day</span>
      <input type="date" max={today} value={value} onChange={e => onPick(e.target.value || null)}
        aria-label="Open another day"
        className="bg-surface-2 border border-line rounded-lg px-2 py-1 text-sm text-bright focus:outline-none focus:border-violet-soft/70 [color-scheme:dark]" />
    </label>
  )
}

function PastReviews({ reviews, onPick }) {
  if (!reviews.length) return null
  return (
    <section>
      <h3 className="text-sm font-medium text-faint mb-2">Past reviews</h3>
      <div className="card divide-y divide-line-soft overflow-hidden">
        {reviews.slice(0, 20).map(r => (
          <button key={r.id} type="button" onClick={() => onPick(r.reviewDate)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-surface-2/60 transition-colors">
            <span className="text-faint tnum shrink-0 w-24 sm:w-28">{formatDay(r.reviewDate)}</span>
            <span className="text-bright shrink-0">{r.symbol}</span>
            {/* The day type gives way on a phone so the flags never get clipped. */}
            <span className="text-muted truncate flex-1 min-w-0 hidden sm:block">{DAY_TYPES.find(d => d.value === r.dayType)?.label}</span>
            <ReviewFlags review={r} compact />
          </button>
        ))}
      </div>
    </section>
  )
}

// Late, backtest, and edited-later — derived by the server from when the
// review was written and changed, so they read the same everywhere.
function ReviewFlags({ review, compact = false }) {
  const items = []
  if (review.isBacktest) items.push(<Pill key="b" tone="violet"><FlaskConical size={11} strokeWidth={2.5} className="inline -mt-0.5 mr-1" />backtest</Pill>)
  else if (review.writtenLate) items.push(<Pill key="l" tone="warn"><Clock size={11} strokeWidth={2.5} className="inline -mt-0.5 mr-1" />written late</Pill>)
  if (review.editedAfterClose) {
    items.push(<Pill key="e" tone="warn">edited later{compact ? '' : ` · ${stamp(review.lastEditedAt)}`}</Pill>)
  }
  return items.length
    ? <span className={`flex items-center gap-1.5 flex-wrap ${compact ? 'ml-auto min-w-0 justify-end' : 'shrink-0'}`}>{items}</span>
    : null
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
            ? `${formatDay(window.reviewDate)} · ${window.marketOpenTime} open, ${window.marketTimezone} · today's opens ${clock(window.opensAt, window.marketTimezone)}`
            : ' '}
        </p>
      </div>
      {children}
    </div>
  )
}

// --- the form ------------------------------------------------------------------

function ReviewForm({ review = null, plans, planExists, reviewDate = null, defaultSymbol = '', onSaved, onCancel }) {
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
  // Only a new review of a past day can be a backtest; the mark is fixed once saved.
  const [isBacktest, setIsBacktest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(fe => { const n = { ...fe }; delete n[field]; return n })
  }

  const submit = async () => {
    setSaving(true); setError(null); setFieldErrors({})
    try {
      const payload = { ...form, planPlayedOut: planExists ? form.planPlayedOut : null }
      onSaved(review
        ? await reviewsApi.update(review.id, payload)
        : await reviewsApi.create({ ...payload, ...(reviewDate ? { reviewDate, isBacktest } : {}) }))
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
        <ChartPicker value={form.screenshots} onChange={v => set('screenshots', v)} max={MAX_REVIEW_SCREENSHOTS} />
      </Field>

      {reviewDate && !review && (
        <label className="flex items-start gap-2.5 rounded-xl border border-violet/30 bg-violet/[0.07] px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={isBacktest} onChange={e => setIsBacktest(e.target.checked)} className="w-4 h-4 mt-0.5 accent-violet" />
          <span className="text-sm">
            <span className="text-bright font-medium">This is a backtest</span>
            <span className="block text-xs text-muted">Practice on an old day. Kept with your reviews, never counted toward the daily record.</span>
          </span>
        </label>
      )}

      {/* Counted live: fixing a field shrinks it, fixing the last one clears it. */}
      {Object.keys(fieldErrors).length > 0 && (
        <Notice tone="loss">
          Fix the {Object.keys(fieldErrors).length === 1 ? 'highlighted field' : `${Object.keys(fieldErrors).length} highlighted fields`} above.
        </Notice>
      )}
      {error && <Notice tone="loss">{error}</Notice>}

      <button type="button" disabled={saving} onClick={submit}
        className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition">
        {saving ? 'Saving…' : review ? 'Save changes' : reviewDate ? `Save review of ${formatDay(reviewDate)}` : "Save today's review"}
      </button>
      <p className="text-xs text-muted text-center -mt-2">
        {review?.writtenLate || reviewDate
          ? 'Saved with when it was written. Edits stay possible, and an edit after the day closed shows as edited later.'
          : 'Edits after midnight in the market stay possible, and show as edited later.'}
      </p>
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
          <ReviewFlags review={review} />
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
          {review.screenshots.map((src, i) => <Thumb key={i} src={src} alt={`Chart ${i + 1}`} />)}
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
          {(plans.length > 1 || p.marketSession) && (
            <p className="text-xs text-muted">{[plans.length > 1 && (p.account?.name ?? 'No account'), sessionLabel(p.marketSession) && `${sessionLabel(p.marketSession)} session`].filter(Boolean).join(' · ')}</p>
          )}
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
function RecentDays({ days, selected, onPick }) {
  const style = {
    reviewed: 'bg-gain-bg text-gain border-gain/30',
    late: 'bg-warn-bg text-warn border-warn/30',
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
          <button key={d.date} type="button" onClick={() => onPick(d.date)} title={`${formatDay(d.date)} — ${d.status}`}
            aria-pressed={selected === d.date}
            className={`rounded-lg border px-1 py-1.5 text-center transition hover:brightness-125 ${style[d.status]} ${selected === d.date ? 'ring-2 ring-violet-soft/70' : ''}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-80">{weekday(d.date)}</div>
            <div className="text-xs font-semibold tnum">{Number(d.date.slice(8))}</div>
            <div className="h-3 flex items-center justify-center">
              {d.status === 'reviewed' && <CheckCircle2 size={11} strokeWidth={2.5} />}
              {d.status === 'missed' && <X size={11} strokeWidth={2.5} />}
              {d.status === 'due' && <span className="w-1.5 h-1.5 rounded-full bg-violet-soft" />}
              {d.status === 'late' && <Clock size={11} strokeWidth={2.5} />}
            </div>
          </button>
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
    violet: 'bg-violet/15 text-violet-soft border-violet/40',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${tones[tone]}`}>{children}</span>
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

const stamp = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

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
