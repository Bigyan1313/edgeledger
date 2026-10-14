import { Fragment, useMemo, useState } from 'react'
import { FileUp, X, CheckCircle2, AlertTriangle, HelpCircle, CircleSlash } from 'lucide-react'
import { importsApi } from '../api/imports.js'
import { money } from '../utils/money.js'

// Close trades from Tradovate's own numbers: the free alternative to the API.
// Preview first, untick anything that looks wrong, then close the rest.

const TZ_KEY = 'edgeledger_import_tz'
const rememberedZone = () => { try { return localStorage.getItem(TZ_KEY) || 'America/Chicago' } catch { return 'America/Chicago' } }
const ZONES = ['America/Chicago', 'America/New_York', 'Europe/London', 'UTC']

const STATUS = {
  will_close: { label: 'Will close', icon: CheckCircle2, cls: 'text-gain' },
  problem: { label: 'Needs a look', icon: AlertTriangle, cls: 'text-warn' },
  already_closed: { label: 'Already closed', icon: CheckCircle2, cls: 'text-muted' },
  ambiguous: { label: 'Ambiguous', icon: HelpCircle, cls: 'text-warn' },
  not_in_journal: { label: 'Not in journal', icon: CircleSlash, cls: 'text-loss/80' },
}

export default function TradovateImport({ accounts, onClose, onApplied }) {
  const [csv, setCsv] = useState(null)
  const [fileName, setFileName] = useState('')
  const [timezone, setTimezone] = useState(rememberedZone)
  const [accountId, setAccountId] = useState('')
  const [preview, setPreview] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const pick = async (file) => {
    if (!file) return
    setFileName(file.name)
    setCsv(await file.text())
    setPreview(null); setDone(null); setError(null)
  }

  const runPreview = async () => {
    setBusy(true); setError(null); setDone(null)
    try {
      const p = await importsApi.previewTradovate({ csv, timezone, accountId: accountId || null })
      setPreview({ ...p, timezone })
      setChosen(new Set(p.rows.filter(r => r.status === 'will_close' && !r.problems.length).map(r => r.trade.id)))
      try { localStorage.setItem(TZ_KEY, timezone) } catch { /* a remembered zone is a convenience only */ }
    } catch (err) {
      setError(err.message + (err.found ? ` Columns found: ${err.found.join(', ')}.` : ''))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true); setError(null)
    try {
      const r = await importsApi.applyTradovate({ csv, timezone, accountId: accountId || null, tradeIds: [...chosen] })
      setDone(r.closed.length)
      setPreview({ ...r, timezone })
      setChosen(new Set())
      onApplied()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => (preview?.rows ?? []).map(r => ({
    ...r, key: r.status === 'will_close' && r.problems.length ? 'problem' : r.status,
  })), [preview])

  const toggle = (id) => setChosen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-label="Import Tradovate fills">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full sm:max-w-4xl max-h-[92vh] flex flex-col rounded-b-none sm:rounded-[var(--radius-card)]">
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line-soft">
          <div>
            <h2 className="text-base font-semibold text-bright flex items-center gap-2"><FileUp size={17} strokeWidth={2} className="text-violet-soft" />Import from Tradovate</h2>
            <p className="text-xs text-muted mt-0.5">Account Reports → Performance → download as CSV. Closes your open trades with the broker's exit and P&L.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface-2"><X size={17} /></button>
        </header>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">CSV file</span>
              <span className="relative flex items-center gap-2 bg-surface-2 border border-line rounded-xl px-3 py-2.5 text-sm text-faint cursor-pointer hover:border-violet-soft/60">
                <FileUp size={15} /> <span className="truncate">{fileName || 'Choose Performance.csv'}</span>
                <input type="file" accept=".csv,text/csv" className="absolute inset-0 opacity-0 cursor-pointer" aria-label="CSV file" onChange={e => pick(e.target.files?.[0])} />
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Times shown in</span>
              <input list="import-zones" value={timezone} onChange={e => setTimezone(e.target.value)}
                className="bg-surface-2 border border-line rounded-xl px-3 py-2.5 text-sm text-bright focus:outline-none focus:border-violet-soft/70" />
              <datalist id="import-zones">{ZONES.map(z => <option key={z} value={z} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Match against</span>
              <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="bg-surface-2 border border-line rounded-xl px-3 py-2.5 text-sm text-bright focus:outline-none">
                <option value="">All accounts</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted">
            The timezone your Tradovate platform displays — for futures it is usually Central (an 08:31 fill is one
            minute after the 9:30 New York open). If nothing matches, this is the first thing to check.
          </p>

          <button type="button" onClick={runPreview} disabled={!csv || busy}
            className="w-full py-2.5 rounded-xl border border-violet/40 bg-violet/15 text-violet-soft font-semibold hover:bg-violet/25 disabled:opacity-40 transition-colors">
            {busy && !preview ? 'Reading…' : 'Preview'}
          </button>

          {error && <p className="text-sm text-loss/90 rounded-xl border border-loss/40 bg-loss-bg/70 px-3 py-2">{error}</p>}
          {done !== null && <p className="text-sm text-gain rounded-xl border border-gain/30 bg-gain-bg/70 px-3 py-2">Closed {done} trade{done === 1 ? '' : 's'} from the broker's numbers.</p>}

          {preview && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Chip>{preview.summary.brokerTrades} trades in file</Chip>
                <Chip tone="gain">{preview.summary.willClose} can close</Chip>
                {preview.summary.withProblems > 0 && <Chip tone="warn">{preview.summary.withProblems} need a look</Chip>}
                {preview.summary.alreadyClosed > 0 && <Chip>{preview.summary.alreadyClosed} already closed</Chip>}
                {preview.summary.ambiguous > 0 && <Chip tone="warn">{preview.summary.ambiguous} ambiguous</Chip>}
                {preview.summary.notInJournal > 0 && <Chip tone="loss">{preview.summary.notInJournal} not in journal</Chip>}
              </div>
              {preview.summary.willClose + preview.summary.withProblems + preview.summary.alreadyClosed === 0 && preview.summary.brokerTrades > 0 && (
                <p className="text-sm text-warn/90">Nothing matched your journal. If you did log these trades, check the timezone above.</p>
              )}

              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                      <th className="py-2 pr-2 w-8" />
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Trade</th>
                      <th className="py-2 pr-3 text-right">P&L</th>
                      <th className="py-2 pr-3">Entry</th>
                      <th className="py-2 pr-3">Exit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {rows.map((r, i) => {
                      const S = STATUS[r.key]
                      return (
                        <Fragment key={i}>
                          <tr className="align-top">
                            <td className="py-2.5 pr-2">
                              {r.key === 'will_close' && (
                                <input type="checkbox" aria-label={`Close trade ${r.trade.id}`} checked={chosen.has(r.trade.id)}
                                  onChange={() => toggle(r.trade.id)} className="w-4 h-4 accent-violet" />
                              )}
                            </td>
                            <td className={`py-2.5 pr-3 whitespace-nowrap ${S.cls}`}><span className="inline-flex items-center gap-1.5"><S.icon size={13} strokeWidth={2.25} />{S.label}</span></td>
                            <td className="py-2.5 pr-3 whitespace-nowrap text-bright">
                              {r.broker.symbol} {r.broker.direction} {r.broker.qty}
                              {r.trade && <span className="text-muted"> · #{r.trade.id}</span>}
                            </td>
                            <td className={`py-2.5 pr-3 tnum text-right whitespace-nowrap font-medium ${r.broker.pnl < 0 ? 'text-loss' : r.broker.pnl > 0 ? 'text-gain' : 'text-faint'}`}>{money(r.broker.pnl)}</td>
                            <td className="py-2.5 pr-3 tnum text-faint whitespace-nowrap">
                              {clock(r.broker.entryAt, preview.timezone)} @ {r.broker.entryPrice}
                              {r.trade?.entryPrice != null && r.trade.entryPrice !== r.broker.entryPrice && (
                                <span className="block text-[11px] text-muted">journal @ {r.trade.entryPrice}</span>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 tnum text-faint whitespace-nowrap">{clock(r.broker.exitAt, preview.timezone)} @ {r.broker.exitPrice}</td>
                          </tr>
                          {r.problems.length > 0 && (
                            <tr><td /><td colSpan={5} className="pb-2.5 text-xs text-warn/90">
                              {r.problems.join(' ')} <span className="text-muted">Correct the journal entry with Amend in History, then preview again.</span>
                            </td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {preview.summary.notInJournal > 0 && (
                <p className="text-xs text-muted">
                  "Not in journal" trades are never created here — a journal entry is the plan written before the
                  trade, and an export can only say what happened after. Trades taken outside your session plan
                  can be logged from Log Trade as rule breaks.
                </p>
              )}
              {preview.skippedRows?.length > 0 && <p className="text-xs text-warn/90">{preview.skippedRows.length} row(s) in the file could not be read and were skipped (lines {preview.skippedRows.map(s => s.line).join(', ')}).</p>}
            </>
          )}
        </div>

        {preview && chosen.size > 0 && (
          <footer className="px-5 py-4 border-t border-line-soft pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
            <button type="button" onClick={apply} disabled={busy}
              className="w-full py-3 bg-violet hover:brightness-110 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_10px_30px_-12px_rgb(90_84_232/0.85)] transition">
              {busy ? 'Closing…' : `Close ${chosen.size} trade${chosen.size === 1 ? '' : 's'}`}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function Chip({ tone, children }) {
  const tones = { gain: 'bg-gain-bg text-gain border-gain/30', warn: 'bg-warn-bg text-warn border-warn/30', loss: 'bg-loss-bg text-loss/90 border-loss/30' }
  return <span className={`px-2 py-0.5 rounded-full border ${tones[tone] ?? 'bg-surface-2 text-faint border-line'}`}>{children}</span>
}

// In the export's own zone, 24-hour, as Tradovate writes it ("10/13 08:38:20"),
// so a row reads the same here as in the platform.
function clock(iso, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`
}
