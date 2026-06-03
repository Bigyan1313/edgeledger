import { request } from './client.js'

export const tradesApi = {
  list:   ()         => request('/trades'),
  create: (data)     => request('/trades', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/trades/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id)       => request(`/trades/${id}`, { method: 'DELETE' }),
}
