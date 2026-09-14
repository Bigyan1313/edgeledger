// The upload endpoint: what it accepts, what it refuses, and the promise it has
// to keep — that reading a screenshot never writes anything to the journal.
//
// The Anthropic client is stubbed, so these run without an API key and without
// spending anything. What the model *sees* is measured separately by
// eval/run-accuracy.mjs against real images.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) {
  console.log('TEST_DATABASE_URL is not set — skipping the screenshot upload route tests.')
}

// A 1x1 PNG. Content is irrelevant: the stub decides what comes back.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const READING = {
  brokerPositionId: '184052117', brokerAccountId: '5039284', brokerPlatform: 'cTrader',
  pair: 'XAUUSD.pro', direction: 'long',
  entryTimeUtc: '2026-08-01T13:30:00Z', exitTimeUtc: '2026-08-01T15:02:00Z',
  entryPrice: 2350.15, stopLoss: 2345, takeProfit: 2365, exitPrice: 2360.4,
  lotSize: 0.5, pnl: 512.5, isClosed: true, unreadableFields: [],
}

// Stands in for the model. `next` sets what the next call returns or throws.
function stubClient() {
  const state = { reading: READING, error: null, calls: 0 }
  return {
    state,
    messages: {
      create: async () => {
        state.calls++
        if (state.error) throw state.error
        return {
          content: [{ type: 'tool_use', name: 'record_trade_from_screenshot', input: state.reading }],
          usage: { input_tokens: 1200, output_tokens: 180 },
        }
      },
    },
  }
}

let server, baseUrl, prisma, token, userId, stub

before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: express }, { createExtractRouter }, { default: client }, { signToken }, { requireAuth }] =
    await Promise.all([
      import('express'),
      import('../src/routes/extract.js'),
      import('../src/prisma/client.js'),
      import('../src/auth/jwt.js'),
      import('../src/auth/middleware.js'),
    ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: 'extract@example.com' } })
  const user = await prisma.user.create({ data: { email: 'extract@example.com', passwordHash: 'x' } })
  userId = user.id
  token = signToken(userId)

  stub = stubClient()
  const app = express()
  app.use(express.json({ limit: '12mb' }))
  app.use('/api/trades', requireAuth, createExtractRouter({ client: stub }))

  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL) return
  // Cascade removes this user's trades; other suites' rows are left alone.
  await prisma?.user.deleteMany({ where: { email: 'extract@example.com' } })
  await prisma?.$disconnect()
  await new Promise(resolve => server?.close(resolve))
})

async function post(body, opts = {}) {
  const res = await fetch(`${baseUrl}/trades/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('uploading a screenshot', () => {
  test('a valid image comes back as a reviewable draft', async () => {
    stub.state.reading = READING
    const { status, body } = await post({ image: PNG })
    assert.equal(status, 200)
    assert.equal(body.fields.brokerPositionId, '184052117')
    assert.equal(body.fields.pair, 'XAUUSD.pro')
    assert.equal(body.fields.entryPrice, 2350.15)
    assert.equal(body.coverage.found, body.coverage.total)
  })

  test('reading a screenshot never creates a trade', async () => {
    const before = await prisma.trade.count({ where: { userId } })
    await post({ image: PNG })
    await post({ image: PNG })
    assert.equal(await prisma.trade.count({ where: { userId } }), before,
      'extraction must be read-only — the user saves, not the importer')
  })

  test('the judgement axes are never returned from an image', async () => {
    const { body } = await post({ image: PNG })
    assert.equal(body.fields.technicalSetup, null)
    assert.equal(body.fields.emotionalState, null)
  })

  test('an import of a closed trade warns that it is not contemporaneous', async () => {
    stub.state.reading = { ...READING, isClosed: true }
    const { body } = await post({ image: PNG })
    assert.equal(body.journaledAfterOutcome, true)
  })

  test('an open position is not flagged as retroactive', async () => {
    stub.state.reading = { ...READING, isClosed: false, exitPrice: null, pnl: null }
    const { body } = await post({ image: PNG })
    assert.equal(body.journaledAfterOutcome, false)
  })

  test('authentication is required', async () => {
    const res = await fetch(`${baseUrl}/trades/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: PNG }),
    })
    assert.equal(res.status, 401)
  })
})

describe('rejecting bad uploads', () => {
  test('a missing or non-data-URL image is refused before the model is called', async () => {
    const callsBefore = stub.state.calls
    for (const image of [undefined, null, '', 'https://example.com/a.png', 'not an image']) {
      const { status } = await post({ image })
      assert.equal(status, 400, `expected ${JSON.stringify(image)} to be refused`)
    }
    assert.equal(stub.state.calls, callsBefore, 'nothing should have been billed')
  })

  test('a non-image data URL is refused by media type', async () => {
    const { status, body } = await post({ image: 'data:application/pdf;base64,AAAA' })
    assert.equal(status, 400)
    assert.match(body.error, /Unsupported image type/)
  })

  test('an oversized image is refused with its size', async () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024)
    const { status, body } = await post({ image: huge })
    assert.equal(status, 400)
    assert.match(body.error, /MB/)
  })

  test('an image with no trade in it is reported, not turned into one', async () => {
    stub.state.reading = null
    const { status, body } = await post({ image: PNG })
    assert.equal(status, 422)
    assert.match(body.error, /doesn't look like a trading screenshot/i)
    stub.state.reading = READING
  })

  test('a rate limit is surfaced as retryable rather than as a generic failure', async () => {
    stub.state.error = Object.assign(new Error('rate limited'), { status: 429 })
    const { status, body } = await post({ image: PNG })
    assert.equal(status, 429)
    assert.match(body.error, /Wait a moment/i)
    stub.state.error = null
  })

  test('an upstream failure does not leak internals to the client', async () => {
    stub.state.error = Object.assign(new Error('sk-ant-secret leaked in message'), { status: 500 })
    const { status, body } = await post({ image: PNG })
    assert.equal(status, 502)
    assert.ok(!body.error.includes('sk-ant'), 'the client must not see upstream error text')
    stub.state.error = null
  })
})

describe('guards applied to what the model returned', () => {
  test('a volume read as a lot size is dropped before it reaches the form', async () => {
    stub.state.reading = { ...READING, lotSize: 100000 }
    const { body } = await post({ image: PNG })
    assert.equal(body.fields.lotSize, null)
    assert.ok(body.warnings.some(w => w.field === 'lotSize'))
    stub.state.reading = READING
  })

  test('a stop on the wrong side of entry drops both prices', async () => {
    stub.state.reading = { ...READING, direction: 'long', entryPrice: 2350, stopLoss: 2360 }
    const { body } = await post({ image: PNG })
    assert.equal(body.fields.stopLoss, null)
    assert.equal(body.fields.entryPrice, null)
    stub.state.reading = READING
  })

  test('coverage reports what still needs typing', async () => {
    stub.state.reading = { ...READING, brokerPositionId: null, stopLoss: null }
    const { body } = await post({ image: PNG })
    assert.ok(body.coverage.missing.includes('brokerPositionId'))
    assert.ok(body.coverage.missing.includes('stopLoss'))
    stub.state.reading = READING
  })
})

describe('duplicate imports', () => {
  test('re-importing a position already in the journal is caught before saving', async () => {
    const existing = await prisma.trade.create({
      data: {
        userId, schemaVersion: 2, brokerPositionId: '184052117', brokerAccountId: '5039284',
        pair: 'XAUUSD.pro', direction: 'long', entryTimeUtc: new Date('2026-08-01T13:30:00Z'),
        entryStage: 'complete', journaledAt: new Date(), dataQualityFlags: [],
      },
    })

    stub.state.reading = READING
    const { body } = await post({ image: PNG })
    assert.equal(body.duplicateOf?.id, existing.id)
    assert.ok(body.warnings.some(w => w.field === 'brokerPositionId' && /already logged/i.test(w.message)))

    await prisma.trade.delete({ where: { id: existing.id } })
  })

  test('a position not yet logged is not flagged as a duplicate', async () => {
    stub.state.reading = { ...READING, brokerPositionId: '999999999' }
    const { body } = await post({ image: PNG })
    assert.equal(body.duplicateOf, null)
    stub.state.reading = READING
  })
})

// The mapping from an upstream failure to what the operator and the user each
// get told. Pure, so unlike the rest of this file it needs no database — and it
// is worth testing precisely because the failures it separates (a rejected key,
// an empty balance, a bad image) are indistinguishable from the browser once
// they have been flattened into a single 502.
rawDescribe('upstream failures are told apart', () => {
  let describeUpstreamFailure
  before(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://unused@localhost:5432/unused'
    ;({ describeUpstreamFailure } = await import('../src/routes/extract.js'))
  })

  test('a rejected API key reads as misconfiguration, not as a bad screenshot', () => {
    const r = describeUpstreamFailure(Object.assign(new Error('x'), { status: 401 }))
    assert.equal(r.status, 503)
    assert.match(r.error, /ANTHROPIC_API_KEY/)
    assert.doesNotMatch(r.error, /try again/i, 'retrying cannot fix a rejected key')
  })

  test('an empty credit balance names the account, not the image', () => {
    const err = Object.assign(new Error('Your credit balance is too low to access the API'), { status: 400 })
    const r = describeUpstreamFailure(err)
    assert.equal(r.status, 503)
    assert.match(r.error, /out of credit/i)
  })

  test('an unavailable model is reported as a server problem', () => {
    const r = describeUpstreamFailure(Object.assign(new Error('x'), { status: 404 }))
    assert.equal(r.status, 503)
    assert.match(r.error, /model/i)
    assert.match(r.logHint, /claude-haiku/)
  })

  test('an image refused upstream is a 400 the user can act on', () => {
    const r = describeUpstreamFailure(Object.assign(new Error('x'), { status: 413 }))
    assert.equal(r.status, 400)
    assert.match(r.error, /crop|scale/i)
  })

  test('overload is transient and says so', () => {
    const r = describeUpstreamFailure(Object.assign(new Error('x'), { status: 529 }))
    assert.equal(r.status, 503)
    assert.match(r.error, /try again/i)
  })

  test('an unrecognised failure still falls back to the generic 502', () => {
    const r = describeUpstreamFailure(Object.assign(new Error('x'), { status: 500 }))
    assert.equal(r.status, 502)
  })

  test('no branch ever forwards the upstream message to the client', () => {
    for (const status of [401, 403, 400, 404, 413, 500, 529]) {
      const err = Object.assign(new Error('request failed: x-api-key sk-ant-secret-value'), { status })
      const r = describeUpstreamFailure(err)
      assert.ok(!r.error.includes('sk-ant'), `status ${status} leaked the key into the client message`)
    }
  })
})
