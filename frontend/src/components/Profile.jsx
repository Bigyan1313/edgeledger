import { useEffect, useState } from 'react'
import { profileApi } from '../api/profile.js'
import { BROKER_PLATFORMS, detectTimezone } from '../constants/trade.js'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD']

// A short, real list beats a 400-entry dropdown nobody scrolls. "Use my current
// zone" covers everyone else.
const COMMON_ZONES = [
  'America/Chicago', 'America/New_York', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Asia/Kathmandu', 'Asia/Tokyo',
  'Asia/Dubai', 'Australia/Sydney', 'UTC',
]

const EMPTY = {
  displayName: '', timezone: '', baseCurrency: '',
  defaultBrokerPlatform: '', defaultBrokerAccountId: '', defaultRiskPercent: '',
}

export default function Profile({ onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [email, setEmail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    profileApi.get()
      .then(p => {
        if (cancelled) return
        setEmail(p.email)
        setForm({
          displayName: p.displayName ?? '',
          timezone: p.timezone ?? '',
          baseCurrency: p.baseCurrency ?? '',
          defaultBrokerPlatform: p.defaultBrokerPlatform ?? '',
          defaultBrokerAccountId: p.defaultBrokerAccountId ?? '',
          defaultRiskPercent: p.defaultRiskPercent ?? '',
        })
      })
      .catch(err => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }; delete next[field]; return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null); setFieldErrors({}); setSaving(true)
    try {
      const updated = await profileApi.save({
        ...form,
        defaultRiskPercent: form.defaultRiskPercent === '' ? null : Number(form.defaultRiskPercent),
      })
      setSaved(true)
      onSaved?.(updated)
    } catch (err) {
      setError(err.message)
      setFieldErrors(Object.fromEntries((err.fieldErrors ?? []).map(f => [f.field, f.message])))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-center py-16 text-gray-600">Loading your profile…</p>

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Profile</h2>
        <p className="text-xs text-muted mt-1">
          {email} · everything here is optional
        </p>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-gray-300 mb-2">You</legend>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Display name" error={fieldErrors.displayName}>
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)}
              placeholder="Shown instead of your email" className={inputCls(fieldErrors.displayName)} />
          </Field>
          <Field label="Base currency" hint="display only" error={fieldErrors.baseCurrency}>
            <select value={form.baseCurrency} onChange={e => set('baseCurrency', e.target.value)}
              className={inputCls(fieldErrors.baseCurrency)}>
              <option value="">Not set</option>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Journal timezone" hint="how your entry times are read" error={fieldErrors.timezone}>
          <div className="flex gap-2">
            <select value={form.timezone} onChange={e => set('timezone', e.target.value)}
              className={`${inputCls(fieldErrors.timezone)} min-w-0`}>
              <option value="">Detect from this browser</option>
              {COMMON_ZONES.map(z => <option key={z}>{z}</option>)}
              {form.timezone && !COMMON_ZONES.includes(form.timezone) && <option>{form.timezone}</option>}
            </select>
            <button type="button" onClick={() => set('timezone', detectTimezone())}
              className="px-3 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 shrink-0 whitespace-nowrap">
              Use {detectTimezone()}
            </button>
          </div>
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium text-gray-300 mb-1">Defaults for new trades</legend>
        <p className="text-xs text-muted -mt-1 mb-2">
          These prefill the pre-trade form. They save typing on the fields that are the same
          every time — they are never saved to a trade unless you save that trade.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Platform" error={fieldErrors.defaultBrokerPlatform}>
            <select value={form.defaultBrokerPlatform} onChange={e => set('defaultBrokerPlatform', e.target.value)}
              className={inputCls(fieldErrors.defaultBrokerPlatform)}>
              <option value="">Not set</option>
              {BROKER_PLATFORMS.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Broker account" error={fieldErrors.defaultBrokerAccountId}>
            <input value={form.defaultBrokerAccountId} onChange={e => set('defaultBrokerAccountId', e.target.value)}
              placeholder="e.g. 5039284" className={inputCls(fieldErrors.defaultBrokerAccountId)} />
          </Field>
          <Field label="Risk per trade (%)" error={fieldErrors.defaultRiskPercent}>
            <input type="number" step="any" min="0" max="100" value={form.defaultRiskPercent}
              onChange={e => set('defaultRiskPercent', e.target.value)}
              placeholder="e.g. 1" className={inputCls(fieldErrors.defaultRiskPercent)} />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  )
}

function Field({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal text-gray-600">{hint}</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

const baseInput = 'bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none w-full'
const inputCls = (error) =>
  `${baseInput} ${error ? 'border-red-600 focus:border-red-500' : 'border-gray-700 focus:border-emerald-500'}`
