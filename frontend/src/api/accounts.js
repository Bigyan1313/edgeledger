import { request } from './client.js'

export const accountsApi = {
  list:   ()     => request('/accounts'),
  create: (data) => request('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  remove: (id)   => request(`/accounts/${id}`, { method: 'DELETE' }),
  // The firm's rules for losing the account.
  update: (id, data) => request(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Distance to losing it — and, given a planned trade, what that trade leaves.
  standing: (id, planned = null) => {
    const params = new URLSearchParams()
    if (planned?.pair) {
      params.set('pair', planned.pair)
      for (const [k, v] of [['entry', planned.entryPrice], ['stop', planned.stopLoss], ['lots', planned.lotSize]]) {
        if (v !== '' && v != null) params.set(k, String(v))
      }
    }
    const q = params.toString()
    return request(`/accounts/${id}/standing${q ? `?${q}` : ''}`)
  },
}

export const DRAWDOWN_TYPES = [
  { value: 'static', label: 'Static' },
  { value: 'eod_trailing', label: 'End-of-day trailing' },
  { value: 'intraday_trailing', label: 'Intraday trailing' },
]
