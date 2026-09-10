import { useState, useEffect } from 'react'
import { authApi } from '../api/auth.js'
import { setToken, clearAuth, getStoredUser, setStoredUser } from '../api/client.js'
import { AuthContext } from './context.js'

export function AuthProvider({ children }) {
  // Initialise from localStorage so a page refresh keeps you logged in.
  const [user, setUser] = useState(() => getStoredUser())

  useEffect(() => {
    // If any API call returns 401, the client fires this event → log out.
    const onLogout = () => setUser(null)
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  // Shared handler: persist token + user after signup/login.
  const persist = (resp) => {
    setToken(resp.token)
    setStoredUser(resp.user)
    setUser(resp.user)
  }

  const login = async (email, password) => {
    persist(await authApi.login({ email, password }))
  }

  const signup = async (email, password, displayName) => {
    persist(await authApi.signup({ email, password, displayName }))
  }

  // Google sends us an ID token (credential); backend verifies + returns our token.
  const loginWithGoogle = async (credential) => {
    persist(await authApi.google(credential))
  }

  const logout = () => {
    clearAuth()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
