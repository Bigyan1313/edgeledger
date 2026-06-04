// In production, Vercel sets VITE_API_URL to the Render backend URL (e.g.
// https://edgeledger-api.onrender.com/api). Locally it falls back to the dev server.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const TOKEN_KEY = 'edgeledger_token'
const USER_KEY  = 'edgeledger_user'

// --- token storage (localStorage; see XSS note in our auth discussion) ---
export const getToken  = () => localStorage.getItem(TOKEN_KEY)
export const setToken  = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearAuth = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) }

export const getStoredUser = () => {
  const raw = localStorage.getItem(USER_KEY)
  return raw ? JSON.parse(raw) : null
}
export const setStoredUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u))

// Shared fetch wrapper. Attaches the Bearer token to every request and
// centralises error + 401 handling.
export async function request(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  })

  // Only treat a 401 as an EXPIRED SESSION if we actually sent a token.
  // A 401 with no token = a failed login/signup → let the real error message
  // (e.g. "Invalid email or password") surface below instead.
  if (res.status === 401 && token) {
    clearAuth()
    window.dispatchEvent(new Event('auth:logout'))
    throw new Error('Session expired. Please log in again.')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  if (res.status === 204) return null
  return res.json()
}
