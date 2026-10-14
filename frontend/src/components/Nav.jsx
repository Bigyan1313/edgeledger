import { LayoutDashboard, ClipboardCheck, PlusCircle, List, Calculator, User, LogOut } from 'lucide-react'

const TABS = [
  { id: 'dashboard', label: 'Dashboard',   icon: LayoutDashboard },
  // Before Log Trade, because that is the order they are used in.
  { id: 'session',   label: 'Session',     icon: ClipboardCheck },
  { id: 'log',       label: 'Log Trade',   icon: PlusCircle },
  { id: 'history',   label: 'History',     icon: List },
  { id: 'calc',      label: 'Calculators', icon: Calculator },
  { id: 'profile',   label: 'Profile',     icon: User },
]

export default function Nav({ active, onChange, user, onLogout, openCount = 0 }) {
  return (
    <nav className="border-b border-line bg-ink/70 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
      <div className="flex items-center gap-2 sm:gap-5 min-w-0">
        <span className="text-[15px] font-semibold tracking-tight py-3.5 shrink-0">
          Edge<span className="text-emerald-400">Ledger</span>
        </span>

        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`px-3 py-3.5 text-[13px] whitespace-nowrap transition-colors relative flex items-center gap-1.5 ${
                active === tab.id ? 'text-bright' : 'text-muted hover:text-faint'
              }`}
            >
              <tab.icon size={14} strokeWidth={2} />
              {tab.label}
              {/* Trades still awaiting their Stage B close. */}
              {tab.id === 'history' && openCount > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet/20 text-violet-soft align-middle tnum">
                  {openCount}
                </span>
              )}
              {active === tab.id && (
                <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-violet-soft rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="text-xs text-muted hidden md:inline">
          {user?.displayName || user?.email}
        </span>
        <span className="w-7 h-7 rounded-full bg-violet/25 text-violet-soft text-[11px] font-semibold flex items-center justify-center shrink-0">
          {(user?.displayName || user?.email || '?').slice(0, 2).toUpperCase()}
        </span>
        <button
          onClick={onLogout}
          className="text-xs px-3 py-1.5 border border-line bg-surface-2 rounded-lg text-faint hover:text-bright hover:bg-surface-3 transition-colors flex items-center gap-1.5"
        >
          <LogOut size={13} strokeWidth={2} />
          Log out
        </button>
      </div>
    </nav>
  )
}
