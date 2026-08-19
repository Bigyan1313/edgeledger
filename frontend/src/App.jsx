import { useState, useEffect } from 'react'
import { tradesApi } from './api/trades.js'
import { accountsApi } from './api/accounts.js'
import { useAuth } from './auth/AuthContext.jsx'
import Nav from './components/Nav.jsx'
import TradeForm from './components/TradeForm.jsx'
import CloseTradeForm from './components/CloseTradeForm.jsx'
import TradeTable from './components/TradeTable.jsx'
import AmendmentHistory from './components/AmendmentHistory.jsx'
import Dashboard from './components/Dashboard.jsx'
import Calculators from './components/Calculators.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import WakingScreen from './components/WakingScreen.jsx'
import { downloadCsv, selectExportRows } from './utils/csv.js'

export default function App() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [trades, setTrades] = useState([])
  const [accounts, setAccounts] = useState([])

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
    setError(null)
    Promise.all([tradesApi.list({ includeLegacy }), accountsApi.list()])
      .then(([t, a]) => { setTrades(t); setAccounts(a) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
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
    setTab(newTab)
  }

  const handleDeleted = (id) => {
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  const openCount = trades.filter(t => t.entryStage === 'pending_exit').length
  const exportableCount = selectExportRows(trades, { includeLegacy }).length

  const stageBTrade = closingTrade ?? reviewingTrade

  return (
    <div className="min-h-screen bg-ink text-gray-100">
      <Nav active={tab} onChange={handleNavChange} user={user} onLogout={logout} openCount={openCount} />

      {/* The v2 trade table carries more columns than v1 did — broker linkage,
          both setup axes, stage, flags — so History gets a wider column than the
          rest of the app rather than scrolling its actions off the edge. */}
      <main className={`${tab === 'history' ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-6 py-8`}>
        {error && (
          <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!error && (
          <>
            {tab === 'dashboard' && <Dashboard trades={trades} />}

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
                  amendTrade={amendingTrade}
                  accounts={accounts}
                  onAddAccount={handleAddAccount}
                  onCreated={handleCreated}
                  onAmended={handleAmended}
                  onCancelAmend={() => { clearWork(); setTab('history') }}
                />
              )
            )}

            {tab === 'history' && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                  <h2 className="text-xl font-semibold text-white">Trade History</h2>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                      <input
                        type="checkbox"
                        checked={includeLegacy}
                        onChange={e => setIncludeLegacy(e.target.checked)}
                        className="w-4 h-4 rounded accent-amber-400"
                      />
                      <span title="v1 rows have no broker position ID and cannot be joined to execution data.">
                        Include v1 rows
                      </span>
                    </label>
                    <button
                      onClick={() => downloadCsv(trades, { includeLegacy })}
                      disabled={exportableCount === 0}
                      className="text-sm px-3 py-1.5 border border-gray-700 rounded-lg text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      ↓ Export CSV ({exportableCount})
                    </button>
                  </div>
                </div>

                {includeLegacy && (
                  <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3 text-amber-300/90 text-sm mb-4">
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

            {tab === 'calc' && <Calculators />}
          </>
        )}
      </main>

      {amendmentsTrade && (
        <AmendmentHistory trade={amendmentsTrade} onClose={() => setAmendmentsTrade(null)} />
      )}
    </div>
  )
}
