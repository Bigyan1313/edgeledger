import { useState, useEffect } from 'react'
import { tradesApi } from './api/trades.js'
import { accountsApi } from './api/accounts.js'
import { useAuth } from './auth/AuthContext.jsx'
import Nav from './components/Nav.jsx'
import TradeForm from './components/TradeForm.jsx'
import TradeTable from './components/TradeTable.jsx'
import Dashboard from './components/Dashboard.jsx'
import Calculators from './components/Calculators.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import WakingScreen from './components/WakingScreen.jsx'
import { downloadCsv } from './utils/csv.js'

export default function App() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [trades, setTrades] = useState([])
  const [accounts, setAccounts] = useState([])
  const [editingTrade, setEditingTrade] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load this user's trades + accounts whenever they log in (re-run if the user changes).
  useEffect(() => {
    if (!user) return
    setLoading(true)
    setError(null)
    Promise.all([tradesApi.list(), accountsApi.list()])
      .then(([t, a]) => { setTrades(t); setAccounts(a) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

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

  // Called by TradeForm when a NEW trade is saved
  const handleCreated = (trade) => {
    setTrades(prev => [trade, ...prev])
    setTab('history')
  }

  // Called by TradeForm when an EXISTING trade is updated
  const handleUpdated = (updated) => {
    setTrades(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    setEditingTrade(null)
    setTab('history')
  }

  // Called by TradeTable's Edit button — open the form pre-filled
  const handleEdit = (trade) => {
    setEditingTrade(trade)
    setTab('log')
  }

  const cancelEdit = () => {
    setEditingTrade(null)
    setTab('history')
  }

  // Clicking any nav tab abandons an in-progress edit (fresh form on "Log Trade").
  const handleNavChange = (newTab) => {
    setEditingTrade(null)
    setTab(newTab)
  }

  // Called by TradeTable when a trade is deleted
  const handleDeleted = (id) => {
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="min-h-screen bg-ink text-gray-100">
      <Nav active={tab} onChange={handleNavChange} user={user} onLogout={logout} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!error && (
          <>
            {tab === 'dashboard' && <Dashboard trades={trades} />}
            {tab === 'log'       && (
              <TradeForm
                editTrade={editingTrade}
                accounts={accounts}
                onAddAccount={handleAddAccount}
                onCreated={handleCreated}
                onUpdated={handleUpdated}
                onCancelEdit={cancelEdit}
              />
            )}
            {tab === 'history'   && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-white">Trade History</h2>
                  <button
                    onClick={() => downloadCsv(trades)}
                    disabled={trades.length === 0}
                    className="text-sm px-3 py-1.5 border border-gray-700 rounded-lg text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ↓ Export CSV
                  </button>
                </div>
                <TradeTable trades={trades} onDeleted={handleDeleted} onEdit={handleEdit} />
              </div>
            )}
            {tab === 'calc'      && <Calculators />}
          </>
        )}
      </main>
    </div>
  )
}
