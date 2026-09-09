// Screenshot → trade draft.
//
// The governing rule, and the reason this file is mostly prompt and validation:
// a hallucinated number in a trading journal is worse than a blank one. A blank
// field asks the user to fill it in; a confident wrong entry price silently
// corrupts every R-multiple computed from it. So the model is instructed to
// report only what it can literally read, and everything it returns is treated
// as a *draft* the user confirms — never as a saved trade.

import { BROKER_PLATFORMS, DIRECTIONS } from './tradeSchema.js'

// Haiku 4.5: this is a read-the-pixels extraction, not a reasoning task, and it
// runs on every screenshot the user uploads. Explicitly the user's choice.
export const EXTRACTION_MODEL = 'claude-haiku-4-5'

// Images are sent inline as base64. A broker screenshot is well under this; the
// cap exists so a pasted 20MB PNG fails fast with a clear message instead of
// being billed for.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const SUPPORTED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// Every field the model may fill. Deliberately nullable *everywhere*: a broker's
// position panel rarely shows all of these at once, and "not shown" has to be
// expressible or the model will invent something to fill the slot.
export const EXTRACTION_TOOL = {
  name: 'record_trade_from_screenshot',
  description:
    'Record the trade details that are literally visible in the screenshot. ' +
    'Use null for any field that is not shown — never infer, compute, or guess a value.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      brokerPositionId: { type: ['string', 'null'], description: 'The platform\'s own Position ID / Deal ID, exactly as shown.' },
      brokerAccountId: { type: ['string', 'null'], description: 'Account number or name, exactly as shown.' },
      brokerPlatform: { type: ['string', 'null'], enum: [...BROKER_PLATFORMS, null], description: 'Which platform the screenshot is from, if identifiable from its UI.' },
      pair: { type: ['string', 'null'], description: 'The instrument symbol exactly as the broker writes it, e.g. "XAUUSD.pro". Do not normalise or expand it.' },
      direction: { type: ['string', 'null'], enum: [...DIRECTIONS, null], description: 'long for Buy, short for Sell.' },
      entryTimeUtc: { type: ['string', 'null'], description: 'Entry/open time as an ISO 8601 timestamp. Only if a date AND time are both visible.' },
      exitTimeUtc: { type: ['string', 'null'], description: 'Exit/close time as an ISO 8601 timestamp. Only if a date AND time are both visible.' },
      entryPrice: { type: ['number', 'null'], description: 'Open/entry price.' },
      stopLoss: { type: ['number', 'null'], description: 'Stop loss price. Null if the S/L column is empty or shows a dash.' },
      takeProfit: { type: ['number', 'null'], description: 'Take profit price. Null if empty.' },
      exitPrice: { type: ['number', 'null'], description: 'Close/exit price.' },
      lotSize: { type: ['number', 'null'], description: 'Position size in lots/volume.' },
      pnl: { type: ['number', 'null'], description: 'Realised profit or loss in account currency. Negative for a loss.' },
      isClosed: { type: 'boolean', description: 'True if the screenshot shows a closed/historical position, false if it is still open.' },
      unreadableFields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of fields that appear in the screenshot but could not be read confidently (blurred, cropped, truncated).',
      },
    },
    required: [
      'brokerPositionId', 'brokerAccountId', 'brokerPlatform', 'pair', 'direction',
      'entryTimeUtc', 'exitTimeUtc', 'entryPrice', 'stopLoss', 'takeProfit',
      'exitPrice', 'lotSize', 'pnl', 'isClosed', 'unreadableFields',
    ],
    additionalProperties: false,
  },
}

export const EXTRACTION_SYSTEM_PROMPT = `You read broker trading screenshots and transcribe the trade details you can see.

You are a transcriber, not an analyst. The single rule that matters:

  Report only what is literally legible in the image. Everything else is null.

Specifically:
- Never compute a value from other values. If P&L is not shown, it is null — do not derive it from entry and exit prices.
- Never infer a stop loss from a "risk" figure, or an entry time from a date alone.
- Never expand, normalise, or correct a symbol. If it reads "XAUUSD.pro", that is the value — not "XAUUSD" or "Gold".
- If a number is cut off, blurred, or ambiguous, set the field to null and name it in unreadableFields.
- A dash, an em dash, "-", or an empty cell means the field is not set. That is null, not zero.
- Negative P&L is negative. Parentheses, a minus sign, or red text all mean a loss.

If the image is not a trading screenshot at all, set every field to null and isClosed to false.

The person using this will review everything you return before it is saved. A null they have to fill in costs them five seconds. A wrong number they do not notice corrupts their records permanently. Prefer null.`

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

// JavaScript's Date parser is far too permissive to point at model output:
// `new Date('01/08/2026 maybe')` returns 2008-05-01 rather than an error. A
// garbage timestamp silently becoming a confident wrong date is exactly the
// corruption this whole module exists to prevent, so the shape is checked
// against strict ISO 8601 before Date is allowed near it.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/

function toIso(value) {
  if (typeof value !== 'string') return { iso: null, assumedUtc: false }
  const text = value.trim()
  if (!ISO_8601.test(text)) return { iso: null, assumedUtc: false }

  // No offset means the screenshot showed a wall clock without a zone. Parsing
  // it as UTC is a guess, so it is parsed as UTC *and* reported as one.
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(text)
  const d = new Date(hasOffset ? text : `${text.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return { iso: null, assumedUtc: false }
  return { iso: d.toISOString(), assumedUtc: !hasOffset }
}

// Everything the model returns passes through here before it reaches the client.
// The model is instructed not to invent values; this is what enforces it when
// the instruction is not followed.
export function normalizeExtraction(raw) {
  const entryTime = toIso(raw?.entryTimeUtc)
  const exitTime = toIso(raw?.exitTimeUtc)

  const out = {
    brokerPositionId: clean(raw?.brokerPositionId),
    brokerAccountId: clean(raw?.brokerAccountId),
    brokerPlatform: BROKER_PLATFORMS.includes(raw?.brokerPlatform) ? raw.brokerPlatform : null,
    pair: clean(raw?.pair),
    direction: DIRECTIONS.includes(raw?.direction) ? raw.direction : null,
    entryTimeUtc: entryTime.iso,
    exitTimeUtc: exitTime.iso,
    entryPrice: isNum(raw?.entryPrice) ? raw.entryPrice : null,
    stopLoss: isNum(raw?.stopLoss) ? raw.stopLoss : null,
    takeProfit: isNum(raw?.takeProfit) ? raw.takeProfit : null,
    exitPrice: isNum(raw?.exitPrice) ? raw.exitPrice : null,
    lotSize: isNum(raw?.lotSize) ? raw.lotSize : null,
    pnl: isNum(raw?.pnl) ? raw.pnl : null,
    isClosed: raw?.isClosed === true,
  }

  const warnings = []

  // Task 6's whole point: a timestamp whose zone nobody recorded is not a fact.
  for (const [field, parsed] of [['entryTimeUtc', entryTime], ['exitTimeUtc', exitTime]]) {
    if (parsed.assumedUtc) {
      warnings.push({
        field,
        message: 'The screenshot showed a time but no timezone. Read as UTC — correct it if your platform displays local time.',
      })
    }
  }

  const unreadable = Array.isArray(raw?.unreadableFields)
    ? raw.unreadableFields.filter(f => typeof f === 'string')
    : []
  for (const field of unreadable) {
    warnings.push({ field, message: `Could not be read from the screenshot — check this one against your platform.` })
  }

  // A price of zero or below is not a price. This catches a misread decimal or a
  // stray "0" in an empty cell before it reaches the form.
  for (const field of ['entryPrice', 'stopLoss', 'takeProfit', 'exitPrice', 'lotSize']) {
    if (out[field] !== null && out[field] <= 0) {
      warnings.push({ field, message: `Read as ${out[field]}, which is not a valid ${field}. Dropped — enter it manually.` })
      out[field] = null
    }
  }

  // The two axes are judgements about the trade, and no screenshot contains
  // them. Left blank on purpose so the user states them rather than inheriting
  // a default — the same reason v2 removed defaults everywhere else.
  out.technicalSetup = null
  out.emotionalState = null

  // Stop on the wrong side of entry means one of the two was misread. Both are
  // dropped rather than guessing which.
  if (isNum(out.entryPrice) && isNum(out.stopLoss) && out.direction) {
    const wrongSide = out.direction === 'long' ? out.stopLoss >= out.entryPrice : out.stopLoss <= out.entryPrice
    if (wrongSide) {
      warnings.push({
        field: 'stopLoss',
        message: `Stop (${out.stopLoss}) is on the wrong side of entry (${out.entryPrice}) for a ${out.direction}. One of them was misread — both dropped.`,
      })
      out.stopLoss = null
      out.entryPrice = null
    }
  }

  return { fields: out, warnings, unreadableFields: unreadable }
}

// How much of what the journal needs did the screenshot actually supply? Shown
// to the user so "the import got most of it" vs "the import got almost nothing"
// is visible at a glance rather than discovered field by field.
export function extractionCoverage(fields) {
  const wanted = ['brokerPositionId', 'brokerAccountId', 'pair', 'direction',
                  'entryTimeUtc', 'entryPrice', 'stopLoss', 'lotSize']
  const found = wanted.filter(f => fields[f] !== null && fields[f] !== undefined)
  return { found: found.length, total: wanted.length, missing: wanted.filter(f => !found.includes(f)) }
}

// Data URL → the parts the Messages API needs, with the format and size checks
// done before anything is billed.
export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return { error: 'No image was provided.' }
  const match = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return { error: 'The image must be a base64 data URL.' }
  const [, mediaType, data] = match
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType.toLowerCase())) {
    return { error: `Unsupported image type "${mediaType}". Use PNG, JPEG, WebP, or GIF.` }
  }
  const bytes = Math.floor(data.length * 3 / 4)
  if (bytes > MAX_IMAGE_BYTES) {
    return { error: `That image is ${(bytes / 1024 / 1024).toFixed(1)}MB. Keep screenshots under ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` }
  }
  return { mediaType: mediaType.toLowerCase(), data }
}
