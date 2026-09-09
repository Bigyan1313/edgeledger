import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import prisma from '../prisma/client.js'
import {
  normalizeExtraction,
  extractionCoverage,
  parseImageDataUrl,
  callExtractionModel,
} from '../domain/extraction.js'

const apiKey = process.env.ANTHROPIC_API_KEY
const configured = Boolean(apiKey) && !apiKey.startsWith('PASTE_')
const defaultClient = configured ? new Anthropic({ apiKey }) : null

// The Anthropic client is a parameter rather than a module-level singleton so
// the route's own behaviour — the image checks, the guards, duplicate
// detection, and the promise that nothing is ever created — can be tested
// without a live API call or an API key.
export function createExtractRouter({ client = defaultClient } = {}) {
  const router = Router()

  // POST /api/trades/extract — read a broker screenshot into a draft trade.
  //
  // This deliberately does NOT create anything. It returns fields for the entry
  // form to prefill, which the user reviews and saves themselves. Auto-saving a
  // model's reading of an image would put unverified numbers into the journal —
  // the exact failure schema v2 exists to prevent — and it would do it
  // invisibly, because a plausible wrong price looks just like a right one.
  router.post('/extract', async (req, res) => {
    if (!client) {
      return res.status(503).json({
        error: 'Screenshot import is not configured on this server (missing ANTHROPIC_API_KEY).',
      })
    }

    const image = parseImageDataUrl(req.body?.image)
    if (image.error) return res.status(400).json({ error: image.error })

    let raw, usage
    try {
      ({ input: raw, usage } = await callExtractionModel(client, image))
    } catch (err) {
      // Rate limits are worth distinguishing — they're worth retrying, and a
      // generic "something went wrong" hides that.
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

    // Re-importing the same screenshot is easy to do by accident. The save would
    // be refused by the unique constraint anyway, but saying so here means the
    // user finds out before retyping the setup and emotional state.
    let duplicateOf = null
    if (fields.brokerPositionId) {
      const existing = await prisma.trade.findFirst({
        where: { userId: req.userId, brokerPositionId: fields.brokerPositionId },
        select: { id: true, entryTimeUtc: true, pair: true },
      })
      if (existing) {
        duplicateOf = existing
        warnings.push({
          field: 'brokerPositionId',
          message: `Position ${fields.brokerPositionId} is already logged as trade #${existing.id}. Saving this would be a duplicate.`,
        })
      }
    }

    res.json({
      fields,
      warnings,
      unreadableFields,
      coverage,
      duplicateOf,
      // An import of an already-closed trade is being journaled after the
      // outcome was known, and will be flagged retroactive_journal on save.
      // Better said up front than discovered as a mystery flag afterwards.
      journaledAfterOutcome: fields.isClosed === true,
      usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null,
    })
  })

  return router
}

export default createExtractRouter()
