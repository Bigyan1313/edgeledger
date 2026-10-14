import { useEffect, useState } from 'react'
import {
  Moon, HeartPulse, Eye, GitBranch, OctagonX, Lock, Plus, Trash2,
  CheckCircle2, XCircle, ShieldAlert, ArrowRight, ClipboardCheck,
} from 'lucide-react'
import AccountSelector from './AccountSelector.jsx'
import { sessionsApi, MAX_TRADES_CEILING, MIN_PLAN_TEXT, MAX_SCENARIOS, MARKET_SESSIONS, sessionLabel } from '../api/sessions.js'
import ChartPicker, { Thumb } from './ChartPicker.jsx'

// The pre-session journal. Written before the open, locked once saved.
//
// Order matters here. Readiness is asked first and judged live, so a tired
// trader learns the answer before typing a plan — and is never asked to write
// one for a day they are not going to trade. Only a day that passes gets the
// plan section at all.

const EMPTY_SCENARIO = { if: '', then: '' }

export default function SessionPlan({ accounts, onAddAccount, onManageAccounts, onGoLog, activeAccountId, onAccountChange }) {
  const [accountId, setAccountIdState] = useState(activeAccountId ?? accounts[0]?.id ?? null)
  const setAccountId = (id) => { setAccountIdState(id); onAccountChange?.(id) }
  // Each load is tagged with the account it was for, so switching accounts
  // shows "loading" until the new answer arrives instead of the old account's
  // plan — without clearing state from inside the effect.
  const [loaded, setLoaded] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    let cancelled = false
    Promise.all([sessionsApi.today(accountId), sessionsApi.list()])
      .then(([today, list]) => { if (!cancelled) { setLoaded({ accountId, ctx: today, error: null }); setHistory(list) } })
      .catch(err => { if (!cancelled) setLoaded({ accountId, ctx: null, error: err.message }) })
    return () => { cancelled = true }
  }, [accountId])

  const current = loaded?.accountId === accountId ? loaded : null
  const ctx = current?.ctx ?? null
  const error = current?.error ?? null

  const onSaved = (session) => {
    setLoaded(l => ({ ...l, ctx: { ...l.ctx, session, gateActive: true } }))
    setHistory(h => [session, ...h.filter(s => s.id !== session.id)])
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-bright tracking-tight flex items-center gap-2">
            <ClipboardCheck size={20} strokeWidth={2} className="text-violet-soft" />
            Session plan — before the open
          </h2>
          <p className="text-xs text-muted mt-1 tnum">
            {ctx ? `${formatDay(ctx.today)} · ${ctx.timezone}` : ' '}
          </p>
        </div>
        <AccountSelector accounts={accounts} value={accountId} onChange={setAccountId} onAdd={onAddAccount} onManage={onManageAccounts} />
      </div>

      {error && <Notice tone="loss">{error}</Notice>}
      {!error && !ctx && <p className="text-sm text-muted">Loading today…</p>}

      {ctx && !ctx.session && (
        <PreSessionForm key={accountId ?? 'none'} ctx={ctx} accountId={accountId} onSaved={onSaved} />
      )}
      {ctx?.session?.status === 'blocked' && <BlockedDay session={ctx.session} />}
      {ctx?.session?.status === 'open' && <OpenDay session={ctx.session} onSaved={onSaved} onGoLog={() => onGoLog(accountId)} />}
      {ctx?.session?.status === 'closed' && <ClosedDay session={ctx.session} />}

      {history.length > 0 && <RecentDays sessions={history} />}
    </div>
  )
}

// --- before the plan exists -------------------------------------------------------

function PreSessionForm({ ctx, accountId, onSaved }) {
  const [sleepHours, setSleepHours] = useState('')
  const [fitToTrade, setFitToTrade] = useState(null)
  const [plan, setPlan] = useState({ marketSession: null, bias: null, wantToSee: '', noTradeIf: '', scenarios: [{ ...EMPTY_SCENARIO }], maxTrades: null, screenshots: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const verdict = previewReadiness({ sleepHours, fitToTrade }, ctx.minSleepHours, ctx.blockedElsewhere)
  // Editing a field clears its error, and the summary below is counted from
  // what is still marked — so it shrinks as the plan is fixed.
  const clearError = (...fields) => setFieldErrors(fe => {
    const next = { ...fe }
    for (const f of fields) delete next[f]
    return next
  })
  const setP = (field, value) => { setPlan(p => ({ ...p, [field]: value })); clearError(field) }
  const setScenario = (i, side, value) => {
    setPlan(p => ({ ...p, scenarios: p.scenarios.map((s, idx) => (idx === i ? { ...s, [side]: value } : s)) }))
    clearError('scenarios', `scenarios.${i}`)
  }

  const submit = async (blocked) => {
    setSaving(true); setError(null); setFieldErrors({})
    try {
      const readiness = { accountId, sleepHours: Number(sleepHours), fitToTrade }
      const session = await sessionsApi.create(blocked ? readiness : {
        ...readiness,
        bias: plan.bias,
        wantToSee: plan.wantToSee,
        noTradeIf: plan.noTradeIf,
        marketSession: plan.marketSession,
        screenshots: plan.screenshots,
        scenarios: plan.scenarios.filter(s => s.if.trim() || s.then.trim()),
        maxTrades: plan.maxTrades,
      })
      onSaved(session)
    } catch (err) {
      const fe = Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message]))
      setFieldErrors(fe)
      setError(Object.keys(fe).length ? null : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {ctx.blockedElsewhere && (
        <Notice tone="loss" icon={ShieldAlert}>
          Today is already recorded as a no-trade day on <b>{ctx.blockedElsewhere}</b>. Readiness is
          about you, not the account — that answer stands here too.
        </Notice>
      )}

      <section className="card p-6 space-y-5">
        <StepTitle n={1} title="Are you fit to trade?" hint="Answered before anything else." />
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Hours slept" icon={Moon} error={fieldErrors.sleepHours}
            hint={`Your floor: ${ctx.minSleepHours}h`}>
            <input type="number" inputMode="decimal" step="0.25" min="0" max="24" value={sleepHours}
              onChange={e => setSleepHours(e.target.value)} placeholder="e.g. 7.5"
              className={inputCls(fieldErrors.sleepHours)} />
          </Field>
          <Field label="Rested, not sick, not upset, not rushed?" icon={HeartPulse} error={fieldErrors.fitToTrade}>
            <Segmented
              options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
              value={fitToTrade} onChange={setFitToTrade} />
          </Field>
        </div>

        {verdict.answered && verdict.reasons.length > 0 && (
          <div className="rounded-2xl border border-loss/40 bg-loss-bg/70 p-4 space-y-3">
            <p className="text-sm font-semibold text-loss flex items-center gap-2">
              <OctagonX size={16} strokeWidth={2.25} /> Today is a no-trade day.
            </p>
            <ul className="text-sm text-loss/90 space-y-1 list-disc pl-5">
              {verdict.reasons.map(r => <li key={r}>{r}</li>)}
            </ul>
            <p className="text-xs text-faint">
              Recording it is final for today, on every account. That is the point: the
              answer you give while you are tired is the one that decides it.
            </p>
            <button type="button" disabled={saving} onClick={() => submit(true)}
              className="w-full py-2.5 rounded-xl border border-loss/50 bg-loss/15 text-loss font-semibold hover:bg-loss/25 disabled:opacity-50 transition-colors">
              {saving ? 'Recording…' : 'Record today as a no-trade day'}
            </button>
          </div>
        )}

        {verdict.answered && verdict.reasons.length === 0 && (
          <p className="text-sm text-gain flex items-center gap-2">
            <CheckCircle2 size={16} strokeWidth={2.25} /> Ready. Now write the plan.
          </p>
        )}
      </section>

      {verdict.answered && verdict.reasons.length === 0 && (
        <section className="card p-6 space-y-5">
          <StepTitle n={2} title="The plan" hint="Locked once saved. No edits, no delete." />

          <Field label="Session" error={fieldErrors.marketSession}
            hint="the day's limit is shared across sessions">
            <Segmented
              options={MARKET_SESSIONS.map(m => ({ value: m.value, label: m.label }))}
              value={plan.marketSession} onChange={v => setP('marketSession', v)} />
            <span className="text-[11px] text-muted">
              {MARKET_SESSIONS.map(m => `${m.label} ${m.hours}`).join(' · ')}
            </span>
          </Field>

          <Field label="Bias" hint="optional" error={fieldErrors.bias}>
            <Segmented
              options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: 'neutral', label: 'Neutral' }]}
              value={plan.bias} onChange={v => setP('bias', plan.bias === v ? null : v)} />
          </Field>

          <Field label="What I want to see before any trade" icon={Eye} error={fieldErrors.wantToSee}>
            <textarea rows={3} value={plan.wantToSee} onChange={e => setP('wantToSee', e.target.value)}
              placeholder="e.g. NY sweeps the Asia low, then a 5m break of structure back above it"
              className={inputCls(fieldErrors.wantToSee)} />
            <CharHint value={plan.wantToSee} />
          </Field>

          <Field label="If / then" icon={GitBranch} error={fieldErrors.scenarios ?? scenarioError(fieldErrors)}
            hint={`up to ${MAX_SCENARIOS}`}>
            <div className="space-y-2">
              {plan.scenarios.map((s, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 rounded-xl bg-surface-2/60 border border-line p-2">
                  <span className="text-[11px] font-semibold text-violet-soft uppercase tracking-wider px-1">If</span>
                  <input value={s.if} onChange={e => setScenario(i, 'if', e.target.value)}
                    placeholder="Asia low swept and reclaimed" className={`${inputCls(fieldErrors[`scenarios.${i}`])} min-w-0`} />
                  <span className="text-[11px] font-semibold text-violet-soft uppercase tracking-wider px-1">Then</span>
                  <input value={s.then} onChange={e => setScenario(i, 'then', e.target.value)}
                    placeholder="Long the retest, stop under the sweep" className={`${inputCls(fieldErrors[`scenarios.${i}`])} min-w-0`} />
                  <button type="button" aria-label={`Remove scenario ${i + 1}`} disabled={plan.scenarios.length === 1}
                    onClick={() => setPlan(p => ({ ...p, scenarios: p.scenarios.filter((_, idx) => idx !== i) }))}
                    className="justify-self-end p-2 text-muted hover:text-loss disabled:opacity-30 disabled:hover:text-muted transition-colors">
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
              ))}
              {plan.scenarios.length < MAX_SCENARIOS && (
                <button type="button" onClick={() => setPlan(p => ({ ...p, scenarios: [...p.scenarios, { ...EMPTY_SCENARIO }] }))}
                  className="text-sm text-violet-soft hover:text-bright flex items-center gap-1.5 transition-colors">
                  <Plus size={14} strokeWidth={2.25} /> Add a scenario
                </button>
              )}
            </div>
          </Field>

          <Field label="No trade today if…" icon={OctagonX} error={fieldErrors.noTradeIf}>
            <textarea rows={2} value={plan.noTradeIf} onChange={e => setP('noTradeIf', e.target.value)}
              placeholder="e.g. Price is still chopping inside the Asia range at 10:30"
              className={`${inputCls(fieldErrors.noTradeIf)} border-loss/30 bg-loss-bg/40`} />
            <CharHint value={plan.noTradeIf} />
          </Field>

          <Field label="Pre-market charts" hint="optional, up to 3" error={fieldErrors.screenshots}>
            <ChartPicker value={plan.screenshots} onChange={v => setP('screenshots', v)} label="Add chart" />
          </Field>

          <Field label="Most trades today" error={fieldErrors.maxTrades}
            hint={`${MAX_TRADES_CEILING} is the ceiling. It does not go higher.`}>
            <Segmented
              options={Array.from({ length: MAX_TRADES_CEILING }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
              value={plan.maxTrades} onChange={v => setP('maxTrades', v)} />
          </Field>

          {/* The fields carry their own messages; repeating all of them here
              just doubles the red. Only an error with no field is spelled out. */}
          {Object.keys(fieldErrors).length > 0 && (
            <Notice tone="loss">
              Fix the {Object.keys(fieldErrors).length === 1 ? 'highlighted field' : `${Object.keys(fieldErrors).length} highlighted fields`} above.
            </Notice>
          )}
          {error && <Notice tone="loss">{error}</Notice>}

          <button type="button" disabled={saving} onClick={() => submit(false)}
            className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition flex items-center justify-center gap-2">
            <Lock size={15} strokeWidth={2.25} />
            {saving ? 'Locking…' : "Lock today's plan"}
          </button>
        </section>
      )}

      {/* Readiness errors (e.g. a blocked submit refused) when the plan section is hidden. */}
      {error && !(verdict.answered && verdict.reasons.length === 0) && <Notice tone="loss">{error}</Notice>}
    </div>
  )
}

// --- after the plan exists -----------------------------------------------------------

function OpenDay({ session, onSaved, onGoLog }) {
  const [closing, setClosing] = useState(false)
  const [chartError, setChartError] = useState(null)

  // Charts added after the plan was locked go straight to the server: there is
  // nothing to confirm, and nothing already attached can be taken away.
  const addCharts = async (urls) => {
    setChartError(null)
    try { onSaved(await sessionsApi.addCharts(session.id, urls)) } catch (err) { setChartError(err.message) }
  }
  const capped = session.tradesLogged >= session.maxTrades

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill tone="gain" icon={Lock}>Locked · open</StatusPill>
            <SessionTag value={session.marketSession} />
          </div>
          <TradeMeter used={session.tradesLogged} max={session.maxTrades} />
        </div>

        <PlanBody session={session} />

        <div>
          <Label>Charts</Label>
          <ChartPicker existing={session.screenshots ?? []} value={[]} onChange={addCharts} removable={false} label="Add chart" />
          {chartError && <p className="text-xs text-red-400 mt-1">{chartError}</p>}
        </div>

        {capped ? (
          <Notice tone="warn" icon={ShieldAlert}>
            {session.maxTrades === 1 ? 'Your one trade' : `All ${session.maxTrades} trades`} for today {session.maxTrades === 1 ? 'is' : 'are'} used.
            The day is done — close it out below.
          </Notice>
        ) : (
          <button type="button" onClick={onGoLog}
            className="w-full py-2.5 rounded-xl border border-violet/40 bg-violet/15 text-violet-soft font-semibold hover:bg-violet/25 transition-colors flex items-center justify-center gap-2">
            Log a trade under this plan <ArrowRight size={15} strokeWidth={2.25} />
          </button>
        )}
      </section>

      {closing
        ? <CloseDayForm session={session} onSaved={onSaved} onCancel={() => setClosing(false)} />
        : (
          <button type="button" onClick={() => setClosing(true)}
            className="w-full py-2.5 rounded-xl border border-line bg-surface-2 text-faint hover:text-bright hover:bg-surface-3 transition-colors">
            Close the day — post-session review
          </button>
        )}
    </div>
  )
}

function CloseDayForm({ session, onSaved, onCancel }) {
  const [followedPlan, setFollowedPlan] = useState(null)
  const [review, setReview] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      onSaved(await sessionsApi.close(session.id, { followedPlan, review }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card p-6 space-y-5">
      <StepTitle n={3} title="Post-session" hint="Closing ends the day. No trades after this." />
      <Field label="Did you follow the plan?">
        <Segmented options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
          value={followedPlan} onChange={setFollowedPlan} />
      </Field>
      <Field label="Review" hint="optional">
        <textarea rows={3} value={review} onChange={e => setReview(e.target.value)}
          placeholder="What happened, what you did, what you would do the same or differently."
          className={inputCls()} />
      </Field>
      {error && <Notice tone="loss">{error}</Notice>}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="px-4 py-2.5 rounded-xl border border-line bg-surface-2 text-faint hover:text-bright transition-colors">
          Not yet
        </button>
        <button type="button" disabled={saving || followedPlan === null} onClick={submit}
          className="flex-1 py-2.5 bg-violet hover:brightness-110 disabled:opacity-40 text-white font-semibold rounded-xl transition">
          {saving ? 'Closing…' : 'Close the day'}
        </button>
      </div>
    </section>
  )
}

function BlockedDay({ session }) {
  return (
    <section className="card p-6 space-y-4 border-loss/30">
      <StatusPill tone="loss" icon={OctagonX}>No-trade day</StatusPill>
      <ul className="text-sm text-loss/90 space-y-1 list-disc pl-5">
        {session.blockedReasons.map(r => <li key={r}>{r}</li>)}
      </ul>
      <p className="text-sm text-faint">
        No trades today on any account. The plan comes back tomorrow, after a night's sleep.
      </p>
    </section>
  )
}

function ClosedDay({ session }) {
  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill tone={session.followedPlan ? 'gain' : 'warn'} icon={session.followedPlan ? CheckCircle2 : XCircle}>
            Closed · {session.followedPlan ? 'followed the plan' : 'did not follow the plan'}
          </StatusPill>
          <SessionTag value={session.marketSession} />
        </div>
        <TradeMeter used={session.tradesLogged} max={session.maxTrades} />
      </div>
      <PlanBody session={session} />
      {session.screenshots?.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {session.screenshots.map((src, i) => <Thumb key={i} src={src} alt={`Chart ${i + 1}`} />)}
        </div>
      )}
      {session.review && (
        <div>
          <Label>Review</Label>
          <p className="text-sm text-faint whitespace-pre-wrap">{session.review}</p>
        </div>
      )}
    </section>
  )
}

function PlanBody({ session }) {
  return (
    <div className="space-y-4">
      {session.bias && <p className="text-xs text-muted uppercase tracking-wider">Bias · <span className="text-faint">{session.bias}</span></p>}
      <div>
        <Label icon={Eye}>What I want to see</Label>
        <p className="text-sm text-bright whitespace-pre-wrap">{session.wantToSee}</p>
      </div>
      <div>
        <Label icon={GitBranch}>If / then</Label>
        <ul className="space-y-1.5">
          {session.scenarios.map((s, i) => (
            <li key={i} className="text-sm rounded-xl bg-surface-2/60 border border-line px-3 py-2">
              <span className="text-violet-soft font-semibold">If</span> <span className="text-bright">{s.if}</span>
              <span className="text-violet-soft font-semibold"> → then</span> <span className="text-bright">{s.then}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-loss/30 bg-loss-bg/50 px-3 py-2.5">
        <Label icon={OctagonX} tone="loss">No trade today if</Label>
        <p className="text-sm text-bright whitespace-pre-wrap">{session.noTradeIf}</p>
      </div>
    </div>
  )
}

function RecentDays({ sessions }) {
  return (
    <section>
      <h3 className="text-sm font-medium text-faint mb-2">Recent days</h3>
      <div className="card divide-y divide-line-soft overflow-hidden">
        {sessions.slice(0, 14).map(s => (
          <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="text-faint tnum shrink-0 sm:w-28">{formatDay(s.sessionDate)}</span>
            <span className="text-muted truncate flex-1 min-w-0">
              {s.account?.name ?? 'No account'}{sessionLabel(s.marketSession) ? ` · ${sessionLabel(s.marketSession)}` : ''}
            </span>
            <span className="tnum text-muted shrink-0 text-right">
              {s.status === 'blocked' ? '—' : `${s.tradesLogged}/${s.maxTrades}`}
            </span>
            <DayOutcome session={s} />
          </div>
        ))}
      </div>
    </section>
  )
}

function DayOutcome({ session }) {
  if (session.status === 'blocked') return <span className="text-xs text-loss shrink-0 sm:w-28 text-right">no-trade day</span>
  if (session.status === 'open') return <span className="text-xs text-violet-soft shrink-0 sm:w-28 text-right">open</span>
  if (session.tradesLogged > session.maxTrades) return <span className="text-xs text-loss shrink-0 sm:w-28 text-right">over the limit</span>
  return session.followedPlan
    ? <span className="text-xs text-gain shrink-0 sm:w-28 text-right">followed plan</span>
    : <span className="text-xs text-warn shrink-0 sm:w-28 text-right">broke plan</span>
}

// --- pieces ------------------------------------------------------------------------

// Mirrors readinessVerdict on the server so the answer appears as it is typed.
// The server's verdict is the one that is stored.
function previewReadiness({ sleepHours, fitToTrade }, minSleep, blockedElsewhere) {
  if (sleepHours === '' || fitToTrade === null) return { answered: false, reasons: [] }
  const hours = Number(sleepHours)
  const reasons = []
  if (Number.isFinite(hours) && hours < minSleep) reasons.push(`Slept ${hours}h — the floor is ${minSleep}h.`)
  if (fitToTrade === false) reasons.push('You said you are not fit to trade today.')
  if (blockedElsewhere) reasons.push(`Already recorded as a no-trade day on ${blockedElsewhere}.`)
  return { answered: true, reasons }
}

function scenarioError(fieldErrors) {
  const key = Object.keys(fieldErrors).find(k => k.startsWith('scenarios.'))
  return key ? fieldErrors[key] : undefined
}

function TradeMeter({ used, max }) {
  const over = used > max
  return (
    <div className="text-right">
      <div className="flex gap-1.5 justify-end">
        {Array.from({ length: Math.max(max, used) }, (_, i) => (
          <span key={i} className={`h-2.5 w-7 rounded-full border border-line ${
            i >= max ? 'bg-loss' : i < used ? 'bg-violet-soft' : 'bg-white/15'
          }`} />
        ))}
      </div>
      <p className={`text-xs mt-1.5 tnum ${over ? 'text-loss' : 'text-muted'}`}>
        {used} of {max} trade{max === 1 ? '' : 's'}{over ? ' — over the limit' : ''}
      </p>
    </div>
  )
}

function SessionTag({ value }) {
  const label = sessionLabel(value)
  if (!label) return null
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-violet/40 bg-violet/15 text-violet-soft">{label} session</span>
}

function StatusPill({ tone, icon: Icon, children }) {
  const tones = {
    gain: 'bg-gain-bg text-gain border-gain/30',
    loss: 'bg-loss-bg text-loss border-loss/30',
    warn: 'bg-warn-bg text-warn border-warn/30',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${tones[tone]}`}>
      <Icon size={13} strokeWidth={2.25} />{children}
    </span>
  )
}

function Notice({ tone, icon: Icon, children }) {
  const tones = {
    loss: 'border-loss/40 bg-loss-bg/80 text-loss/90',
    warn: 'border-warn/30 bg-warn-bg/60 text-warn/90',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm flex gap-2.5 ${tones[tone]}`}>
      {Icon && <Icon size={16} strokeWidth={2.25} className="shrink-0 mt-0.5" />}
      <div>{children}</div>
    </div>
  )
}

function StepTitle({ n, title, hint }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 h-6 rounded-full bg-violet/25 text-violet-soft text-xs font-semibold flex items-center justify-center shrink-0 self-center">{n}</span>
      <h3 className="text-base font-semibold text-bright">{title}</h3>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

function Label({ icon: Icon, tone, children }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-wider mb-1.5 flex items-center gap-1.5 ${tone === 'loss' ? 'text-loss/90' : 'text-muted'}`}>
      {Icon && <Icon size={12} strokeWidth={2.25} />}{children}
    </p>
  )
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

function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 rounded-xl bg-surface-2 border border-line p-1">
      {options.map(o => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            value === o.value ? 'bg-violet text-white shadow' : 'text-faint hover:text-bright hover:bg-surface-3'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CharHint({ value }) {
  const n = value.trim().length
  if (n >= MIN_PLAN_TEXT) return null
  return <span className="text-[11px] text-muted tnum">{n}/{MIN_PLAN_TEXT} characters minimum</span>
}

function formatDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const baseInput = 'bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none w-full transition-colors'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-loss/70 focus:border-loss' : 'border-line focus:border-violet-soft/70'}`
