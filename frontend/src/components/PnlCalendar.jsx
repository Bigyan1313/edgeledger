import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Bucket key for a trade's LOCAL calendar day.
const dayKey = (y, m, d) => `${y}-${m}-${d}`

export default function PnlCalendar({ trades }) {
  // Aggregate trades by local day: { pnl, count, wins, losses }.
  const byDay = useMemo(() => {
    const map = {}
    for (const t of trades) {
      if (t.pnl == null) continue
      const d = new Date(t.entryTimeUtc)
      const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate())
      if (!map[k]) map[k] = { pnl: 0, count: 0, wins: 0, losses: 0 }
      map[k].pnl += t.pnl
      map[k].count++
      if (t.outcome === 'Win') map[k].wins++
      else if (t.outcome === 'Loss') map[k].losses++
    }
    return map
  }, [trades])

  // Start on the most recent trade's month so data is visible immediately.
  const latest = useMemo(() => {
    if (!trades.length) return new Date()
    return trades.reduce((acc, t) => {
      const d = new Date(t.entryTimeUtc)
      return d > acc ? d : acc
    }, new Date(0))
  }, [trades])

  const [view, setView] = useState(() => ({ year: latest.getFullYear(), month: latest.getMonth() }))
  const { year, month } = view

  const first = new Date(year, month, 1)
  const startWeekday = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Leading blanks for the first week, then the days.
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // Month stats + max magnitude (for heatmap intensity).
  let maxAbs = 0, monthPnl = 0, greenDays = 0, redDays = 0, tradingDays = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const day = byDay[dayKey(year, month, d)]
    if (!day) continue
    tradingDays++
    monthPnl += day.pnl
    maxAbs = Math.max(maxAbs, Math.abs(day.pnl))
    if (day.pnl > 0) greenDays++
    else if (day.pnl < 0) redDays++
  }

  // Colour is carried as translucent light over the glass cell rather than as a
  // painted swatch, so the page reads through and the heaviest days still stand
  // out by intensity alone.
  const tint = (pnl) => {
    if (pnl === 0) return 'rgb(124 124 134 / 0.10)'
    const a = maxAbs ? 0.10 + 0.20 * Math.min(1, Math.abs(pnl) / maxAbs) : 0.15
    return pnl > 0 ? `rgb(52 199 89 / ${a})` : `rgb(255 69 58 / ${a})`
  }

  const go = (delta) => setView(v => {
    const n = v.month + delta
    return { year: v.year + Math.floor(n / 12), month: ((n % 12) + 12) % 12 }
  })

  const monthLabel = first.toLocaleString('default', { month: 'long', year: 'numeric' })
  const money = n => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}`

  const navBtn = 'w-7 h-7 flex items-center justify-center rounded-lg bg-surface-2 border border-line text-faint hover:text-bright hover:bg-surface-3 transition-colors'

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[11px] text-muted uppercase tracking-wider">
          <CalendarDays size={13} strokeWidth={2} className="text-violet-soft" />
          P&L Calendar
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(-1)} className={navBtn} aria-label="Previous month">
            <ChevronLeft size={15} strokeWidth={2.25} />
          </button>
          <span className="text-xs text-faint w-32 text-center tnum">{monthLabel}</span>
          <button type="button" onClick={() => go(1)} className={navBtn} aria-label="Next month">
            <ChevronRight size={15} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[10px] text-muted text-center py-1 uppercase tracking-wide">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const day = byDay[dayKey(year, month, d)]
          const decided = day ? day.wins + day.losses : 0
          const wr = decided ? Math.round((day.wins / decided) * 100) : null
          return (
            <div
              key={i}
              style={day ? { backgroundColor: tint(day.pnl) } : undefined}
              className={`rounded-[14px] p-2 min-h-[68px] flex flex-col transition-colors ${
                day
                  ? 'border border-black/70 backdrop-blur-[8px] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]'
                  : 'border border-line-soft/60 bg-surface-2/25'
              }`}
            >
              <div className="text-[10px] text-muted leading-none tnum">{d}</div>
              {day && (
                <div className="mt-auto">
                  <div className={`text-[13px] font-semibold leading-tight tnum ${day.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {money(day.pnl)}
                  </div>
                  <div className="text-[9px] text-muted leading-tight tnum">
                    {day.count} {day.count === 1 ? 'trade' : 'trades'}{wr !== null ? ` · ${wr}%` : ''}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-line text-[11px] text-muted">
        <span>
          Month:{' '}
          <span className={monthPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(monthPnl)}</span>
        </span>
        <span>{tradingDays} trading {tradingDays === 1 ? 'day' : 'days'}</span>
        <span className="text-emerald-400">{greenDays} green</span>
        <span className="text-red-400">{redDays} red</span>
      </div>
    </div>
  )
}
