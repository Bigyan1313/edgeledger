import { useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'
import GoogleButton from './GoogleButton.jsx'

export default function AuthScreen() {
  const { login, signup, loginWithGoogle } = useAuth()
  const [mode, setMode] = useState('login')   // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'

  const handleGoogle = async (credential) => {
    setError(null)
    setBusy(true)
    try {
      await loginWithGoogle(credential)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (isSignup) {
        await signup(email, password, displayName)
      } else {
        await login(email, password)
      }
      // On success, AuthProvider sets the user → App swaps to the app view.
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">
            Edge<span className="text-emerald-400">Ledger</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">Your trading journal</p>
        </div>

        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-6">
          {/* Toggle */}
          <div className="flex bg-gray-900/60 rounded-lg p-1 mb-6">
            {['login', 'signup'].map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null) }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  mode === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-950 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <Field label="Display Name (optional)">
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className={input}
                  placeholder="Bigyan"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={input}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={input}
                placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
              />
            </Field>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold rounded-lg transition-colors"
            >
              {busy ? 'Please wait…' : isSignup ? 'Create Account' : 'Log In'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-700/60" />
            <span className="text-xs text-gray-600 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-gray-700/60" />
          </div>

          <GoogleButton onCredential={handleGoogle} onError={setError} />
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
          <button
            onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(null) }}
            className="text-emerald-400 hover:underline"
          >
            {isSignup ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

const input = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500 w-full'
