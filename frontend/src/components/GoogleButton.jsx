import { useEffect, useRef } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
// Treat the untouched placeholder as "not configured yet".
const CONFIGURED = CLIENT_ID && !CLIENT_ID.startsWith('PASTE_')

// Load Google's Identity Services script once, return a promise that
// resolves when window.google.accounts.id is available.
function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const existing = document.getElementById('gsi-script')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.id = 'gsi-script'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export default function GoogleButton({ onCredential, onError }) {
  const ref = useRef(null)
  // Keep the latest callback without re-initializing the button each render.
  const cbRef = useRef(onCredential)
  cbRef.current = onCredential

  useEffect(() => {
    if (!CONFIGURED) return
    let cancelled = false

    loadGsi()
      .then(() => {
        if (cancelled || !ref.current) return
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => cbRef.current(response.credential),
        })
        ref.current.innerHTML = ''  // guard against StrictMode double-render
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          width: 300,
          text: 'continue_with',
          shape: 'pill',
        })
      })
      .catch(() => onError?.('Could not load Google sign-in'))

    return () => { cancelled = true }
  }, [])

  if (!CONFIGURED) {
    return (
      <div className="text-xs text-gray-600 text-center border border-dashed border-gray-700 rounded-lg py-3 px-3">
        Google sign-in isn't configured yet — add your Client ID to <code className="text-gray-500">frontend/.env</code>
      </div>
    )
  }

  return <div ref={ref} className="flex justify-center" />
}
