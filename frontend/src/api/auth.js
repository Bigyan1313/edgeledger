import { request } from './client.js'

export const authApi = {
  signup: (data) => request('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  login:  (data) => request('/auth/login',  { method: 'POST', body: JSON.stringify(data) }),
  google: (credential) => request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
}
