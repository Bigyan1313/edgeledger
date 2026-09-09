import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import {
  EXTRACTION_MODEL,
  EXTRACTION_TOOL,
  EXTRACTION_SYSTEM_PROMPT,
  normalizeExtraction,
  extractionCoverage,
  parseImageDataUrl,
} from '../domain/extraction.js'

const router = Router()

const apiKey = process.env.ANTHROPIC_API_KEY
const configured = Boolean(apiKey) && !apiKey.startsWith('PASTE_')
const anthropic = configured ? new Anthropic({ apiKey }) : null

// Pulled out so the route's own logic can be exercised without a live API call.
export async function callExtractionModel(client, { mediaType, data }) {
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    system: [
      // The prompt and tool schema are byte-identical on every request, so they
      // form a stable cacheable prefix ahead of the volatile image.
      { type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [EXTRACTION_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'Transcribe the trade in this screenshot. Anything not legible is null.' },
        ],
      },
    ],
  })

  const call = response.content.find(block => block.type === 'tool_use' && block.name === EXTRACTION_TOOL.name)
  return { input: call?.input ?? null, usage: response.usage }
}

// POST /api/trades/extract — read a broker screenshot into a draft trade.
//
// This deliberately does NOT create anything. It returns fields for the entry
// form to prefill, which the user reviews and saves themselves. Auto-saving a
// model's reading of an image would put unverified numbers into the journal —
// the exact failure mode schema v2 exists to prevent — and it would do it
// invisibly, because a plausible wrong price looks just like a right one.
router.post('/extract', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({
      error: 'Screenshot import is not configured on this server (missing ANTHROPIC_API_KEY).',
    })
  }

  const image = parseImageDataUrl(req.body?.image)
  if (image.error) return res.status(400).json({ error: image.error })

  let raw, usage
  try {
    ({ input: raw, usage } = await callExtractionModel(anthropic, image))
  } catch (err) {
    // Rate limits and overloads are worth distinguishing — they're worth
    // retrying, and a generic "something went wrong" hides that.
    if (err?.status === 429) {
      return res.status(429).json({ error: 'Too many screenshot imports at once. Wait a moment and try again.' })
    }
    console.error('Screenshot extraction failed:', err)
    return res.status(502).json({ error: 'Could not read that screenshot. Try again, or enter the trade manually.' })
  }

  if (!raw) {
    return res.status(422).json({
      error: "That doesn't look like a trading screenshot — nothing could be read from it.",
    })
  }

  const { fields, warnings, unreadableFields } = normalizeExtraction(raw)
  const coverage = extractionCoverage(fields)

  res.json({
    fields,
    warnings,
    unreadableFields,
    coverage,
    // The client shows this: an import of an already-closed trade is being
    // journaled after the outcome was known, and will be flagged
    // retroactive_journal on save. Better to say so up front than to let it
    // appear as a mystery flag afterwards.
    journaledAfterOutcome: fields.isClosed === true,
    usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null,
  })
})

export default router
