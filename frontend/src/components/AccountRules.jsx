import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { accountsApi, DRAWDOWN_TYPES } from '../api/accounts.js'
import { money } from '../utils/money.js'

// Each account's loss rules, as the firm states them. The journal uses them
// to say, at entry, how far the account is from being lost.
export default function AccountRules({ accounts, onUpdated }) {
  if (!accounts.length) return null
  return (
    <section className="max-w-2xl mx-auto mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-bright tracking-tight flex items-center gap-2">
          <ShieldAlert size={18} strokeWidth={2} className="text-violet-soft" /> Account rules
        </h2>
        <p className="text-xs text-muted mt-1">
          Enter each firm's loss rules once. Log Trade then shows how far the account is from being
          lost — and what the trade you are about to take would leave.
        </p>
      </div>
      {accounts.map(a => <AccountCard key={a.id} account={a} onUpdated={onUpdated} />)}
    </section>
  )
}

const toForm = (a) => ({
  startingBalance: a.startingBalance ?? '',
  dailyLossLimit: a.dailyLossLimit ?? '',
  maxDrawdown: a.maxDrawdown ?? '',
  drawdownType: a.drawdownType ?? '',
  drawdownLockBalance: a.drawdownLockBalance ?? '',
})

function AccountCard({ account, onUpdated }) {
  const [form, setForm] = useState(() => toForm(account))
  const [standing, setStanding] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    accountsApi.standing(account.id).then(s => { if (!cancelled) setStanding(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [account.id, version])

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
    setFieldErrors(fe => { const n = { ...fe }; delete n[field]; return n })
  }

  const save = async () => {
    setSaving(true); setFieldErrors({})
    try {
      const updated = await accountsApi.update(account.id, {
        ...form,
        // A static floor has nothing to lock; clear it rather than send a stale value.
        drawdownLockBalance: form.drawdownType === 'static' ? '' : form.drawdownLockBalance,
      })
      onUpdated(updated)
      setSaved(true)
      setVersion(v => v + 1)
    } catch (err) {
      setFieldErrors(Object.fromEntries((err.fieldErrors ?? [{ field: '_', message: err.message }]).map(f => [f.field, f.message])))
    } finally {
      setSaving(false)
    }
  }

  const trailing = form.drawdownType === 'eod_trailing' || form.drawdownType === 'intraday_trailing'

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-bright">{account.name}</p>
        <StandingLine standing={standing} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label="Starting balance" error={fieldErrors.startingBalance}>
          <Dollar value={form.startingBalance} onChange={v => set('startingBalance', v)} placeholder="50000" error={fieldErrors.startingBalance} />
        </Field>
        <Field label="Daily loss limit" error={fieldErrors.dailyLossLimit}>
          <Dollar value={form.dailyLossLimit} onChange={v => set('dailyLossLimit', v)} placeholder="1000" error={fieldErrors.dailyLossLimit} />
        </Field>
        <Field label="Max drawdown" error={fieldErrors.maxDrawdown}>
          <Dollar value={form.maxDrawdown} onChange={v => set('maxDrawdown', v)} placeholder="2000" error={fieldErrors.maxDrawdown} />
        </Field>
        <Field label="Drawdown type" error={fieldErrors.drawdownType}>
          <select value={form.drawdownType} onChange={e => set('drawdownType', e.target.value)} className={inputCls(fieldErrors.drawdownType)}>
            <option value="">None</option>
            {DRAWDOWN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        {trailing && (
          <Field label="Trail stops at" hint="balance" error={fieldErrors.drawdownLockBalance}>
            <Dollar value={form.drawdownLockBalance} onChange={v => set('drawdownLockBalance', v)} placeholder="e.g. 50100" error={fieldErrors.drawdownLockBalance} />
          </Field>
        )}
      </div>
      {fieldErrors._ && <p className="text-xs text-red-400">{fieldErrors._}</p>}
      {standing?.notes?.length > 0 && standing.status !== 'no_rules' && (
        <ul className="text-[11px] text-muted space-y-0.5">{standing.notes.map(n => <li key={n}>· {n}</li>)}</ul>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 rounded-xl bg-violet text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
          {saving ? 'Saving…' : 'Save rules'}
        </button>
        {saved && <span className="text-sm text-gain">Saved</span>}
      </div>
    </div>
  )
}

function StandingLine({ standing }) {
  if (!standing) return null
  if (!standing.configured) return <span className="text-xs text-muted">Set a starting balance to track it</span>
  const tone = standing.status === 'breached' || standing.status === 'danger' ? 'text-loss' : 'text-faint'
  return (
    <span className={`text-xs tnum ${tone}`}>
      Balance {money(standing.balance)}
      {standing.room != null && <> · <b className="font-semibold">{money(standing.room)}</b> to the {standing.binding === 'daily' ? 'daily limit' : 'drawdown floor'}</>}
    </span>
  )
}

function Dollar({ value, onChange, placeholder, error }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input type="number" inputMode="decimal" step="any" min="0" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className={`${inputCls(error)} pl-7`} />
    </div>
  )
}

function Field({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}{hint && <span className="ml-1.5 normal-case tracking-normal text-gray-600">{hint}</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

const baseInput = 'bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none w-full transition-colors'
const inputCls = (error) => `${baseInput} ${error ? 'border-loss/70 focus:border-loss' : 'border-line focus:border-violet-soft/70'}`
