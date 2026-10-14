import PnlCalendar from './PnlCalendar.jsx'
import BalanceCard from './BalanceCard.jsx'
import { RISKY_TECHNICAL_SETUPS } from '../constants/trade.js'
import {
  TrendingUp, Target, Scale, Activity, AlertTriangle, LineChart, ShieldCheck, Layers,
  PlusCircle, FileUp, ClipboardCheck, CalendarDays,
} from 'lucide-react'

// Stats are computed over CLOSED trades only. An open Stage A entry has no
// result yet, and folding it in as a zero would drag every average toward it.
function computeStats(allTrades) {
  const trades = allTrades.filter(t => t.entryStage !== 'pending_exit' && t.pnl != null)
  if (!trades.length) return null

  const wins   = trades.filter(t => t.outcome === 'Win')
  const losses = trades.filter(t => t.outcome === 'Loss')
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0)

  const winRate    = wins.length / (wins.length + losses.length) || 0
  const avgWin     = wins.length   ? wins.reduce((s, t) => s + t.pnl, 0)            / wins.length   : 0
  const avgLoss    = losses.length ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0
  const grossWin   = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss  = losses.reduce((s, t) => s + Math.abs(t.pnl), 0)
  const profitFactor = grossLoss ? grossWin / grossLoss : null
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss

  // rMultiple is computed server-side (pnl / risk) and arrives on the trade.
  const rValues = trades.map(t => t.rMultiple).filter(r => r != null)
  const avgR    = rValues.length ? rValues.reduce((s, r) => s + r, 0) / rValues.length : null

  const biggestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0
  const fullPortCount = trades.filter(t => t.fullPort).length

  // equity curve: sorted by entry time, running cumsum
  const sorted = [...trades].sort((a, b) => new Date(a.entryTimeUtc) - new Date(b.entryTimeUtc))
  let running = 0
  const equity = sorted.map(t => { running += t.pnl; return { date: t.entryTimeUtc, equity: running } })

  return { netPnl, winRate, avgWin, avgLoss, profitFactor, expectancy, avgR,
           biggestLoss, fullPortCount, totalTrades: trades.length, equity,
           wins: wins.length, losses: losses.length }
}

// Modelled on the reference's balance card: a dimmed label above an oversized
// figure, with the fractional part dropped to grey so the eye lands on the whole
// number first.
function Stat({ label, value, sub, icon: Icon, color = 'text-bright' }) {
  const [whole, fraction] = String(value).split(/(\.\d+$)/)
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted uppercase tracking-wider">
        {Icon && <Icon size={12} strokeWidth={2} className="text-violet-soft" />}
        {label}
      </div>
      <div className={`text-[26px] leading-tight font-semibold mt-1.5 tnum tracking-tight ${color}`}>
        {whole}{fraction && <span className="text-muted">{fraction}</span>}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5 tnum">{sub}</div>}
    </div>
  )
}

export default function Dashboard({ trades, accounts = [], onGo }) {
  const s = computeStats(trades)

  if (!s) return <EmptyDashboard openCount={trades.filter(t => t.entryStage === 'pending_exit').length} onGo={onGo} />

  const fmt = (n, d = 2) => n == null ? '—' : n.toFixed(d)

  return (
    <div className="space-y-4">
      {/* Key stats grid */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 items-start">
        <BalanceCard
          netPnl={s.netPnl}
          accounts={accounts}
          openCount={trades.filter(t => t.entryStage === 'pending_exit').length}
          totalTrades={s.totalTrades}
        />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Win Rate"      value={`${(s.winRate * 100).toFixed(1)}%`} icon={Target}
                                    sub={`${s.wins}W / ${s.losses}L`} />
          <Stat label="Profit Factor" value={s.profitFactor ? fmt(s.profitFactor) : '∞'} icon={Scale}
                                      color={s.profitFactor >= 1 ? 'text-gain' : 'text-loss'} />
          <Stat label="Expectancy"    value={`$${fmt(s.expectancy)}`} icon={Activity}
                                      color={s.expectancy >= 0 ? 'text-gain' : 'text-loss'} />
          <Stat label="Avg R"         value={s.avgR != null ? `${fmt(s.avgR)}R` : '—'} icon={TrendingUp} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Avg Win"       value={`$${fmt(s.avgWin)}`}   color="text-gain" />
        <Stat label="Avg Loss"      value={`$${fmt(s.avgLoss)}`}  color="text-loss" />
        <Stat label="Total Trades"  value={s.totalTrades} />
        <Stat label="Biggest Loss"  value={`$${fmt(Math.abs(s.biggestLoss))}`} color="text-loss" />
      </div>

      {/* Danger zone */}
      {(s.fullPortCount > 0 || s.biggestLoss < -200) && (
        <div className="rounded-[24px] border border-black bg-loss-bg/70 p-4 flex items-start gap-3.5 backdrop-blur-sm">
          <AlertTriangle size={18} strokeWidth={2} className="text-loss mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            {s.fullPortCount > 0 && (
              <p className="text-loss/90">
                <strong>{s.fullPortCount}</strong> full-port trade{s.fullPortCount !== 1 ? 's' : ''} logged.
              </p>
            )}
            {s.biggestLoss < -200 && (
              <p className="text-loss/90">
                Biggest single loss: <strong>${Math.abs(s.biggestLoss).toFixed(2)}</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Equity curve (simple) */}
      <div className="card p-5">
        <div className="flex items-center gap-2 text-[11px] text-muted uppercase tracking-wider mb-4">
          <LineChart size={13} strokeWidth={2} className="text-violet-soft" />
          Equity Curve
        </div>
        <EquityCurve points={s.equity} />
      </div>

      {/* Daily P&L calendar */}
      <PnlCalendar trades={trades} />

      {/* Discipline mirror */}
      <DisciplineMirror trades={trades} />

      {/* Per-setup breakdown */}
      <SetupTable trades={trades} />
    </div>
  )
}

function splitStats(allTrades) {
  const group = allTrades.filter(t => t.pnl != null)
  const pnl  = group.reduce((s, t) => s + t.pnl, 0)
  const wins = group.filter(t => t.outcome === 'Win').length
  const losses = group.filter(t => t.outcome === 'Loss').length
  const winRate = wins + losses ? wins / (wins + losses) : 0
  return { count: group.length, pnl, winRate }
}

function DisciplineMirror({ trades }) {
  // Checklist followed vs not
  // `followedChecklist` is nullable now: unanswered is neither followed nor
  // skipped, and lumping it in with "skipped" would invent an answer.
  const followed = splitStats(trades.filter(t => t.followedChecklist === true))
  const skipped  = splitStats(trades.filter(t => t.followedChecklist === false))

  // Calm vs not-calm, on the emotional axis Task 3 split out
  const calm    = splitStats(trades.filter(t => t.emotionalState === 'Calm'))
  const notCalm = splitStats(trades.filter(t => t.emotionalState && t.emotionalState !== 'Calm'))

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2 text-[11px] text-muted uppercase tracking-wider">
        <ShieldCheck size={13} strokeWidth={2} className="text-violet-soft" />
        Discipline Mirror
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <MirrorPair
          title="Checklist"
          good={{ label: 'Followed', ...followed }}
          bad={{ label: 'Skipped',  ...skipped }}
        />
        <MirrorPair
          title="Emotional State"
          good={{ label: 'Calm',     ...calm }}
          bad={{ label: 'Not calm',  ...notCalm }}
        />
      </div>
    </div>
  )
}

function MirrorSide({ data }) {
  return (
    <div className="flex-1">
      <div className="text-xs text-gray-500 mb-1">{data.label}</div>
      <div className={`text-lg font-bold ${data.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
        {data.count === 0 ? '—' : `${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(0)}`}
      </div>
      <div className="text-xs text-gray-500">
        {data.count === 0 ? 'no trades' : `${data.count} trades · ${(data.winRate * 100).toFixed(0)}% win`}
      </div>
    </div>
  )
}

function MirrorPair({ title, good, bad }) {
  return (
    <div className="glass rounded-[16px] p-3.5">
      <div className="text-xs font-medium text-faint mb-2">{title}</div>
      <div className="flex gap-3">
        <MirrorSide data={good} />
        <div className="w-px bg-line" />
        <MirrorSide data={bad} />
      </div>
    </div>
  )
}

function EquityCurve({ points }) {
  if (points.length < 2) return <p className="text-gray-600 text-sm">Need more trades.</p>

  const values = points.map(p => p.equity)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const range = max - min || 1
  const W = 600, H = 120, PAD = 8

  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2))
  const ys = points.map(p => H - PAD - ((p.equity - min) / range) * (H - PAD * 2))
  const zeroY = H - PAD - ((0 - min) / range) * (H - PAD * 2)

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
  const area = `${xs[0]},${zeroY} ` + xs.map((x, i) => `${x},${ys[i]}`).join(' ') + ` ${xs[xs.length - 1]},${zeroY}`

  const lastVal = values[values.length - 1]
  const isUp = lastVal >= 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="rgb(124 124 134 / 0.35)" strokeWidth="1" />
      <polygon points={area} fill={isUp ? 'rgb(52 199 89 / 0.12)' : 'rgb(255 69 58 / 0.12)'} />
      <polyline points={polyline} fill="none" stroke={isUp ? '#34c759' : '#ff453a'} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function SetupTable({ trades }) {
  const bySetup = {}
  for (const t of trades) {
    if (t.pnl == null) continue
    const setup = t.technicalSetup ?? t.legacySetup ?? 'Unrecorded'
    if (!bySetup[setup]) bySetup[setup] = { trades: 0, wins: 0, pnl: 0 }
    bySetup[setup].trades++
    if (t.outcome === 'Win') bySetup[setup].wins++
    bySetup[setup].pnl += t.pnl
  }

  const rows = Object.entries(bySetup).sort((a, b) => b[1].pnl - a[1].pnl)

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-[11px] text-muted uppercase tracking-wider mb-4">
        <Layers size={13} strokeWidth={2} className="text-violet-soft" />
        Performance by Setup
      </div>
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col style={{width: '60px'}} />
          <col style={{width: '60px'}} />
          <col style={{width: '90px'}} />
        </colgroup>
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="pb-2">Setup</th>
            <th className="pb-2 text-right">Trades</th>
            <th className="pb-2 text-right">Win %</th>
            <th className="pb-2 text-right">Net P&L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map(([setup, s]) => (
            <tr key={setup} className={RISKY_TECHNICAL_SETUPS.has(setup) ? 'text-loss' : 'text-faint'}>
              <td className="py-2 text-xs pr-2">{RISKY_TECHNICAL_SETUPS.has(setup) && '⚠ '}{setup}</td>
              <td className="py-2 text-right text-gray-400">{s.trades}</td>
              <td className="py-2 text-right text-gray-400">
                {((s.wins / s.trades) * 100).toFixed(0)}%
              </td>
              <td className={`py-2 text-right font-semibold ${s.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                {s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Before the first closed trade there is nothing to compute, so say what will
// be here and how to get it there — rather than a page of zeros.
function EmptyDashboard({ openCount, onGo }) {
  const coming = [
    { icon: LineChart, title: 'Equity curve', text: 'Your running P&L, trade by trade.' },
    { icon: CalendarDays, title: 'P&L calendar', text: 'Green and red days at a glance.' },
    { icon: ShieldCheck, title: 'Discipline mirror', text: 'Results when you followed the checklist versus when you did not.' },
    { icon: Target, title: 'Win rate, expectancy, R', text: 'Computed from closed trades, with futures priced per point.' },
  ]
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <section className="card p-6 sm:p-8 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-violet/20 text-violet-soft flex items-center justify-center">
          <LineChart size={24} strokeWidth={2} />
        </div>
        <h2 className="text-xl font-semibold text-bright tracking-tight">
          {openCount ? 'No closed trades yet' : 'No trades yet'}
        </h2>
        <p className="text-sm text-faint max-w-md mx-auto">
          {openCount
            ? `You have ${openCount} open trade${openCount === 1 ? '' : 's'}. Stats start with the first close — add the exit in History, or import it from Tradovate.`
            : 'Stats appear here once your first trade is closed. Log one before you enter, or import your Tradovate fills.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {openCount
            ? <EmptyAction primary icon={FileUp} label={`Close ${openCount === 1 ? 'it' : 'them'} in History`} onClick={() => onGo?.('history')} />
            : <EmptyAction primary icon={PlusCircle} label="Log a trade" onClick={() => onGo?.('log')} />}
          <EmptyAction icon={ClipboardCheck} label="Write today's plan" onClick={() => onGo?.('session')} />
          {!openCount && <EmptyAction icon={FileUp} label="Import from Tradovate" onClick={() => onGo?.('history')} />}
        </div>
      </section>
      <div className="grid sm:grid-cols-2 gap-3">
        {coming.map(c => (
          <div key={c.title} className="card px-4 py-3.5 flex items-start gap-3 opacity-80">
            <c.icon size={18} strokeWidth={2} className="text-violet-soft mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-bright">{c.title}</p>
              <p className="text-xs text-muted mt-0.5">{c.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyAction({ icon: Icon, label, onClick, primary = false }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-sm px-4 py-2 rounded-xl inline-flex items-center gap-1.5 transition ${
        primary ? 'bg-violet text-white hover:brightness-110' : 'border border-line bg-surface-2 text-faint hover:text-bright hover:bg-surface-3'
      }`}>
      <Icon size={15} strokeWidth={2} /> {label}
    </button>
  )
}
