import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'

const router = Router()

const MODEL = 'claude-haiku-4-5'

// Edge's persona, knowledge of the app, and hard scope. Frozen + cached.
const SYSTEM_PROMPT = `You are Edge, the friendly in-app assistant for EdgeLedger — a personal trading journal and analytics web app.

What EdgeLedger does and how to use it:
- Log Trade: record a trade with date, pair, direction, setup, entry/stop/target/exit prices, lot size, risk, P&L, outcome, emotion, and whether the user followed their checklist. You can pick a trading account (Live or Demo / prop firm) from the top-right selector. You can edit or delete trades.
- Dashboard: net P&L, win rate, profit factor, expectancy, average R, an equity curve, a daily P&L calendar (green/red days with trade count + win rate), a "discipline mirror" comparing performance when the checklist was followed vs not and calm vs not-calm, and a per-setup breakdown.
- History: a table of all trades with CSV export.
- Calculators: a position-size calculator (risk % → lot size) and a risk:reward calculator.
- Accounts: each trade can be tagged to a Live or Demo (prop-firm) account.
- Sign-in: email/password or Google.

Your job:
1. Help users understand and use EdgeLedger's features (where to click, what a metric means, how something is calculated).
2. Answer SIMPLE, educational trading questions — e.g. "what is a stop loss?", "what does R:R mean?", "how is win rate calculated?", "what is expectancy?". Keep it conceptual and beginner-friendly.

Hard limits — never cross these:
- You do NOT give financial or trading advice. No buy/sell signals, no "should I take this trade", no price predictions, no opinions on specific instruments or setups.
- If asked for advice, a recommendation, or a market call, politely decline and explain you can only help with using EdgeLedger and general trading education.
- If asked about anything unrelated to EdgeLedger or basic trading concepts (coding, general chit-chat, other topics), politely steer back to what you can help with.

Style: concise, warm, and practical. A sentence or two is usually enough. You are a support assistant, not an open-ended chatbot.`

const apiKey = process.env.ANTHROPIC_API_KEY
const configured = apiKey && !apiKey.startsWith('PASTE_')
const anthropic = configured ? new Anthropic({ apiKey }) : null

// POST /api/chat  — body: { messages: [{ role: 'user'|'assistant', content }] }
// Streams Edge's reply back as plain text chunks.
router.post('/', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'The assistant is not configured yet (missing ANTHROPIC_API_KEY).' })
  }

  const { messages } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'A non-empty messages array is required.' })
  }

  // Bound cost: keep only the last 10 turns, cap each message length.
  const history = messages.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 2000),
  }))

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: [
        // cache_control caches the system prompt; only activates once it's large
        // enough (~4096 tokens on Haiku), but harmless to include now.
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: history,
    })

    // Only commit to a streaming response once the request is accepted —
    // if the first event throws (e.g. bad key), we fall to the catch with
    // headers unsent and return a clean JSON error.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(event.delta.text)
      }
    }
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'The assistant ran into a problem. Please try again.' })
    } else {
      res.end()
    }
  }
})

export default router
