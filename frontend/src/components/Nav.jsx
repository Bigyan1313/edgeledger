import { useState } from 'react'
import {
  Home, LayoutDashboard, ClipboardCheck, PlusCircle, List, CandlestickChart, Calculator, User, LogOut, MoreHorizontal,
} from 'lucide-react'

const TABS = [
  // The day at a glance; also where the logo goes.
  { id: 'home',      label: 'Home',        short: 'Home',    icon: Home },
  { id: 'dashboard', label: 'Dashboard',   short: 'Stats',   icon: LayoutDashboard },
  // Before Log Trade, because that is the order they are used in.
  { id: 'session',   label: 'Session',     short: 'Session', icon: ClipboardCheck },
  { id: 'log',       label: 'Log Trade',   short: 'Log',     icon: PlusCircle },
  { id: 'history',   label: 'History',     short: 'History', icon: List },
  // After the morning — three hours past the open.
  { id: 'review',    label: 'Review',      short: 'Review',  icon: CandlestickChart },
  { id: 'calc',      label: 'Calculators', short: 'Calc',    icon: Calculator },
  { id: 'profile',   label: 'Profile',     short: 'Profile', icon: User },
]

// On a phone, the five used every trading day sit in a bottom bar within
// thumb reach; the rest go behind More.
const BAR = ['home', 'session', 'log', 'history', 'review']
const MORE = ['dashboard', 'calc', 'profile']

export default function Nav({ active, onChange, user, onLogout, openCount = 0, reviewDue = false }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const go = (id) => { setMoreOpen(false); onChange(id) }
  const initials = (user?.displayName || user?.email || '?').slice(0, 2).toUpperCase()

  return (
    <>
      <nav className="border-b border-line bg-ink/70 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 sm:gap-5 min-w-0">
          <button type="button" onClick={() => go('home')} aria-label="EdgeLedger home"
            className="text-[15px] font-semibold tracking-tight py-3.5 shrink-0 hover:opacity-90 transition-opacity">
            Edge<span className="text-emerald-400">Ledger</span>
          </button>

          {/* The full tab row from the small breakpoint up. */}
          <div className="hidden sm:flex items-center gap-0.5 overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => go(tab.id)}
                className={`px-3 py-3.5 text-[13px] whitespace-nowrap transition-colors relative flex items-center gap-1.5 ${
                  active === tab.id ? 'text-bright' : 'text-muted hover:text-faint'
                }`}
              >
                <tab.icon size={14} strokeWidth={2} />
                {tab.label}
                <Badges id={tab.id} openCount={openCount} reviewDue={reviewDue} />
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
            {initials}
          </span>
          <button
            onClick={onLogout}
            className="hidden sm:flex text-xs px-3 py-1.5 border border-line bg-surface-2 rounded-lg text-faint hover:text-bright hover:bg-surface-3 transition-colors items-center gap-1.5"
          >
            <LogOut size={13} strokeWidth={2} />
            Log out
          </button>
        </div>
      </nav>

      {/* Phone: bottom tab bar. */}
      <nav aria-label="Main" className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-ink/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6">
          {BAR.map(id => {
            const tab = TABS.find(t => t.id === id)
            return (
              <BarButton key={id} label={tab.short} icon={tab.icon} active={active === id} onClick={() => go(id)}>
                <Badges id={id} openCount={openCount} reviewDue={reviewDue} compact />
              </BarButton>
            )
          })}
          <BarButton label="More" icon={MoreHorizontal} active={moreOpen || MORE.includes(active)} onClick={() => setMoreOpen(o => !o)} />
        </div>
      </nav>

      {moreOpen && (
        <div className="sm:hidden fixed inset-0 z-20" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div role="menu" onClick={e => e.stopPropagation()}
            className="absolute right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] w-52 card p-1.5">
            {MORE.map(id => {
              const tab = TABS.find(t => t.id === id)
              return (
                <button key={id} role="menuitem" onClick={() => go(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                    active === id ? 'bg-violet/20 text-bright' : 'text-faint hover:bg-surface-2 hover:text-bright'
                  }`}>
                  <tab.icon size={16} strokeWidth={2} /> {tab.label}
                </button>
              )
            })}
            <div className="h-px bg-line-soft my-1" />
            <button role="menuitem" onClick={() => { setMoreOpen(false); onLogout() }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-faint hover:bg-surface-2 hover:text-bright transition-colors">
              <LogOut size={16} strokeWidth={2} /> Log out
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function BarButton({ label, icon: Icon, active, onClick, children }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[3.5rem] text-[10px] font-medium transition-colors ${
        active ? 'text-violet-soft' : 'text-muted active:text-faint'
      }`}>
      {active && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-violet-soft" />}
      <span className="relative">
        <Icon size={20} strokeWidth={active ? 2.25 : 1.9} />
        {children}
      </span>
      {label}
    </button>
  )
}

// Trades awaiting their close, and a review window that is open and unwritten.
function Badges({ id, openCount, reviewDue, compact = false }) {
  if (id === 'history' && openCount > 0) {
    return compact
      ? <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-violet text-white text-[9px] leading-4 text-center tnum">{openCount}</span>
      : <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet/20 text-violet-soft align-middle tnum">{openCount}</span>
  }
  if (id === 'review' && reviewDue) {
    return (
      <span aria-label="Review due"
        className={`${compact ? 'absolute -top-0.5 -right-1' : ''} w-1.5 h-1.5 rounded-full bg-violet-soft shadow-[0_0_8px_rgb(185_166_245/0.9)]`} />
    )
  }
  return null
}
