import { request } from './client.js'

// Two-stage entry means two write paths, plus a third for changing anything
// that locked when Stage A was saved.
export const tradesApi = {
  // Task 8: v1 rows are excluded unless explicitly asked for.
  list: ({ includeLegacy = false, stage } = {}) => {
    const params = new URLSearchParams()
    if (includeLegacy) params.set('includeLegacy', 'true')
    if (stage) params.set('stage', stage)
    const query = params.toString()
    return request(`/trades${query ? `?${query}` : ''}`)
  },

  // Stage A — the pre-trade record. These fields lock on save.
  create: (data) => request('/trades', { method: 'POST', body: JSON.stringify(data) }),

  // Stage B — the close.
  close: (id, data) => request(`/trades/${id}/close`, { method: 'POST', body: JSON.stringify(data) }),

  // A single trade, including its screenshots — the list payload omits those.
  get: (id) => request(`/trades/${id}`),

  // Edits to unlocked fields only; the server rejects anything else with a 409.
  update: (id, data) => request(`/trades/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Changing a locked Stage A field. Records an audit row and stamps amendedAt.
  amend: (id, fields, reason) =>
    request(`/trades/${id}/amend`, { method: 'POST', body: JSON.stringify({ fields, reason }) }),

  amendments: (id) => request(`/trades/${id}/amendments`),

  remove: (id) => request(`/trades/${id}`, { method: 'DELETE' }),
}
