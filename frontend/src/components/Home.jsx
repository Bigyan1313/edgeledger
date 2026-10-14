import { useEffect, useState } from 'react'
import {
  ClipboardCheck, PlusCircle, CandlestickChart, ShieldAlert, ArrowRight, CheckCircle2, Circle,
  OctagonX, FileUp, LayoutDashboard,
} from 'lucide-react'
import { sessionsApi, sessionLabel } from '../api/sessions.js'
import { reviewsApi } from '../api/reviews.js'
import { accountsApi } from '../api/accounts.js'
import { money } from '../utils/money.js'

// The day at a glance, in the order it is lived: the plan before the open,
// the trades, the review after the morning. Each line says where things
// stand and offers the one next step. A new journal gets a getting-started
// path instead of a page of zeros.
export default function Home({ user, profile, accounts, trades, onGo }) {
  const [sessions, setSessions] = useState(null)
  const [review, setReview] = useState(null)
  const [standings, setStandings] = useState({})

  useEffect(() => {
    let cancelled = false
    Promise.all([sessionsApi.list(), reviewsApi.today()])
      .then(([list, r]) => { if (!cancelled) { setSessions(list); setReview(r) } })
      .catch(() => { if (!cancelled) { setSessions([]); setReview(null) } })
    for (const a of accounts.filter(x => x.startingBalance != null)) {
      accountsApi.standing(a.id).then(st => { if (!cancelled) setStandings(prev => ({ ...prev, [a.id]: st })) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [accounts])

  const name = profile?.displayName || user?.displayName || (user?.email ?? '').split('@')[0]
  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // Plans are dated in the trader's own zone; today's are the newest dates.
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: profile?.timezone || undefined }).format(new Date())
  const todays = (sessions ?? []).filter(s => s.sessionDate === todayLocal)
  const openTrades = trades.filter(t => t.entryStage === 'pending_exit')
  const isNew = accounts.length === 0 || (trades.length === 0 && (sessions ?? []).length === 0)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-bright tracking-tight">{greeting}{name ? `, ${name}` : ''}.</h1>
        <p className="text-sm text-muted mt-1">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {isNew && <GettingStarted accounts={accounts} trades={trades} sessions={sessions ?? []} onGo={onGo} />}

      <section className="card p-5 sm:p-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted mb-4">Today</h2>
        <ol className="space-y-4">
          <Step
            n={1} icon={ClipboardCheck} title="Session plan"
            done={todays.length > 0}
            detail={sessions === null ? 'Loading…' : planDetail(todays, accounts)}
            tone={todays.some(s => s.status === 'blocked') ? 'loss' : null}
            action={todays.length ? 'Open plan' : 'Write the plan'} onAction={() => onGo('session')}
          />
          <Step
            n={2} icon={PlusCircle} title="Trades"
            done={false}
            detail={tradeDetail(todays, openTrades)}
            action={openTrades.length ? `Close ${openTrades.length} open` : 'Log a trade'}
            onAction={() => onGo(openTrades.length ? 'history' : 'log')}
          />
          <Step
            n={3} icon={CandlestickChart} title="Price action review"
            done={review?.recentDays?.[0]?.status === 'reviewed'}
            detail={reviewDetail(review)}
            action={review?.recentDays?.[0]?.status === 'due' ? 'Write it' : 'Open'}
            onAction={() => onGo('review')}
          />
        </ol>
      </section>

      {accounts.length > 0 && (
        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">Accounts</h2>
            <button type="button" onClick={() => onGo('profile')} className="text-xs text-violet-soft hover:text-bright transition-colors">Manage</button>
          </div>
          <ul className="space-y-3">
            {accounts.map(a => <AccountLine key={a.id} account={a} standing={standings[a.id]} onGo={onGo} />)}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Quick icon={PlusCircle} label="Log trade" onClick={() => onGo('log')} />
        <Quick icon={FileUp} label="Import Tradovate" onClick={() => onGo('history')} />
        <Quick icon={ClipboardCheck} label="Session plan" onClick={() => onGo('session')} />
        <Quick icon={LayoutDashboard} label="Dashboard" onClick={() => onGo('dashboard')} />
      </div>
    </div>
  )
}

function planDetail(todays, accounts) {
  if (!todays.length) return accounts.length ? 'No plan written today. Writing one turns on the 2-trade limit.' : 'Add an account first, then write your plan before the open.'
  return todays.map(s => {
    const where = [s.account?.name, sessionLabel(s.marketSession)].filter(Boolean).join(' · ')
    if (s.status === 'blocked') return `${where}: no-trade day`
    if (s.status === 'closed') return `${where}: closed${s.followedPlan ? ', plan followed' : ', plan not followed'}`
    return `${where}: locked, ${s.tradesRemaining} of ${s.maxTrades} trade${s.maxTrades === 1 ? '' : 's'} left`
  }).join(' — ')
}

function tradeDetail(todays, openTrades) {
  const used = todays.reduce((n, s) => n + (s.tradesLogged ?? 0), 0)
  const parts = []
  if (todays.length) parts.push(`${used} logged under today's plan${todays.length > 1 ? 's' : ''}`)
  parts.push(openTrades.length ? `${openTrades.length} open, waiting for an exit` : 'none open')
  return parts.join(' · ')
}

function reviewDetail(review) {
  if (!review) return 'Loading…'
  const status = review.recentDays?.[0]?.status
  const reviewed = review.recentDays?.filter(d => d.status === 'reviewed').length ?? 0
  const record = ` · ${reviewed}/10 days reviewed on time`
  if (review.window.state === 'weekend') return `Markets closed today${record}`
  if (status === 'reviewed') return `Written for today${record}`
  if (status === 'due') return `Open now — write it before midnight${record}`
  const opens = new Date(review.window.opensAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `Opens at ${opens}, three hours after the open${record}`
}

function Step({ n, icon: Icon, title, detail, done, tone, action, onAction }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 ${done ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-muted'}`}>
        {done ? <CheckCircle2 size={20} strokeWidth={2} /> : tone === 'loss' ? <OctagonX size={20} strokeWidth={2} /> : <Circle size={20} strokeWidth={1.75} />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-bright flex items-center gap-1.5">
          <Icon size={14} strokeWidth={2.25} className="text-violet-soft" /> {n}. {title}
        </p>
        <p className={`text-sm mt-0.5 ${tone === 'loss' ? 'text-loss/90' : 'text-faint'}`}>{detail}</p>
      </div>
      <button type="button" onClick={onAction}
        className="shrink-0 whitespace-nowrap text-sm px-3 py-1.5 rounded-xl border border-violet/40 bg-violet/15 text-violet-soft hover:bg-violet/25 transition-colors inline-flex items-center gap-1">
        {action} <ArrowRight size={13} strokeWidth={2.25} />
      </button>
    </li>
  )
}

function AccountLine({ account, standing, onGo }) {
  let text = 'Add a starting balance and loss rules to track it'
  let tone = 'text-muted'
  if (standing?.configured && standing.status === 'no_rules') text = `Balance ${money(standing.balance)} — no loss rules yet`
  if (standing?.configured && standing.room != null) {
    text = standing.status === 'breached'
      ? `Past the ${standing.binding === 'daily' ? 'daily loss limit' : 'drawdown floor'} by ${money(-standing.room)}`
      : `${money(standing.room)} to the ${standing.binding === 'daily' ? 'daily loss limit' : 'drawdown floor'}`
    tone = standing.status === 'breached' || standing.status === 'danger' ? 'text-loss' : 'text-bright'
  }
  return (
    <li className="flex items-center gap-3">
      <ShieldAlert size={16} strokeWidth={2} className="text-violet-soft shrink-0" />
      {/* Name over standing on a phone, side by side from the small breakpoint. */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-3">
        <span className="text-sm text-faint sm:w-40 truncate shrink-0">{account.name}</span>
        <span className={`text-sm tnum min-w-0 sm:truncate ${tone}`}>{text}</span>
      </div>
      {!standing?.configured && (
        <button type="button" onClick={() => onGo('profile')} className="text-xs text-violet-soft hover:text-bright shrink-0">Set up</button>
      )}
    </li>
  )
}

function GettingStarted({ accounts, trades, sessions, onGo }) {
  const steps = [
    { done: accounts.length > 0 && accounts.some(a => a.startingBalance != null), text: 'Add your account and its loss rules', hint: 'Starting balance, daily loss limit, drawdown — so the journal can show how far you are from losing it.', tab: 'profile', action: 'Accounts' },
    { done: sessions.length > 0, text: 'Write your first session plan', hint: 'Before the open: sleep and readiness, what you want to see, if/then, and your 1–2 trade limit.', tab: 'session', action: 'Session plan' },
    { done: trades.length > 0, text: 'Log or import your first trade', hint: 'Type it in, read it from a broker screenshot, or import your Tradovate Performance CSV.', tab: 'log', action: 'Log trade' },
  ]
  return (
    <section className="card p-5 sm:p-6 border-violet/30">
      <h2 className="text-base font-semibold text-bright mb-1">Getting started</h2>
      <p className="text-sm text-muted mb-4">Three steps, once. After that this page shows your day.</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className={`mt-0.5 shrink-0 ${s.done ? 'text-gain' : 'text-muted'}`}>
              {s.done ? <CheckCircle2 size={20} strokeWidth={2} /> : <Circle size={20} strokeWidth={1.75} />}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${s.done ? 'text-muted line-through' : 'text-bright'}`}>{s.text}</p>
              {!s.done && <p className="text-xs text-muted mt-0.5">{s.hint}</p>}
            </div>
            {!s.done && (
              <button type="button" onClick={() => onGo(s.tab)}
                className="shrink-0 whitespace-nowrap text-sm px-3 py-1.5 rounded-xl bg-violet text-white hover:brightness-110 transition">
                {s.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Quick({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="card px-3 py-4 flex flex-col items-center gap-2 text-sm text-faint hover:text-bright transition-colors">
      <Icon size={20} strokeWidth={2} className="text-violet-soft" />
      {label}
    </button>
  )
}
