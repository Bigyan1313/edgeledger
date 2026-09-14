import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import prisma from '../prisma/client.js'
import {
  normalizeExtraction,
  extractionCoverage,
  parseImageDataUrl,
  callExtractionModel,
  EXTRACTION_MODEL,
} from '../domain/extraction.js'

const apiKey = process.env.ANTHROPIC_API_KEY
const configured = Boolean(apiKey) && !apiKey.startsWith('PASTE_')
const defaultClient = configured ? new Anthropic({ apiKey }) : null

// The duplicate lookup can reject too; Express 4 must pass it to middleware.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

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
  router.post('/extract', handle(async (req, res) => {
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
      const failure = describeUpstreamFailure(err)
      console.error(
        `Screenshot extraction failed [status=${err?.status ?? 'none'} type=${err?.error?.error?.type ?? err?.error?.type ?? 'none'}]: ${failure.logHint}`,
        err,
      )
      return res.status(failure.status).json({ error: failure.error })
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
  }))

  return router
}

export default createExtractRouter()

// Every upstream failure used to collapse into one 502 reading "Could not read
// that screenshot" — which is what a bad API key, an empty credit balance, and
// a genuinely unreadable image all looked like from the browser. The operator
// had to open the server log to tell them apart, and the person at the screen
// was told to retry something that could never succeed.
//
// The upstream message is read but never forwarded: it can quote the failing
// request back, and that request carries the API key. Everything the client
// sees below is a fixed string chosen by status and error type.
export function describeUpstreamFailure(err) {
  const status = err?.status
  const type = err?.error?.error?.type ?? err?.error?.type
  const detail = typeof err?.message === 'string' ? err.message : ''

  // A rejected key, and a key without access to this model, are both fixed in
  // the dashboard rather than by retrying — so they are 503, like a key that
  // was never set at all.
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') {
    return {
      status: 503,
      error: "Screenshot import is misconfigured: the server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the server environment.",
      logHint: 'ANTHROPIC_API_KEY was rejected upstream (401/403). Check for wrapping quotes or trailing whitespace in the value.',
    }
  }

  // Billing is its own status (402 billing_error). The message check behind it
  // catches the balance failures that arrive as a 400 instead.
  if (status === 402 || type === 'billing_error' || /credit balance|insufficient|billing/i.test(detail)) {
    return {
      status: 503,
      error: 'Screenshot import is unavailable: the Anthropic account backing this server cannot be billed — most likely no credit.',
      logHint: 'Anthropic reported a billing problem. Check the balance at console.anthropic.com/settings/billing.',
    }
  }

  if (status === 404 || type === 'not_found_error') {
    return {
      status: 503,
      error: 'Screenshot import is misconfigured: this server is asking for a model its account cannot use.',
      logHint: `Model "${EXTRACTION_MODEL}" was not found for this account.`,
    }
  }

  // Under our own 5MB ceiling but still refused — usually pixel dimensions
  // rather than bytes, which resizing fixes and retrying does not.
  if (status === 413) {
    return {
      status: 400,
      error: 'That image is too large for the reader. Crop it to the order ticket, or scale it down, and try again.',
      logHint: 'Upstream rejected the image as too large despite passing the local byte check.',
    }
  }

  if (status === 400 || type === 'invalid_request_error') {
    return {
      status: 400,
      error: 'That image could not be read as an image. Re-save it as a PNG or JPEG and try again.',
      logHint: 'Upstream rejected the request as invalid — most likely a corrupt or mislabelled image.',
    }
  }

  if (status === 529 || type === 'overloaded_error') {
    return {
      status: 503,
      error: 'The screenshot reader is busy right now. Try again in a moment.',
      logHint: 'Upstream reported overload.',
    }
  }

  return {
    status: 502,
    error: 'Could not read that screenshot. Try again, or enter the trade manually.',
    logHint: 'Unclassified upstream failure.',
  }
}
