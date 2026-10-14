import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImageUp, X } from 'lucide-react'
import { fileToCompressedDataUrl } from '../utils/image.js'

// Chart images for plans and reviews: compressed in the browser before they
// are sent, shown as thumbnails, opened full-size on click. `removable`
// false shows existing charts without a remove button — a locked plan's
// charts can be added to, never taken away.
export default function ChartPicker({ value, onChange, max = 3, removable = true, existing = [], label = 'Add chart' }) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const room = max - existing.length - value.length

  const add = async (files) => {
    if (room <= 0) return
    setProcessing(true); setError(null)
    try {
      const urls = []
      for (const file of Array.from(files).slice(0, room)) urls.push(await fileToCompressedDataUrl(file))
      onChange([...value, ...urls])
    } catch (err) {
      setError(err.message || 'Could not add that image')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {existing.map((src, i) => <Thumb key={`e${i}`} src={src} alt={`Chart ${i + 1}`} />)}
        {value.map((src, i) => (
          <Thumb key={`v${i}`} src={src} alt={`Chart ${existing.length + i + 1}`}
            onRemove={removable ? () => onChange(value.filter((_, idx) => idx !== i)) : null} />
        ))}
        {room > 0 && (
          <label className="w-28 h-20 rounded-xl border border-dashed border-line-soft bg-surface-2/40 text-muted hover:text-violet-soft hover:border-violet-soft/60 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors">
            <ImageUp size={18} strokeWidth={2} />
            <span className="text-[11px]">{processing ? 'Adding…' : label}</span>
            {/* No `capture`: on a phone that would force the camera and hide
                the gallery, where most chart screenshots live. */}
            <input type="file" accept="image/*" multiple className="hidden" aria-label={label}
              onChange={e => { add(e.target.files); e.target.value = '' }} />
          </label>
        )}
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}

// A chart opens full size in the page itself: Chrome refuses to open a
// data: image in a new tab, and on a phone a viewer is the better place anyway.
export function Thumb({ src, alt, onRemove }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative w-28 h-20 rounded-xl overflow-hidden border border-line">
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${alt.toLowerCase()} full size`}
        className="block w-full h-full cursor-zoom-in">
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${alt.toLowerCase()}`} onClick={onRemove}
          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-loss">
          <X size={13} strokeWidth={2.5} />
        </button>
      )}
      {open && <Viewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </div>
  )
}

function Viewer({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portalled to the body: a blurred card would otherwise contain a fixed overlay.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} onClick={e => { e.stopPropagation(); onClose() }}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out">
      <img src={src} alt={alt} className="max-w-full max-h-full rounded-xl shadow-2xl" />
      <button type="button" aria-label="Close" onClick={e => { e.stopPropagation(); onClose() }}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">
        <X size={18} strokeWidth={2.25} />
      </button>
    </div>,
    document.body,
  )
}
