import { request } from './client.js'

// Tradovate Performance export → closes for open journal trades. Preview
// writes nothing; apply closes only the trades named, re-checked server-side.
export const importsApi = {
  previewTradovate: (data) => request('/imports/tradovate/preview', { method: 'POST', body: JSON.stringify(data) }),
  applyTradovate: (data) => request('/imports/tradovate/apply', { method: 'POST', body: JSON.stringify(data) }),
}
