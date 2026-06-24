import { request } from './client.js'

export const accountsApi = {
  list:   ()     => request('/accounts'),
  create: (data) => request('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  remove: (id)   => request(`/accounts/${id}`, { method: 'DELETE' }),
}
