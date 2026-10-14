import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import { tradesApi } from './api/trades.js'
import { accountsApi } from './api/accounts.js'
import { profileApi } from './api/profile.js'
import { reviewsApi } from './api/reviews.js'
import { useAuth } from './auth/useAuth.js'
import Nav from './components/Nav.jsx'
import TradeForm from './components/TradeForm.jsx'
import CloseTradeForm from './components/CloseTradeForm.jsx'
import TradeTable from './components/TradeTable.jsx'
import AmendmentHistory from './components/AmendmentHistory.jsx'
import Dashboard from './components/Dashboard.jsx'
import Calculators from './components/Calculators.jsx'
import Profile from './components/Profile.jsx'
import SessionPlan from './components/SessionPlan.jsx'
import PriceActionReview from './components/PriceActionReview.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import WakingScreen from './components/WakingScreen.jsx'
import { downloadCsv, selectExportRows } from './utils/csv.js'

export default function App() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [trades, setTrades] = useState([])
  const [accounts, setAccounts] = useState([])
  const [profile, setProfile] = useState(null)

  // Task 8: v1 rows stay out of every view until asked for, by name.
  const [includeLegacy, setIncludeLegacy] = useState(false)

  // The three things the user can be doing to an existing trade. Only one at a
  // time, and each takes a different door: closing and reviewing touch Stage B,
  // amending touches the locked Stage A fields and leaves a record.
  const [closingTrade, setClosingTrade] = useState(null)
  const [reviewingTrade, setReviewingTrade] = useState(null)
  const [amendingTrade, setAmendingTrade] = useState(null)

  // Read-only view of a trade's audit trail. Not part of clearWork() — it is a
  // lookup, not an edit in progress.
  const [amendmentsTrade, setAmendmentsTrade] = useState(null)

  // The account being worked on, shared by the Session and Log Trade tabs so a
  // trade logged "under this plan" starts on the plan's account.
  const [activeAccountId, setActiveAccountId] = useState(null)

  // Whether today's price action review is open and unwritten — the dot on
  // the Review tab. Checked on load, on every tab change, and after a save,
  // so it appears once the window opens without needing a reload.
  const [reviewDue, setReviewDue] = useState(false)
  const [reviewCheck, setReviewCheck] = useState(0)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    reviewsApi.today()
      .then(d => { if (!cancelled) setReviewDue(d.recentDays[0]?.status === 'due') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user, reviewCheck])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load this user's trades + accounts on login, and again whenever the legacy
  // filter changes — v1 rows are excluded server-side, so the toggle is a
  // refetch rather than a client-side filter.
  //
  // `loading` is only ever set false here: it gates the cold-start screen, which
  // belongs to the first load alone. Flipping the toggle updates the list in
  // place instead of blanking the app.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([tradesApi.list({ includeLegacy }), accountsApi.list(), profileApi.get()])
      .then(([t, a, p]) => {
        if (cancelled) return
        setTrades(t); setAccounts(a); setProfile(p); setError(null)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user, includeLegacy])

  // Create an account, add it to state, and return it (so the form can select it).
  const handleAddAccount = async (data) => {
    const acct = await accountsApi.create(data)
    setAccounts(prev => [...prev, acct])
    return acct
  }

  // Not logged in → show the auth screen, nothing else.
  if (!user) return <AuthScreen />

  // First data load (can be a ~30-60s Render cold start) → balloon ride.
  if (loading) return <WakingScreen />

  const clearWork = () => {
    setClosingTrade(null)
    setReviewingTrade(null)
    setAmendingTrade(null)
  }

  const replaceTrade = (updated) => {
    setTrades(prev => prev.map(t => (t.id === updated.id ? updated : t)))
  }

  // A new Stage A entry: the plan is on the record, the result is not yet.
  const handleCreated = (trade) => {
    setTrades(prev => [trade, ...prev])
    setTab('history')
  }

  const handleClosed = (updated) => {
    replaceTrade(updated)
    clearWork()
    setTab('history')
  }

  const handleAmended = (updated) => {
    replaceTrade(updated)
    clearWork()
    setTab('history')
  }

  const startClose = (trade) => { clearWork(); setClosingTrade(trade); setTab('log') }
  const startReview = (trade) => { clearWork(); setReviewingTrade(trade); setTab('log') }
  // The list payload omits screenshots (they're heavy), so fetch the full record
  // before opening the amend form — otherwise saving would drop the images that
  // were never loaded. Falls back to the list row if the fetch fails.
  const startAmend = async (trade) => {
    clearWork()
    setTab('log')
    try {
      setAmendingTrade(await tradesApi.get(trade.id))
    } catch {
      setAmendingTrade(trade)
    }
  }

  // Clicking any nav tab abandons whatever was in progress.
  const handleNavChange = (newTab) => {
    clearWork()
    // Opening the session plan picks a working account if none is chosen yet,
    // so the Log Trade tab that follows is on the same one.
    if (newTab === 'session' && activeAccountId == null && accounts.length) {
      setActiveAccountId(accounts[0].id)
    }
    setReviewCheck(c => c + 1)
    setTab(newTab)
  }

  const handleDeleted = (id) => {
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  const openCount = trades.filter(t => t.entryStage === 'pending_exit').length
  const exportableCount = selectExportRows(trades, { includeLegacy }).length

  const stageBTrade = closingTrade ?? reviewingTrade

  return (
    <div className="min-h-screen bg-ink text-bright">
      <Nav active={tab} onChange={handleNavChange} user={{ ...user, displayName: profile?.displayName ?? user.displayName }} onLogout={logout} openCount={openCount} reviewDue={reviewDue} />

      {/* The v2 trade table carries more columns than v1 did — broker linkage,
          both setup axes, stage, flags — so History gets a wider column than the
          rest of the app rather than scrolling its actions off the edge. */}
      <main className={`${tab === 'history' ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-6 py-8`}>
        {error && (
          <div className="rounded-xl border border-loss/40 bg-loss-bg/80 px-4 py-3 text-loss/90 text-sm">
            {error}
          </div>
        )}

        {!error && (
          <>
            {tab === 'dashboard' && <Dashboard trades={trades} accounts={accounts} />}

            {tab === 'log' && (
              stageBTrade ? (
                <CloseTradeForm
                  trade={stageBTrade}
                  mode={reviewingTrade ? 'review' : 'close'}
                  onClosed={handleClosed}
                  onCancel={() => { clearWork(); setTab('history') }}
                />
              ) : (
                <TradeForm
                  key={amendingTrade?.id ?? 'new'}
                  amendTrade={amendingTrade}
                  accounts={accounts}
                  onAddAccount={handleAddAccount}
                  onCreated={handleCreated}
                  onAmended={handleAmended}
                  onCancelAmend={() => { clearWork(); setTab('history') }}
                  onGoSession={() => { clearWork(); setTab('session') }}
                  activeAccountId={activeAccountId}
                  onAccountChange={setActiveAccountId}
                  profile={profile}
                />
              )
            )}

            {tab === 'history' && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                  <h2 className="text-xl font-semibold text-bright tracking-tight">Trade History</h2>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                      <input
                        type="checkbox"
                        checked={includeLegacy}
                        onChange={e => setIncludeLegacy(e.target.checked)}
                        className="w-4 h-4 rounded accent-violet"
                      />
                      <span title="v1 rows have no broker position ID and cannot be joined to execution data.">
                        Include v1 rows
                      </span>
                    </label>
                    <button
                      onClick={() => downloadCsv(trades, { includeLegacy })}
                      disabled={exportableCount === 0}
                      className="text-sm px-3.5 py-2 border border-line bg-surface-2 rounded-xl text-faint hover:bg-surface-3 hover:text-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
                    >
                      <Download size={14} strokeWidth={2} />Export CSV ({exportableCount})
                    </button>
                  </div>
                </div>

                {includeLegacy && (
                  <div className="rounded-xl border border-warn/30 bg-warn-bg/60 px-4 py-3 text-warn/90 text-sm mb-4">
                    Showing v1 rows. They have no broker position ID, so they cannot be matched to
                    execution data — they are kept as a record, not as analysable data, and the
                    export marks them <code className="text-amber-200">schema_version=1</code>.
                  </div>
                )}

                <TradeTable
                  trades={trades}
                  onDeleted={handleDeleted}
                  onClose={startClose}
                  onReview={startReview}
                  onAmend={startAmend}
                  onShowAmendments={setAmendmentsTrade}
                />
              </div>
            )}

            {tab === 'session' && (
              <SessionPlan
                accounts={accounts}
                onAddAccount={handleAddAccount}
                activeAccountId={activeAccountId}
                onAccountChange={setActiveAccountId}
                onGoLog={(accountId) => { setActiveAccountId(accountId); setTab('log') }}
              />
            )}

            {tab === 'review' && <PriceActionReview onChanged={() => setReviewCheck(c => c + 1)} />}

            {tab === 'calc' && <Calculators defaultRiskPercent={profile?.defaultRiskPercent} />}

            {tab === 'profile' && <Profile onSaved={setProfile} />}
          </>
        )}
      </main>

      {amendmentsTrade && (
        <AmendmentHistory trade={amendmentsTrade} onClose={() => setAmendmentsTrade(null)} />
      )}
    </div>
  )
}
