import { request } from './client.js'

export const profileApi = {
  get: () => request('/profile'),
  save: (data) => request('/profile', { method: 'PUT', body: JSON.stringify(data) }),
}
