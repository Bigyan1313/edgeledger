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
// `strict: true` guarantees the arguments validate against this schema, which is
// what lets normalizeExtraction below trust the *shape* and spend its effort on
// the values. Strict mode accepts `anyOf`, so every nullable field is written
// that way: a bare `type: ['string', 'null']` union is not one of the supported
// forms, and an enum with `null` as a member is not either. Both were rejected
// for the whole schema, which failed every request identically no matter what
// the screenshot held — the schema had never been sent to the API, because the
// route tests stub the client and only the eval makes a real call.
const nullable = (type, description, extra = {}) => ({
  anyOf: [{ type, ...extra }, { type: 'null' }],
  description,
})

export const EXTRACTION_TOOL = {
  name: 'record_trade_from_screenshot',
  description:
    'Record the trade details that are literally visible in the screenshot. ' +
    'Use null for any field that is not shown — never infer, compute, or guess a value.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      brokerPositionId: nullable('string', 'The platform\'s own Position ID / Deal ID, exactly as shown.'),
      brokerAccountId: nullable('string', 'Account number or name, exactly as shown.'),
      brokerPlatform: nullable('string', 'Which platform the screenshot is from, if identifiable from its UI.', { enum: BROKER_PLATFORMS }),
      pair: nullable('string', 'The instrument symbol exactly as the broker writes it, e.g. "XAUUSD.pro". Do not normalise or expand it.'),
      direction: nullable('string', 'long for Buy, short for Sell.', { enum: DIRECTIONS }),
      entryTimeUtc: nullable('string', 'Entry/open time as an ISO 8601 timestamp. Only if a date AND time are both visible.'),
      exitTimeUtc: nullable('string', 'Exit/close time as an ISO 8601 timestamp. Only if a date AND time are both visible.'),
      entryPrice: nullable('number', 'Open/entry price.'),
      stopLoss: nullable('number', 'Stop loss price. Null if the S/L column is empty or shows a dash.'),
      takeProfit: nullable('number', 'Take profit price. Null if empty.'),
      exitPrice: nullable('number', 'Close/exit price.'),
      lotSize: nullable('number', 'Position size in lots/volume.'),
      pnl: nullable('number', 'Realised profit or loss in account currency. Negative for a loss.'),
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

Number formats trip transcription more than anything else. Read carefully:
- "1,234.56" is one thousand two hundred thirty-four point five six. "1.234,56" is the same number written the European way. Decide which convention the screenshot uses by looking at the other numbers on it, then read all of them the same way.
- Losses appear as "-55.00", "(55.00)", or plain red text. All three are negative.
- Volume and lots are different units. A "Volume" column reading 100,000 or 10k is units, not lots — 100,000 units of a standard FX pair is 1.0 lots. Report lotSize in LOTS. If the screenshot only shows units and you are not certain of the conversion, set lotSize to null and name it in unreadableFields.
- A price column may show more decimal places than the instrument trades in. Transcribe exactly what is printed; do not round.

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

  // A lot size in the thousands is a Volume column read as lots. 100,000 units
  // of a standard FX pair is 1.0 lots, so a "lot size" of 100000 would compute a
  // risk figure five orders of magnitude too large.
  if (isNum(out.lotSize) && out.lotSize >= 1000) {
    warnings.push({
      field: 'lotSize',
      message: `Read as ${out.lotSize}, which looks like a volume in units rather than lots. Dropped — enter the lot size your platform shows.`,
    })
    out.lotSize = null
  }

  // The sign of P&L has to agree with the direction the price actually moved. A
  // long that exited above entry cannot have lost money, so a disagreement means
  // one of the three was misread and none of them can be trusted on its own.
  if (isNum(out.pnl) && isNum(out.entryPrice) && isNum(out.exitPrice) && out.direction) {
    const move = out.direction === 'long' ? out.exitPrice - out.entryPrice : out.entryPrice - out.exitPrice
    const disagrees = (move > 0 && out.pnl < 0) || (move < 0 && out.pnl > 0)
    if (disagrees) {
      warnings.push({
        field: 'pnl',
        message: `P&L of ${out.pnl} disagrees with a ${out.direction} from ${out.entryPrice} to ${out.exitPrice}. One of these was misread — check all three against your platform.`,
      })
    }
  }

  // Exit before entry is a date misread — most often a day/month swap on a
  // non-ISO screenshot. Reported rather than dropped: the user can see at a
  // glance which of the two is wrong, and the form rejects the pair anyway.
  if (out.entryTimeUtc && out.exitTimeUtc && new Date(out.exitTimeUtc) < new Date(out.entryTimeUtc)) {
    warnings.push({
      field: 'exitTimeUtc',
      message: `Exit time reads earlier than entry time. Likely a day/month swap — check both dates.`,
    })
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

// The Messages request itself. Lives here rather than in the route so the eval
// harness can exercise the exact same call the app makes — an eval that hits a
// different prompt or schema measures the wrong thing.
export async function callExtractionModel(client, { mediaType, data }) {
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    system: [
      // Prompt and tool schema are byte-identical on every request, so they form
      // a stable cacheable prefix ahead of the volatile image.
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

  const call = response.content.find(b => b.type === 'tool_use' && b.name === EXTRACTION_TOOL.name)
  return { input: call?.input ?? null, usage: response.usage }
}
