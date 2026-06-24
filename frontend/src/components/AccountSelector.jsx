import { useState, useRef, useEffect } from 'react'

const PROP_FIRMS = [
  'FTMO', 'FundedNext', 'The Funded Trader', 'MyFundedFX',
  'E8 Markets', 'FunderPro', 'Alpha Capital', 'Topstep', 'Apex', 'Other',
]

export default function AccountSelector({ accounts, value, onChange, onAdd }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef(null)

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setAdding(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = accounts.find(a => a.id === value) || null
  const dot = m => (m === 'Live' ? 'bg-emerald-400' : 'bg-amber-400')

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setAdding(false) }}
        className="flex items-center gap-2 text-xs bg-surface border border-line rounded-lg px-3 py-1.5 hover:border-gray-600 transition-colors"
      >
        {selected ? (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${dot(selected.mode)}`} />
            <span className="text-gray-200 max-w-[140px] truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-muted">Select account</span>
        )}
        <span className="text-muted text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 bg-surface border border-line rounded-xl z-30 overflow-hidden shadow-xl shadow-black/40">
          {adding ? (
            <AddForm
              onCancel={() => setAdding(false)}
              onSave={async (data) => {
                const acct = await onAdd(data)
                onChange(acct.id)
                setAdding(false)
                setOpen(false)
              }}
            />
          ) : (
            <div className="py-1">
              {accounts.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted">No accounts yet.</div>
              )}
              {accounts.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2 ${a.id === value ? 'text-emerald-400' : 'text-gray-200'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot(a.mode)}`} />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-[10px] text-muted shrink-0">
                    {a.mode === 'Demo' && a.propFirm ? a.propFirm : a.mode}
                  </span>
                </button>
              ))}
              {value != null && (
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false) }}
                  className="w-full px-3 py-2 text-left text-xs text-muted hover:bg-surface-2"
                >
                  Clear selection
                </button>
              )}
              <div className="border-t border-line my-1" />
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full px-3 py-2 text-left text-xs text-emerald-400 hover:bg-surface-2"
              >
                + Add account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AddForm({ onSave, onCancel }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('Demo')
  const [firm, setFirm] = useState('Just demo')
  const [otherFirm, setOtherFirm] = useState('')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!name.trim()) { setErr('Account name is required'); return }
    setBusy(true)
    setErr(null)
    try {
      const propFirm =
        mode === 'Demo'
          ? (firm === 'Just demo' ? null : firm === 'Other' ? otherFirm.trim() : firm)
          : null
      await onSave({ name: name.trim(), mode, propFirm, startingBalance: balance })
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  const inp = 'w-full bg-surface-2 border border-line rounded-lg px-2.5 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-emerald-500'

  return (
    // Capture Enter so it saves the account instead of submitting the trade form.
    <div
      className="p-3 space-y-2.5"
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit() } }}
    >
      <div className="text-xs font-medium text-gray-200">New account</div>
      {err && <div className="text-[11px] text-red-400">{err}</div>}

      <input className={inp} placeholder="Account name (e.g. FTMO 100k)" value={name} onChange={e => setName(e.target.value)} autoFocus />

      <div className="flex gap-1.5">
        {['Live', 'Demo'].map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
              mode === m
                ? m === 'Live'
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                  : 'border-amber-500 text-amber-400 bg-amber-500/10'
                : 'border-line text-muted hover:text-gray-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'Demo' && (
        <>
          <select className={inp} value={firm} onChange={e => setFirm(e.target.value)}>
            <option value="Just demo">Just demo (no firm)</option>
            {PROP_FIRMS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {firm === 'Other' && (
            <input className={inp} placeholder="Prop firm name" value={otherFirm} onChange={e => setOtherFirm(e.target.value)} />
          )}
        </>
      )}

      <input className={inp} type="number" step="any" placeholder="Starting balance (optional)" value={balance} onChange={e => setBalance(e.target.value)} />

      <div className="flex gap-2 pt-0.5">
        <button type="button" onClick={submit} disabled={busy} className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold rounded-lg disabled:opacity-50">
          {busy ? 'Saving…' : 'Save account'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-muted hover:text-white">Cancel</button>
      </div>
    </div>
  )
}
