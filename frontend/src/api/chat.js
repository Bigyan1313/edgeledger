import { BASE, getToken, clearAuth } from './client.js'

// The assistant streams plain text, so this reads the body as it arrives
// rather than going through request(), which waits for a whole JSON reply.
export async function streamChat(messages, { onText, signal } = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (res.status === 401 && token) {
    clearAuth()
    window.dispatchEvent(new Event('auth:logout'))
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onText?.(decoder.decode(value, { stream: true }))
  }
}
