const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'log',       label: 'Log Trade' },
  { id: 'history',   label: 'History' },
  { id: 'calc',      label: 'Calculators' },
]

export default function Nav({ active, onChange, user, onLogout }) {
  return (
    <nav className="border-b border-line bg-ink/80 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
      <div className="flex items-center gap-2 sm:gap-5 min-w-0">
        <span className="text-[15px] font-semibold tracking-tight py-3.5 shrink-0">
          Edge<span className="text-emerald-400">Ledger</span>
        </span>

        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`px-3 py-3.5 text-[13px] whitespace-nowrap transition-colors relative ${
                active === tab.id ? 'text-white' : 'text-muted hover:text-gray-200'
              }`}
            >
              {tab.label}
              {active === tab.id && (
                <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-emerald-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="text-xs text-muted hidden md:inline">
          {user?.displayName || user?.email}
        </span>
        <span className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-medium flex items-center justify-center shrink-0">
          {(user?.displayName || user?.email || '?').slice(0, 2).toUpperCase()}
        </span>
        <button
          onClick={onLogout}
          className="text-xs px-3 py-1.5 border border-line rounded-lg text-faint hover:text-white hover:border-gray-600 transition-colors"
        >
          Log out
        </button>
      </div>
    </nav>
  )
}
