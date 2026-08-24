// The Task 5 validation rules, one test per acceptance criterion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateStageA, validateStageB } from '../src/domain/validation.js'

// A Stage A entry with nothing wrong with it. Each test below breaks exactly
// one thing, so a failure names the rule that broke.
const validStageA = () => ({
  brokerPositionId: '123456789',
  brokerAccountId: 'CT-4471',
  brokerPlatform: 'cTrader',
  pair: 'XAUUSD.pro',
  direction: 'long',
  entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
  captureTimezone: 'America/Chicago',
  entryPrice: 2350,
  stopLoss: 2345,
  takeProfit: 2365,
  lotSize: 0.5,
  technicalSetup: 'Break & retest',
  emotionalState: 'Calm',
  followedChecklist: true,
  fullPort: false,
  notes: 'Swept the Asia high, waited for the retest.',
})

const fieldsWithErrors = (errors) => errors.map(e => e.field)

test('a well-formed Stage A entry is accepted', () => {
  assert.deepEqual(validateStageA(validStageA()), [])
})

// --- Task 1: broker linkage ------------------------------------------------

test('Task 1: a trade without brokerPositionId is rejected with a clear message', () => {
  const errors = validateStageA({ ...validStageA(), brokerPositionId: undefined })
  assert.ok(fieldsWithErrors(errors).includes('brokerPositionId'))
  const message = errors.find(e => e.field === 'brokerPositionId').message
  assert.match(message, /required/i)
  assert.match(message, /broker/i)
})

test('Task 1: brokerAccountId and a known platform are both required', () => {
  const errors = validateStageA({ ...validStageA(), brokerAccountId: '  ', brokerPlatform: 'Tradovate' })
  assert.ok(fieldsWithErrors(errors).includes('brokerAccountId'))
  assert.ok(fieldsWithErrors(errors).includes('brokerPlatform'))
})

// --- Task 3: two orthogonal axes, neither defaulted ------------------------

test('Task 3: both setup axes are required with no default', () => {
  const { technicalSetup, emotionalState, ...withoutAxes } = validStageA()
  const errors = validateStageA(withoutAxes)
  assert.ok(fieldsWithErrors(errors).includes('technicalSetup'))
  assert.ok(fieldsWithErrors(errors).includes('emotionalState'))
})

test('Task 3: a revenge trade keeps its technical setup — the axes are independent', () => {
  const errors = validateStageA({
    ...validStageA(),
    technicalSetup: 'Break & retest',
    emotionalState: 'Revenge',
  })
  assert.deepEqual(errors, [])
})

test('Task 3: the retired v1 setup values are no longer accepted', () => {
  for (const retired of ['Other', 'News / Full-port', 'FOMO / Impulsive']) {
    const errors = validateStageA({ ...validStageA(), technicalSetup: retired })
    assert.ok(
      fieldsWithErrors(errors).includes('technicalSetup'),
      `expected "${retired}" to be rejected as a technical setup`
    )
  }
})

// --- Task 4: no silent defaults --------------------------------------------

test('Task 4: followedChecklist and fullPort must be answered explicitly', () => {
  const { followedChecklist, fullPort, ...unanswered } = validStageA()
  const errors = validateStageA(unanswered)
  assert.ok(fieldsWithErrors(errors).includes('followedChecklist'))
  assert.ok(fieldsWithErrors(errors).includes('fullPort'))
})

test('Task 4: false is an answer, and is accepted as one', () => {
  const errors = validateStageA({ ...validStageA(), followedChecklist: false, fullPort: false })
  assert.deepEqual(errors, [])
})

// --- Task 5: the six validation rules --------------------------------------

test('Task 5 rule 1: lotSize must be > 0, including the v1 negatives', () => {
  for (const lotSize of [-16.83, -0.5, 0]) {
    const errors = validateStageA({ ...validStageA(), lotSize })
    assert.ok(fieldsWithErrors(errors).includes('lotSize'), `expected lotSize ${lotSize} to be rejected`)
    assert.match(errors.find(e => e.field === 'lotSize').message, /greater than 0/)
  }
})

test('Task 5 rule 2: stopLoss is required and must be > 0', () => {
  const missing = validateStageA({ ...validStageA(), stopLoss: null })
  assert.match(missing.find(e => e.field === 'stopLoss').message, /required/i)

  const negative = validateStageA({ ...validStageA(), stopLoss: -1 })
  assert.match(negative.find(e => e.field === 'stopLoss').message, /greater than 0/)
})

test('Task 5 rule 3: for a long, stopLoss must be below entryPrice', () => {
  const errors = validateStageA({ ...validStageA(), direction: 'long', entryPrice: 2350, stopLoss: 2360 })
  assert.match(errors.find(e => e.field === 'stopLoss').message, /long.*below entry/i)
})

test('Task 5 rule 4: for a short, stopLoss must be above entryPrice', () => {
  const errors = validateStageA({ ...validStageA(), direction: 'short', entryPrice: 2350, stopLoss: 2340 })
  assert.match(errors.find(e => e.field === 'stopLoss').message, /short.*above entry/i)

  const ok = validateStageA({ ...validStageA(), direction: 'short', entryPrice: 2350, stopLoss: 2360 })
  assert.deepEqual(ok, [])
})

test('Task 5: entryPrice is required', () => {
  const errors = validateStageA({ ...validStageA(), entryPrice: null })
  assert.match(errors.find(e => e.field === 'entryPrice').message, /required/i)
})

test('Task 5 rule 5: exitTime must be at or after entryTime', () => {
  const existing = { ...validStageA(), entryTimeUtc: new Date('2026-08-01T13:30:00Z') }
  const errors = validateStageB(
    { exitTimeUtc: new Date('2026-08-01T12:00:00Z'), exitPrice: 2360, pnl: 500 },
    existing
  )
  assert.match(errors.find(e => e.field === 'exitTimeUtc').message, /at or after entry time/i)

  const sameInstant = validateStageB(
    { exitTimeUtc: new Date('2026-08-01T13:30:00Z'), exitPrice: 2360, pnl: 500 },
    existing
  )
  assert.deepEqual(sameInstant, [], 'an exit at the entry instant is allowed')
})

test('Task 5 rule 6: pnl sign must agree with the price move', () => {
  const existing = { ...validStageA(), direction: 'long', entryPrice: 2350 }

  // Long, exited higher, but claims a loss.
  const wrong = validateStageB(
    { exitTimeUtc: new Date('2026-08-01T14:00:00Z'), exitPrice: 2360, pnl: -500 },
    existing
  )
  assert.match(wrong.find(e => e.field === 'pnl').message, /disagrees with the price move/i)

  // Same trade, consistent sign.
  const right = validateStageB(
    { exitTimeUtc: new Date('2026-08-01T14:00:00Z'), exitPrice: 2360, pnl: 500 },
    existing
  )
  assert.deepEqual(right, [])
})

test('Task 5 rule 6: a scratch exit imposes no constraint, because fees decide the sign', () => {
  const existing = { ...validStageA(), direction: 'long', entryPrice: 2350 }
  const errors = validateStageB(
    { exitTimeUtc: new Date('2026-08-01T14:00:00Z'), exitPrice: 2350, pnl: -8 },
    existing
  )
  assert.deepEqual(errors, [])
})

// --- Task 6: timestamps and instruments ------------------------------------

test('Task 6: "Other" is rejected as an instrument', () => {
  const errors = validateStageA({ ...validStageA(), pair: 'Other' })
  assert.match(errors.find(e => e.field === 'pair').message, /not an instrument/i)
})

test('Task 6: the broker\'s exact symbol string is accepted', () => {
  for (const pair of ['XAUUSD.pro', 'NAS100.pro', 'EURUSD', 'US30_i']) {
    assert.deepEqual(validateStageA({ ...validStageA(), pair }), [], `expected "${pair}" to be accepted`)
  }
})

test('Task 6: captureTimezone must be a real IANA zone', () => {
  // "CST" is US Central in Chicago and China Standard in Shanghai. Intl accepts
  // it; Task 6 must not, or the field reintroduces the ambiguity it exists to
  // remove.
  for (const ambiguous of ['CST', 'EST', 'GMT+2', 'Chicago', '']) {
    const errors = validateStageA({ ...validStageA(), captureTimezone: ambiguous })
    assert.ok(
      fieldsWithErrors(errors).includes('captureTimezone'),
      `expected "${ambiguous}" to be rejected as a capture timezone`
    )
  }

  for (const zone of ['Europe/London', 'America/Chicago', 'Asia/Kolkata', 'UTC']) {
    assert.deepEqual(
      validateStageA({ ...validStageA(), captureTimezone: zone }), [],
      `expected "${zone}" to be accepted`
    )
  }
})

test('Task 6: an unparseable entry timestamp is rejected', () => {
  const errors = validateStageA({ ...validStageA(), entryTimeUtc: null })
  assert.match(errors.find(e => e.field === 'entryTimeUtc').message, /ISO 8601/)
})

test('every rule reports its own field, so the form can mark them individually', () => {
  const errors = validateStageA({})
  const fields = new Set(fieldsWithErrors(errors))
  for (const expected of [
    'brokerPositionId', 'brokerAccountId', 'brokerPlatform', 'pair', 'direction',
    'entryTimeUtc', 'captureTimezone', 'entryPrice', 'stopLoss', 'lotSize',
    'technicalSetup', 'emotionalState', 'followedChecklist', 'fullPort',
  ]) {
    assert.ok(fields.has(expected), `expected an error for ${expected}`)
  }
  assert.ok(errors.every(e => e.message.length > 0))
})
