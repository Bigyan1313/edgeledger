import PnlCalendar from './PnlCalendar.jsx'

function realizedR(trade) {
  const { direction, entryPrice: e, stopLoss: sl, exitPrice: ex, riskDollars: rd, pnl } = trade
  if (e && sl && ex) {
    const risk = direction === 'long' ? e - sl : sl - e
    if (risk > 0) return direction === 'long' ? (ex - e) / risk : (e - ex) / risk
  }
  if (rd && pnl !== null) return pnl / rd
  return null
}

function computeStats(trades) {
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

  const rValues = trades.map(realizedR).filter(r => r !== null)
  const avgR    = rValues.length ? rValues.reduce((s, r) => s + r, 0) / rValues.length : null

  const biggestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0
  const fullPortCount = trades.filter(t => t.fullPort).length

  // equity curve: sorted by date, running cumsum
  const sorted = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date))
  let running = 0
  const equity = sorted.map(t => { running += t.pnl; return { date: t.date, equity: running } })

  return { netPnl, winRate, avgWin, avgLoss, profitFactor, expectancy, avgR,
           biggestLoss, fullPortCount, totalTrades: trades.length, equity,
           wins: wins.length, losses: losses.length }
}

function Stat({ label, value, sub, color = 'text-gray-100' }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-3.5 py-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Dashboard({ trades }) {
  const s = computeStats(trades)

  if (!s) {
    return (
      <div className="text-center py-16 text-gray-600">
        Log your first trade to see stats.
      </div>
    )
  }

  const pnlColor = s.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
  const fmt = (n, d = 2) => n == null ? '—' : n.toFixed(d)
  const fmtDollar = n => `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`

  return (
    <div className="space-y-4">
      {/* Key stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label="Net P&L"       value={fmtDollar(s.netPnl)}          color={pnlColor} />
        <Stat label="Win Rate"      value={`${(s.winRate * 100).toFixed(1)}%`}
                                    sub={`${s.wins}W / ${s.losses}L`} />
        <Stat label="Profit Factor" value={s.profitFactor ? fmt(s.profitFactor) : '∞'}
                                    color={s.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400'} />
        <Stat label="Expectancy"    value={`$${fmt(s.expectancy)}`}
                                    color={s.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label="Avg R"         value={s.avgR != null ? `${fmt(s.avgR)}R` : '—'} />
        <Stat label="Avg Win"       value={`$${fmt(s.avgWin)}`}   color="text-emerald-400" />
        <Stat label="Avg Loss"      value={`$${fmt(s.avgLoss)}`}  color="text-red-400" />
        <Stat label="Total Trades"  value={s.totalTrades} />
      </div>

      {/* Danger zone */}
      {(s.fullPortCount > 0 || s.biggestLoss < -200) && (
        <div className="bg-red-950/60 border border-red-800/60 rounded-xl p-4 flex items-start gap-4">
          <span className="text-red-400 text-xl mt-0.5">⚠</span>
          <div className="space-y-1 text-sm">
            {s.fullPortCount > 0 && (
              <p className="text-red-300">
                <strong>{s.fullPortCount}</strong> full-port trade{s.fullPortCount !== 1 ? 's' : ''} logged.
              </p>
            )}
            {s.biggestLoss < -200 && (
              <p className="text-red-300">
                Biggest single loss: <strong>${Math.abs(s.biggestLoss).toFixed(2)}</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Equity curve (simple) */}
      <div className="bg-surface border border-line rounded-xl p-4">
        <div className="text-[11px] text-muted mb-3">Equity Curve</div>
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

function splitStats(group) {
  const pnl  = group.reduce((s, t) => s + t.pnl, 0)
  const wins = group.filter(t => t.outcome === 'Win').length
  const losses = group.filter(t => t.outcome === 'Loss').length
  const winRate = wins + losses ? wins / (wins + losses) : 0
  return { count: group.length, pnl, winRate }
}

function DisciplineMirror({ trades }) {
  // Checklist followed vs not
  const followed = splitStats(trades.filter(t => t.followedChecklist))
  const skipped  = splitStats(trades.filter(t => !t.followedChecklist))

  // Calm vs not-calm
  const calm    = splitStats(trades.filter(t => t.emotionBefore === 'Calm'))
  const notCalm = splitStats(trades.filter(t => t.emotionBefore && t.emotionBefore !== 'Calm'))

  return (
    <div className="bg-surface border border-line rounded-xl p-4 space-y-4">
      <div className="text-[11px] text-muted">Discipline Mirror</div>
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

function MirrorPair({ title, good, bad }) {
  const Side = ({ data, tone }) => (
    <div className="flex-1">
      <div className="text-xs text-gray-500 mb-1">{data.label}</div>
      <div className={`text-lg font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {data.count === 0 ? '—' : `${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(0)}`}
      </div>
      <div className="text-xs text-gray-500">
        {data.count === 0 ? 'no trades' : `${data.count} trades · ${(data.winRate * 100).toFixed(0)}% win`}
      </div>
    </div>
  )
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <div className="text-xs font-medium text-faint mb-2">{title}</div>
      <div className="flex gap-3">
        <Side data={good} tone="good" />
        <div className="w-px bg-line" />
        <Side data={bad} tone="bad" />
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
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#374151" strokeWidth="1" />
      <polygon points={area} fill={isUp ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)'} />
      <polyline points={polyline} fill="none" stroke={isUp ? '#34d399' : '#ef4444'} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function SetupTable({ trades }) {
  const DANGER = new Set(['Anticipation (no confirmation)', 'FOMO / Impulsive', 'News / Full-port', 'Revenge'])

  const bySetup = {}
  for (const t of trades) {
    if (!bySetup[t.setup]) bySetup[t.setup] = { trades: 0, wins: 0, pnl: 0 }
    bySetup[t.setup].trades++
    if (t.outcome === 'Win') bySetup[t.setup].wins++
    bySetup[t.setup].pnl += t.pnl
  }

  const rows = Object.entries(bySetup).sort((a, b) => b[1].pnl - a[1].pnl)

  return (
    <div className="bg-surface border border-line rounded-xl p-4">
      <div className="text-[11px] text-muted mb-3">Performance by Setup</div>
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
            <tr key={setup} className={DANGER.has(setup) ? 'text-red-400' : 'text-gray-300'}>
              <td className="py-2 text-xs pr-2">{DANGER.has(setup) && '⚠ '}{setup}</td>
              <td className="py-2 text-right text-gray-400">{s.trades}</td>
              <td className="py-2 text-right text-gray-400">
                {((s.wins / s.trades) * 100).toFixed(0)}%
              </td>
              <td className={`py-2 text-right font-semibold ${s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
