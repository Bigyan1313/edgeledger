// Screenshot extraction: the guard rails that hold when the model misbehaves.
//
// The model is instructed to null anything it cannot read. These tests cover
// what happens when it doesn't — because a wrong number that reaches the
// journal is permanent, and an instruction is not an enforcement mechanism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeExtraction,
  extractionCoverage,
  parseImageDataUrl,
  EXTRACTION_TOOL,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_IMAGE_BYTES,
} from '../src/domain/extraction.js'

const goodRead = (over = {}) => ({
  brokerPositionId: '184052117',
  brokerAccountId: '5039284',
  brokerPlatform: 'cTrader',
  pair: 'XAUUSD.pro',
  direction: 'long',
  entryTimeUtc: '2026-08-01T13:30:00Z',
  exitTimeUtc: '2026-08-01T15:00:00Z',
  entryPrice: 2350,
  stopLoss: 2345,
  takeProfit: 2365,
  exitPrice: 2360,
  lotSize: 0.5,
  pnl: 500,
  isClosed: true,
  unreadableFields: [],
  ...over,
})

test('a clean read passes through intact', () => {
  const { fields, warnings } = normalizeExtraction(goodRead())
  assert.equal(fields.brokerPositionId, '184052117')
  assert.equal(fields.pair, 'XAUUSD.pro')
  assert.equal(fields.entryPrice, 2350)
  assert.equal(fields.isClosed, true)
  assert.deepEqual(warnings, [])
})

test('the symbol is never normalised — the broker string is the join key', () => {
  const { fields } = normalizeExtraction(goodRead({ pair: 'NAS100.pro' }))
  assert.equal(fields.pair, 'NAS100.pro')
})

test('the two judgement axes are always left blank', () => {
  // No screenshot contains why you took the trade or how you felt. Leaving them
  // null forces an answer instead of letting a default masquerade as one.
  const { fields } = normalizeExtraction(goodRead())
  assert.equal(fields.technicalSetup, null)
  assert.equal(fields.emotionalState, null)
})

test('an unknown enum value is dropped rather than passed through', () => {
  const { fields } = normalizeExtraction(goodRead({ direction: 'buy', brokerPlatform: 'Tradovate' }))
  assert.equal(fields.direction, null, '"buy" is not one of our directions')
  assert.equal(fields.brokerPlatform, null)
})

test('a zero or negative price is dropped and reported, not stored', () => {
  const { fields, warnings } = normalizeExtraction(goodRead({ entryPrice: 0, lotSize: -0.5 }))
  assert.equal(fields.entryPrice, null)
  assert.equal(fields.lotSize, null)
  assert.ok(warnings.some(w => w.field === 'entryPrice'))
  assert.ok(warnings.some(w => w.field === 'lotSize'))
})

test('an empty S/L cell read as 0 does not become a stop of zero', () => {
  // The most likely misread on a real screenshot: a dash in the S/L column
  // coming back as 0. A stop of 0 would compute a catastrophic R-multiple.
  const { fields } = normalizeExtraction(goodRead({ stopLoss: 0 }))
  assert.equal(fields.stopLoss, null)
})

test('a stop on the wrong side of entry drops both, since either could be the misread', () => {
  const { fields, warnings } = normalizeExtraction(
    goodRead({ direction: 'long', entryPrice: 2350, stopLoss: 2360 })
  )
  assert.equal(fields.stopLoss, null)
  assert.equal(fields.entryPrice, null)
  assert.match(warnings.find(w => w.field === 'stopLoss').message, /wrong side/i)
})

test('a valid short is not mistaken for a wrong-side stop', () => {
  // A coherent short: entered 2360, stop above at 2370, exited lower for a win.
  const { fields, warnings } = normalizeExtraction(
    goodRead({ direction: 'short', entryPrice: 2360, stopLoss: 2370, exitPrice: 2350, pnl: 500 })
  )
  assert.equal(fields.stopLoss, 2370)
  assert.equal(fields.entryPrice, 2360)
  assert.deepEqual(warnings, [])
})

test('an unparseable timestamp becomes null rather than an Invalid Date', () => {
  const { fields } = normalizeExtraction(goodRead({ entryTimeUtc: '01/08/2026 maybe', exitTimeUtc: null }))
  assert.equal(fields.entryTimeUtc, null)
  assert.equal(fields.exitTimeUtc, null)
})

test('timestamps are normalised to UTC ISO 8601', () => {
  const { fields } = normalizeExtraction(goodRead({ entryTimeUtc: '2026-08-01T08:30:00-05:00' }))
  assert.equal(fields.entryTimeUtc, '2026-08-01T13:30:00.000Z')
})

test('fields the model flagged as unreadable surface as warnings', () => {
  const { warnings } = normalizeExtraction(goodRead({ pnl: null, unreadableFields: ['pnl'] }))
  assert.ok(warnings.some(w => w.field === 'pnl'))
})

test('a non-trading image yields nothing rather than a plausible-looking trade', () => {
  const empty = Object.fromEntries(Object.keys(goodRead()).map(k => [k, null]))
  const { fields } = normalizeExtraction({ ...empty, isClosed: false, unreadableFields: [] })
  assert.equal(fields.pair, null)
  assert.equal(fields.entryPrice, null)
  assert.equal(fields.isClosed, false)
})

test('garbage input does not throw', () => {
  for (const junk of [null, undefined, {}, { pair: 42 }, { entryPrice: 'two thousand' }]) {
    const { fields } = normalizeExtraction(junk)
    assert.equal(fields.pair, null)
    assert.equal(fields.entryPrice, null)
  }
})

test('coverage reports what the screenshot actually supplied', () => {
  const full = extractionCoverage(normalizeExtraction(goodRead()).fields)
  assert.equal(full.found, full.total)
  assert.deepEqual(full.missing, [])

  const sparse = extractionCoverage(
    normalizeExtraction(goodRead({ brokerPositionId: null, stopLoss: null })).fields
  )
  assert.equal(sparse.found, sparse.total - 2)
  assert.ok(sparse.missing.includes('brokerPositionId'))
  assert.ok(sparse.missing.includes('stopLoss'))
})

// --- image handling --------------------------------------------------------

test('a valid data URL is split into media type and payload', () => {
  const r = parseImageDataUrl('data:image/png;base64,iVBORw0KGgo=')
  assert.equal(r.mediaType, 'image/png')
  assert.equal(r.data, 'iVBORw0KGgo=')
  assert.equal(r.error, undefined)
})

test('non-images and malformed URLs are refused before anything is billed', () => {
  assert.match(parseImageDataUrl('data:application/pdf;base64,AAAA').error, /Unsupported image type/)
  assert.match(parseImageDataUrl('https://example.com/a.png').error, /base64 data URL/)
  assert.match(parseImageDataUrl(null).error, /No image/)
})

test('an oversized image is refused with its actual size', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024)
  assert.match(parseImageDataUrl(huge).error, /MB/)
})

// --- the tool contract -----------------------------------------------------

test('every extractable field is nullable, so "not shown" is always expressible', () => {
  const props = EXTRACTION_TOOL.input_schema.properties
  for (const [name, spec] of Object.entries(props)) {
    if (name === 'isClosed' || name === 'unreadableFields') continue
    assert.ok(Array.isArray(spec.type) && spec.type.includes('null'),
      `${name} must be nullable — a field that cannot be null invites invention`)
  }
})

test('the schema is strict and closed', () => {
  assert.equal(EXTRACTION_TOOL.strict, true)
  assert.equal(EXTRACTION_TOOL.input_schema.additionalProperties, false)
  assert.deepEqual(
    EXTRACTION_TOOL.input_schema.required.sort(),
    Object.keys(EXTRACTION_TOOL.input_schema.properties).sort(),
    'strict mode requires every property to be listed as required'
  )
})

// --- regression: lenient Date parsing ---------------------------------------

test('JS Date leniency cannot turn garbage into a confident wrong date', () => {
  // `new Date('01/08/2026 maybe')` returns 2008-05-01. Anything that is not
  // strict ISO 8601 must be refused outright.
  for (const junk of ['01/08/2026 maybe', 'Aug 1 2026', '2026-08-01 1:30pm', 'yesterday', '2026']) {
    const { fields } = normalizeExtraction(goodRead({ entryTimeUtc: junk }))
    assert.equal(fields.entryTimeUtc, null, `"${junk}" must not parse`)
  }
})

test('a timestamp with no timezone is read as UTC and says so', () => {
  const { fields, warnings } = normalizeExtraction(goodRead({ entryTimeUtc: '2026-08-01T13:30:00' }))
  assert.equal(fields.entryTimeUtc, '2026-08-01T13:30:00.000Z')
  assert.match(warnings.find(w => w.field === 'entryTimeUtc').message, /no timezone/i)
})

test('a timestamp with an explicit offset is trusted and not warned about', () => {
  const { fields, warnings } = normalizeExtraction(goodRead({ entryTimeUtc: '2026-08-01T08:30:00-05:00' }))
  assert.equal(fields.entryTimeUtc, '2026-08-01T13:30:00.000Z')
  assert.ok(!warnings.some(w => w.field === 'entryTimeUtc'))
})

// --- guards against the misreads that actually cost money -------------------
//
// Each of these catches a wrong value using only cross-field arithmetic, so it
// holds regardless of how well the model read the image.

test('a Volume column read as lots is caught before it reaches risk', () => {
  // cTrader and MT5 show FX size in units: 100,000 units = 1.0 lots. Taken as a
  // lot size, that inflates riskDollars by five orders of magnitude.
  for (const volume of [1000, 10000, 100000, 1_000_000]) {
    const { fields, warnings } = normalizeExtraction(goodRead({ lotSize: volume }))
    assert.equal(fields.lotSize, null, `${volume} should not survive as a lot size`)
    assert.match(warnings.find(w => w.field === 'lotSize').message, /volume in units/i)
  }
})

test('a realistic lot size is left alone', () => {
  for (const lots of [0.01, 0.1, 0.5, 2, 16.83, 999]) {
    const { fields } = normalizeExtraction(goodRead({ lotSize: lots }))
    assert.equal(fields.lotSize, lots)
  }
})

test('a P&L sign that contradicts the price move is reported', () => {
  // Long 2350 -> 2360 is a win; a negative P&L means one of the three is wrong.
  const { warnings } = normalizeExtraction(
    goodRead({ direction: 'long', entryPrice: 2350, exitPrice: 2360, pnl: -500 })
  )
  assert.match(warnings.find(w => w.field === 'pnl').message, /disagrees/i)
})

test('a losing trade with a consistent sign raises nothing', () => {
  const { warnings } = normalizeExtraction(
    goodRead({ direction: 'long', entryPrice: 2350, exitPrice: 2340, pnl: -500 })
  )
  assert.deepEqual(warnings, [])
})

test('a scratch exit imposes no P&L constraint — fees decide the sign', () => {
  const { warnings } = normalizeExtraction(
    goodRead({ direction: 'long', entryPrice: 2350, exitPrice: 2350, pnl: -8 })
  )
  assert.deepEqual(warnings, [])
})

test('an exit before entry is flagged as a likely day/month swap', () => {
  const { warnings } = normalizeExtraction(goodRead({
    entryTimeUtc: '2026-08-09T13:30:00Z',
    exitTimeUtc: '2026-09-08T15:00:00Z'.replace('2026-09-08', '2026-08-01'),
  }))
  assert.match(warnings.find(w => w.field === 'exitTimeUtc').message, /day\/month swap/i)
})

test('the guards compose — several misreads are all reported at once', () => {
  const { fields, warnings } = normalizeExtraction(goodRead({
    lotSize: 100000,
    stopLoss: 0,
    entryPrice: 2350, exitPrice: 2360, pnl: -500,
  }))
  assert.equal(fields.lotSize, null)
  assert.equal(fields.stopLoss, null)
  const flagged = warnings.map(w => w.field)
  assert.ok(flagged.includes('lotSize'))
  assert.ok(flagged.includes('stopLoss'))
  assert.ok(flagged.includes('pnl'))
})

test('the prompt names the number-format traps explicitly', () => {
  // These are the transcription failures that produce a plausible wrong number
  // rather than an obvious one, so the prompt has to address them by name.
  for (const trap of [/1\.234,56/, /Volume and lots are different units/i, /\(55\.00\)/, /do not round/i]) {
    assert.match(EXTRACTION_SYSTEM_PROMPT, trap, `prompt should address ${trap}`)
  }
})
