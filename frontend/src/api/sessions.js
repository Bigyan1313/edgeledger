import { request } from './client.js'

// The browser's own zone. The server prefers the profile's pinned zone when
// there is one; this is the fallback for a trader who has not set it.
export const browserTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' }
}

export const sessionsApi = {
  today: (accountId) => {
    const params = new URLSearchParams({ timezone: browserTimezone() })
    if (accountId != null) params.set('accountId', String(accountId))
    return request(`/sessions/today?${params}`)
  },
  list: ({ all = false } = {}) => request(`/sessions${all ? '?all=true' : ''}`),
  // Readiness plus, if readiness passes, the plan. Locked once saved.
  create: (data) => request('/sessions', { method: 'POST', body: JSON.stringify({ timezone: browserTimezone(), ...data }) }),
  close: (id, data) => request(`/sessions/${id}/close`, { method: 'POST', body: JSON.stringify(data) }),
  // Add-only: a locked plan's charts can grow, never shrink.
  addCharts: (id, screenshots) => request(`/sessions/${id}/screenshots`, { method: 'POST', body: JSON.stringify({ screenshots }) }),
}

// The market sessions a plan can be for, with their usual hours in New York
// time. A label on the day's one plan: the trade limit is per day, not per
// session.
export const MARKET_SESSIONS = [
  { value: 'asia', label: 'Asia', hours: '7pm–4am ET' },
  { value: 'london', label: 'London', hours: '3am–11:30am ET' },
  { value: 'new_york', label: 'New York', hours: '9:30am–4pm ET' },
]
export const sessionLabel = (value) => MARKET_SESSIONS.find(s => s.value === value)?.label ?? null

// Mirrors the server's ceiling. The server and the database both enforce it;
// this only keeps the form from offering a choice that will be refused.
export const MAX_TRADES_CEILING = 2
export const MIN_PLAN_TEXT = 10
export const MAX_SCENARIOS = 5
