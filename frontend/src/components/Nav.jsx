const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'log',       label: 'Log Trade' },
  { id: 'history',   label: 'History' },
  { id: 'calc',      label: 'Calculators' },
]

export default function Nav({ active, onChange, user, onLogout }) {
  return (
    <nav className="border-b border-gray-800 px-6 py-0 flex items-center justify-between gap-4">
      <span className="text-white font-semibold tracking-tight py-4 shrink-0">
        Edge<span className="text-emerald-400">Ledger</span>
      </span>

      <div className="flex">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-4 text-sm font-medium border-b-2 transition-colors ${
              active === tab.id
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 shrink-0 ml-auto">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {user?.displayName || user?.email}
        </span>
        <button
          onClick={onLogout}
          className="text-xs px-3 py-1.5 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        >
          Log out
        </button>
      </div>
    </nav>
  )
}
