import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, RotateCcw } from 'lucide-react'
import { streamChat } from '../api/chat.js'

// Edge, the in-app assistant. It sees today's plan, each account's room to its
// loss limits, recent trades and reviews — so "should I take this?" gets an
// answer in the trader's own rules and numbers, never a market call.

const STARTERS = [
  'Where do I stand today?',
  'Can I take another trade?',
  'Check my recent trades against my rules',
  'How do I import my Tradovate fills?',
]

export default function EdgeChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, open])
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (text) => {
    const question = text.trim()
    if (!question || streaming) return
    setError(null)
    setInput('')
    const history = [...messages, { role: 'user', content: question }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat(history, {
        signal: controller.signal,
        onText: (chunk) => setMessages(m => {
          const next = [...m]
          next[next.length - 1] = { ...next.at(-1), content: next.at(-1).content + chunk }
          return next
        }),
      })
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
        // A reply that never started is removed rather than left as an empty bubble.
        setMessages(m => (m.at(-1)?.role === 'assistant' && !m.at(-1).content ? m.slice(0, -1) : m))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const close = () => { abortRef.current?.abort(); setOpen(false) }
  const reset = () => { abortRef.current?.abort(); setMessages([]); setError(null) }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Ask Edge"
        className="fixed right-4 sm:right-6 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] sm:bottom-6 z-30 h-12 pl-4 pr-5 rounded-full bg-violet text-white font-semibold shadow-[0_12px_32px_-10px_rgb(90_84_232/0.9)] hover:brightness-110 transition flex items-center gap-2">
        <Sparkles size={17} strokeWidth={2.25} /> Ask Edge
      </button>
    )
  }

  return (
    <div role="dialog" aria-label="Edge assistant"
      className="fixed z-40 inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[400px] sm:h-[min(620px,calc(100vh-6rem))] bg-surface sm:rounded-[var(--radius-card)] border border-line shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9),0_0_48px_-28px_rgb(90_84_232/0.6)] flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line-soft pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-full bg-violet/25 text-violet-soft flex items-center justify-center shrink-0"><Sparkles size={16} strokeWidth={2.25} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-bright">Edge</p>
            <p className="text-[11px] text-muted truncate">Sees today's plan, your limits and recent trades</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            <button type="button" onClick={reset} aria-label="New conversation" className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface-2 transition-colors">
              <RotateCcw size={15} strokeWidth={2} />
            </button>
          )}
          <button type="button" onClick={close} aria-label="Close" className="p-2 rounded-lg text-muted hover:text-bright hover:bg-surface-2 transition-colors">
            <X size={17} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-faint">
              Ask about your day, your limits, or the app. Edge answers from your own plan and numbers —
              it won't tell you where the market is going.
            </p>
            <div className="flex flex-col gap-2">
              {STARTERS.map(s => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="text-left text-sm px-3 py-2.5 rounded-xl border border-line bg-surface-2 text-faint hover:text-bright hover:border-violet-soft/40 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${
              m.role === 'user' ? 'bg-violet text-white rounded-br-md' : 'bg-surface-2 border border-line text-bright rounded-bl-md'
            }`}>
              {m.role === 'assistant' && !m.content
                ? <span className="inline-flex gap-1 py-1" aria-label="Edge is writing">{[0, 1, 2].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" style={{ animationDelay: `${d * 150}ms` }} />)}</span>
                : <Rich text={m.content} />}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-loss/90 rounded-xl border border-loss/40 bg-loss-bg/70 px-3 py-2">{error}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={e => { e.preventDefault(); send(input) }}
        className="border-t border-line-soft p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3 flex items-end gap-2">
        <textarea rows={1} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
          placeholder="Ask Edge…" aria-label="Message"
          className="flex-1 resize-none max-h-32 bg-surface-2 border border-line rounded-xl px-3 py-2.5 text-sm text-bright placeholder:text-muted/70 focus:outline-none focus:border-violet-soft/70" />
        <button type="submit" disabled={streaming || !input.trim()} aria-label="Send"
          className="h-10 w-10 shrink-0 rounded-xl bg-violet text-white flex items-center justify-center hover:brightness-110 disabled:opacity-40 transition">
          <Send size={16} strokeWidth={2.25} />
        </button>
      </form>
    </div>
  )
}

// Just enough formatting for a chat reply: paragraphs, "- " lists, and
// **bold**. Rendered as React elements, so nothing in the text is ever HTML.
function Rich({ text }) {
  const blocks = []
  let list = null
  for (const line of text.split('\n')) {
    const item = /^\s*[-•*]\s+(.*)$/.exec(line)
    if (item) {
      if (!list) { list = []; blocks.push({ list }) }
      list.push(item[1])
    } else {
      list = null
      blocks.push({ line })
    }
  }
  return (
    <div className="space-y-1.5 leading-relaxed">
      {blocks.map((b, i) => b.list
        ? <ul key={i} className="list-disc pl-4 space-y-0.5">{b.list.map((li, j) => <li key={j}><Bold text={li} /></li>)}</ul>
        : b.line.trim() ? <p key={i}><Bold text={b.line} /></p> : null)}
    </div>
  )
}

function Bold({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : part)
}
